import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { directionIssue, fielderOf, where } from './direction';
import { deriveSteps, loadEngine } from './engine';
import { foldLandings, type GameEvent } from './events';
import { engineEvents, manualGame, resolve, type ManualEvent } from './manual';
import sample from './sample-game.json';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../engine/engine_bg.wasm'))); });

/** a point at angle a (degrees, left negative) and distance d */
const at = (a: number, d: number): [number, number] => [d * Math.sin((a * Math.PI) / 180), d * Math.cos((a * Math.PI) / 180)];

describe('direction check', () => {
  it('reads the fielder a result names', () => {
    expect(fielderOf('홍길동 : 우익수 앞 1루타')).toBe('우익수');
    expect(fielderOf('유격수 땅볼 아웃 (유격수->1루수 송구아웃)')).toBe('유격수');
    expect(fielderOf('1루수 플라이 아웃')).toBe('1루수');
    expect(fielderOf('홍길동 : 볼넷')).toBeNull();
    expect(fielderOf(null)).toBeNull();
  });

  it('flags a point on the wrong side or at the wrong depth, and lets plausible ones be', () => {
    expect(directionIssue('우익수 앞 1루타', ...at(25, 60))).toBeNull();
    expect(directionIssue('우익수 앞 1루타', ...at(-30, 60))).toBe('낙구지점(좌측 30° · 60m)이 우익수 쪽이 아니에요');
    expect(directionIssue('중견수 플라이 아웃', ...at(0, 20))).toMatch(/중견수 쪽이 아니에요/); // in front of the mound
    expect(directionIssue('유격수 땅볼 아웃', ...at(-12, 35))).toBeNull();
    expect(directionIssue('유격수 땅볼 아웃', ...at(10, 40))).toBeNull(); // up the middle, past second
    expect(directionIssue('2루수 땅볼 아웃', ...at(-35, 30))).not.toBeNull(); // the hole on the left side
    expect(directionIssue('3루수 파울플라이 아웃', ...at(-55, 30))).toBeNull(); // foul ground on his side
    expect(directionIssue('포수 파울플라이 아웃', 3, -8)).toBeNull(); // behind the plate
    expect(directionIssue('좌익수 홈런', ...at(-28, 115))).toBeNull();
    expect(directionIssue('볼넷', 10, 10)).toBeNull();
  });

  it('describes a point', () => {
    expect(where(...at(-30, 60))).toBe('좌측 30° · 60m');
    expect(where(...at(0, 100))).toBe('중앙 0° · 100m');
    expect(where(...at(60, 20))).toBe('우측 파울 60° · 20m');
  });

  it('finds nothing to flag in the sample game, where each point was tapped where the ball went', async () => {
    const edits = resolve(sample.filter((e) => e.kind.startsWith('m.')) as unknown as ManualEvent[]);
    const ee = engineEvents(edits);
    const { game } = manualGame('m-sample', edits, await deriveSteps(ee.config, ee.events));
    const landings = foldLandings(sample.filter((e) => e.kind.startsWith('landing.')) as unknown as GameEvent[]);
    const flagged = game.pas.flatMap((p) => { const l = landings[p.no]; const w = l && directionIssue(p.result, l.x, l.y); return w ? [`${p.no} ${p.result} ${w}`] : []; });
    expect(flagged).toEqual([]);
  });
});
