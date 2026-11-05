export type View = 'chart' | 'sheet' | 'log' | 'box' | 'pitcher' | 'wp' | 'score' | 'setup';
export const TABS: [View, string][] = [['chart', '차팅'], ['sheet', '기록지'], ['log', '로그'], ['box', '박스'], ['pitcher', '투수'], ['wp', '승률']];
/** a manually scored game: its input screen first, no win probability (that comes from Naver) */
export const MANUAL_TABS: [View, string][] = [['score', '기록'], ...TABS.filter(([k]) => k !== 'wp')];
export const isView = (v: string): v is View => v === 'setup' || MANUAL_TABS.some(([k]) => k === v) || TABS.some(([k]) => k === v);
export const isManualId = (id: string) => id.startsWith('m-');
