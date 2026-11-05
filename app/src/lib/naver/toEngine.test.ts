// Feeds fetched games through the wasm engine and reports where its derived score departs from Naver's.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGame } from './parse';
import type { NaverInning } from './types';
import { derive, loadEngine } from '../engine';
import { compareBox, compareRuns, toEngine } from './toEngine';

const DIR = join(__dirname, '../../../../fixtures/naver');
const ids = existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'inning-1.json'))) : [];
const load = (id: string) => {
  const innings: NaverInning[] = [];
  for (let i = 1; existsSync(join(DIR, id, `inning-${i}.json`)); i++)
    innings.push(JSON.parse(readFileSync(join(DIR, id, `inning-${i}.json`), 'utf8')).result.textRelayData);
  return buildGame(id, JSON.parse(readFileSync(join(DIR, id, 'game.json'), 'utf8')), innings);
};

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../../engine/engine_bg.wasm'))); });

describe.skipIf(!ids.length)('engine replay of fetched games', () => {
  for (const id of ids) {
    it(`${id}: engine score vs Naver`, async () => {
      const g = load(id), { config, events, unmapped, issues } = toEngine(g);
      const d = await derive(config, events);
      const fin = g.pas[g.pas.length - 1].after;
      const runs = compareRuns(g, d), box = compareBox(g, d);
      console.log(`${id}: engine ${d.state.away_score}:${d.state.home_score} vs naver ${fin.awayScore}:${fin.homeScore} | ${events.length} events` +
        ` | unmapped ${unmapped.map((p) => p.result).join(' / ') || '-'} | issues ${issues.join(' ; ') || '-'}` +
        ` | halves off ${JSON.stringify(runs)} | box off ${box.join(', ') || '-'}`);
      expect(unmapped.map((p) => p.result)).toEqual([]);
      expect(issues).toEqual([]);
      expect(runs).toEqual({});
      expect([d.state.away_score, d.state.home_score]).toEqual([fin.awayScore, fin.homeScore]);
      expect(box).toEqual([]);
    });
  }
});
