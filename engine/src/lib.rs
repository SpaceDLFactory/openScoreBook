//! KBO scorebook scoring engine — pure, event-sourced.
//!
//! `derive(&Config, &[Event])` replays a game's event log into a `Derived`
//! snapshot (current field state + per-batter box score). No I/O; the same
//! function compiles to native (for `cargo test`) and wasm.
//!
//! Slice 1 covers plate-appearance results only. Runner advancement uses a
//! deterministic MVP model (documented per result in `apply_pa`); explicit
//! per-runner advances, pitch/hit coordinates, substitutions and base-running
//! events are later slices.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    Away,
    Home,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Half {
    Top,
    Bottom,
}

/// Identifies a player by their team and batting-order slot (0..=8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerRef {
    pub side: Side,
    pub slot: usize,
}

/// Batting lineups (9 names each, in batting order).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub away: Vec<String>,
    pub home: Vec<String>,
}

impl Config {
    pub fn name(&self, p: PlayerRef) -> &str {
        match p.side {
            Side::Away => &self.away[p.slot],
            Side::Home => &self.home[p.slot],
        }
    }
}

/// Outcome of a plate appearance. The batter is implicit (current batter of the
/// batting team); the engine resolves identity from lineup + batting index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PaResult {
    Single,
    Double,
    Triple,
    HomeRun,
    Walk,
    HitByPitch,
    Strikeout,
    GroundOut,
    FlyOut,
    /// Batter out + lead forced runner (from 1B) out.
    DoublePlay,
    /// Batter safe at 1B, lead forced runner (from 1B) out.
    FieldersChoice,
    /// Batter reaches on error (advances like a single; no hit, no RBI).
    Error,
    /// Batter out; runner on 3B scores.
    SacFly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Event {
    PlateAppearance { result: PaResult },
}

/// Per-batter batting line.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatLine {
    pub ab: u16,
    pub r: u16,
    pub h: u16,
    pub rbi: u16,
    pub bb: u16,
    pub so: u16,
}

/// Runs scored in one completed (or in-progress) half-inning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HalfLine {
    pub inning: u16,
    pub half: Half,
    pub runs: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    pub inning: u16,
    pub half: Half,
    pub outs: u8,
    /// bases[0]=1B, [1]=2B, [2]=3B.
    pub bases: [Option<PlayerRef>; 3],
    pub away_score: u16,
    pub home_score: u16,
    pub away_idx: usize,
    pub home_idx: usize,
    pub linescore: Vec<HalfLine>,
}

impl GameState {
    fn new() -> Self {
        GameState {
            inning: 1,
            half: Half::Top,
            outs: 0,
            bases: [None, None, None],
            away_score: 0,
            home_score: 0,
            away_idx: 0,
            home_idx: 0,
            linescore: Vec::new(),
        }
    }

    fn batting_side(&self) -> Side {
        match self.half {
            Half::Top => Side::Away,
            Half::Bottom => Side::Home,
        }
    }

    fn bat_idx(&self) -> usize {
        match self.batting_side() {
            Side::Away => self.away_idx,
            Side::Home => self.home_idx,
        }
    }

