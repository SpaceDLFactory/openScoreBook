// User-recorded batted balls, keyed by the PA's relay number. Stored per game in localStorage for now
// (same keys as the prototype, so its recordings carry over).
import type { ResClass } from './naver/parse';

export interface Landing {
  unit: 'm';
  /** first landing point, meters from home plate */
  x: number;
  y: number;
  /** where the ball went after it landed */
  path: [number, number][];
  res: ResClass | null;
  resManual?: boolean;
  traj?: string;
  inn: number;
  batter: string;
  result: string | null;
  at: number;
}
export type Landings = Record<string, Landing>;

const key = (gameId: string) => `scorebook:landings:${gameId}`;

export function loadLandings(gameId: string): Landings {
  let v: Record<string, Landing & { unit?: string }> = {};
  try { v = JSON.parse(localStorage.getItem(key(gameId)) || '{}'); } catch { /* private mode, bad JSON */ }
  for (const l of Object.values(v))
    if (l.unit !== 'm') { l.x = Math.round(l.x * 0.3048); l.y = Math.round(l.y * 0.3048); l.unit = 'm'; } // early recordings were in feet
  return v as Landings;
}

export function saveLandings(gameId: string, v: Landings) {
  try { localStorage.setItem(key(gameId), JSON.stringify(v)); } catch { /* quota, private mode */ }
}

/** "54m · 펜스 107m · 이후 32m" */
export function landingInfo(v: Landing, fenceAt: (a: number) => number): string {
  const d = Math.hypot(v.x, v.y), a = (Math.atan2(v.x, v.y) * 180) / Math.PI;
  const fence = Math.abs(a) <= 45 ? ` · 펜스 ${Math.round(fenceAt(a))}m` : ' · 파울지역';
  let roll = 0, prev: [number, number] = [v.x, v.y];
  for (const q of v.path ?? []) { roll += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
  return `${Math.round(d)}m${fence}${roll ? ` · 이후 ${Math.round(roll)}m` : ''}`;
}
