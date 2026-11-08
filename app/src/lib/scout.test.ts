import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGame } from './naver/parse';
import type { NaverInning } from './naver/types';
import { zoneOf } from './scout';

describe('zoneOf', () => {
  const at = (x: number, z: number, sz: [number, number] | null = [1.5, 3.6]) => zoneOf({ xz: [x, z], sz });
  it('numbers the zone 1-9 from the top left, catcher\'s view', () => {
    expect([at(-0.5, 3.4), at(0, 3.4), at(0.5, 3.4)]).toEqual([1, 2, 3]);
    expect([at(-0.5, 2.5), at(0, 2.5), at(0.5, 2.5)]).toEqual([4, 5, 6]);
    expect([at(-0.5, 1.7), at(0, 1.7), at(0.5, 1.7)]).toEqual([7, 8, 9]);
  });
  it('edges belong to the zone; outside goes by quadrant', () => {
    expect([at(-0.708, 3.6), at(0.708, 1.5)]).toEqual([1, 9]);
    expect([at(-1, 3.0), at(1, 3.0), at(-1, 2.0), at(1, 2.0)]).toEqual([11, 12, 13, 14]);
    expect([at(0.2, 4.2), at(-0.2, 0.9)]).toEqual([12, 13]);
    // a ball that touches the zone is in it, as ABS calls it (plate +2 cm each side)
    expect([at(-0.85, 3.65), at(0.85, 1.42), at(0.9, 2.5), at(0, 3.75)]).toEqual([1, 9, 14, 12]);
  });
  it('falls back to the drawn zone without sz, and gives nothing without a location', () => {
    expect(at(0, 3.3, null)).toBe(2);
    expect(zoneOf({ xz: null, sz: null })).toBeNull();
  });
});

const DIR = join(__dirname, '../../../fixtures/naver');
const ids = existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'inning-1.json'))) : [];
const STRIKE = new Set(['T', 'S']);
describe.skipIf(!ids.length)('the count before each pitch, fetched games', () => {
  const load = (id: string) => {
    const innings: NaverInning[] = [];
    for (let i = 1; existsSync(join(DIR, id, `inning-${i}.json`)); i++)
      innings.push(JSON.parse(readFileSync(join(DIR, id, `inning-${i}.json`), 'utf8')).result.textRelayData);
    return buildGame(id, JSON.parse(readFileSync(join(DIR, id, 'game.json'), 'utf8')), innings);
  };
  it.each(ids)('%s: follows the calls, except where a pitch-clock violation adds one', (id) => {
    let n = 0;
    const off: string[] = [];
    for (const pa of load(id).pas) {
      if (pa.pitches[0] && pa.pitches[0].count.join() !== '0,0' && !pa.events.some((e) => e.includes('피치클락'))) off.push(`${pa.no} starts ${pa.pitches[0].count}`);
      pa.pitches.slice(1).forEach((q, k) => {
        const [b, s] = pa.pitches[k].count, c: string = pa.pitches[k].call; // Naver also sends W (foul bunt), outside Call
        const want = c === 'B' ? [b + 1, s] : STRIKE.has(c) || ((c === 'F' || c === 'W') && s < 2) ? [b, s + 1] : [b, s];
        n++;
        if (q.count.join() !== want.join() && !pa.events.some((e) => e.includes('피치클락'))) off.push(`${pa.no}#${q.n} ${q.count} vs ${want}`);
      });
    }
    expect(n).toBeGreaterThan(100);
    expect(off).toEqual([]);
  });
  it('the zone number agrees with ABS calls: every called strike in 1-9, almost every ball outside', () => {
    const ps = ids.flatMap((id) => load(id).pas.flatMap((x) => x.pitches)).filter((q) => q.xz && q.sz);
    const inZone = (q: (typeof ps)[number]) => zoneOf(q)! <= 9;
    const strikes = ps.filter((q) => q.call === 'T'), balls = ps.filter((q) => q.call === 'B');
    expect(strikes.length).toBeGreaterThan(100);
    expect(strikes.filter((q) => !inZone(q))).toEqual([]);
    expect(balls.filter(inZone).length / balls.length).toBeLessThan(0.02); // one plane can't match ABS's top/bottom planes
  });
  it.skipIf(!ids.includes('77771104SSKT02026'))('KS2 10회 오윤석: a batter clock violation before the first pitch is a strike', () => {
    const pa = load('77771104SSKT02026').pas.find((x) => x.no === 108)!;
    expect(pa.pitches.map((q) => [q.n, q.count.join('-')])).toEqual([[2, '0-1'], [3, '1-1'], [4, '1-2']]);
  });
});
