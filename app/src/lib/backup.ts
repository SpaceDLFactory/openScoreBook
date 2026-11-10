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
/** Shape check; a game's moves are checked by replaying it before anything is stored. A setup is read when listing games. */
function ok(e: unknown): boolean {
  const x = e as Partial<GameEvent> & { setup?: Record<string, unknown> };
  if (!x || !str(x.id) || !str(x.gameId) || !str(x.kind) || typeof x.at !== 'number') return false;
  if (!/^(m|landing)\./.test(x.kind!)) return false;
  if (x.kind !== 'm.setup') return true;
  const s = x.setup;
  return !!s && ['date', 'stadium', 'awayName', 'homeName'].every((k) => str(s[k]))
    && [s.away, s.home].every((l) => Array.isArray(l) && l.length >= 9 && l.every(player)) && player(s.awayPitcher) && player(s.homePitcher);
}

export const backupName = (now = new Date()) => `openscorebook-${now.toISOString().slice(0, 10)}.json`;

/** The events of a backup file, in log order. Throws with a message for the user when it isn't one. */
export function readBackup(text: string): GameEvent[] {
  let data: { app?: unknown; events?: unknown };
  try { data = JSON.parse(text); } catch { throw new Error('백업 파일을 읽을 수 없어요.'); }
  if (data?.app !== APP || !Array.isArray(data.events)) throw new Error('openScoreBook 백업 파일이 아니에요.');
  if (!data.events.every(ok)) throw new Error('백업 파일이 손상됐어요.');
  // the store numbers events itself, in this order
  return (data.events as GameEvent[]).filter((e) => e.gameId !== SAMPLE).map(({ seq: _, ...e }) => e as GameEvent);
}
