// Manual scoring: the user's own record of a game as events. Folded into engine events (state, box) and into the
// same Game shape the Naver relay gives, so every view works on it. Result texts follow Naver's wording, so the
// scorebook notation and the engine adapter read them the same way.
import type { Advance, Derived, EngineConfig, EngineEvent, PaResultType, Spot } from './engine';
import { classify, type Call, type Game, type PA, type Pitch, type Play, type State } from './naver/parse';
import type { NaverBatter, NaverLineup, NaverPitcher } from './naver/types';

export type Side = 'away' | 'home';
export interface Player { id: string; name: string; pos: string }
export interface Setup {
  date: string; stadium: string; awayName: string; homeName: string;
  /** batting order, 9 each */
  away: Player[]; home: Player[];
  awayPitcher: Player; homePitcher: Player;
}
export type RunnerPlay = 'SB' | 'CS' | 'WP' | 'PB' | 'BK' | 'PO' | 'ETC';
export type SubRole = 'PH' | 'PR' | 'DEF' | 'P';

export type ManualEvent =
  | { kind: 'm.setup'; setup: Setup }
  /** x, z: plate crossing in feet, catcher's view (as Naver's) */
  | { kind: 'm.pitch'; call: Call; x?: number; z?: number; stuff?: string; speed?: number }
  /** fielders: positions 1-9 in the order the ball went; line: a line drive (FlyOut);
   *  err (here and on m.runners): the moves from these spots were made on an error */
  | { kind: 'm.pa'; result: PaResultType; fielders: number[]; advances: Advance[]; line?: boolean; ibb?: boolean; auto?: boolean; err?: Spot[] }
  | { kind: 'm.runners'; play: RunnerPlay; advances: Advance[]; err?: Spot[] }
  /** slot 0-8 for PH/PR/DEF; P replaces the side's pitcher */
  | { kind: 'm.sub'; side: Side; role: SubRole; slot: number; player: Player }
  /** take back the last edit (setup can't be taken back) */
  | { kind: 'm.undo' };

export const POS_NAME = ['', '투수', '포수', '1루수', '2루수', '3루수', '유격수', '좌익수', '중견수', '우익수'];
const BASE_NAME: Partial<Record<Spot, string>> = { First: '1루', Second: '2루', Third: '3루' };
const PLAY_NAME: Record<RunnerPlay, string> = { SB: '도루로 ', CS: '도루실패 ', WP: '폭투로 ', PB: '포일로 ', BK: '보크로 ', PO: '견제사 ', ETC: '' };

/** The edits in effect: each m.undo removes the latest edit before it. */
export function resolve(events: readonly ManualEvent[]): ManualEvent[] {
  const out: ManualEvent[] = [];
  for (const e of events) {
    if (e.kind !== 'm.undo') out.push(e);
    else if (out.length && out[out.length - 1].kind !== 'm.setup') out.pop();
  }
  return out;
}

/** Naver-style PA result text, e.g. "유격수 땅볼 아웃 (유격수->1루수 송구아웃)". */
export function resultText(r: PaResultType, fielders: number[], line = false, ibb = false): string {
  const p = POS_NAME[fielders[0]] ?? '';
  const pre = p ? p + ' ' : '';
  const chain = fielders.length > 1 ? ` (${fielders.map((f) => POS_NAME[f]).join('->')} 송구아웃)` : '';
  switch (r) {
    case 'Single': return p ? `${p} 앞 1루타` : '1루타';
    case 'Double': return `${pre}2루타`;
    case 'Triple': return `${pre}3루타`;
    case 'HomeRun': return `${pre}홈런`;
    case 'Walk': return ibb ? '고의4구' : '볼넷';
    case 'HitByPitch': return '몸에 맞는 볼';
    case 'Strikeout': return '삼진 아웃';
    case 'GroundOut': return `${pre}땅볼 아웃${chain}`;
    case 'FlyOut': return `${pre}${line ? '라인드라이브' : '플라이'} 아웃`;
    case 'DoublePlay': return `${pre}병살타 아웃${chain}`;
    case 'FieldersChoice': return `${p ? p + ' 앞 ' : ''}땅볼로 출루`;
    case 'Error': return `${pre}실책으로 출루`;
    case 'SacFly': return `${pre}희생플라이 아웃`;
    case 'SacBunt': return `${pre}희생번트 아웃${chain}`;
  }
}

const BASES: Spot[] = ['First', 'Second', 'Third'];
const HITS: Partial<Record<PaResultType, number>> = { Single: 1, Double: 2, Triple: 3, HomeRun: 4, Error: 1 };

