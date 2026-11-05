import { describe, expect, it } from 'vitest';
import { eventsFromLegacy, foldLandings, newId, type GameEvent, type LandingEvent } from './events';

const g = 'G';
let t = 0;
const ev = (e: LandingEvent): GameEvent => ({ ...e, id: newId(), gameId: g, at: ++t });
const set = (pa: number, x = 10, y = 80) => ev({ kind: 'landing.set', pa, x, y, res: '1B', inn: 1, batter: 'b', result: '중견수 앞 1루타' });

describe('foldLandings', () => {
  it('first tap sets the landing, later taps extend its path', () => {
    const L = foldLandings([set(3), ev({ kind: 'landing.path', pa: 3, x: 12, y: 90 }), ev({ kind: 'landing.path', pa: 3, x: 15, y: 95 })]);
    expect(L[3]).toMatchObject({ x: 10, y: 80, res: '1B', path: [[12, 90], [15, 95]] });
  });
  it('undo pops the path first, then removes the landing', () => {
    const base = [set(3), ev({ kind: 'landing.path', pa: 3, x: 12, y: 90 })];
    expect(foldLandings([...base, ev({ kind: 'landing.undo', pa: 3 })])[3].path).toEqual([]);
    expect(foldLandings([...base, ev({ kind: 'landing.undo', pa: 3 }), ev({ kind: 'landing.undo', pa: 3 })])[3]).toBeUndefined();
  });
  it('clear removes; a new set after clear starts fresh', () => {
    const L = foldLandings([set(3), ev({ kind: 'landing.path', pa: 3, x: 1, y: 1 }), ev({ kind: 'landing.clear', pa: 3 }), set(3, 20, 70)]);
    expect(L[3]).toMatchObject({ x: 20, y: 70, path: [] });
  });
  it('result and trajectory overrides apply to an existing landing only', () => {
    const L = foldLandings([ev({ kind: 'landing.res', pa: 4, res: 'HR', manual: true }), set(3),
      ev({ kind: 'landing.res', pa: 3, res: 'HR', manual: true }), ev({ kind: 'landing.traj', pa: 3, traj: '플라이' })]);
    expect(L[4]).toBeUndefined();
    expect(L[3]).toMatchObject({ res: 'HR', resManual: true, traj: '플라이' });
  });
  it('landings of different PAs are independent', () => {
    const L = foldLandings([set(3), set(7, -40, 60), ev({ kind: 'landing.clear', pa: 3 })]);
    expect(Object.keys(L)).toEqual(['7']);
  });
});

describe('eventsFromLegacy', () => {
  it('rebuilds the same landings from a prototype record', () => {
    const legacy = { 12: { unit: 'm' as const, x: -60.4, y: 85.1, path: [[-70.3, 95] as [number, number]], res: 'HR' as const, resManual: true,
      traj: '플라이', inn: 1, batter: '52605', result: '좌익수 플라이 아웃', at: 1000 } };
    const evs = eventsFromLegacy(g, legacy);
    expect(foldLandings(evs)[12]).toEqual(legacy[12]);
    expect(new Set(evs.map((e) => e.id)).size).toBe(evs.length);
  });
});
