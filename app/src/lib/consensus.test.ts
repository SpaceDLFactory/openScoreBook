import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compareGames } from './compare';
import { checkMerged, consensus, segments, type Source } from './consensus';
import { deriveSteps, loadEngine } from './engine';
import { foldLandings, type GameEvent } from './events';
import { defaultAdvances, engineEvents, manualGame, resolve, type ManualEvent, type Player, type Setup } from './manual';
import sample from './sample-game.json';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../engine/engine_bg.wasm'))); });

type Ev = ManualEvent | Omit<GameEvent, 'id' | 'gameId' | 'at'>;
const source = async (label: string, evs: Ev[]): Promise<Source> => {
  const edits = resolve(evs.filter((e) => e.kind.startsWith('m.')) as ManualEvent[]);
  const ee = engineEvents(edits);
  const steps = await deriveSteps(ee.config, ee.events);
  const { game, now } = manualGame('m-' + label, edits, steps);
  expect(now.issues).toEqual([]);
  return { label, edits, steps, game, landings: foldLandings(evs.filter((e) => e.kind.startsWith('landing.')) as GameEvent[]) };
};
const clone = () => JSON.parse(JSON.stringify(sample)) as (Ev & Record<string, unknown>)[];
const pitchesOf = (evs: Ev[]) => evs.filter((e) => e.kind === 'm.pitch') as (ManualEvent & { kind: 'm.pitch' })[];
/** the merged record as a game, the way the app would open it */
const merged = async (c: ReturnType<typeof consensus>) => {
  const m = await source('merged', [...c.edits, ...c.landings]);
  expect(checkMerged(c, m.game, [])).toEqual([]);
  return m;
};

describe('segments', () => {
  it('cuts the sample game into exactly its plate appearances', async () => {
    const s = await source('A', clone());
    const sg = segments(s.edits, s.steps);
    expect(sg.pas).toHaveLength(s.game.pas.length);
    expect(sg.pas.flat().length + sg.tail.length).toBe(s.edits.length - 1);
  });
});

