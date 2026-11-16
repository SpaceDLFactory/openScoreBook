// A shared game: one game's events with a summary, as the share server stores and serves it (docs/design/sharing.md).
// Used by the app (making and opening shares) and by the server (checking them), so both read it the same way.
import { isEvent } from './backup';
import { summaryOf, type CardSummary } from './card';
import { deriveSteps } from './engine';
import type { GameEvent } from './events';
import { engineEvents, manualGame, resolve, type ManualEvent } from './manual';

export const SHARE_VERSION = 1;
/** one game is far below this; anything bigger is not a game */
export const SHARE_MAX_BYTES = 1_000_000;

export interface Share {
  app: 'openScoreBook'; kind: 'share'; version: number;
  createdAt: string;
  summary: CardSummary;
  /** the game's events in log order, without store positions */
  events: GameEvent[];
}

/** the game id every shared event carries: the sharer's own ids (game and events) stay with the sharer */
const SHARED = 'shared';
const anonymous = (events: GameEvent[]) => events.map(({ seq: _, ...e }, i) => ({ ...e, id: `e${i}`, gameId: SHARED }) as GameEvent);

/** What the app sends: the events of one game. The server makes the summary itself. */
export function shareRequest(events: GameEvent[]) {
  return { app: 'openScoreBook', kind: 'share', version: SHARE_VERSION, events: anonymous(events) };
}

/** Check a shared game and replay it: one manually scored game, setup first, that the engine replays without
 *  problems. Returns its events and summary; throws with a message for the user otherwise. */
export async function readShareEvents(data: unknown): Promise<{ events: GameEvent[]; summary: CardSummary }> {
  const d = data as { app?: unknown; kind?: unknown; version?: unknown; events?: unknown };
  if (d?.app !== 'openScoreBook' || d.kind !== 'share' || d.version !== SHARE_VERSION || !Array.isArray(d.events)) throw new Error('공유 기록 형식이 아니에요.');
  const events = d.events as GameEvent[];
  if (!events.length || !events.every(isEvent)) throw new Error('공유 기록이 손상됐어요.');
  if (new Set(events.map((e) => e.gameId)).size !== 1) throw new Error('경기 하나만 공유할 수 있어요.');
  if (events[0].kind !== 'm.setup' || events.filter((e) => e.kind === 'm.setup').length !== 1) throw new Error('경기 설정이 없어요.');
  const edits = resolve(events.filter((e) => e.kind.startsWith('m.')) as unknown as ManualEvent[]);
  let replay;
  try {
    const ee = engineEvents(edits);
    replay = manualGame('m-share', edits, await deriveSteps(ee.config, ee.events));
  } catch { throw new Error('공유 기록을 다시 계산하지 못했어요.'); }
  if (replay.now.issues.length) throw new Error(`공유 기록이 맞지 않아요: ${replay.now.issues.join(' · ')}`);
  // a landing belongs to a PA of this game
  if (events.some((e) => e.kind.startsWith('landing.') && (e as unknown as { pa: number }).pa > replay.game.pas.length)) throw new Error('공유 기록이 손상됐어요.');
  return { events: anonymous(events), summary: summaryOf(replay.game, replay.now) };
}
