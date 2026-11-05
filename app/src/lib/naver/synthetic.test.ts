// Relay situations the fetched games don't contain (from the Codex review): built by hand, run through
// parser -> adapter -> wasm engine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGame } from './parse';
import { toEngine, playAdvances } from './toEngine';
import { derive, loadEngine } from '../engine';
import type { NaverGameState, NaverInning, NaverRelay, NaverTextOption } from './types';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../../engine/engine_bg.wasm'))); });

const st = (o: Partial<NaverGameState> = {}): NaverGameState => ({
  homeScore: '0', awayScore: '0', homeHit: '0', awayHit: '0', homeError: '0', awayError: '0', pitcher: 'HP', batter: 'A1',
  ball: '0', strike: '0', out: '0', base1: '0', base2: '0', base3: '0', ...o,
});
let seq = 0;
const opt = (type: number, text: string, s: NaverGameState, extra: Partial<NaverTextOption> = {}): NaverTextOption =>
  ({ seqno: ++seq, type, text, currentGameState: s, ...extra });
const pitch = (s: NaverGameState, call = 'B') => opt(1, '공', s, { pitchNum: 1, pitchResult: call });
let no = 0;
const relay = (top: boolean, title: string, opts: NaverTextOption[]): NaverRelay =>
  ({ no: ++no, inn: 1, homeOrAway: top ? '0' : '1', title, metricOption: null, textOptions: opts, ptsOptions: [] });
const lineup = (t: string) => ({
  batter: Array.from({ length: 9 }, (_, i) => ({ pcode: `${t}${i + 1}`, name: `${t}타자${i + 1}`, batOrder: i + 1, seqno: 1, ab: 0, hit: 0, rbi: 0, run: 0, bb: 0, so: 0 })),
  pitcher: [],
});
const game = (relays: NaverRelay[]) => buildGame('20261105AAHH0', null, [
  { inningScore: { away: {}, home: {} }, awayLineup: lineup('A'), homeLineup: lineup('H'), textRelays: relays } as NaverInning,
]);
/** a PA by away batter `slot`, `pre` = state before; `post` the result line's state; `lines` runner lines after it */
const pa = (slot: number, pre: NaverGameState, result: string, post: NaverGameState, lines: [string, NaverGameState][] = [], pitches = 1) =>
  relay(true, `${slot}번타자 A타자${slot}`, [opt(8, `${slot}번타자`, pre), ...Array.from({ length: pitches }, () => pitch(pre)),
    opt(13, `A타자${slot} : ${result}`, post), ...lines.map(([t, s]) => opt(14, t, s))]);

describe('relay situations outside the fixtures', () => {
  it('automatic intentional walk (no pitch) still counts', async () => {
    const g = game([pa(1, st({ batter: 'A1' }), '고의4구', st({ batter: 'A1', base1: '1' }), [], 0)]);
    expect(g.pas).toHaveLength(1);
    const { config, events } = toEngine(g);
    const d = await derive(config, events);
    expect([d.away_box[0].bb, d.away_box[0].ab, d.state.away_idx]).toEqual([1, 0, 1]);
  });

  it('pickoff for the third out before the first pitch ends the half; that batter leads off next time', async () => {
    const s0 = st({ out: '2', base1: '3', batter: 'A4' });
    const g = game([
      pa(1, st(), '삼진 아웃', st({ out: '1' })),
      pa(2, st({ out: '1', batter: 'A2' }), '삼진 아웃', st({ out: '2' })),
      pa(3, st({ out: '2', batter: 'A3' }), '중견수 앞 1루타', st({ out: '2', base1: '3', awayHit: '1' })),
      relay(true, '4번타자 A타자4', [opt(8, '4번타자', s0), opt(14, '1루주자 A타자3 : 견제사 아웃 (투수->1루수 1루 태그아웃)', st({ out: '3', batter: 'A4' }))]),
    ]);
    expect(g.pas).toHaveLength(4);
    const { config, events } = toEngine(g);
    const d = await derive(config, events);
    expect([d.state.half, d.state.away_idx]).toEqual(['Bottom', 3]);
  });

  it('without runner lines, a run and an out on one play: lead runner scores, flagged as a guess', () => {
    const g = game([pa(3, st({ base1: '1', base2: '2', out: '0', batter: 'A3' }), '좌익수 앞 1루타', st({ base1: '3', awayScore: '1', out: '1' }))]);
    const p = g.pas[0].plays[0];
    const { advances, issue } = playAdvances(p, true, 3, g.pas[0].result);
    expect(advances).toEqual(expect.arrayContaining([{ from: 'Second', to: 'Home' }, { from: 'First', to: 'Out' }, { from: 'Batter', to: 'First' }]));
    expect(issue).toMatch(/guessed/);
  });

  it('a run scored on an error earns no RBI', async () => {
    const g = game([
      pa(1, st(), '좌중간 2루타', st({ base2: '1', awayHit: '1' })),
      pa(2, st({ base2: '1', batter: 'A2' }), '중견수 앞 1루타', st({ base1: '2', awayHit: '2' }),
        [['2루주자 A타자1 : 중견수 실책으로 홈인', st({ base1: '2', awayHit: '2', awayScore: '1' })]]),
    ]);
    const { config, events, issues } = toEngine(g);
    expect(issues).toEqual([]);
    const d = await derive(config, events);
    expect([d.state.away_score, d.away_box[0].r, d.away_box[1].rbi]).toEqual([1, 1, 0]);
  });
});
