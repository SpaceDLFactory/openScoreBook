import { describe, expect, it } from 'vitest';
import { readBackup } from './backup';
import { foldLandings, type GameEvent } from './events';
import { caughtByResult, landingInfo } from './landings';

let n = 0;
const ev = (e: object) => ({ ...e, id: `h${n++}`, gameId: 'm-a', at: n }) as GameEvent;
const set = ev({ kind: 'landing.set', pa: 3, x: 0, y: 90, res: 'OUT', inn: 1, batter: 'a', result: '중견수 플라이 아웃' });

describe('hang time and caught flag', () => {
  it('fold onto the landing, and clear', () => {
    let l = foldLandings([set, ev({ kind: 'landing.hang', pa: 3, sec: 4.6 }), ev({ kind: 'landing.caught', pa: 3, caught: false })])[3];
    expect([l.hang, l.caught]).toEqual([4.6, false]);
    l = foldLandings([set, ev({ kind: 'landing.hang', pa: 3, sec: 4.6 }), ev({ kind: 'landing.hang', pa: 3, sec: null }), ev({ kind: 'landing.caught', pa: 3, caught: true }), ev({ kind: 'landing.caught', pa: 3, caught: null })])[3];
    expect('hang' in l || 'caught' in l).toBe(false);
    // nothing to attach to without a landing
    expect(foldLandings([ev({ kind: 'landing.hang', pa: 9, sec: 3 })])[9]).toBeUndefined();
  });

  it('read caught-in-the-air from the result', () => {
    expect(caughtByResult('중견수 플라이 아웃')).toBe(true);
    expect(caughtByResult('홍길동 : 유격수 라인드라이브 아웃')).toBe(true);
    expect(caughtByResult('중견수 희생플라이 아웃')).toBe(true);
    expect(caughtByResult('포수 파울플라이 아웃')).toBe(true);
    expect(caughtByResult('유격수 땅볼 아웃')).toBe(false);
    expect(caughtByResult('중견수 앞 1루타')).toBe(false);
    expect(caughtByResult('좌익수 실책으로 출루')).toBe(false);
    expect(caughtByResult(null)).toBe(false);
  });

  it('show in the landing line', () => {
    expect(landingInfo({ ...foldLandings([set])[3], hang: 4.6 }, () => 120)).toBe('90m · 펜스 120m · 체공 4.6초');
  });

  it('are checked in backups', () => {
    const file = (e: object) => JSON.stringify({ app: 'openScoreBook', version: 1, events: [{ id: 'x', gameId: 'm-a', at: 1, ...e }] });
    expect(readBackup(file({ kind: 'landing.hang', pa: 3, sec: 4.6 }))).toHaveLength(1);
    expect(readBackup(file({ kind: 'landing.hang', pa: 3, sec: null }))).toHaveLength(1);
    expect(readBackup(file({ kind: 'landing.caught', pa: 3, caught: false }))).toHaveLength(1);
    for (const bad of [{ kind: 'landing.hang', pa: 3, sec: 99 }, { kind: 'landing.hang', pa: 3, sec: '4' }, { kind: 'landing.caught', pa: 3, caught: 'yes' }])
      expect(() => readBackup(file(bad))).toThrow('손상');
  });
});
