// Where games come from. A plain build has none: every game is scored by hand. VITE_RELAY=1 builds in relay games.
import type { Game } from './naver/parse';
import type { NaverGameMeta } from './naver/types';

export interface GameSource {
  listGames(): Promise<NaverGameMeta[]>;
  loadGame(id: string): Promise<Game>;
}

const noSource: GameSource = {
  listGames: async () => [],
  loadGame: async () => { throw new Error('이 경기를 불러올 수 없어요.'); },
};

export async function pickSource(): Promise<GameSource> {
  return import.meta.env.VITE_RELAY ? (await import('./naver/source')).relaySource() : noSource;
}

/** Naver statuses after which a game no longer changes. */
export const isOver = (status: string | undefined) => status === 'RESULT' || status === 'CANCEL';
