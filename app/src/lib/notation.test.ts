import { describe, expect, it } from 'vitest';
import { notation } from './notation';
import type { PA } from './naver/parse';

const note = (result: string) => notation({ result: `X : ${result}`, pitches: [] } as unknown as PA);
describe('notation', () => {
  it('a bunt hit is a single, a bunt out still an out', () => {
    expect(note('투수 앞 번트안타')).toEqual({ c: '1B', k: 'hit' });
    expect(note('투수 왼쪽 내야안타')).toEqual({ c: '1B', k: 'hit' });
    expect(note('투수 번트 아웃 (투수->1루수 송구아웃)')).toEqual({ c: '1-3', k: 'out' });
  });
});
