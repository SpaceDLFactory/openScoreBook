// Turn Naver relay innings into plate appearances with pitches, results and score state.
import type { Fence } from '../stadiums';
import type { InningScore, NaverGameMeta, NaverGameState, NaverInning, NaverLineup, NaverMetric, NaverPitchTrack } from './types';

/** W: a foul bunt */
export type Call = 'B' | 'T' | 'S' | 'F' | 'W' | 'H';
export type ResClass = '1B' | '2B' | '3B' | 'HR' | 'OUT' | 'E' | 'ETC';

export interface State {
  awayScore: number; homeScore: number;
  awayHit: number; homeHit: number;
  awayError: number; homeError: number;
  ball: number; strike: number; out: number;
  pitcher: string; batter: string;
  /** batting slot (1-9) of the runner on 1B, 2B, 3B; 0 = empty */
  bases: [number, number, number];
}

/** A stretch of the relay that moves runners: the PA's result with the runner lines that follow it, or runner
 *  lines between pitches (steal, wild pitch, pickoff). States are Naver's before and after the stretch. */
export interface Play {
  kind: 'result' | 'runners';
  before: State;
  after: State;
  /** the runner lines, e.g. "1루주자 김영웅 : 2루까지 진루" */
  texts: string[];
}

export interface Pitch {
  pitcher: string;
  n: number;
  call: Call;
  speed?: string;
  stuff?: string;
  /** plate crossing [x, z] in feet, catcher's view; null without tracking data */
  xz: [number, number] | null;
  /** strike zone [bottom, top] in feet */
  sz: [number, number] | null;
  /** balls, strikes before the pitch (a pitch-clock violation adds one with no pitch) */
  count: [number, number];
  state: State;
}

export interface PA {
  no: number;
  inn: number;
  top: boolean;
  title: string;
  batter: string;
  /** pitcher who threw the last pitch of the PA */
  pitcher: string;
  /** that pitcher's running pitch count after this PA */
  pitcherPitches: number;
  pitches: Pitch[];
  result: string | null;
  events: string[];
  /** in relay order */
  plays: Play[];
  before: State;
  after: State;
  inPlay: boolean;
  res: ResClass | null;
  wp: NaverMetric | null;
}

export interface Game {
  meta: NaverGameMeta | null;
  gameId: string;
  stadium: string | null;
  /** a park the user measured; otherwise the fence comes from the stadium's name */
  fence?: Fence;
  pas: PA[];
  names: Record<string, string>;
  hands: Record<string, string>;
  lineups: { away: NaverLineup; home: NaverLineup };
  inningScore: InningScore;
  awayName: string;
  homeName: string;
}

/** Batted-ball class from Naver's PA result text. */
export function classify(t: string | null | undefined): ResClass | null {
  if (!t) return null;
  if (/홈런/.test(t)) return 'HR';
  if (/3루타/.test(t)) return '3B';
  if (/2루타/.test(t)) return '2B';
  if (/1루타|내야안타/.test(t)) return '1B';
  if (/실책/.test(t)) return 'E';
  if (/야수선택|땅볼로 출루|희생/.test(t)) return 'ETC';
  if (/아웃/.test(t)) return 'OUT';
  return 'ETC';
}

/** Height where the pitch crosses y = crossPlateY. Naver's crossPlateY is the plate-plane position
 *  (constant 0.7083 ft), not a height, so solve the trajectory for the crossing time. */
export function plateXZ(p: NaverPitchTrack): [number, number] {
  const a = 0.5 * p.ay, b = p.vy0, c = p.y0 - p.crossPlateY;
  const t = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return [p.crossPlateX, p.z0 + p.vz0 * t + 0.5 * p.az * t * t];
}

const toState = (s: NaverGameState): State => ({
  awayScore: +s.awayScore, homeScore: +s.homeScore,
  awayHit: +s.awayHit, homeHit: +s.homeHit,
  awayError: +s.awayError, homeError: +s.homeError,
  ball: +s.ball, strike: +s.strike, out: +s.out,
  pitcher: s.pitcher, batter: s.batter,
  bases: [+(s.base1 ?? 0), +(s.base2 ?? 0), +(s.base3 ?? 0)],
});

