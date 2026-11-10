//! KBO scorebook scoring engine — pure, event-sourced.
//!
//! `derive(&Config, &[Event])` replays a game's event log into a `Derived`
//! snapshot (current field state + per-batter box score). No I/O; the same
//! function compiles to native (for `cargo test`) and wasm.
//!
//! Plate appearances carry a result and, optionally, explicit runner moves
//! (`advances`); without them a deterministic default model applies (documented
//! per result in `apply_pa`). `Runners` events move runners between plate
//! appearances (steals, wild pitches, pickoffs) without charging the batter.
//! Pitch/hit coordinates and substitutions are later slices.

use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
mod wasm;

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

/// Identifies a player by their team and batting-order slot (0-based).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerRef {
    pub side: Side,
    pub slot: usize,
}

/// Batting lineups in batting order: 9 names each in pro ball, more where a league bats extra hitters.
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
    /// Batter out on a sacrifice bunt (no at-bat); runners advance one base by default.
    SacBunt,
}

/// Where a runner starts or ends a move. `Batter` is only a start, `Home`/`Out` only ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Spot {
    Batter,
    First,
    Second,
    Third,
    Home,
    Out,
}

impl Spot {
    fn base(self) -> Option<usize> {
        match self {
            Spot::First => Some(0),
            Spot::Second => Some(1),
            Spot::Third => Some(2),
            _ => None,
        }
    }
}

