// Manual scoring checked two ways: hand-entered snippets, and every fetched Naver game re-entered as manual edits
// (pitches, results with fielders, runner moves, pitching changes), which must land on Naver's score and box.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveSteps, loadEngine } from './engine';
import { defaultAdvances, engineEvents, manualGame, resolve, resultText, type ManualEvent, type Player, type Setup } from './manual';
import { buildGame, type Game } from './naver/parse';
import type { NaverInning } from './naver/types';
import { engineResult, playAdvances } from './naver/toEngine';
import { notation } from './notation';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../engine/engine_bg.wasm'))); });

const team = (t: string): Player[] => Array.from({ length: 9 }, (_, i) => ({ id: `${t}${i + 1}`, name: `${t}${i + 1}`, pos: '' }));
const setup: Setup = { date: '2026-11-05', stadium: '대구', awayName: '원정', homeName: '홈', away: team('A'), home: team('H'),
  awayPitcher: { id: 'AP', name: 'AP', pos: '투수' }, homePitcher: { id: 'HP', name: 'HP', pos: '투수' } };
const build = async (edits: ManualEvent[]) => {
  const ee = engineEvents(resolve(edits));
  return manualGame('m-test', edits, await deriveSteps(ee.config, ee.events));
};
const p = (call: 'B' | 'T' | 'S' | 'F' | 'H'): ManualEvent => ({ kind: 'm.pitch', call });
const pa = (result: ManualEvent & { kind: 'm.pa' } extends infer T ? T extends { result: infer R } ? R : never : never, bases: boolean[], fielders: number[] = []): ManualEvent =>
  ({ kind: 'm.pa', result, fielders, advances: defaultAdvances(result, bases) });

