import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBackup } from './backup';
import { deriveSteps, loadEngine } from './engine';
import { engineEvents, manualGame, resolve, type ManualEvent, type Player, type Setup } from './manual';
import { STADIUMS, fenceDist } from './stadiums';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../engine/engine_bg.wasm'))); });

const team = (t: string): Player[] => Array.from({ length: 9 }, (_, i) => ({ id: `${t}${i}`, name: `${t}${i}`, pos: '' }));
const base: Setup = { date: '2026-11-17', stadium: '잠실', awayName: 'A', homeName: 'H', away: team('a'), home: team('h'),
  awayPitcher: { id: 'ap', name: 'ap', pos: '투수' }, homePitcher: { id: 'hp', name: 'hp', pos: '투수' } };
const game = async (setup: Setup) => {
  const edits = resolve([{ kind: 'm.setup', setup }] as ManualEvent[]);
  const ee = engineEvents(edits);
  return manualGame('m-p', edits, await deriveSteps(ee.config, ee.events)).game;
};

describe('park outline kept with the game', () => {
  it('uses the outline stored at creation, not the one listed now', async () => {
    const then = structuredClone(STADIUMS['잠실']);
    then.p = then.p!.map((d) => d - 3); // measured 3 m shorter back then
    const g = await game({ ...base, park: then });
    expect(fenceDist(g.fence!, 0)).toBeCloseTo(fenceDist(STADIUMS['잠실'], 0) - 3, 5);
  });

  it('leaves games made before this on the listed outline', async () => {
    expect((await game(base)).fence).toBeUndefined();
  });

  it('is checked in backups', () => {
    const file = (setup: object) => JSON.stringify({ app: 'openScoreBook', version: 1, events: [{ id: 'x', gameId: 'm-a', at: 1, kind: 'm.setup', setup }] });
    expect(readBackup(file({ ...base, park: STADIUMS['잠실'] }))).toHaveLength(1);
    for (const park of [{ f: [1, 2, 3], src: [] }, { ...STADIUMS['잠실'], p: [1, 2] }, { ...STADIUMS['잠실'], src: ['x', 'ok', 'ok', 'ok', 'ok'] }])
      expect(() => readBackup(file({ ...base, park }))).toThrow('손상');
  });
});
