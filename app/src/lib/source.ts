// Where games come from. Dev reads fetched fixtures; a relay server source will plug in here later.
import { buildGame, type Game } from './naver/parse';
import type { NaverGameMeta, NaverInning } from './naver/types';

export interface GameSource {
  listGames(): Promise<NaverGameMeta[]>;
  loadGame(id: string): Promise<Game>;
}

/** Static files laid out like fixtures/naver: games.json, <id>/game.json, <id>/inning-N.json. */
export function fixtureSource(base = '/fixtures/naver'): GameSource {
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
      return buildGame(id, meta, innings);
    },
  };
}
