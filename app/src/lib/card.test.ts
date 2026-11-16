import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cardSvg, isOver, summaryOf, type CardSummary } from './card';
import { deriveSteps, loadEngine } from './engine';
import { engineEvents, manualGame, resolve, type ManualEvent } from './manual';
import sample from './sample-game.json';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../engine/engine_bg.wasm'))); });

const base: CardSummary = { date: '2026-04-04', stadium: '잠실', away: '청룡', home: '백호', score: [4, 5],
  innings: { away: ['0', '1', '0', '0', '0', '2', '0', '1', '0'], home: ['0', '0', '0', '1', '0', '0', '0', '4', ''] }, status: 'final', inning: 9, top: false };
// CARD_OUT=dir writes the cards as files, to look at them
const out = (name: string, svg: string) => { const d = process.env.CARD_OUT; if (d) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${name}.svg`), svg); } };

describe('score card', () => {
  it('sums up the sample game: final, home won 4-5, its line score', async () => {
    const edits = resolve(sample.filter((e) => e.kind.startsWith('m.')) as unknown as ManualEvent[]);
    const ee = engineEvents(edits);
    const { game, now } = manualGame('m-sample', edits, await deriveSteps(ee.config, ee.events));
    const s = summaryOf(game, now);
    expect(s).toMatchObject({ date: '2026-04-04', stadium: '잠실', away: '청룡', home: '백호', score: [4, 5], status: 'final' });
    expect(s.innings.away.reduce((t, r) => t + +r, 0)).toBe(4);
    expect(s.innings.home.reduce((t, r) => t + +(r || 0), 0)).toBe(5);
    const svg = cardSvg(s);
    out('sample', svg);
    expect(svg).toContain('4 : 5');
    expect(svg).toContain('경기 종료');
    expect(svg).toContain('2026-04-04 · 잠실');
    expect(svg).toMatch(/>X<\/text>/); // the bottom of the 9th, not batted
  });

  it('tells a game in progress from a finished one', () => {
    const at = { outs: 0, balls: 0, strikes: 0 };
    expect(isOver({ ...at, inning: 9, top: false, awayScore: 4, homeScore: 5 })).toBe(true); // home ahead after the top of the 9th
    expect(isOver({ ...at, inning: 9, top: false, awayScore: 5, homeScore: 4 })).toBe(false);
    expect(isOver({ ...at, inning: 10, top: true, awayScore: 5, homeScore: 4 })).toBe(true); // visitors won in 9
    expect(isOver({ ...at, inning: 10, top: true, awayScore: 4, homeScore: 4 })).toBe(false); // extra innings
    expect(isOver({ ...at, inning: 5, top: true, awayScore: 0, homeScore: 3 })).toBe(false);
    const live = cardSvg({ ...base, status: 'live', inning: 6, top: true, score: [3, 1] });
    out('live', live);
    expect(live).toContain('6회초 진행 중');
  });

  it('escapes team names and fits long ones', () => {
    const svg = cardSvg({ ...base, away: '<b>"한강" & 둔치 야구단 블루윙스</b>', home: 'Seoul Saturday Morning Baseball Club' });
    out('long', svg);
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;&quot;한강&quot; &amp;');
    expect(svg).toContain('…');
  });

  it('widens the line score for extra innings', () => {
    const ex = (n: number) => Array.from({ length: n }, (_, i) => String(i % 2));
    const svg = cardSvg({ ...base, innings: { away: ex(12), home: ex(12) }, score: [6, 7] });
    out('extra', svg);
    expect(svg).toContain('>12<');
  });
});