/// One runner's move on a play. Runners not named stay where they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Advance {
    pub from: Spot,
    pub to: Spot,
    /// A run that earns no RBI whatever the result (scored on a wild pitch, passed ball, balk or error).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub no_rbi: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Event {
    PlateAppearance {
        result: PaResult,
        /// Explicit moves for this play, batter included; `None` = default model.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        advances: Option<Vec<Advance>>,
    },
    /// Runner moves outside a plate appearance; the batter stays at the plate.
    Runners { advances: Vec<Advance> },
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

    /// `n`: the batting side's lineup length.
    fn advance_bat_idx(&mut self, n: usize) {
        match self.batting_side() {
            Side::Away => self.away_idx = (self.away_idx + 1) % n,
            Side::Home => self.home_idx = (self.home_idx + 1) % n,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Derived {
    pub state: GameState,
    /// Box score keyed by batting slot, per side.
    pub away_box: Vec<BatLine>,
    pub home_box: Vec<BatLine>,
    /// Moves that were skipped as impossible (empty base, a runner moved twice, ...), one line each.
    #[serde(default)]
    pub issues: Vec<String>,
}

impl Derived {
    fn box_line(&mut self, p: PlayerRef) -> &mut BatLine {
        match p.side {
            Side::Away => &mut self.away_box[p.slot],
            Side::Home => &mut self.home_box[p.slot],
        }
    }

    fn next_batter(&mut self) {
        let n = match self.state.batting_side() {
            Side::Away => self.away_box.len(),
            Side::Home => self.home_box.len(),
        };
        self.state.advance_bat_idx(n);
    }
}

/// Replay an event log into a derived snapshot.
pub fn derive(config: &Config, events: &[Event]) -> Derived {
    derive_with(config, events, |_| ())
}

/// The snapshot after each event, in order (for drawing a game PA by PA without replaying prefixes).
/// A step's linescore holds the completed halves only.
pub fn derive_steps(config: &Config, events: &[Event]) -> Vec<Derived> {
    let mut steps = Vec::with_capacity(events.len());
    derive_with(config, events, |d| steps.push(d.clone()));
    steps
}

fn derive_with(config: &Config, events: &[Event], mut after_each: impl FnMut(&Derived)) -> Derived {
    let mut d = Derived {
        state: GameState::new(),
        away_box: vec![BatLine::default(); config.away.len()],
        home_box: vec![BatLine::default(); config.home.len()],
        issues: Vec::new(),
    };
    let mut half_runs: u16 = 0;

    for ev in events {
        match ev {
            Event::PlateAppearance { result, advances: None } => apply_pa(&mut d, *result, &mut half_runs),
            Event::PlateAppearance { result, advances: Some(adv) } => apply_explicit_pa(&mut d, *result, adv, &mut half_runs),
            Event::Runners { advances } => {
                let m = move_runners(&mut d.state.bases, None, advances);
                d.issues.extend(m.issues);
                score(&mut d, &m.scored, &mut half_runs);
                end_play(&mut d, m.outs, &mut half_runs);
            }
        }
        after_each(&d);
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
        SacBunt => {
            outs_added = 1;
            advance_runners(&mut d.state.bases, 1, &mut scored);
            rbi_credited = true;
        }
    }

    score(d, &scored, half_runs);
    let runs = scored.len() as u16;
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
    d.next_batter();
    end_play(d, outs_added, half_runs);
}

/// A plate appearance whose runner moves are given (e.g. from a relay feed). Batting-line flags come from the
/// result. RBI: none on a strikeout, double play or error; on a walk or HBP only a run forced home with the
/// bases loaded; otherwise each run on the play, except moves flagged `no_rbi`.
fn apply_explicit_pa(d: &mut Derived, result: PaResult, advances: &[Advance], half_runs: &mut u16) {
    use PaResult::*;
    let batter = PlayerRef { side: d.state.batting_side(), slot: d.state.bat_idx() };
    let loaded = d.state.bases.iter().all(|b| b.is_some());
    let m = move_runners(&mut d.state.bases, Some(batter), advances);
    d.issues.extend(m.issues);
    score(d, &m.scored, half_runs);
    let rbi = match result {
        Strikeout | DoublePlay | Error => 0,
        Walk | HitByPitch => u16::from(loaded && m.rbi_runs > 0),
        _ => m.rbi_runs,
    };
    let outs = m.outs;
    let line = d.box_line(batter);
    if !matches!(result, Walk | HitByPitch | SacFly | SacBunt) {
        line.ab += 1;
    }
    if matches!(result, Single | Double | Triple | HomeRun) {
        line.h += 1;
    }
    if result == Walk {
        line.bb += 1;
    }
    if result == Strikeout {
        line.so += 1;
    }
    line.rbi += rbi;
    d.next_batter();
    end_play(d, outs, half_runs);
}

struct Moved {
    scored: Vec<PlayerRef>,
    /// runs not flagged `no_rbi`
    rbi_runs: u16,
    outs: u8,
    issues: Vec<String>,
}

/// Apply explicit moves. All are read against the bases as they were before the play, so "2B->3B, 1B->2B"
/// works in any order. A move is skipped (and reported) when its runner doesn't exist or already moved, or when
/// it would end on the batter's spot or on a base another runner takes on the same play.
fn move_runners(bases: &mut [Option<PlayerRef>; 3], batter: Option<PlayerRef>, advances: &[Advance]) -> Moved {
    let before = *bases;
    let mut m = Moved { scored: Vec::new(), rbi_runs: 0, outs: 0, issues: Vec::new() };
    let mut moved: Vec<Spot> = Vec::new();
    let mut valid: Vec<(PlayerRef, Advance)> = Vec::new();
    for a in advances {
        let who = match a.from {
            Spot::Batter => batter,
            from => from.base().and_then(|i| before[i]),
        };
        let problem = match who {
            _ if matches!(a.from, Spot::Home | Spot::Out) || a.to == Spot::Batter => Some("not a start/end spot"),
            None => Some("no runner there"),
            Some(_) if moved.contains(&a.from) => Some("runner moved twice"),
            Some(_) => None,
        };
        if let Some(p) = problem {
            m.issues.push(format!("skipped {:?}->{:?}: {p}", a.from, a.to));
            continue;
        }
        moved.push(a.from);
        valid.push((who.unwrap(), *a));
    }
    for (_, a) in &valid {
        if let Some(i) = a.from.base() {
            bases[i] = None;
        }
    }
    for (who, a) in valid {
        match a.to {
            Spot::Home => {
                m.scored.push(who);
                if !a.no_rbi {
                    m.rbi_runs += 1;
                }
            }
            Spot::Out => m.outs = m.outs.saturating_add(1),
            to => {
                let i = to.base().expect("bases checked above");
                if bases[i].is_some() {
                    m.issues.push(format!("{:?}->{:?}: base already taken, runner left off", a.from, a.to));
                } else {
                    bases[i] = Some(who);
                }
            }
        }
    }
    m
}

fn score(d: &mut Derived, scored: &[PlayerRef], half_runs: &mut u16) {
    let runs = scored.len() as u16;
    match d.state.batting_side() {
        Side::Away => d.state.away_score += runs,
        Side::Home => d.state.home_score += runs,
    }
    *half_runs += runs;
    for r in scored {
        d.box_line(*r).r += 1;
    }
}

/// Count the play's outs; at three, close the half and flip.
fn end_play(d: &mut Derived, outs_added: u8, half_runs: &mut u16) {
    d.state.outs = d.state.outs.saturating_add(outs_added).min(3);
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
        Event::PlateAppearance { result, advances: None }
    }

    fn mv(from: Spot, to: Spot) -> Advance {
        Advance { from, to, no_rbi: false }
    }

    fn xpa(result: PaResult, advances: &[Advance]) -> Event {
        Event::PlateAppearance { result, advances: Some(advances.to_vec()) }
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

    #[test]
    fn explicit_single_scores_runner_from_second() {
        use PaResult::*;
        use Spot::*;
        let d = derive(&cfg(), &[xpa(Double, &[mv(Batter, Second)]), xpa(Single, &[mv(Second, Home), mv(Batter, First)])]);
        assert_eq!(d.state.away_score, 1);
        assert_eq!(d.away_box[0].r, 1);
        assert_eq!(d.away_box[1].rbi, 1);
        assert_eq!(d.state.bases, [Some(PlayerRef { side: Side::Away, slot: 1 }), None, None]);
    }

    #[test]
    fn moves_read_against_bases_before_the_play() {
        use PaResult::*;
        use Spot::*;
        // 1B and 2B occupied; on a single 2B->3B and 1B->2B, listed lead runner last.
        let d = derive(&cfg(), &[pa(Walk), pa(Walk), xpa(Single, &[mv(First, Second), mv(Second, Third), mv(Batter, First)])]);
        let r = |slot| Some(PlayerRef { side: Side::Away, slot });
        // walks: slot 0 forced to 2B, slot 1 on 1B; after the single 1B=slot 2, 2B=slot 1, 3B=slot 0
        assert_eq!(d.state.bases, [r(2), r(1), r(0)]);
    }

    #[test]
    fn caught_stealing_for_the_third_out_keeps_the_batter() {
        use PaResult::*;
        use Spot::*;
        let d = derive(&cfg(), &[pa(Strikeout), pa(Strikeout), pa(Single), Event::Runners { advances: vec![mv(First, Out)] }]);
        assert_eq!(d.state.half, Half::Bottom);
        // slot 3 never finished his PA: he leads off the away team's next inning
        assert_eq!(d.state.away_idx, 3);
    }

    #[test]
    fn run_on_double_play_or_wild_pitch_earns_no_rbi() {
        use PaResult::*;
        use Spot::*;
        let d = derive(&cfg(), &[
            xpa(Triple, &[mv(Batter, Third)]),
            pa(Walk),
            xpa(DoublePlay, &[mv(Third, Home), mv(First, Out), mv(Batter, Out)]),
            xpa(Walk, &[mv(Batter, First)]),
            Event::Runners { advances: vec![mv(First, Second)] },
            xpa(Single, &[mv(Batter, First), mv(Second, Third)]),
            Event::Runners { advances: vec![mv(Third, Home)] },
        ]);
        assert_eq!(d.state.away_score, 2);
        assert_eq!(d.away_box[2].rbi, 0);
        assert_eq!(d.away_box.iter().map(|b| b.rbi).sum::<u16>(), 0);
        assert_eq!((d.away_box[0].r, d.away_box[3].r), (1, 1));
        assert_eq!(d.state.outs, 2);
    }

    #[test]
    fn sac_bunt_is_no_at_bat_and_moves_runners_up() {
        use PaResult::*;
        let d = derive(&cfg(), &[pa(Single), pa(SacBunt)]);
        assert_eq!(d.away_box[1].ab, 0);
        assert_eq!(d.state.outs, 1);
        assert_eq!(d.state.bases[1], Some(PlayerRef { side: Side::Away, slot: 0 }));
    }

    #[test]
    fn events_round_trip_through_json() {
        use PaResult::*;
        use Spot::*;
        let evs = vec![pa(Single), xpa(Double, &[mv(First, Home), mv(Batter, Second)]), Event::Runners { advances: vec![mv(Second, Third)] }];
        let json = serde_json::to_string(&evs).unwrap();
        assert!(json.contains(r#"{"kind":"PlateAppearance","result":{"type":"Single"}}"#));
        assert_eq!(serde_json::from_str::<Vec<Event>>(&json).unwrap(), evs);
    }

    #[test]
    fn no_rbi_on_strikeout_wild_pitch_or_flagged_run() {
        use PaResult::*;
        use Spot::*;
        // runner on 3B scores on a dropped third strike wild pitch, batter reaches 1B
        let d = derive(&cfg(), &[xpa(Triple, &[mv(Batter, Third)]), xpa(Strikeout, &[mv(Third, Home), mv(Batter, First)])]);
        assert_eq!((d.state.away_score, d.away_box[1].rbi, d.away_box[1].so), (1, 0, 1));
        // a single where the run scores on the throwing error: flagged
        let d = derive(&cfg(), &[xpa(Double, &[mv(Batter, Second)]), xpa(Single, &[Advance { from: Second, to: Home, no_rbi: true }, mv(Batter, First)])]);
        assert_eq!((d.state.away_score, d.away_box[1].rbi), (1, 0));
    }

    #[test]
    fn walk_drives_in_only_a_forced_run() {
        use PaResult::*;
        use Spot::*;
        // runner on 3B only; ball four is a wild pitch and he scores: no RBI
        let d = derive(&cfg(), &[xpa(Triple, &[mv(Batter, Third)]), xpa(Walk, &[mv(Third, Home), mv(Batter, First)])]);
        assert_eq!((d.state.away_score, d.away_box[1].rbi, d.away_box[1].bb), (1, 0, 1));
        // bases loaded walk: 1 RBI
        let d = derive(&cfg(), &[pa(Walk), pa(Walk), pa(Walk), xpa(Walk, &[mv(Third, Home), mv(Second, Third), mv(First, Second), mv(Batter, First)])]);
        assert_eq!((d.state.away_score, d.away_box[3].rbi), (1, 1));
    }

    #[test]
    fn impossible_moves_are_skipped_and_reported() {
        use PaResult::*;
        use Spot::*;
        let d = derive(&cfg(), &[xpa(HomeRun, &[mv(Batter, Home), mv(Batter, Home), mv(Second, Home)])]);
        assert_eq!(d.state.away_score, 1);
        assert_eq!(d.issues.len(), 2, "{:?}", d.issues);
        // 256 outs on one play: no overflow, the half just ends
        let d = derive(&cfg(), &[Event::Runners { advances: vec![mv(First, Out); 256] }, xpa(Strikeout, &vec![mv(Batter, Out); 256])]);
        assert_eq!((d.state.outs, d.state.half), (1, Half::Top));
        assert!(!d.issues.is_empty());
    }

    #[test]
    fn steps_give_the_state_after_each_event() {
        use PaResult::*;
        let evs = [pa(Single), pa(HomeRun), pa(Strikeout), pa(Strikeout), pa(Strikeout)];
        let steps = derive_steps(&cfg(), &evs);
        assert_eq!(steps.len(), 5);
        assert_eq!((steps[0].state.away_score, steps[0].state.bases[0].is_some()), (0, true));
        assert_eq!((steps[1].state.away_score, steps[1].away_box[1].rbi), (2, 2));
        assert_eq!((steps[4].state.half, steps[4].state.outs), (Half::Bottom, 0));
        // the last step is the final state
        assert_eq!(steps[4].state.away_idx, derive(&cfg(), &evs).state.away_idx);
    }

    #[test]
    fn a_ten_man_lineup_bats_its_tenth_hitter_before_turning_over() {
        let c = Config { away: (1..=10).map(|i| format!("A{i}")).collect(), home: cfg().home };
        // away: slots 1-3 walk, 4-6 strike out; home: three outs; away: slot 7 singles, 8-10 strike out
        let mut evs: Vec<Event> = (0..3).map(|_| pa(PaResult::Walk)).collect();
        evs.extend((0..6).map(|_| pa(PaResult::Strikeout)));
        evs.push(pa(PaResult::Single));
        evs.extend((0..3).map(|_| pa(PaResult::Strikeout)));
        let d = derive(&c, &evs);
        assert_eq!(d.away_box.len(), 10);
        assert_eq!(d.home_box.len(), 9);
        assert_eq!(d.state.away_idx, 0, "slot 10 batted; the order turns over");
        assert_eq!(d.away_box[9].ab, 1);
        assert_eq!(d.state.home_idx, 3);
    }
}
