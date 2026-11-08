// Display constants shared by the views.
import type { Call, PA, ResClass } from './naver/parse';

export const CALL: Record<Call, [string, string]> = {
  B: ['볼', 'var(--ball)'], T: ['루킹 스트라이크', 'var(--strike)'], S: ['헛스윙', 'var(--strike)'],
  F: ['파울', 'var(--foul)'], W: ['번트파울', 'var(--foul)'], H: ['타격', 'var(--inplay)'],
};
export const callLabel = (c: string) => CALL[c as Call]?.[0] ?? c;
export const callColor = (c: string) => CALL[c as Call]?.[1] ?? 'var(--foul)';

export const TRAJ = ['땅볼', '라이너', '플라이', '번트'];

/** Batted-ball result classes: auto-derived from Naver's result text, user can override. */
export const RES: [ResClass, string, string][] = [
  ['1B', '1루타', '#22c55e'], ['2B', '2루타', '#14b8a6'], ['3B', '3루타', '#a855f7'], ['HR', '홈런', '#f59e0b'],
  ['OUT', '아웃', '#8b95a3'], ['E', '실책', '#ef4444'], ['ETC', '야선·희생', '#64748b'],
];
export const RES_COL = Object.fromEntries(RES.map(([k, , c]) => [k, c])) as Record<ResClass, string>;

export const TYPE_COL = ['#f59e0b', '#3b82f6', '#a855f7', '#22c55e', '#ef4444', '#14b8a6', '#ec4899', '#eab308', '#64748b'];

export const halfName = (pa: PA) => `${pa.inn}회${pa.top ? '초' : '말'}`;
export const slotOf = (pa: PA) => pa.title.split('번')[0];
