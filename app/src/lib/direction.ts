// Does a landing point agree with the fielder its result names? "우익수 앞 1루타" tapped in left field is almost
// certainly a slip of the finger. Each fielder gets a generous area (direction and distance from home), so only
// clear mismatches are flagged; a warning, never a block.

const FIELDERS = ['투수', '포수', '1루수', '2루수', '3루수', '유격수', '좌익수', '중견수', '우익수'] as const;
type Fielder = (typeof FIELDERS)[number];

/** where each fielder can plausibly make or field a play: angle from the center line in degrees (left negative),
 *  and distance from home in meters */
const AREA: Record<Fielder, { a: [number, number]; d: [number, number] }> = {
  투수: { a: [-50, 50], d: [0, 45] },
  포수: { a: [-180, 180], d: [0, 30] },
  '1루수': { a: [-5, 180], d: [0, 70] },
  '2루수': { a: [-20, 180], d: [0, 75] },
  '3루수': { a: [-180, 5], d: [0, 70] },
  유격수: { a: [-180, 20], d: [0, 75] },
  좌익수: { a: [-180, 10], d: [35, 200] },
  중견수: { a: [-35, 35], d: [40, 200] },
  우익수: { a: [-10, 180], d: [35, 200] },
};

/** the first fielder a result names: "홍길동 : 우익수 앞 1루타" → 우익수 */
export function fielderOf(result: string | null | undefined): Fielder | null {
  const t = (result ?? '').replace(/^[^:]*:\s*/, '');
  return FIELDERS.find((f) => t.startsWith(f)) ?? null;
}

/** "좌측 32° · 85m" */
export function where(x: number, y: number): string {
  const a = (Math.atan2(x, y) * 180) / Math.PI, d = Math.hypot(x, y);
  const side = Math.abs(a) > 45 ? (a < 0 ? '좌측 파울' : '우측 파울') : a < -15 ? '좌측' : a > 15 ? '우측' : '중앙';
  return `${side} ${Math.round(Math.abs(a))}° · ${Math.round(d)}m`;
}

/** A warning when the point is outside the named fielder's area, else null. */
export function directionIssue(result: string | null | undefined, x: number, y: number): string | null {
  const f = fielderOf(result);
  if (!f) return null;
  const a = (Math.atan2(x, y) * 180) / Math.PI, d = Math.hypot(x, y), A = AREA[f];
  if (a >= A.a[0] && a <= A.a[1] && d >= A.d[0] && d <= A.d[1]) return null;
  return `낙구지점(${where(x, y)})이 ${f} 쪽이 아니에요`;
}