describe('manual scoring', () => {
  it('counts, a walk, a two-run homer, outs and a half flip', async () => {
    const { game, now } = await build([{ kind: 'm.setup', setup },
      p('B'), p('B'), p('B'), p('B'), pa('Walk', [false, false, false]),
      p('T'), p('H'), pa('HomeRun', [true, false, false], [7]),
      p('S'), p('S'), p('S'), pa('Strikeout', [false, false, false]),
      p('H'), pa('GroundOut', [false, false, false], [6, 3]),
      p('H'), pa('FlyOut', [false, false, false], [8])]);
    expect([now.awayScore, now.homeScore, now.top, now.outs, now.batter.id]).toEqual([2, 0, false, 0, 'H1']);
    expect(game.pas.map((x) => notation(x)?.c)).toEqual(['BB', 'HR', 'K', '6-3', 'F8']);
    const a2 = game.lineups.away.batter.find((b) => b.pcode === 'A2')!;
    expect([a2.ab, a2.hit, a2.rbi, a2.run]).toEqual([1, 1, 2, 1]);
    expect(game.lineups.home.pitcher[0]).toMatchObject({ ballCount: 11, kk: 1, bb: 1, hit: 1, er: 2, inn: '1' });
    // the third out reads like Naver's relay (3 outs, bases cleared), so the engine adapter replays it the same
    expect(game.pas[4].after).toMatchObject({ out: 3, bases: [0, 0, 0] });
    const { toEngine, compareRuns, compareBox } = await import('./naver/toEngine');
    const { derive } = await import('./engine');
    const t = toEngine(game), d = await derive(t.config, t.events);
    expect([t.issues, compareRuns(game, d), compareBox(game, d)]).toEqual([[], {}, []]);
  });

  it('undo takes back the latest edit; the count follows', async () => {
    const { now } = await build([{ kind: 'm.setup', setup }, p('B'), p('S'), { kind: 'm.undo' }, p('B')]);
    expect([now.balls, now.strikes]).toEqual([2, 0]);
  });

  it('caught stealing for the third out mid-count: the batter leads off next time, count reset', async () => {
    const { now } = await build([{ kind: 'm.setup', setup },
      p('H'), pa('GroundOut', [false, false, false], [6, 3]), p('H'), pa('GroundOut', [false, false, false], [4, 3]),
      p('H'), pa('Single', [false, false, false], [8]),
      p('B'), { kind: 'm.runners', play: 'CS', advances: [{ from: 'First', to: 'Out' }] }]);
    expect([now.top, now.balls, now.outs]).toEqual([false, 0, 0]);
    expect(now.lineup.away[3].id).toBe('A4');
  });

  it('pinch hitter and pitching change', async () => {
    const { game, now } = await build([{ kind: 'm.setup', setup },
      { kind: 'm.sub', side: 'away', role: 'PH', slot: 0, player: { id: 'X', name: 'X', pos: '대타' } },
      { kind: 'm.sub', side: 'home', role: 'P', slot: 0, player: { id: 'HP2', name: 'HP2', pos: '투수' } },
      p('H'), pa('Double', [false, false, false], [9])]);
    expect(game.pas[0].batter).toBe('X');
    expect(game.pas[0].events.join(' / ')).toMatch(/대타 X/);
    expect(game.lineups.home.pitcher.map((r) => [r.name, r.ballCount])).toEqual([['HP', 0], ['HP2', 1]]);
    expect(now.bases[1]?.id).toBe('X');
  });

  it('runs go to the pitcher who let the runner on', async () => {
    const { game } = await build([{ kind: 'm.setup', setup },
      p('H'), pa('Single', [false, false, false], [8]),
      { kind: 'm.sub', side: 'home', role: 'P', slot: 0, player: { id: 'HP2', name: 'HP2', pos: '투수' } },
      p('H'), { kind: 'm.pa', result: 'Double', fielders: [7], advances: [{ from: 'First', to: 'Home' }, { from: 'Batter', to: 'Second' }] }, // A1 scores: the starter's runner
      p('H'), pa('HomeRun', [false, true, false], [8])]); // A2 (the reliever's) and A3
    expect(game.lineups.home.pitcher.map((r) => [r.name, r.er])).toEqual([['HP', 1], ['HP2', 2]]);
  });

  it('unearned: reached on an error, scored after the third out should have been made, or on a passed ball', async () => {
    const { game, now } = await build([{ kind: 'm.setup', setup },
      p('H'), pa('GroundOut', [false, false, false], [6, 3]), p('H'), pa('GroundOut', [false, false, false], [4, 3]),
      p('H'), pa('Error', [false, false, false], [6]), // A3 on by error with two outs: the half should be over
      p('H'), { kind: 'm.pa', result: 'Double', fielders: [7], advances: [{ from: 'First', to: 'Home' }, { from: 'Batter', to: 'Second' }] }, // A3 scores
      p('H'), pa('HomeRun', [false, true, false], [8]), // A4, A5 score
      p('H'), pa('FlyOut', [false, false, false], [9]),
      p('H'), pa('Triple', [false, false, false], [9]), // H1
      { kind: 'm.runners', play: 'PB', advances: [{ from: 'Third', to: 'Home' }] },
      p('H'), pa('Triple', [false, false, false], [9]), // H2
      { kind: 'm.runners', play: 'WP', advances: [{ from: 'Third', to: 'Home' }] }]);
    expect([now.awayScore, now.homeScore]).toEqual([3, 2]);
    expect(game.lineups.home.pitcher[0].er).toBe(0);
    expect(game.lineups.away.pitcher[0].er).toBe(1); // the wild pitch run is earned
  });

  it('unearned: the scoring play would have been the third out without the error', async () => {
    const { game, now } = await build([{ kind: 'm.setup', setup },
      p('S'), p('S'), p('S'), pa('Strikeout', [false, false, false]),
      p('H'), pa('Triple', [false, false, false], [9]), // A2 on third
      p('H'), { kind: 'm.pa', result: 'Error', fielders: [6], advances: [{ from: 'Batter', to: 'First' }] }, // would be out two
      p('H'), pa('SacFly', [true, false, true], [8])]); // A2 scores on what would be out three
    expect([now.awayScore, now.outs]).toEqual([1, 2]);
    expect(game.lineups.home.pitcher[0].er).toBe(0);
  });

  it('a run scored on a runner play shows at once, as does the half in progress', async () => {
    const lead = await build([{ kind: 'm.setup', setup }, p('H'), pa('HomeRun', [false, false, false], [7])]);
    expect(lead.game.inningScore.away['1']).toBe('1');
    const more = await build([{ kind: 'm.setup', setup }, p('H'), pa('HomeRun', [false, false, false], [7]), p('B')]);
    expect(more.game.inningScore.away['1']).toBe('1');
    const { game } = await build([{ kind: 'm.setup', setup },
      p('H'), pa('Triple', [false, false, false], [9]), p('B'),
      { kind: 'm.runners', play: 'WP', advances: [{ from: 'Third', to: 'Home' }] }]);
    expect(game.pas.at(-1)!.after.awayScore).toBe(2 - 1);
    expect(game.inningScore.away['1']).toBe('1');
    expect(game.inningScore.home['1']).toBeUndefined();
  });

  it('result texts read back as the same notation', () => {
    const cases: [Parameters<typeof resultText>, string][] = [
      [['GroundOut', [6, 3]], '6-3'], [['FlyOut', [8]], 'F8'], [['FlyOut', [6], true], 'L6'], [['DoublePlay', [6, 4, 3]], '6-4-3 DP'],
      [['SacBunt', [1, 3]], 'SAC 1-3'], [['SacFly', [9]], 'SF9'], [['Error', [5]], 'E5'], [['FieldersChoice', [4]], 'FC'],
    ];
    for (const [args, code] of cases)
      expect(notation({ result: `X : ${resultText(...args)}`, pitches: [] } as never)?.c, args.join(' ')).toBe(code);
  });
});

