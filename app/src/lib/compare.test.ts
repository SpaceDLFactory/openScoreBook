import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compareGames } from './compare';
import { deriveSteps, loadEngine } from './engine';
import { foldLandings, type GameEvent } from './events';
import { defaultAdvances, engineEvents, manualGame, resolve, type ManualEvent, type Player, type Setup } from './manual';
import sample from './sample-game.json';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../engine/engine_bg.wasm'))); });

const build = async (evs: (ManualEvent | GameEvent)[]) => {
  const edits = evs.filter((e) => e.kind.startsWith('m.')) as ManualEvent[];
  const ee = engineEvents(resolve(edits));
  const { game } = manualGame('m-test', edits, await deriveSteps(ee.config, ee.events));
  return { game, landings: foldLandings(evs.filter((e) => e.kind.startsWith('landing.')) as GameEvent[]) };
};
const clone = () => JSON.parse(JSON.stringify(sample)) as GameEvent[];

describe('compareGames', () => {
  it('finds nothing to report between a record and itself', async () => {
    const x = await build(clone()), y = await build(clone());
    const c = compareGames(x.game, x.landings, y.game, y.landings);
    expect(c.rows.every((r) => r.diffs.length === 0)).toBe(true);
    expect(c.stats.pa).toMatchObject({ onlyA: 0, onlyB: 0 });
    expect(c.stats.pa.agree).toBe(c.stats.pa.both);
    expect(c.stats.call.agree).toBe(c.stats.call.both);
    expect(c.stats.landing.median).toBe(0);
    expect(c.stats.pa.both).toBe(x.game.pas.length);
  });

  it('reports a pitch read differently and a landing tapped elsewhere, on the right PA', async () => {
    const evs = clone();
    const pitches = evs.filter((e) => e.kind === 'm.pitch') as (GameEvent & { kind: 'm.pitch' })[];
    pitches[0].stuff = '커브'; pitches[0].speed = 140; // first pitch of the game: 직구 151 in the sample
    pitches[1].x = -1.5; // the 2nd pitch, out of the zone on the other side
    const land = evs.find((e) => e.kind === 'landing.set') as GameEvent & { kind: 'landing.set' };
    land.x += 10;
    const x = await build(clone()), y = await build(evs);
    const c = compareGames(x.game, x.landings, y.game, y.landings);
    const first = c.rows[0];
    expect([first.inn, first.top, first.slot]).toEqual([1, true, 1]);
    expect(first.diffs.slice(0, 2)).toEqual(['1구 구종: 직구 / 커브', '1구 구속: 151 / 140']);
    expect(first.diffs).toHaveLength(3);
    expect(first.diffs[2]).toMatch(/^2구 코스: \d+ \/ 1[1-4]$/);
    const landed = c.rows.find((r) => r.a?.no === land.pa)!;
    expect(landed.diffs).toEqual(['낙구지점: 10.0m 차이']);
    expect(c.stats.speed.both - c.stats.speed.agree).toBe(1);
    expect(c.stats.landing.both - c.stats.landing.agree).toBe(1);
    expect(c.rows.filter((r) => r.diffs.length)).toHaveLength(2);
  });

  it('pairs plate appearances by batting slot when one scorer missed one', async () => {
    // A saw a single from the 2nd batter; B wrote him down as struck out, so B's half ends one batter earlier
    const x = await build([{ kind: 'm.setup', setup }, k, single, k, k]);
    const y = await build([{ kind: 'm.setup', setup }, k, k, k]);
    const c = compareGames(x.game, x.landings, y.game, y.landings);
    const top1 = c.rows.filter((r) => r.inn === 1 && r.top);
    expect(top1.map((r) => [r.slot, !!r.a, !!r.b])).toEqual([[1, true, true], [2, true, true], [3, true, true], [4, true, false]]);
    expect(top1[1].diffs).toEqual(['결과: 중견수 앞 1루타 / 삼진 아웃']);
    expect(top1[3].diffs).toEqual(['B 기록에 없는 타석']);
    expect(c.stats.pa).toMatchObject({ both: 3, agree: 2, onlyA: 1, onlyB: 0 });
  });

  it('reports runners moved differently on the same result', async () => {
    // both saw two singles; A had the runner from first go to third, B kept him at second
    const s2a: ManualEvent = { kind: 'm.pa', result: 'Single', fielders: [9], advances: [{ from: 'First', to: 'Third' }, { from: 'Batter', to: 'First' }] };
    const x = await build([{ kind: 'm.setup', setup }, single, s2a]);
    const y = await build([{ kind: 'm.setup', setup }, single, { ...s2a, advances: defaultAdvances('Single', [true, false, false]) }]);
    const c = compareGames(x.game, x.landings, y.game, y.landings);
    expect(c.rows.map((r) => r.diffs)).toEqual([[], ['타석 후: 0사 1·3루 0:0 / 0사 1·2루 0:0']]);
    expect(c.stats.pa).toMatchObject({ both: 2, agree: 2 });
  });

  it('notes pitch data only one scorer took, without counting it against agreement', async () => {
    const x = await build([{ kind: 'm.setup', setup }, { kind: 'm.pitch', call: 'B', x: 0, z: 2.5, speed: 140 }, { kind: 'm.pitch', call: 'B', speed: 141 }]);
    const y = await build([{ kind: 'm.setup', setup }, { kind: 'm.pitch', call: 'B' }, { kind: 'm.pitch', call: 'B', speed: 141 }]);
    const c = compareGames(x.game, x.landings, y.game, y.landings);
    expect(c.rows[0].diffs).toEqual(['코스 한쪽만 기록: 1구', '구속 한쪽만 기록: 1구']);
    expect([c.stats.zone, c.stats.speed.both, c.stats.speed.agree]).toEqual([{ both: 0, agree: 0 }, 1, 1]);
    // the PA is still in progress on both sides: no result to agree on
    expect(c.stats.pa).toMatchObject({ both: 0, agree: 0 });
  });
});

const team = (t: string): Player[] => Array.from({ length: 9 }, (_, i) => ({ id: `${t}${i + 1}`, name: `${t}${i + 1}`, pos: '' }));
const setup: Setup = { date: '2026-11-14', stadium: '기타', awayName: 'A', homeName: 'H', away: team('a'), home: team('h'),
  awayPitcher: { id: 'ap', name: 'ap', pos: '투수' }, homePitcher: { id: 'hp', name: 'hp', pos: '투수' } };
const k: ManualEvent = { kind: 'm.pa', result: 'Strikeout', fielders: [], advances: [{ from: 'Batter', to: 'Out' }] };
const single: ManualEvent = { kind: 'm.pa', result: 'Single', fielders: [8], advances: defaultAdvances('Single', [false, false, false]) };
