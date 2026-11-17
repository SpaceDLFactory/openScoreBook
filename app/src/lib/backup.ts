// Backup file: every scored event of this browser as JSON, and reading one back. The made-up sample game is left
// out: each browser seeds its own copy with its own event ids, so merging two copies would double it.
import type { GameEvent } from './events';

const APP = 'openScoreBook', SAMPLE = 'm-sample';

export function backupText(events: GameEvent[], now = new Date()): string {
  const kept = events.filter((e) => e.gameId !== SAMPLE).map(({ seq: _, ...e }) => e);
  return JSON.stringify({ app: APP, version: 1, exportedAt: now.toISOString(), events: kept });
}

const str = (v: unknown) => typeof v === 'string';
const player = (p: unknown) => !!p && str((p as { id?: unknown }).id) && str((p as { name?: unknown }).name);
/** No string longer than this anywhere in an event (names, notes); keeps a hostile file from costing much to handle. */
const MAX_TEXT = 200;
function bounded(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return v.length <= MAX_TEXT;
  if (typeof v === 'number') return Number.isFinite(v);
  if (v == null || typeof v === 'boolean') return true;
  if (depth > 6 || typeof v !== 'object') return false;
  return Object.entries(v as object).every(([k, x]) => k.length <= MAX_TEXT && bounded(x, depth + 1));
}
const RES = ['1B', '2B', '3B', 'HR', 'OUT', 'E', 'ETC'];
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000;
/** a landing edit: the PA it belongs to (a plain positive number, never a property name) and sane values */
function isLanding(x: Record<string, unknown>): boolean {
  if (!Number.isInteger(x.pa) || (x.pa as number) < 1 || (x.pa as number) > 10_000) return false;
  switch (x.kind) {
    case 'landing.set': return num(x.x) && num(x.y) && (x.res === null || RES.includes(x.res as string)) && Number.isInteger(x.inn)
      && str(x.batter) && (x.result === null || str(x.result));
    case 'landing.path': return num(x.x) && num(x.y);
    case 'landing.undo': case 'landing.clear': return true;
    case 'landing.res': return RES.includes(x.res as string) && typeof x.manual === 'boolean';
    case 'landing.traj': return str(x.traj);
    case 'landing.hang': return x.sec === null || (typeof x.sec === 'number' && x.sec > 0 && x.sec <= 15);
    case 'landing.caught': return x.caught === null || typeof x.caught === 'boolean';
    default: return false;
  }
}

/** Shape check; a game's moves are checked by replaying it before anything is stored. A setup is read when listing games. */
export function isEvent(e: unknown): boolean {
  const x = e as Partial<GameEvent> & { setup?: Record<string, unknown> };
  if (!x || !str(x.id) || !str(x.gameId) || !str(x.kind) || typeof x.at !== 'number' || !bounded(x)) return false;
  if (!/^(m|landing)\./.test(x.kind!)) return false;
  if (x.kind.startsWith('landing.')) return isLanding(x as unknown as Record<string, unknown>);
  if (x.kind !== 'm.setup') return isEdit(x as unknown as Record<string, unknown>);
  const s = x.setup;
  return !!s && ['date', 'stadium', 'awayName', 'homeName'].every((k) => str(s[k]))
    && [s.away, s.home].every((l) => Array.isArray(l) && l.length >= 9 && l.length <= 15 && l.every(player)) && player(s.awayPitcher) && player(s.homePitcher)
    && (s.fence === undefined || (Array.isArray(s.fence) && s.fence.length === 5 && s.fence.every((v) => v === null || num(v))));
}

// Every scoring edit, field by field: replay indexes lineups and tables with these values, so a side, role, slot
// or spot outside its set could reach object internals (a side of "__proto__") before replay could object.
const CALLS = ['B', 'T', 'S', 'F', 'W', 'H'];
const RESULTS = ['Single', 'Double', 'Triple', 'HomeRun', 'Walk', 'HitByPitch', 'Strikeout', 'GroundOut', 'FlyOut', 'DoublePlay', 'FieldersChoice', 'Error', 'SacFly', 'SacBunt'];
const SPOTS = ['Batter', 'First', 'Second', 'Third', 'Home', 'Out'];
const PLAYS = ['SB', 'CS', 'WP', 'PB', 'BK', 'PO', 'ETC'];
const ROLES = ['PH', 'PR', 'DEF', 'P'];
const opt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);
const bool = (v: unknown) => typeof v === 'boolean';
const spots = (v: unknown) => Array.isArray(v) && v.length <= 4 && v.every((f) => SPOTS.includes(f));
const moves = (v: unknown) => Array.isArray(v) && v.length <= 4 && v.every((a) => !!a && SPOTS.includes(a.from) && SPOTS.includes(a.to) && opt(a.no_rbi, bool));
function isEdit(x: Record<string, unknown>): boolean {
  switch (x.kind) {
    case 'm.pitch': return CALLS.includes(x.call as string) && opt(x.x, num) && opt(x.z, num) && opt(x.stuff, str) && opt(x.speed, num);
    case 'm.pa': return RESULTS.includes(x.result as string) && Array.isArray(x.fielders) && x.fielders.length <= 9
      && x.fielders.every((f) => Number.isInteger(f) && f >= 1 && f <= 9) && moves(x.advances)
      && opt(x.line, bool) && opt(x.ibb, bool) && opt(x.auto, bool) && opt(x.err, spots);
    case 'm.runners': return PLAYS.includes(x.play as string) && moves(x.advances) && opt(x.err, spots);
    case 'm.sub': return (x.side === 'away' || x.side === 'home') && ROLES.includes(x.role as string)
      && Number.isInteger(x.slot) && (x.slot as number) >= 0 && (x.slot as number) < 15 && player(x.player);
    case 'm.undo': return true;
    default: return false;
  }
}

export const backupName = (now = new Date()) => `openscorebook-${now.toISOString().slice(0, 10)}.json`;

/** The events of a backup file, in log order. Throws with a message for the user when it isn't one. */
export function readBackup(text: string): GameEvent[] {
  let data: { app?: unknown; events?: unknown };
  try { data = JSON.parse(text); } catch { throw new Error('백업 파일을 읽을 수 없어요.'); }
  if (data?.app !== APP || !Array.isArray(data.events)) throw new Error('openScoreBook 백업 파일이 아니에요.');
  if (!data.events.every(isEvent)) throw new Error('백업 파일이 손상됐어요.');
  // the store numbers events itself, in this order
  return (data.events as GameEvent[]).filter((e) => e.gameId !== SAMPLE).map(({ seq: _, ...e }) => e as GameEvent);
}
