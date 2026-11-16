import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import type { ManualEvent, Player, Setup } from './manual';
import { rosters } from './rosters';
import sample from './sample-game.json';

const pl = (name: string, pos = ''): Player => ({ id: name, name, pos });
let n = 0;
const game = (gameId: string, setup: Setup, ...rest: ManualEvent[]): GameEvent[] =>
  [{ kind: 'm.setup', setup } as ManualEvent, ...rest].map((e) => ({ ...e, id: `x${n++}`, gameId, at: n }) as GameEvent);
const nine = (t: string, names: string[]) => Array.from({ length: 9 }, (_, i) => pl(names[i] ?? `${t}${i + 1}번`, i === 0 ? '중견수' : ''));
const setup = (date: string, away: string, home: string, a: string[], h: string[], ap = '', hp = ''): Setup =>
  ({ date, stadium: '잠실', awayName: away, homeName: home, away: nine(away, a), home: nine(home, h), awayPitcher: pl(ap || `${away} 선발`, '투수'), homePitcher: pl(hp || `${home} 선발`, '투수') });

describe('rosters from scored games', () => {
  it('reads the sample game: both teams, their order and starters', () => {
    const r = rosters((sample as Record<string, unknown>[]).map((e, i) => ({ ...e, id: `s${i}`, gameId: 'm-sample', at: i })) as unknown as GameEvent[]);
    expect(Object.keys(r).sort()).toEqual(['백호', '청룡']);
    expect(r['청룡'].lineup[0]).toEqual({ name: '한재민', pos: '중견수' });
    expect(r['청룡'].pitcher).toBe('권도진');
    expect(r['백호'].pitchers.length).toBeGreaterThan(1); // relievers came in
    expect(r['청룡'].batters.find((b) => b.name === '진세현')).toEqual({ name: '진세현', pos: '유격수' }); // pinch hitter who stayed at short
  });

  it('takes the newest game\'s lineup, and gathers everyone used, newest first, without app-made names', () => {
    const old = game('m-1', setup('2026-04-01', 'LG', '두산', ['박해민', '홍창기'], ['정수빈'], '임찬규', '곽빈'),
      { kind: 'm.sub', side: 'away', role: 'P', slot: 0, player: pl('유영찬', '투수') });
    const now = game('m-2', setup('2026-04-02', 'LG', 'KT', ['홍창기', '신민재'], [], '손주영'),
      { kind: 'm.sub', side: 'away', role: 'PH', slot: 1, player: pl('문보경') },
      { kind: 'm.undo' }, // taken back: not on the roster
      { kind: 'm.sub', side: 'away', role: 'PH', slot: 1, player: pl('오지환') });
    const r = rosters([...now, ...old]);
    expect(r['LG'].date).toBe('2026-04-02');
    expect(r['LG'].lineup.slice(0, 3)).toEqual([{ name: '홍창기', pos: '중견수' }, { name: '신민재', pos: '' }, { name: '', pos: '' }]);
    expect(r['LG'].pitcher).toBe('손주영');
    expect(r['LG'].batters.map((b) => b.name)).toEqual(['오지환', '홍창기', '신민재', '박해민']);
    expect(r['LG'].pitchers).toEqual(['손주영', '유영찬', '임찬규']);
    expect(r['KT'].pitcher).toBe('');
    expect(r['KT'].batters).toEqual([]);
    expect(r['두산'].batters).toEqual([{ name: '정수빈', pos: '중견수' }]);
  });

  it('skips teams left unnamed', () => {
    expect(Object.keys(rosters(game('m-3', setup('2026-04-03', '원정', '홈', ['가'], ['나']))))).toEqual([]);
  });
});
