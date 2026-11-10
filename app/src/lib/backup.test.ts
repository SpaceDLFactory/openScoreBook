import { describe, expect, it } from 'vitest';
import { backupName, backupText, readBackup } from './backup';
import type { GameEvent } from './events';

const ev = (gameId: string, id: string, seq: number): GameEvent => ({ kind: 'm.pitch', call: 'B', id, gameId, at: 1, seq } as GameEvent);

describe('backup file', () => {
  it('round-trips the events in order, without the sample game or store sequence numbers', () => {
    const text = backupText([ev('m-a', 'x1', 1), ev('m-sample', 's1', 2), ev('m-a', 'x2', 3)], new Date('2026-11-10T01:00:00Z'));
    expect(JSON.parse(text)).toMatchObject({ app: 'openScoreBook', version: 1, exportedAt: '2026-11-10T01:00:00.000Z' });
    const back = readBackup(text);
    expect(back.map((e) => e.id)).toEqual(['x1', 'x2']);
    expect(back.every((e) => e.seq === undefined)).toBe(true);
  });
  it('drops a sample game even when a file carries one', () => {
    const text = JSON.stringify({ app: 'openScoreBook', version: 1, events: [ev('m-sample', 's1', 1), ev('m-a', 'x1', 2)] });
    expect(readBackup(text).map((e) => e.id)).toEqual(['x1']);
  });
  it('says what is wrong with a file that is not a backup', () => {
    expect(() => readBackup('{')).toThrow('백업 파일을 읽을 수 없어요.');
    expect(() => readBackup('{"events":[]}')).toThrow('openScoreBook 백업 파일이 아니에요.');
    expect(() => readBackup('{"app":"openScoreBook","events":[{"id":1}]}')).toThrow('백업 파일이 손상됐어요.');
  });
  it('drops sequence numbers a file brings, so the store numbers events in file order', () => {
    const text = JSON.stringify({ app: 'openScoreBook', version: 1, events: [ev('m-a', 'x1', 100), ev('m-a', 'x2', 50)] });
    expect(readBackup(text).map((e) => [e.id, e.seq])).toEqual([['x1', undefined], ['x2', undefined]]);
  });
  it('refuses a setup the game list could not read, and kinds the app does not know', () => {
    const file = (events: unknown[]) => JSON.stringify({ app: 'openScoreBook', version: 1, events });
    const base = { id: 'x', gameId: 'm-a', at: 1 };
    const p = { id: 'p', name: 'p', pos: '' };
    const setup = { date: '2026-11-10', stadium: '한강', awayName: 'A', homeName: 'H', away: Array(9).fill(p), home: Array(9).fill(p), awayPitcher: p, homePitcher: p };
    expect(readBackup(file([{ ...base, kind: 'm.setup', setup }]))).toHaveLength(1);
    expect(() => readBackup(file([{ ...base, kind: 'm.setup' }]))).toThrow('손상');
    expect(() => readBackup(file([{ ...base, kind: 'm.setup', setup: { ...setup, away: [] } }]))).toThrow('손상');
    expect(() => readBackup(file([{ ...base, kind: 'm.setup', setup: { ...setup, date: 3 } }]))).toThrow('손상');
    expect(() => readBackup(file([{ ...base, kind: 'evil' }]))).toThrow('손상');
  });
  it('names the file by date', () => {
    expect(backupName(new Date('2026-11-10T01:00:00Z'))).toBe('openscorebook-2026-11-10.json');
  });
});
