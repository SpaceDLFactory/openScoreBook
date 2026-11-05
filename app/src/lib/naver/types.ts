// Shapes of Naver's unofficial KBO relay API (api-gw.sports.naver.com), limited to the fields the app reads.
// Numbers inside currentGameState arrive as strings.

export interface NaverGameMeta {
  gameId: string;
  gameDate?: string;
  stadium?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeTeamScore?: number;
  awayTeamScore?: number;
  statusCode?: string;
}

export interface NaverGameState {
  homeScore: string;
  awayScore: string;
  homeHit: string;
  awayHit: string;
  homeError: string;
  awayError: string;
  pitcher: string;
  batter: string;
  ball: string;
  strike: string;
  out: string;
  base1?: string;
  base2?: string;
  base3?: string;
}

export interface NaverTextOption {
  seqno: number;
  type: number; // 0 inning header, 1 pitch, 2 substitution, 8 batter up, 13/23 PA result, 14/24 runner, ...
  text?: string;
  pitchNum?: number;
  pitchResult?: string; // B ball, T called strike, S swinging strike, F foul, H in play
  speed?: string;
  stuff?: string;
  ptsPitchId?: string;
  currentGameState: NaverGameState;
}

export interface NaverPitchTrack {
  pitchId: string;
  crossPlateX: number;
  crossPlateY: number;
  y0: number;
  z0: number;
  vy0: number;
  vz0: number;
  ay: number;
  az: number;
  topSz: number;
  bottomSz: number;
}

export interface NaverMetric {
  homeTeamWinRate?: number;
  awayTeamWinRate?: number;
}

export interface NaverRelay {
  no: number;
  inn: number;
  homeOrAway: string; // "0" = away batting (top), "1" = home batting
  title: string;
  metricOption?: NaverMetric | null;
  textOptions: NaverTextOption[];
  ptsOptions: NaverPitchTrack[];
}

export interface NaverBatter {
  pcode: string;
  name: string;
  hitType?: string;
  batOrder: number;
  seqno: number;
  posName?: string;
  ab: number;
  hit: number;
  rbi: number;
  run: number;
  bb: number;
  so: number;
}

export interface NaverPitcher {
  pcode: string;
  name: string;
  hitType?: string;
  seqno: number;
  inn: string;
  ballCount: number;
  hit: number;
  kk: number;
  bb: number;
  er: number;
}

export interface NaverLineup {
  batter: NaverBatter[];
  pitcher: NaverPitcher[];
}

export type InningScore = Record<'home' | 'away', Record<string, string>>;

/** One inning's `result.textRelayData`. */
export interface NaverInning {
  inningScore: InningScore;
  awayLineup: NaverLineup;
  homeLineup: NaverLineup;
  textRelays: NaverRelay[];
}
