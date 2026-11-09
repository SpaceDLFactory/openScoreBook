import { describe, expect, it } from 'vitest';
import { notation } from './notation';
import { classify, type PA } from './naver/parse';
import { engineResult } from './naver/toEngine';

const note = (result: string) => notation({ result: `X : ${result}`, pitches: [] } as unknown as PA);
describe('notation', () => {
  it('a bunt hit is a single, a bunt out still an out', () => {
    expect(note('투수 앞 번트안타')).toEqual({ c: '1B', k: 'hit' });
    expect(note('투수 왼쪽 내야안타')).toEqual({ c: '1B', k: 'hit' });
    expect(note('투수 번트 아웃 (투수->1루수 송구아웃)')).toEqual({ c: '1-3', k: 'out' });
  });
  it('the batted-ball class and the engine result read a bunt hit as a single too', () => {
    const t = 'X : 투수 앞 번트안타';
    expect([classify(t), engineResult({ result: t } as unknown as PA)]).toEqual(['1B', 'Single']);
  });
});