/** The usual runner moves for a result, as a starting point the user corrects. `bases`: occupied 1B/2B/3B. */
export function defaultAdvances(r: PaResultType, bases: boolean[]): Advance[] {
  const mv = (from: Spot, to: Spot): Advance => ({ from, to });
  const up = (i: number, n: number): Spot => (i + n >= 3 ? 'Home' : BASES[i + n]);
  const runners = [2, 1, 0].filter((i) => bases[i]);
  const n = HITS[r];
  if (n) return [...runners.map((i) => mv(BASES[i], up(i, n))), mv('Batter', n === 4 ? 'Home' : BASES[n - 1])];
  if (r === 'Walk' || r === 'HitByPitch') {
    const out: Advance[] = [];
    // forced runners only: each occupied base pushed by the one below it
    for (let i = 0; i < 3 && bases[i]; i++) out.unshift(mv(BASES[i], up(i, 1)));
    return [...out, mv('Batter', 'First')];
  }
  if (r === 'DoublePlay') return [...(bases[0] ? [mv('First', 'Out')] : []), mv('Batter', 'Out')];
  if (r === 'FieldersChoice') return [...(bases[0] ? [mv('First', 'Out')] : []), mv('Batter', 'First')];
  if (r === 'SacFly') return [...(bases[2] ? [mv('Third', 'Home')] : []), mv('Batter', 'Out')];
  if (r === 'SacBunt') return [...runners.map((i) => mv(BASES[i], up(i, 1))), mv('Batter', 'Out')];
  return [mv('Batter', 'Out')]; // strikeout, ground out, fly out
}

/** Engine input for the edits in effect, and for each edit the index of its engine event (or -1). */
export function engineEvents(events: readonly ManualEvent[]): { config: EngineConfig; events: EngineEvent[]; at: number[] } {
  const setup = events.find((e) => e.kind === 'm.setup')?.setup;
  if (!setup) throw new Error('경기 설정이 없어요.');
  const out: EngineEvent[] = [], at: number[] = [];
  // a run scored on an error earns no RBI
  const moves = (e: { advances: Advance[]; err?: Spot[] }) =>
    e.advances.map((a) => (a.to === 'Home' && e.err?.includes(a.from) ? { ...a, no_rbi: true } : a));
  for (const e of events) {
    if (e.kind === 'm.pa') at.push(out.push({ kind: 'PlateAppearance', result: { type: e.result }, advances: moves(e) }) - 1);
    else if (e.kind === 'm.runners') at.push(out.push({ kind: 'Runners', advances: moves(e) }) - 1);
    else at.push(-1);
  }
  return { config: { away: setup.away.map((p) => p.name), home: setup.home.map((p) => p.name) }, events: out, at };
}

type Row = NaverBatter;
interface PitcherRow { p: Player; seqno: number; pitches: number; outs: number; hit: number; kk: number; bb: number; er: number }

