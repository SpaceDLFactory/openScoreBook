// Two records of one game, side by side: plate appearances paired within each half inning by batting slot, then
// compared pitch by pitch (call, location number, pitch type, speed) and by landing point. A first step toward
// checking crowd-scored games against each other.
import type { Landings } from './landings';
import type { Game, PA, State } from './naver/parse';
import { zoneOf } from './scout';

/** speeds this close (km/h) count as the same reading */
export const SPEED_TOL = 2;
/** landing points this close (m) count as the same */
export const LANDING_TOL = 5;

export interface Row {
  inn: number; top: boolean;
  /** batting slot, 1-based */
  slot: number;
  a: PA | null; b: PA | null;
  /** what differs, one line each; empty when the two agree */
  diffs: string[];
}
export interface Tally { both: number; agree: number }
export interface Comparison {
  score: { a: [number, number]; b: [number, number] };
  rows: Row[];
  stats: {
    pa: Tally & { onlyA: number; onlyB: number };
    pitchCount: Tally;
    call: Tally; zone: Tally; stuff: Tally;
    speed: Tally & { meanDiff: number | null };
    landing: Tally & { median: number | null };
  };
}

export const halfKey = (p: PA) => `${p.inn}${p.top ? 'T' : 'B'}`;
/** the result without the batter's name, so two scorers' names for one player don't count as a difference */
export const resultOf = (p: PA) => p.result?.replace(/^[^:]*:\s*/, '') ?? null;
/** outs, runners and score after a PA, e.g. "1사 1·3루 2:1" */
export const situation = (s: State) => {
  const on = s.bases.flatMap((b, i) => (b ? [`${i + 1}`] : []));
  return `${s.out}사 ${on.length ? on.join('·') + '루' : '주자 없음'} ${s.awayScore}:${s.homeScore}`;
};
const callName: Record<string, string> = { B: '볼', T: '스트라이크', S: '헛스윙', F: '파울', W: '번트 파울', H: '타격' };

export function slotOf(g: Game, p: PA): number {
  const rows = (p.top ? g.lineups.away : g.lineups.home).batter;
  return rows.find((r) => r.pcode === p.batter)?.batOrder ?? 0;
}