const TEAM: Record<string, string> = { SS: '삼성', HT: 'KIA', LG: 'LG', OB: '두산', KT: 'KT', SK: 'SSG', NC: 'NC', LT: '롯데', HH: '한화', WO: '키움' };
/** Team name from the gameId (yyyymmdd + away code + home code ...) when the meta is missing. */
const teamFromId = (gameId: string, side: 'away' | 'home') =>
  TEAM[gameId.slice(side === 'away' ? 8 : 10, side === 'away' ? 10 : 12)] ?? side;

export function buildGame(gameId: string, meta: NaverGameMeta | null, innings: NaverInning[]): Game {
  if (!innings.length) throw new Error(`no relay innings for ${gameId}`);
  const names: Record<string, string> = {}, hands: Record<string, string> = {};
  for (const t of innings)
    for (const side of [t.homeLineup, t.awayLineup])
      for (const p of [...side.batter, ...side.pitcher]) {
        names[p.pcode] = p.name;
        if (p.hitType) hands[p.pcode] = p.hitType;
      }
  const pas: PA[] = [];
  const pitchCount: Record<string, number> = {};
  for (const t of innings) {
    for (const r of [...t.textRelays].sort((a, b) => a.no - b.no)) {
      const opts = [...r.textOptions].sort((a, b) => a.seqno - b.seqno);
      if (!opts.length || opts[0].type !== 8) continue; // only batter plate appearances
      const pts = Object.fromEntries(r.ptsOptions.map((p) => [p.pitchId, p]));
      const before = toState(opts[0].currentGameState);
      const pitches: Pitch[] = [], events: string[] = [], plays: Play[] = [];
      let result: string | null = null;
      let prev = before, open: Play | null = null, res: Play | null = null;
      for (const o of opts.slice(1)) {
        const st = toState(o.currentGameState), was = prev;
        if (o.type === 13 || o.type === 23) { res = { kind: 'result', before: prev, after: st, texts: [] }; plays.push(res); open = null; }
        else if (o.type === 14 || o.type === 24) {
          const cur = res ?? (open ??= plays[plays.push({ kind: 'runners', before: prev, after: st, texts: [] }) - 1]);
          cur.after = st;
          cur.texts.push(o.text ?? '');
        } else open = null; // a pitch or another line closes a run of runner lines
        prev = st;
        if (o.type === 1) {
          // attribute each pitch to the pitcher on the mound at that moment (mid-PA changes happen)
          const pc = o.currentGameState.pitcher;
          pitchCount[pc] = (pitchCount[pc] || 0) + 1;
          const p = o.ptsPitchId ? pts[o.ptsPitchId] : undefined;
          pitches.push({
            pitcher: pc, n: o.pitchNum ?? pitches.length + 1, call: o.pitchResult as Call, speed: o.speed, stuff: o.stuff,
            xz: p ? plateXZ(p) : null, sz: p ? [p.bottomSz, p.topSz] : null, count: [was.ball, was.strike], state: toState(o.currentGameState),
          });
        } else if (o.type === 13 || o.type === 23) result = o.text ?? null;
        else if (o.text) events.push(o.text);
      }
      // A relay with no pitch is a PA only if something happened in it (automatic intentional walk, pickoff before
      // the first pitch); a pinch hitter announcement has neither and is skipped.
      if (!pitches.length && !plays.length) continue;
      const lastPitcher = pitches[pitches.length - 1]?.pitcher ?? before.pitcher;
      pas.push({
        no: r.no, inn: r.inn, top: r.homeOrAway === '0', title: r.title, batter: before.batter,
        pitcher: lastPitcher, pitcherPitches: pitchCount[lastPitcher] ?? 0, pitches, result, events, plays, before,
        after: toState(opts[opts.length - 1].currentGameState),
        inPlay: pitches[pitches.length - 1]?.call === 'H', res: classify(result), wp: r.metricOption ?? null,
      });
    }
  }
  const last = innings[innings.length - 1];
  return {
    meta, gameId, stadium: meta?.stadium ?? null, pas, names, hands,
    lineups: { away: last.awayLineup, home: last.homeLineup }, inningScore: last.inningScore,
    awayName: meta?.awayTeamName ?? teamFromId(gameId, 'away'),
    homeName: meta?.homeTeamName ?? teamFromId(gameId, 'home'),
  };
}