/** The current situation for the input screen, plus the Game every view reads. `steps` = deriveSteps(engineEvents). */
export function manualGame(gameId: string, edits: readonly ManualEvent[], steps: Derived[]): { game: Game; now: Now } {
  const events = resolve(edits);
  const setup = events.find((e) => e.kind === 'm.setup')!.setup;
  const { at } = engineEvents(events);
  const lineup = { away: [...setup.away], home: [...setup.home] };
  const pitcher = { away: setup.awayPitcher, home: setup.homePitcher };
  const names: Record<string, string> = {};
  const rows: Record<Side, Row[]> = { away: [], home: [] };
  const prow: Record<Side, PitcherRow[]> = { away: [], home: [] };
  const addRow = (side: Side, slot: number, p: Player) => {
    names[p.id] = p.name;
    const seq = rows[side].filter((r) => r.batOrder === slot + 1).length + 1;
    rows[side].push({ pcode: p.id, name: p.name, batOrder: slot + 1, seqno: seq, posName: p.pos, ab: 0, hit: 0, rbi: 0, run: 0, bb: 0, so: 0 });
  };
  const addPitcher = (side: Side, p: Player) => {
    names[p.id] = p.name;
    prow[side].push({ p, seqno: prow[side].length + 1, pitches: 0, outs: 0, hit: 0, kk: 0, bb: 0, er: 0 });
  };
  (['away', 'home'] as const).forEach((side) => { setup[side].forEach((p, i) => addRow(side, i, p)); addPitcher(side, pitcher[side]); });
  const rowOf = (side: Side, id: string) => rows[side].find((r) => r.pcode === id)!;
  const curPitcherRow = (side: Side) => prow[side][prow[side].length - 1];

  let snap: Derived | null = null; // engine snapshot after the latest engine event
  const fresh: Derived['state'] = { inning: 1, half: 'Top', outs: 0, bases: [null, null, null], away_score: 0, home_score: 0, away_idx: 0, home_idx: 0, linescore: [] };
  const eng = () => snap?.state ?? fresh;
  const hits = { away: 0, home: 0 }, errors = { away: 0, home: 0 };
  let balls = 0, strikes = 0;
  const batSide = (): Side => (eng().half === 'Top' ? 'away' : 'home');
  const fieldSide = (): Side => (eng().half === 'Top' ? 'home' : 'away');
  const batter = () => lineup[batSide()][batSide() === 'away' ? eng().away_idx : eng().home_idx];
  const state = (): State => {
    const s = eng();
    return {
      awayScore: s.away_score, homeScore: s.home_score, awayHit: hits.away, homeHit: hits.home, awayError: errors.away, homeError: errors.home,
      ball: balls, strike: strikes, out: s.outs, pitcher: pitcher[fieldSide()].id, batter: batter().id,
      bases: s.bases.map((b) => (b ? b.slot + 1 : 0)) as [number, number, number],
    };
  };
  const runnerName = (side: Side, base: number) => { const b = eng().bases[base]; return b ? lineup[side][b.slot].name : ''; };

  const pas: PA[] = [];
  let cur: PA | null = null;
  let pitchNo = 0;
  const pending: string[] = []; // substitution lines waiting for the next PA
  const open = () => {
    if (cur) return cur;
    const b = batter(), slot = batSide() === 'away' ? eng().away_idx : eng().home_idx;
    const st = state();
    cur = { no: pas.length + 1, inn: eng().inning, top: eng().half === 'Top', title: `${slot + 1}번타자 ${b.name}`, batter: b.id, pitcher: st.pitcher,
      pitcherPitches: 0, pitches: [], result: null, events: [...pending], plays: [], before: st, after: st, inPlay: false, res: null, wp: null };
    pending.length = 0;
    return cur;
  };
  const close = (after = state()) => { if (cur) { cur.after = after; pas.push(cur); } cur = null; balls = strikes = 0; pitchNo = 0; };
  /** state right after a play; when it ended the half, as Naver shows it: three outs, bases cleared, same batter */
  /** at a half's end the engine has moved on to the next half: the bases are read off the play's moves instead, as
   *  Naver leaves them (runners left on stay where they stood; one put out or scoring is gone). batter: his base value */
  const afterPlay = (ended: boolean, before: State, advances: Advance[], batter = 0): State => {
    if (!ended) return state();
    const bases: State['bases'] = [...before.bases];
    const who = (f: Spot) => (f === 'Batter' ? batter : before.bases[BASES.indexOf(f)]);
    for (const a of advances) if (a.from !== 'Batter') bases[BASES.indexOf(a.from)] = 0;
    for (const a of advances) if (BASES.includes(a.to)) bases[BASES.indexOf(a.to)] = who(a.from);
    return { ...state(), out: 3, bases, batter: before.batter, pitcher: before.pitcher };
  };
  // Earned runs, approximated: a run is charged to the pitcher who let that runner on (a pinch runner takes his place),
  // and is unearned when the runner reached or advanced on an error, scored on a passed ball, or scored after the defense
  // should have had three outs (outs plus errors this half, counting the outs on the scoring play itself when errors
  // are involved: without them that play ends the half; a run that beats a real third out still counts). Finer points (fielder's choices swapping runners,
  // a reliever not getting the benefit of earlier errors) are left out.
  const resp: Record<Side, (PitcherRow | null)[]> = { away: Array(9).fill(null), home: Array(9).fill(null) };
  const onError: Record<Side, boolean[]> = { away: Array(9).fill(false), home: Array(9).fill(false) };
  let missedOuts = 0;
  /** apply an engine step, crediting runs and RBI from the box deltas. batter: the batter's slot and whether he reached on an error;
   *  err: spots whose runner moved on an error (marked so his run, now or later, is unearned) */
  const step = (k: number, side: Side, batter: { id: string; slot: number; error: boolean } | null, pb = false, err: Spot[] = []) => {
    const before = snap, next = steps[k];
    const boxOf = (d: Derived | null) => (side === 'away' ? d?.away_box : d?.home_box);
    const pr = curPitcherRow(side === 'away' ? 'home' : 'away');
    const outsBefore = before?.state.outs ?? 0, halfChanged = next.state.half !== (before?.state.half ?? 'Top');
    const outsOnPlay = halfChanged ? 3 - outsBefore : next.state.outs - outsBefore;
    const dr = (slot: number) => boxOf(next)![slot].r - (boxOf(before)?.[slot]?.r ?? 0);
    if (batter && (dr(batter.slot) > 0 || next.state.bases.some((b) => b?.slot === batter.slot))) {
      resp[side][batter.slot] = pr; onError[side][batter.slot] = batter.error;
    }
    for (const f of err) {
      const slot = f === 'Batter' ? batter?.slot : before?.state.bases[BASES.indexOf(f)]?.slot;
      if (slot != null) onError[side][slot] = true;
    }
    if (batter?.error) missedOuts++;
    for (let slot = 0; slot < 9; slot++) {
      const runs = dr(slot), drbi = boxOf(next)![slot].rbi - (boxOf(before)?.[slot]?.rbi ?? 0);
      if (runs) rowOf(side, lineup[side][slot].id).run += runs;
      if (drbi && batter) rowOf(side, batter.id).rbi += drbi;
      const virtualOuts = outsBefore + missedOuts + (missedOuts ? outsOnPlay : 0);
      if (runs && !onError[side][slot] && !pb && virtualOuts < 3) (resp[side][slot] ?? pr).er += runs;
    }
    pr.outs += outsOnPlay;
    if (halfChanged) missedOuts = 0;
    snap = next;
    return halfChanged;
  };
  const what = (to: Spot, cause: string) => (to === 'Home' ? `${cause}홈인` : to === 'Out' ? `${cause}아웃` : `${cause}${BASE_NAME[to]}까지 진루`);
  const moveLines = (advances: Advance[], side: Side, cause: string, err: Spot[] = []) =>
    advances.filter((a) => a.from !== 'Batter').map((a) => {
      const base = BASES.indexOf(a.from);
      return `${base + 1}루주자 ${runnerName(side, base)} : ${what(a.to, err.includes(a.from) ? '실책으로 ' : cause)}`;
    });

  events.forEach((e, i) => {
    if (e.kind === 'm.pitch') {
      const pa = open(), count: [number, number] = [balls, strikes];
      if (e.call === 'B') balls++;
      else if (e.call === 'T' || e.call === 'S') strikes++;
      else if ((e.call === 'F' || e.call === 'W') && strikes < 2) strikes++; // W: a foul bunt (a relay game re-entered)
      const pr = curPitcherRow(fieldSide());
      pr.pitches++;
      const p: Pitch = { pitcher: pitcher[fieldSide()].id, n: ++pitchNo, call: e.call, stuff: e.stuff, speed: e.speed != null ? String(e.speed) : undefined,
        xz: e.x != null && e.z != null ? [e.x, e.z] : null, sz: [1.6, 3.4], count, state: state() };
      pa.pitches.push(p);
      pa.pitcher = p.pitcher; pa.pitcherPitches = pr.pitches; pa.after = p.state;
    } else if (e.kind === 'm.runners') {
      const side = batSide(), pa = open(), before = state();
      const lines = moveLines(e.advances, side, PLAY_NAME[e.play], e.err);
      if (e.err?.length) errors[fieldSide()]++;
      const ended = step(at[i], side, null, e.play === 'PB', e.err), after = afterPlay(ended, before, e.advances);
      pa.events.push(...lines);
      pa.plays.push({ kind: 'runners', before, after, texts: lines } satisfies Play);
      if (ended) close(after); else pa.after = after;
    } else if (e.kind === 'm.pa') {
      const side = batSide(), pa = open(), before = state(), b = batter(), slot = side === 'away' ? eng().away_idx : eng().home_idx;
      const text = `${b.name} : ${resultText(e.result, e.fielders, e.line, e.ibb)}`;
      const lines = moveLines(e.advances, side, '', e.err);
      // the batter taking more than first on an error reads as Naver writes it: a line for him as the runner on first
      const extra = e.err?.includes('Batter') ? e.advances.find((a) => a.from === 'Batter' && a.to !== 'First' && a.to !== 'Out') : undefined;
      if (extra) lines.push(`1루주자 ${b.name} : ${what(extra.to, '실책으로 ')}`);
      const row = rowOf(side, b.id), pr = curPitcherRow(fieldSide());
      if (!['Walk', 'HitByPitch', 'SacFly', 'SacBunt'].includes(e.result)) row.ab++;
      if (['Single', 'Double', 'Triple', 'HomeRun'].includes(e.result)) { row.hit++; hits[side]++; pr.hit++; }
      if (e.result === 'Error' || e.err?.length) errors[side === 'away' ? 'home' : 'away']++; // one error per play
      if (e.result === 'Walk') { row.bb++; pr.bb++; }
      if (e.result === 'Strikeout') { row.so++; pr.kk++; }
      const after = afterPlay(step(at[i], side, { id: b.id, slot, error: e.result === 'Error' }, false, e.err), before, e.advances, slot + 1);
      pa.result = text; pa.events.push(...lines); pa.res = classify(text);
      pa.inPlay = pa.pitches[pa.pitches.length - 1]?.call === 'H';
      pa.plays.push({ kind: 'result', before, after, texts: lines } satisfies Play);
      close(after);
    } else if (e.kind === 'm.sub') {
      const out = e.role === 'P' ? pitcher[e.side] : lineup[e.side][e.slot];
      const label = { PH: '대타', PR: '대주자', DEF: '', P: '투수' }[e.role];
      const line = e.role === 'PR'
        ? `${BASES.findIndex((_, b) => eng().bases[b]?.slot === e.slot) + 1}루주자 ${out.name} : 대주자 ${e.player.name} (으)로 교체`
        : `${out.name} : ${label ? label + ' ' : ''}${e.player.name} (으)로 교체`;
      if (e.role === 'P') { pitcher[e.side] = e.player; addPitcher(e.side, e.player); }
      else { lineup[e.side][e.slot] = e.player; addRow(e.side, e.slot, e.player); }
      if (cur) (cur as PA).events.push(line); else pending.push(line);
      if (cur && e.role === 'PH') { (cur as PA).batter = e.player.id; (cur as PA).title = `대타 ${e.player.name}`; }
    }
  });
  const fin = eng();
  const inningScore = { away: {} as Record<string, string>, home: {} as Record<string, string> };
  const last = snap as Derived | null; // assigned inside the closures above
  for (const h of last?.state.linescore ?? []) inningScore[h.half === 'Top' ? 'away' : 'home'][String(h.inning)] = String(h.runs);
  const shown = [...pas, ...(cur ? [cur as PA] : [])];
  // the half in progress isn't in the engine's linescore yet: its runs are the side's score less its finished halves
  const curSide: Side = fin.half === 'Top' ? 'away' : 'home';
  if (shown.some((q) => q.inn === fin.inning && q.top === (fin.half === 'Top'))) {
    const done = (last?.state.linescore ?? []).filter((h) => (h.half === 'Top') === (curSide === 'away')).reduce((t, h) => t + h.runs, 0);
    inningScore[curSide][String(fin.inning)] = String((curSide === 'away' ? fin.away_score : fin.home_score) - done);
  }
  const pitcherLines = (side: Side): NaverPitcher[] => prow[side].map((r) => ({
    pcode: r.p.id, name: r.p.name, seqno: r.seqno, inn: `${Math.floor(r.outs / 3)}${r.outs % 3 ? ` ${r.outs % 3}/3` : ''}`,
    ballCount: r.pitches, hit: r.hit, kk: r.kk, bb: r.bb, er: r.er,
  }));
  const lineups: Record<Side, NaverLineup> = { away: { batter: rows.away, pitcher: pitcherLines('away') }, home: { batter: rows.home, pitcher: pitcherLines('home') } };
  const game: Game = {
    gameId, stadium: setup.stadium, pas: shown, names, hands: {}, lineups, inningScore,
    awayName: setup.awayName, homeName: setup.homeName,
    meta: { gameId, gameDate: setup.date, stadium: setup.stadium, awayTeamName: setup.awayName, homeTeamName: setup.homeName,
      awayTeamScore: fin.away_score, homeTeamScore: fin.home_score, statusCode: 'MANUAL' },
  };
  const side = batSide();
  const now: Now = {
    inning: fin.inning, top: fin.half === 'Top', outs: fin.outs, balls, strikes,
    awayScore: fin.away_score, homeScore: fin.home_score,
    batter: batter(), slot: side === 'away' ? fin.away_idx : fin.home_idx, pitcher: pitcher[fieldSide()],
    pitches: curPitcherRow(fieldSide()).pitches,
    bases: fin.bases.map((b) => (b ? lineup[side][b.slot] : null)),
    lineup: { away: [...lineup.away], home: [...lineup.home] },
    issues: last?.issues ?? [],
  };
  return { game, now };
}

export interface Now {
  inning: number; top: boolean; outs: number; balls: number; strikes: number;
  awayScore: number; homeScore: number;
  batter: Player; slot: number; pitcher: Player; pitches: number;
  /** runner on 1B, 2B, 3B */
  bases: (Player | null)[];
  lineup: Record<Side, Player[]>;
  issues: string[];
}