describe('consensus', () => {
  it('outvotes each scorer\'s own slips: the merge of three records equals the true one', async () => {
    const b = clone(), c = clone();
    const pb = pitchesOf(b), pc = pitchesOf(c);
    pb[0].stuff = '투심'; pb[5].speed! += 6; pc[12].x = -pc[12].x! - 0.6; pc[30].stuff = '커브';
    (b.filter((e) => e.kind === 'm.pa' && e.result === 'FlyOut')[0] as { fielders: number[] }).fielders = [8];
    (c.filter((e) => e.kind === 'landing.set')[3] as { y: number }).y += 15;
    const cons = consensus([await source('A', clone()), await source('B', b), await source('C', c)]);
    expect(cons.disputes).toEqual([]);
    expect(cons.scorers.map((s) => [s.label, s.agree === s.total])).toEqual([['A', true], ['B', false], ['C', false]]);
    const truth = await source('T', clone()), m = await merged(cons);
    const diff = compareGames(truth.game, truth.landings, m.game, m.landings);
    expect(diff.rows.filter((r) => r.diffs.length)).toEqual([]);
    expect(m.game.pas).toHaveLength(truth.game.pas.length);
    // substitutions too: the same pitcher and batter in every PA
    expect(m.game.pas.map((p) => [p.pitcher, p.batter])).toEqual(truth.game.pas.map((p) => [p.pitcher, p.batter]));
    expect([m.game.meta?.awayTeamScore, m.game.meta?.homeTeamScore]).toEqual([4, 5]);
  });

  it('lists what two scorers disagree on, with each one\'s value', async () => {
    const b = clone();
    pitchesOf(b)[0].stuff = '투심';
    const cons = consensus([await source('A', clone()), await source('B', b)]);
    expect(cons.disputes).toEqual([{ inn: 1, top: true, slot: 1, title: '1번타자 한재민', field: '구종', values: [{ label: 'A', value: '직구' }, { label: 'B', value: '투심' }] }]);
    expect(cons.settled['구종'].both - cons.settled['구종'].agree).toBe(1);
  });

  it('agrees on speeds within 2 km/h of each other, as the comparison does', async () => {
    const b = clone(), pb = pitchesOf(b);
    pb[0].speed! -= 2; // 151 / 149: the same reading
    pb[1].speed! += 4; // 130 / 134: not
    const cons = consensus([await source('A', clone()), await source('B', b)]);
    expect(cons.disputes.filter((d) => d.field === '구속')).toEqual([
      { inn: 1, top: true, slot: 1, title: '1번타자 한재민', field: '구속', values: [{ label: 'A', value: '130' }, { label: 'B', value: '134' }] }]);
    expect(pitchesOf(cons.edits)[0].speed).toBe(150);
  });

  it('keeps a plate appearance most scorers saw, with the result most of them wrote', async () => {
    const cons = consensus([await source('A', [s0, k, single, k, k]), await source('B', [s0, k, single, k, k]), await source('C', [s0, k, k, k])]);
    const m = await merged(cons);
    expect(m.game.pas.map((p) => p.result)).toEqual(['a1 : 삼진 아웃', 'a2 : 중견수 앞 1루타', 'a3 : 삼진 아웃', 'a4 : 삼진 아웃']);
    expect(cons.disputes).toEqual([]);
    // C: the PA it missed, the single it wrote as a strikeout, and the outs that followed from that
    expect(cons.scorers.find((s) => s.label === 'C')).toMatchObject({ agree: 9, total: 12 });
  });

  it('leaves out a plate appearance only one of three scorers has', async () => {
    // B gave the 3rd batter a single the others didn't see; A and C end the half on three strikeouts
    const cons = consensus([await source('A', [s0, k, k, k]), await source('B', [s0, k, k, single, k]), await source('C', [s0, k, k, k])]);
    const m = await merged(cons);
    expect(m.game.pas.map((p) => p.result)).toEqual(['a1 : 삼진 아웃', 'a2 : 삼진 아웃', 'a3 : 삼진 아웃']);
    expect(cons.plan).toHaveLength(3);
  });

  it('applies calls settled pitch by pitch even when no scorer has all of them', async () => {
    const fly: ManualEvent = { kind: 'm.pa', result: 'FlyOut', fielders: [8], advances: [{ from: 'Batter', to: 'Out' }] };
    const pa = (...calls: ('B' | 'T')[]): ManualEvent[] => [...calls.map((call): ManualEvent => ({ kind: 'm.pitch', call })), { kind: 'm.pitch', call: 'H' }, fly];
    // every scorer has one strike among three balls, each on a different pitch: the vote is three balls
    const cons = consensus([await source('A', [s0, ...pa('T', 'B', 'B')]), await source('B', [s0, ...pa('B', 'T', 'B')]), await source('C', [s0, ...pa('B', 'B', 'T')])]);
    const m = await merged(cons);
    expect(m.game.pas[0].pitches.map((p) => p.call)).toEqual(['B', 'B', 'B', 'H']);
    expect(cons.disputes).toEqual([]);
  });

  it('keeps a scorer\'s own calls when the voted ones contradict how the PA ended', async () => {
    const ibb: ManualEvent = { kind: 'm.pa', result: 'Walk', fielders: [], advances: [{ from: 'Batter', to: 'First' }], ibb: true };
    const pa = (...calls: ('B' | 'T')[]): ManualEvent[] => [...calls.map((call): ManualEvent => ({ kind: 'm.pitch', call })), ibb];
    // the vote is three strikes, which can't come before an intentional walk
    const cons = consensus([await source('A', [s0, ...pa('B', 'T', 'T')]), await source('B', [s0, ...pa('T', 'B', 'T')]), await source('C', [s0, ...pa('T', 'T', 'B')])]);
    const m = await merged(cons);
    expect(m.game.pas[0].pitches.map((p) => p.call)).toEqual(['B', 'T', 'T']);
    expect(cons.disputes.map((d) => [d.field, d.values.map((v) => v.value)])).toEqual([['판정', ['B T T', 'T B T', 'T T B']]]);
  });

  it('gives back the very same edits when every scorer wrote the same, runner plays and substitutions included', async () => {
    const pr: ManualEvent = { kind: 'm.sub', side: 'away', role: 'PR', slot: 0, player: { id: 'pr', name: '대주자', pos: '' } };
    const sb: ManualEvent = { kind: 'm.runners', play: 'SB', advances: [{ from: 'First', to: 'Second' }] };
    const edits: ManualEvent[] = [s0, single, { kind: 'm.pitch', call: 'B' }, sb, pr, { kind: 'm.pitch', call: 'B' }, k, k, k];
    const cons = consensus([await source('A', edits), await source('B', edits)]);
    expect(cons.edits).toEqual(edits);
    const sample = clone().filter((e) => e.kind.startsWith('m.')) as ManualEvent[];
    const all = consensus([await source('A', sample), await source('B', sample)]);
    expect(all.edits).toEqual(resolve(sample));
  });

  it('keeps two changes to relievers of the same name', async () => {
    const r = (id: string): ManualEvent => ({ kind: 'm.sub', side: 'home', role: 'P', slot: 0, player: { id, name: '구원', pos: '투수' } });
    const edits: ManualEvent[] = [s0, k, r('r1'), k, r('r2'), k];
    const cons = consensus([await source('A', edits), await source('B', edits)]);
    expect(cons.edits.filter((e) => e.kind === 'm.sub')).toHaveLength(2);
  });

  it('keeps a pitching change once, before the PA most scorers put it, wherever the PAs come from', async () => {
    const change: ManualEvent = { kind: 'm.sub', side: 'home', role: 'P', slot: 0, player: { id: 'r1', name: '구원', pos: '투수' } };
    // A wrote the change before the first batter, B and C before the second; A's events stand for each PA (first on a tie)
    const p = (call: 'B' | 'T' | 'S'): ManualEvent => ({ kind: 'm.pitch', call });
    const a = [s0, change, p('T'), p('T'), p('S'), k, k, k];
    const b = [s0, p('T'), p('T'), p('S'), k, change, k, k];
    const cons = consensus([await source('A', a), await source('B', b), await source('C', b)]);
    const m = await merged(cons);
    expect(cons.edits.filter((e) => e.kind === 'm.sub')).toHaveLength(1);
    expect(m.game.pas.map((x) => x.pitcher)).toEqual(['hp', 'r1', 'r1']);
    expect(cons.disputes.map((d) => [d.field, d.values.map((v) => v.label)])).toEqual([['교체 위치', ['A', 'B', 'C']]]);
  });

  it('keeps substitutions made after the last plate appearance', async () => {
    const change: ManualEvent = { kind: 'm.sub', side: 'home', role: 'P', slot: 0, player: { id: 'r1', name: '구원', pos: '투수' } };
    const cons = consensus([await source('A', [s0, k, change]), await source('B', [s0, k, change])]);
    expect(cons.edits.at(-1)).toEqual(change);
    expect(cons.disputes).toEqual([]);
  });
});

const team = (t: string): Player[] => Array.from({ length: 9 }, (_, i) => ({ id: `${t}${i + 1}`, name: `${t}${i + 1}`, pos: '' }));
const setup: Setup = { date: '2026-11-14', stadium: '기타', awayName: 'A', homeName: 'H', away: team('a'), home: team('h'),
  awayPitcher: { id: 'ap', name: 'ap', pos: '투수' }, homePitcher: { id: 'hp', name: 'hp', pos: '투수' } };
const k: ManualEvent = { kind: 'm.pa', result: 'Strikeout', fielders: [], advances: [{ from: 'Batter', to: 'Out' }] };
const single: ManualEvent = { kind: 'm.pa', result: 'Single', fielders: [8], advances: defaultAdvances('Single', [false, false, false]) };
const s0: ManualEvent = { kind: 'm.setup', setup };
