// The user's edits as an append-only event log; current landings are a fold over it.
import type { ResClass } from './naver/parse';
import type { Landing, Landings } from './landings';

/** `pa` is the plate appearance's relay number (PA.no). */
export type LandingEvent =
  | { kind: 'landing.set'; pa: number; x: number; y: number; res: ResClass | null; inn: number; batter: string; result: string | null }
  | { kind: 'landing.path'; pa: number; x: number; y: number }
  | { kind: 'landing.undo'; pa: number } // drop the last path point, or the landing when it has no path
  | { kind: 'landing.clear'; pa: number }
  | { kind: 'landing.res'; pa: number; res: ResClass; manual: boolean }
  | { kind: 'landing.traj'; pa: number; traj: string };

export type GameEvent = LandingEvent & {
  /** unique per event; lets a replayed write-ahead entry be recognised */
  id: string;
  gameId: string;
  /** ms since epoch */
  at: number;
  /** assigned by the store; log order */
  seq?: number;
};

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function foldLandings(events: readonly GameEvent[]): Landings {
  const out: Landings = {};
  for (const e of events) {
    const cur = out[e.pa];
    switch (e.kind) {
      case 'landing.set':
        out[e.pa] = { unit: 'm', x: e.x, y: e.y, path: [], res: e.res, inn: e.inn, batter: e.batter, result: e.result, at: e.at };
        break;
      case 'landing.path': cur?.path.push([e.x, e.y]); break;
      case 'landing.undo':
        if (cur?.path.length) cur.path.pop();
        else delete out[e.pa];
        break;
      case 'landing.clear': delete out[e.pa]; break;
      case 'landing.res': if (cur) { cur.res = e.res; cur.resManual = e.manual; } break;
      case 'landing.traj': if (cur) cur.traj = e.traj; break;
    }
  }
  return out;
}

/** Events that rebuild landings recorded before the log existed (localStorage, one record per PA). */
export function eventsFromLegacy(gameId: string, legacy: Landings): GameEvent[] {
  const out: GameEvent[] = [];
  for (const [k, l] of Object.entries(legacy) as [string, Landing][]) {
    const pa = +k, at = l.at || 0;
    const base = () => ({ id: newId(), gameId, at });
    out.push({ ...base(), kind: 'landing.set', pa, x: l.x, y: l.y, res: l.res, inn: l.inn, batter: l.batter, result: l.result });
    for (const [x, y] of l.path ?? []) out.push({ ...base(), kind: 'landing.path', pa, x, y });
    if (l.resManual && l.res) out.push({ ...base(), kind: 'landing.res', pa, res: l.res, manual: true });
    if (l.traj) out.push({ ...base(), kind: 'landing.traj', pa, traj: l.traj });
  }
  return out;
}
