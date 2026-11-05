export type View = 'chart' | 'sheet' | 'log' | 'box' | 'pitcher' | 'wp';
export const TABS: [View, string][] = [['chart', '차팅'], ['sheet', '기록지'], ['log', '로그'], ['box', '박스'], ['pitcher', '투수'], ['wp', '승률']];
export const isView = (v: string): v is View => TABS.some(([k]) => k === v);