/** Pairs of indexes into xs and ys along their longest common subsequence; unpaired items get null. */
export function align<T>(xs: T[], ys: T[]): [number | null, number | null][] {
  const n = xs.length, m = ys.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = xs[i] === ys[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [number | null, number | null][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (xs[i] === ys[j]) out.push([i++, j++]);
    else if (L[i + 1][j] >= L[i][j + 1]) out.push([i++, null]);
    else out.push([null, j++]);
  }
  while (i < n) out.push([i++, null]);
  while (j < m) out.push([null, j++]);
  return out;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((x, y) => x - y), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

export function compareGames(a: Game, la: Landings, b: Game, lb: Landings): Comparison {
  const t = (): Tally => ({ both: 0, agree: 0 });
  const stats: Comparison['stats'] = {
    pa: { ...t(), onlyA: 0, onlyB: 0 }, pitchCount: t(), call: t(), zone: t(), stuff: t(),
    speed: { ...t(), meanDiff: null }, landing: { ...t(), median: null },
  };
  const speedDiffs: number[] = [], landingDiffs: number[] = [];
  const tally = (k: Tally, same: boolean) => { k.both++; if (same) k.agree++; };

  const halves = (g: Game) => {
    const m = new Map<string, PA[]>();
    for (const p of g.pas) m.set(halfKey(p), [...(m.get(halfKey(p)) ?? []), p]);
    return m;
  };
  const ha = halves(a), hb = halves(b);
  const order = [...new Set([...a.pas, ...b.pas].map((p) => `${p.inn}`.padStart(3, '0') + (p.top ? 'a' : 'b')))].sort();

  const rows: Row[] = [];
  for (const k of order) {
    const inn = +k.slice(0, 3), top = k.endsWith('a'), key = `${inn}${top ? 'T' : 'B'}`;
    const xs = ha.get(key) ?? [], ys = hb.get(key) ?? [];
    for (const [i, j] of align(xs.map((p) => slotOf(a, p)), ys.map((p) => slotOf(b, p)))) {
      const pa = i == null ? null : xs[i], pb = j == null ? null : ys[j];
      const slot = slotOf(pa ? a : b, (pa ?? pb)!);
      const diffs: string[] = [];
      if (!pa || !pb) {
        stats.pa[pa ? 'onlyA' : 'onlyB']++;
        diffs.push(pa ? 'B 기록에 없는 타석' : 'A 기록에 없는 타석');
        rows.push({ inn, top, slot, a: pa, b: pb, diffs });
        continue;
      }
      const ra = resultOf(pa), rb = resultOf(pb);
      // a PA neither has finished yet has no result to agree on
      if (ra != null || rb != null) tally(stats.pa, ra === rb);
      if (ra !== rb) diffs.push(`결과: ${ra ?? '진행 중'} / ${rb ?? '진행 중'}`);
      // the same result can still move the runners differently
      if (ra != null && ra === rb && situation(pa.after) !== situation(pb.after)) diffs.push(`타석 후: ${situation(pa.after)} / ${situation(pb.after)}`);
      tally(stats.pitchCount, pa.pitches.length === pb.pitches.length);
      if (pa.pitches.length !== pb.pitches.length) diffs.push(`투구 수: ${pa.pitches.length} / ${pb.pitches.length}`);
      const n = Math.min(pa.pitches.length, pb.pitches.length);
      // pitches where only one scorer noted the location, type or speed: one line per kind, not counted as disagreement
      const oneSided: Record<string, number[]> = { 코스: [], 구종: [], 구속: [] };
      const both = (k: string, q: number, x: unknown, y: unknown) => {
        if (x != null && y != null) return true;
        if ((x == null) !== (y == null)) oneSided[k].push(q + 1);
        return false;
      };
      for (let q = 0; q < n; q++) {
        const x = pa.pitches[q], y = pb.pitches[q];
        tally(stats.call, x.call === y.call);
        if (x.call !== y.call) diffs.push(`${q + 1}구 판정: ${callName[x.call]} / ${callName[y.call]}`);
        const zx = zoneOf(x), zy = zoneOf(y);
        if (both('코스', q, zx, zy)) { tally(stats.zone, zx === zy); if (zx !== zy) diffs.push(`${q + 1}구 코스: ${zx} / ${zy}`); }
        if (both('구종', q, x.stuff || null, y.stuff || null)) { tally(stats.stuff, x.stuff === y.stuff); if (x.stuff !== y.stuff) diffs.push(`${q + 1}구 구종: ${x.stuff} / ${y.stuff}`); }
        if (both('구속', q, x.speed || null, y.speed || null)) {
          const d = Math.abs(Number(x.speed) - Number(y.speed));
          speedDiffs.push(d);
          tally(stats.speed, d <= SPEED_TOL);
          if (d > SPEED_TOL) diffs.push(`${q + 1}구 구속: ${x.speed} / ${y.speed}`);
        }
      }
      for (const [k, qs] of Object.entries(oneSided)) if (qs.length) diffs.push(`${k} 한쪽만 기록: ${qs.join(', ')}구`);
      const lx = la[pa.no], ly = lb[pb.no];
      if (lx && ly) {
        const d = Math.hypot(lx.x - ly.x, lx.y - ly.y);
        landingDiffs.push(d);
        tally(stats.landing, d <= LANDING_TOL);
        if (d > LANDING_TOL) diffs.push(`낙구지점: ${d.toFixed(1)}m 차이`);
      } else if (lx || ly) diffs.push(`낙구지점: ${lx ? '있음' : '없음'} / ${ly ? '있음' : '없음'}`);
      rows.push({ inn, top, slot, a: pa, b: pb, diffs });
    }
  }
  stats.speed.meanDiff = speedDiffs.length ? speedDiffs.reduce((s, d) => s + d, 0) / speedDiffs.length : null;
  stats.landing.median = median(landingDiffs);
  const score = (g: Game): [number, number] => [g.meta?.awayTeamScore ?? 0, g.meta?.homeTeamScore ?? 0];
  return { score: { a: score(a), b: score(b) }, rows, stats };
}
