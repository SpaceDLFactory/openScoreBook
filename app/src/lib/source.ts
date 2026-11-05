// Where games come from. Dev reads fetched fixtures; a relay server source will plug in here later.
import { buildGame, type Game } from './naver/parse';
import type { NaverGameMeta, NaverInning } from './naver/types';

export interface GameSource {
  listGames(): Promise<NaverGameMeta[]>;
  loadGame(id: string): Promise<Game>;
}

/** Static files laid out like fixtures/naver: games.json, <id>/game.json, <id>/inning-N.json. */
export function fixtureSource(base = 'fixtures/naver'): GameSource {
  return {
    async listGames() {
      const r = await fetch(`${base}/games.json`);
      const games: NaverGameMeta[] = r.ok ? await r.json() : [];
      return games.sort((a, b) => (b.gameDate ?? '').localeCompare(a.gameDate ?? '') || b.gameId.localeCompare(a.gameId));
    },
    async loadGame(id) {
      const meta: NaverGameMeta | null = await fetch(`${base}/${id}/game.json`).then((r) => (r.ok ? r.json() : null), () => null);
      const innings: NaverInning[] = [];
      for (let i = 1; i <= 15; i++) {
        const r = await fetch(`${base}/${id}/inning-${i}.json`);
        if (!r.ok) break;
        innings.push((await r.json()).result.textRelayData);
      }
      if (!innings.length)
        throw new Error('이 경기를 불러올 수 없어요. 오프라인이면 한 번 열어 본 경기만 볼 수 있어요.');
      return buildGame(id, meta, innings);
    },
  };
}

/** The relay server (tools/relay_server.py) serves the same layout under api/; the Vite dev server has fixtures. */
export async function pickSource(): Promise<GameSource> {
  const api = await fetch('api/games.json').then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json'), () => false);
  return fixtureSource(api ? 'api' : 'fixtures/naver');
}

/** Naver statuses after which a game no longer changes. */
export const isOver = (status: string | undefined) => status === 'RESULT' || status === 'CANCEL';