// ---- every fetched game, re-entered by hand
const DIR = join(__dirname, '../../../fixtures/naver');
const ids = existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'inning-1.json'))) : [];
const POS: Record<string, number> = { 투수: 1, 포수: 2, '1루수': 3, '2루수': 4, '3루수': 5, 유격수: 6, 좌익수: 7, 중견수: 8, 우익수: 9 };
function fielders(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(투수|포수|1루수|2루수|3루수|유격수|좌익수|중견수|우익수)/g)) if (out.at(-1) !== POS[m[1]]) out.push(POS[m[1]]);
  return out;
}
function asManual(g: Game): ManualEvent[] {
  const first = (side: 'away' | 'home') => Array.from({ length: 9 }, (_, i) => {
    const b = g.lineups[side].batter.filter((x) => x.batOrder === i + 1).sort((x, y) => x.seqno - y.seqno)[0];
    return { id: b.pcode, name: b.name, pos: b.posName ?? '' };
  });
  const sp = (side: 'away' | 'home') => { const q = [...g.lineups[side].pitcher].sort((x, y) => x.seqno - y.seqno)[0]; return { id: q.pcode, name: q.name, pos: '투수' }; };
  const out: ManualEvent[] = [{ kind: 'm.setup', setup: { date: g.meta?.gameDate ?? '', stadium: g.stadium ?? '', awayName: g.awayName, homeName: g.homeName,
    away: first('away'), home: first('home'), awayPitcher: sp('away'), homePitcher: sp('home') } }];
  const onMound = { away: sp('away').id, home: sp('home').id };
  const slotOf: Record<string, number> = {};
  for (const side of ['away', 'home'] as const) for (const b of g.lineups[side].batter) slotOf[b.pcode] = b.batOrder;
  for (const pa of g.pas) {
    const field = pa.top ? 'home' : 'away';
    for (const play of pa.plays.filter((x) => x.kind === 'runners'))
      out.push({ kind: 'm.runners', play: 'ETC', advances: playAdvances(play, pa.top, null, null).advances });
    for (const q of pa.pitches) {
      if (q.pitcher !== onMound[field]) {
        onMound[field] = q.pitcher;
        out.push({ kind: 'm.sub', side: field, role: 'P', slot: 0, player: { id: q.pitcher, name: g.names[q.pitcher], pos: '투수' } });
      }
      out.push({ kind: 'm.pitch', call: q.call, x: q.xz?.[0], z: q.xz?.[1], stuff: q.stuff, speed: q.speed ? +q.speed : undefined });
    }
    const res = pa.plays.find((x) => x.kind === 'result'), type = engineResult(pa);
    if (!res || !type) continue;
    const text = (pa.result ?? '').replace(/^[^:]+ : /, '');
    out.push({ kind: 'm.pa', result: type, fielders: fielders(text), line: /라인드라이브|직선타/.test(text), ibb: /고의/.test(text),
      advances: playAdvances(res, pa.top, slotOf[pa.batter] ?? null, pa.result).advances });
  }
  return out;
}
const load = (id: string) => {
  const innings: NaverInning[] = [];
  for (let i = 1; existsSync(join(DIR, id, `inning-${i}.json`)); i++)
    innings.push(JSON.parse(readFileSync(join(DIR, id, `inning-${i}.json`), 'utf8')).result.textRelayData);
  return buildGame(id, JSON.parse(readFileSync(join(DIR, id, 'game.json'), 'utf8')), innings);
};

describe.skipIf(!ids.length)('fetched games re-entered as manual scoring', () => {
  for (const id of ids) {
    it(`${id}: same score, halves and box per slot as Naver`, async () => {
      const g = load(id), { game: m, now } = await build(asManual(g));
      const fin = g.pas[g.pas.length - 1].after;
      expect([now.awayScore, now.homeScore]).toEqual([fin.awayScore, fin.homeScore]);
      const runs = (x: Game, side: 'away' | 'home') => Object.entries(x.inningScore[side]).filter(([, v]) => Number.isFinite(+v)).map(([k, v]) => `${k}:${+v}`);
      expect(runs(m, 'away')).toEqual(runs(g, 'away'));
      expect(runs(m, 'home')).toEqual(runs(g, 'home'));
      for (const side of ['away', 'home'] as const)
        for (let slot = 1; slot <= 9; slot++)
          for (const k of ['ab', 'hit', 'rbi', 'run', 'bb', 'so'] as const) {
            const sum = (x: Game) => x.lineups[side].batter.filter((b) => b.batOrder === slot).reduce((t, b) => t + +b[k], 0);
            expect(sum(m), `${side} ${slot}번 ${k}`).toBe(sum(g));
          }
      // per pitcher: pitches thrown
      const thrown = (x: Game) => Object.fromEntries([...x.lineups.away.pitcher, ...x.lineups.home.pitcher].map((r) => [r.pcode, +r.ballCount]));
      expect(thrown(m)).toEqual(thrown(g));
      // notation of every PA with a result, in order
      const codes = (x: Game) => x.pas.filter((q) => q.result).map((q) => notation(q)?.c);
      const a = codes(g), b = codes(m), off = a.map((c, i) => [c, b[i]]).filter(([c, d]) => c !== d);
      console.log(`${id}: ${a.length} PAs, notation differs on ${off.length}: ${JSON.stringify(off)}`);
      expect(off).toEqual([]);
      expect(b.length).toBe(a.length);
      expect(now.issues).toEqual([]);
    });
  }
});