    fn advance_bat_idx(&mut self) {
        match self.batting_side() {
            Side::Away => self.away_idx = (self.away_idx + 1) % 9,
            Side::Home => self.home_idx = (self.home_idx + 1) % 9,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Derived {
    pub state: GameState,
    /// Box score keyed by batting slot, per side.
    pub away_box: Vec<BatLine>,
    pub home_box: Vec<BatLine>,
}

impl Derived {
    fn box_line(&mut self, p: PlayerRef) -> &mut BatLine {
        match p.side {
            Side::Away => &mut self.away_box[p.slot],
            Side::Home => &mut self.home_box[p.slot],
        }
    }
}

/// Replay an event log into a derived snapshot.
pub fn derive(_config: &Config, events: &[Event]) -> Derived {
    let mut d = Derived {
        state: GameState::new(),
        away_box: vec![BatLine::default(); 9],
        home_box: vec![BatLine::default(); 9],
    };
    let mut half_runs: u16 = 0;

    for ev in events {
        match ev {
            Event::PlateAppearance { result } => {
                apply_pa(&mut d, *result, &mut half_runs);
            }
        }
    }
    // Flush the in-progress half's runs so the linescore reflects it.
    push_half_line(&mut d.state, half_runs);
    d
}

fn push_half_line(state: &mut GameState, runs: u16) {
    state.linescore.push(HalfLine {
        inning: state.inning,
        half: state.half,
        runs,
    });
}

/// Move every runner up `n` bases; anyone passing home is pushed to `scored`.
/// Iterates high base → low so a runner never overwrites one ahead.
fn advance_runners(bases: &mut [Option<PlayerRef>; 3], n: usize, scored: &mut Vec<PlayerRef>) {
    for i in (0..3).rev() {
        if let Some(r) = bases[i].take() {
            let dest = i + n;
            if dest >= 3 {
                scored.push(r);
            } else {
                bases[dest] = Some(r);
            }
        }
    }
}

/// Forced advance (walk/HBP): batter to 1B, cascading only consecutively
/// occupied bases from 1B; a runner forced home is pushed to `scored`.
fn force_advance(bases: &mut [Option<PlayerRef>; 3], batter: PlayerRef, scored: &mut Vec<PlayerRef>) {
    if bases[0].is_none() {
        bases[0] = Some(batter);
    } else if bases[1].is_none() {
        bases[1] = bases[0].take();
        bases[0] = Some(batter);
    } else if bases[2].is_none() {
        bases[2] = bases[1].take();
        bases[1] = bases[0].take();
        bases[0] = Some(batter);
    } else {
        scored.push(bases[2].take().unwrap());
        bases[2] = bases[1].take();
        bases[1] = bases[0].take();
        bases[0] = Some(batter);
    }
}

fn apply_pa(d: &mut Derived, result: PaResult, half_runs: &mut u16) {
    let side = d.state.batting_side();
    let batter = PlayerRef {
        side,
        slot: d.state.bat_idx(),
    };

    let mut scored: Vec<PlayerRef> = Vec::new();
    let mut outs_added: u8 = 0;
    // Stat flags for this PA.
    let mut is_ab = false;
    let mut is_hit = false;
    let mut is_bb = false;
    let mut is_so = false;
    let mut rbi_credited = false; // batter gets RBI = scored.len() when true

    use PaResult::*;
    match result {
        Single => {
            advance_runners(&mut d.state.bases, 1, &mut scored);
            d.state.bases[0] = Some(batter);
            is_ab = true;
            is_hit = true;
            rbi_credited = true;
        }
        Double => {
            advance_runners(&mut d.state.bases, 2, &mut scored);
            d.state.bases[1] = Some(batter);
            is_ab = true;
            is_hit = true;
            rbi_credited = true;
        }
        Triple => {
            advance_runners(&mut d.state.bases, 3, &mut scored);
            d.state.bases[2] = Some(batter);
            is_ab = true;
            is_hit = true;
            rbi_credited = true;
        }
        HomeRun => {
            advance_runners(&mut d.state.bases, 3, &mut scored);
            scored.push(batter);
            is_ab = true;
            is_hit = true;
            rbi_credited = true;
        }
        Walk => {
            force_advance(&mut d.state.bases, batter, &mut scored);
            is_bb = true;
            rbi_credited = true; // only a forced-in run counts, which is what scored holds
        }
        HitByPitch => {
            force_advance(&mut d.state.bases, batter, &mut scored);
            rbi_credited = true;
        }
        Strikeout => {
            outs_added = 1;
            is_ab = true;
            is_so = true;
        }
        GroundOut | FlyOut => {
            outs_added = 1;
            is_ab = true;
        }
        DoublePlay => {
            // Batter out; lead forced runner (from 1B) also out if present.
            if d.state.bases[0].take().is_some() {
                outs_added = 2;
            } else {
                outs_added = 1;
            }
            is_ab = true;
        }
        FieldersChoice => {
            // Lead forced runner (from 1B) out; batter safe at 1B.
            // With no runner on 1B, the batter is retired instead.
            outs_added = 1;
            if d.state.bases[0].is_some() {
                d.state.bases[0] = Some(batter);
            }
            is_ab = true;
        }
        Error => {
            advance_runners(&mut d.state.bases, 1, &mut scored);
            d.state.bases[0] = Some(batter);
            is_ab = true; // reached on error still counts as an at-bat
        }
        SacFly => {
            outs_added = 1;
            if let Some(r) = d.state.bases[2].take() {
                scored.push(r);
            }
            rbi_credited = true;
        }
    }

    // Apply scoring.
    let runs = scored.len() as u16;
    match side {
        Side::Away => d.state.away_score += runs,
        Side::Home => d.state.home_score += runs,
    }
    *half_runs += runs;
    for r in &scored {
        d.box_line(*r).r += 1;
    }

    // Batting line for the batter.
    {
        let line = d.box_line(batter);
        if is_ab {
            line.ab += 1;
        }
        if is_hit {
            line.h += 1;
        }
        if is_bb {
            line.bb += 1;
        }
        if is_so {
            line.so += 1;
        }
        if rbi_credited {
            line.rbi += runs;
        }
    }

    // Outs and inning flow.
    d.state.outs += outs_added;
    d.state.advance_bat_idx();

    if d.state.outs >= 3 {
        // Close the half: record its runs, reset, and flip.
        push_half_line(&mut d.state, *half_runs);
        *half_runs = 0;
        d.state.outs = 0;
        d.state.bases = [None, None, None];
        match d.state.half {
            Half::Top => d.state.half = Half::Bottom,
            Half::Bottom => {
                d.state.half = Half::Top;
                d.state.inning += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config {
            away: (1..=9).map(|i| format!("A{i}")).collect(),
            home: (1..=9).map(|i| format!("H{i}")).collect(),
        }
    }

    fn pa(result: PaResult) -> Event {
        Event::PlateAppearance { result }
    }

    #[test]
    fn single_then_homerun_scores_two() {
        use PaResult::*;
        let d = derive(&cfg(), &[pa(Single), pa(HomeRun)]);
        assert_eq!(d.state.away_score, 2);
        // Batter 2 (slot 1) drove in 2 with the homer.
        assert_eq!(d.away_box[1].rbi, 2);
        assert_eq!(d.away_box[1].h, 1);
        // Batter 1 (slot 0) scored a run.
        assert_eq!(d.away_box[0].r, 1);
        assert_eq!(d.away_box[1].r, 1);
        // Bases empty after the homer.
        assert_eq!(d.state.bases, [None, None, None]);
        assert_eq!(d.state.outs, 0);
    }

    #[test]
    fn three_strikeouts_flip_to_bottom() {
        use PaResult::*;
        let d = derive(&cfg(), &[pa(Strikeout), pa(Strikeout), pa(Strikeout)]);
        assert_eq!(d.state.inning, 1);
        assert_eq!(d.state.half, Half::Bottom);
        assert_eq!(d.state.outs, 0);
        // Away batting index advanced past three batters.
        assert_eq!(d.state.away_idx, 3);
        assert_eq!(d.away_box[0].so, 1);
        assert_eq!(d.away_box[0].ab, 1);
    }

    #[test]
    fn bases_loaded_walk_forces_in_run() {
        use PaResult::*;
        // Three walks load the bases, fourth walk forces in a run.
        let d = derive(&cfg(), &[pa(Walk), pa(Walk), pa(Walk), pa(Walk)]);
        assert_eq!(d.state.away_score, 1);
        // Batter 4 (slot 3) credited the forced-in RBI.
        assert_eq!(d.away_box[3].rbi, 1);
        assert_eq!(d.away_box[3].bb, 1);
        // Batter 1 (slot 0) scored; still bases loaded with slots 1,2,3.
        assert_eq!(d.away_box[0].r, 1);
        assert!(d.state.bases.iter().all(|b| b.is_some()));
        // No at-bats charged on walks.
        assert_eq!(d.away_box[0].ab, 0);
    }

    #[test]
    fn grand_slam_scores_four() {
        use PaResult::*;
        let d = derive(
            &cfg(),
            &[pa(Walk), pa(Walk), pa(Walk), pa(HomeRun)],
        );
        assert_eq!(d.state.away_score, 4);
        assert_eq!(d.away_box[3].rbi, 4);
        assert_eq!(d.state.bases, [None, None, None]);
    }

    #[test]
    fn double_play_records_two_outs_and_clears_runner() {
        use PaResult::*;
        // Leadoff single puts a runner on 1B, then a DP.
        let d = derive(&cfg(), &[pa(Single), pa(DoublePlay)]);
        assert_eq!(d.state.outs, 2);
        // Runner on 1B was erased, batter out — bases empty.
        assert_eq!(d.state.bases, [None, None, None]);
        assert_eq!(d.away_box[1].ab, 1);
    }

    #[test]
    fn sac_fly_scores_runner_from_third() {
        use PaResult::*;
        // Triple puts a runner on 3B, sac fly scores him.
        let d = derive(&cfg(), &[pa(Triple), pa(SacFly)]);
        assert_eq!(d.state.away_score, 1);
        assert_eq!(d.state.outs, 1);
        // Sac fly is not an at-bat but earns an RBI.
        assert_eq!(d.away_box[1].ab, 0);
        assert_eq!(d.away_box[1].rbi, 1);
        // Runner (batter 1) scored; 3B now empty.
        assert_eq!(d.away_box[0].r, 1);
        assert_eq!(d.state.bases[2], None);
    }

    #[test]
    fn full_inning_flips_increment_after_bottom() {
        use PaResult::*;
        // Top 1st: 3 outs. Bottom 1st: 3 outs. Should reach Top of 2nd.
        let outs6 = vec![
            pa(GroundOut), pa(GroundOut), pa(GroundOut),
            pa(FlyOut), pa(FlyOut), pa(FlyOut),
        ];
        let d = derive(&cfg(), &outs6);
        assert_eq!(d.state.inning, 2);
        assert_eq!(d.state.half, Half::Top);
        // Linescore recorded top-1, bottom-1, and the fresh (empty) top-2.
        assert_eq!(d.state.linescore.len(), 3);
        assert_eq!(d.state.linescore[0].half, Half::Top);
        assert_eq!(d.state.linescore[1].half, Half::Bottom);
    }

    #[test]
    fn fielders_choice_keeps_batter_erases_lead_runner() {
        use PaResult::*;
        let d = derive(&cfg(), &[pa(Single), pa(FieldersChoice)]);
        assert_eq!(d.state.outs, 1);
        // Batter now on 1B; the forced runner was retired.
        assert_eq!(d.state.bases[0], Some(PlayerRef { side: Side::Away, slot: 1 }));
        assert_eq!(d.state.bases[1], None);
    }
}
