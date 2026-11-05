// Checks the relay parser against fetched games (fixtures are gitignored; the suite skips without them).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGame, type Game } from './parse';
import { notation, runsScored } from '../notation';
import type { NaverInning } from './types';

const DIR = join(__dirname, '../../../../fixtures/naver');
const ids = existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'inning-1.json'))) : [];

function load(id: string): Game {
  const innings: NaverInning[] = [];
  for (let i = 1; existsSync(join(DIR, id, `inning-${i}.json`)); i++)
    innings.push(JSON.parse(readFileSync(join(DIR, id, `inning-${i}.json`), 'utf8')).result.textRelayData);
  const meta = existsSync(join(DIR, id, 'game.json')) ? JSON.parse(readFileSync(join(DIR, id, 'game.json'), 'utf8')) : null;
  return buildGame(id, meta, innings);
}

describe.skipIf(!ids.length)('relay parser on fetched games', () => {
  for (const id of ids) {
    const g = load(id);
    const fin = g.pas[g.pas.length - 1].after;
    const sumInnings = (side: 'away' | 'home') =>
      Object.values(g.inningScore[side]).reduce((t, v) => t + (Number.isFinite(+v) ? +v : 0), 0);

    it(`${id}: final score = inning totals = meta`, () => {
      expect(fin.awayScore).toBe(sumInnings('away'));
      expect(fin.homeScore).toBe(sumInnings('home'));
      if (g.meta?.awayTeamScore != null) expect(fin.awayScore).toBe(+g.meta.awayTeamScore);
      if (g.meta?.homeTeamScore != null) expect(fin.homeScore).toBe(+g.meta.homeTeamScore);
    });

    it(`${id}: hits = box score hits`, () => {
      const hits = (side: 'away' | 'home') => g.lineups[side].batter.reduce((t, b) => t + +b.hit, 0);
      expect(fin.awayHit).toBe(hits('away'));
      expect(fin.homeHit).toBe(hits('home'));
    });

    it(`${id}: relay pitch count per pitcher = box score`, () => {
      const count: Record<string, number> = {};
      for (const pa of g.pas) for (const p of pa.pitches) count[p.pitcher] = (count[p.pitcher] ?? 0) + 1;
      for (const p of [...g.lineups.away.pitcher, ...g.lineups.home.pitcher]) expect(count[p.pcode] ?? 0, p.name).toBe(+p.ballCount);
    });

    it(`${id}: every PA with a result gets a notation`, () => {
      const missing = g.pas.filter((pa) => pa.result && !notation(pa)).map((pa) => pa.result);
      expect(missing).toEqual([]);
    });

    it(`${id}: runners marked as scored = final score`, () => {
      const scored = runsScored(g);
      const total = (t: string) => Object.entries(scored).filter(([k]) => k.endsWith(t)).reduce((n, [, s]) => n + s.length, 0);
      expect(total('t')).toBe(fin.awayScore);
      expect(total('b')).toBe(fin.homeScore);
    });
  }
});
