// Outfield fence data per KBO park, keyed by Naver's stadium name, and the geometry used to draw it.

export type FenceSrc = 'ok' | 'sat' | 'comm' | 'est';
export interface Fence {
  /** labels at LF line, LCF, CF, RCF, RF (m); null = unknown */
  f: (number | null)[];
  src: FenceSrc[];
  /** wall distance every 1° from -45 to +45 */
  p?: number[];
}

// Fence distances (m) at LF line, LCF, CF, RCF, RF. null = unknown, interpolated.
// src: 'ok' = official/press figure, 'sat' = from aerial imagery, 'comm' = community table only, 'est' = guessed.
// p (optional): wall distance every 1° from -45 (LF line) to +45 (RF line), traced on VWorld aerial orthophotos
// (z19, 0.24 m/px; 대구 and 광주 cross-checked on Esri/Bing). Wall = outer edge of the warning track; home plate =
// intersection of the two chalk foul lines found in the image (they meet at 89.7-90.6°; 대전: 18.0 m behind the
// mound). Arc parks: one robust 4th-order curve per wall (광주 6th), 0.2-0.4 m rms to the kept trace points.
// 대구/창원: side walls square to the foul lines + a flat CF wall. 대전: straight walls between traced corners.
// Expect about ±1-2 m where the wall meets rays at a shallow angle or sits in shadow. Where an official/press figure
// exists the profile is shifted linearly in angle to pass through it, so ≈ values can include that shift;
// "measured" below = the fitted curve before the shift.
export const STADIUMS: Record<string, Fence> = {
  // 잠실: measured 100/124/101.1 (LF/CF/RF), shifted to 서울시 100/125 (≤1.1 m).
  잠실: {f:[100,119,125,117,100], src:['ok','sat','ok','sat','ok'],
    p:[100,101.1,102.1,103.1,104.1,105.1,106.1,107,108,108.9,109.7,110.6,111.4,112.2,113,113.8,114.5,115.3,115.9,116.6,117.3,117.9,118.5,119,119.6,120.1,120.6,121.1,121.5,121.9,122.3,122.7,123,123.3,123.6,123.8,124.1,124.3,124.5,124.6,124.7,124.9,124.9,125,125,125,124.9,124.8,124.6,124.5,124.3,124.1,123.8,123.6,123.3,123,122.6,122.3,121.9,121.5,121,120.6,120.1,119.6,119.1,118.6,118,117.5,116.9,116.3,115.6,115,114.3,113.6,112.9,112.2,111.5,110.8,110,109.2,108.4,107.6,106.8,106,105.2,104.3,103.5,102.6,101.8,100.9,100]},
  고척: {f:[99,null,122,null,99], src:['ok','est','ok','est','ok']},
  // 문학: no official source found, measured 95.1/119.8/95.9. Community table 95/115/120: gaps are 113, not 115.
  문학: {f:[95,113,120,113,96], src:['sat','sat','sat','sat','sat'],
    p:[95.1,95.9,96.8,97.6,98.5,99.3,100.2,101,101.9,102.7,103.5,104.3,105.1,105.9,106.7,107.4,108.2,108.9,109.6,110.3,111,111.6,112.3,112.9,113.5,114,114.6,115.1,115.6,116.1,116.5,116.9,117.3,117.7,118,118.3,118.6,118.8,119.1,119.3,119.4,119.6,119.7,119.7,119.8,119.8,119.8,119.7,119.7,119.6,119.4,119.3,119.1,118.9,118.6,118.4,118.1,117.7,117.4,117,116.6,116.1,115.7,115.2,114.7,114.2,113.6,113,112.4,111.8,111.2,110.5,109.9,109.2,108.5,107.8,107,106.3,105.5,104.8,104,103.2,102.4,101.6,100.8,100,99.2,98.4,97.6,96.7,95.9]},
  // 대구: the traced side walls are straight (0.1 m mean residual) and 90° apart, so each is taken square to its
  // foul line, joined by a flat CF wall. Distances are the official 99.5/122.5 on that shape: Bing side walls trace
  // within 0.5 m of it, the CF wall 0.4-1.4 m short; VWorld (own foul-line frame) within 1.4 m everywhere.
  // Consistent with press 좌우중간 107 m (≈108 label = model 107.7 at ±22.5°) and 좌중·우중 123.4 m (CF-wall corners: 123.85 at ±8.46°).
  대구: {f:[99.5,108,122.5,108,99.5], src:['ok','sat','ok','sat','ok'],
    p:[99.5,99.5,99.6,99.6,99.7,99.9,100,100.2,100.5,100.7,101,101.4,101.7,102.1,102.5,103,103.5,104,104.6,105.2,105.9,106.6,107.3,108.1,108.9,109.8,110.7,111.7,112.7,113.8,114.9,116.1,117.3,118.6,120,121.5,123,123.7,123.4,123.2,123,122.8,122.7,122.6,122.5,122.5,122.5,122.6,122.7,122.8,123,123.2,123.4,123.7,123,121.5,120,118.6,117.3,116.1,114.9,113.8,112.7,111.7,110.7,109.8,108.9,108.1,107.3,106.6,105.9,105.2,104.6,104,103.5,103,102.5,102.1,101.7,101.4,101,100.7,100.5,100.2,100,99.9,99.7,99.6,99.6,99.5,99.5]},
  // 사직: measured 95.6/122.3/96.6, CF wall in stand shadow (unsure); shifted to the 2022 figures 95.8/120.5
  // (≤1.8 m; the 2024 change only lowered the wall).
  사직: {f:[95.8,115,120.5,114,95.8], src:['ok','sat','ok','sat','ok'],
    p:[95.8,96.9,98,99.1,100.2,101.2,102.2,103.2,104.1,105.1,106,106.8,107.7,108.5,109.3,110.1,110.8,111.5,112.2,112.9,113.5,114.1,114.7,115.2,115.8,116.3,116.7,117.2,117.6,118,118.3,118.7,119,119.3,119.5,119.7,119.9,120.1,120.2,120.4,120.5,120.5,120.6,120.6,120.5,120.5,120.5,120.5,120.4,120.3,120.2,120.1,119.9,119.7,119.5,119.3,119,118.7,118.4,118,117.7,117.3,116.9,116.4,115.9,115.5,114.9,114.4,113.8,113.3,112.6,112,111.3,110.7,110,109.2,108.5,107.7,106.9,106.1,105.3,104.4,103.5,102.6,101.7,100.8,99.8,98.9,97.9,96.8,95.8]},
  // 창원: like 대구 — traced side walls are straight (≤0.16 m mean residual), 90.6° apart and 100.5/101.3 m from home,
  // so walls square to the foul lines at 101 m + a flat CF wall at 122 m (official). Trace within 1.2 m of it (mean 0.4)
  // except a 2 m notch at +1..+5°; CF corners 123.8 m at ±9.7° (wiki: 중앙 좌·우측 123 m).
  창원: {f:[101,109,122,109,101], src:['ok','sat','ok','sat','ok'],
    p:[101,101,101.1,101.1,101.2,101.4,101.6,101.8,102,102.3,102.6,102.9,103.3,103.7,104.1,104.6,105.1,105.6,106.2,106.8,107.5,108.2,108.9,109.7,110.6,111.4,112.4,113.4,114.4,115.5,116.6,117.8,119.1,120.4,121.8,123.3,123.5,123.2,122.9,122.7,122.5,122.3,122.2,122.1,122,122,122,122.1,122.2,122.3,122.5,122.7,122.9,123.2,123.5,123.3,121.8,120.4,119.1,117.8,116.6,115.5,114.4,113.4,112.4,111.4,110.6,109.7,108.9,108.2,107.5,106.8,106.2,105.6,105.1,104.6,104.1,103.7,103.3,102.9,102.6,102.3,102,101.8,101.6,101.4,101.2,101.1,101.1,101,101]},
  // 수원: measured 98.3/119.7/98.4; -2..+9° left out of the fit (the trace took the batter's-eye edge behind the wall).
  수원: {f:[98,114,120,114,98], src:['sat','sat','sat','sat','sat'],
    p:[98.3,99.1,100,100.8,101.7,102.5,103.3,104.1,104.8,105.6,106.3,107,107.8,108.4,109.1,109.8,110.4,111,111.6,112.2,112.8,113.3,113.8,114.3,114.8,115.2,115.7,116.1,116.5,116.9,117.2,117.5,117.8,118.1,118.4,118.6,118.8,119,119.2,119.3,119.5,119.6,119.6,119.7,119.7,119.7,119.7,119.7,119.6,119.5,119.4,119.3,119.2,119,118.8,118.6,118.3,118.1,117.8,117.5,117.1,116.8,116.4,116,115.6,115.2,114.7,114.2,113.7,113.2,112.7,112.1,111.5,110.9,110.3,109.7,109,108.4,107.7,107,106.3,105.6,104.8,104.1,103.3,102.5,101.7,100.9,100,99.2,98.4]},
  // 대전: measured 99.2/114.4/122.9/112.5/97.1; straight walls with corners at -29,-10,-7,6,9,24°, corners moved
  // (≤2.1 m, RF pole) so the walls pass through the club's 99/115/122/112/95.
  대전: {f:[99,115,122,112,95], src:['ok','ok','ok','ok','ok'],
    p:[99,99.6,100.2,100.8,101.5,102.2,102.9,103.7,104.6,105.5,106.4,107.4,108.4,109.5,110.7,111.9,113.2,113.3,113.6,113.8,114.1,114.4,114.8,115.2,115.6,116.1,116.6,117.2,117.8,118.4,119.1,119.8,120.6,121.4,122.3,123.2,123.2,123.3,123.3,123,122.8,122.5,122.3,122.2,122.1,122,122,122,122,122.1,122.2,122.3,122.1,121.9,121.7,120.7,119.7,118.8,118,117.1,116.4,115.7,115,114.3,113.8,113.2,112.7,112.2,111.8,111.4,110.1,108.9,107.8,106.7,105.6,104.7,103.7,102.8,102,101.2,100.5,99.7,99.1,98.4,97.8,97.3,96.8,96.3,95.8,95.4,95]},
  // 광주: measured 99.5/121.4/100.1 (Esri trace within 1 m, 1.9 m at the RF bullpen); CF shifted to 121 (press),
  // poles left as measured since the press gives 98 or 99.
  광주: {f:[100,116,121,115,100], src:['sat','sat','ok','sat','sat'],
    p:[99.5,100.3,101.1,101.9,102.7,103.5,104.4,105.2,106,106.9,107.7,108.5,109.2,110,110.7,111.4,112.1,112.8,113.4,114,114.6,115.2,115.7,116.2,116.7,117.1,117.6,117.9,118.3,118.7,119,119.3,119.5,119.8,120,120.2,120.4,120.5,120.7,120.8,120.9,120.9,121,121,121,121,121,120.9,120.9,120.8,120.7,120.6,120.4,120.3,120.1,119.9,119.6,119.4,119.1,118.8,118.4,118.1,117.7,117.3,116.9,116.4,115.9,115.4,114.9,114.3,113.7,113.1,112.4,111.8,111.1,110.4,109.7,109,108.2,107.5,106.8,106,105.3,104.5,103.8,103.1,102.4,101.7,101.1,100.6,100.1]},
};
export const DEFAULT_FENCE: Fence = {f:[99,null,122,null,99], src:['est','est','est','est','est']};

/** Fence distance (m) at spray angle a (deg, -45 = LF line, +45 = RF line). */
export function fenceDist(fence: Fence, a: number): number {
  const p = fence.p;
  if (p) {
    const u = Math.min(90, Math.max(0, a + 45)), i = Math.min(89, Math.floor(u));
    return p[i] + (p[i + 1] - p[i]) * (u - i);
  }
  // Unknown gap distance: midpoint of line and CF + 6 m (avg bulge of the parks with known gaps).
  const f = fence.f as number[];
  const r = fence.f.map((v, i) => v ?? ((i === 1 ? f[0] : f[4]) + f[2]) / 2 + 6);
  const u = Math.min(3.9999, Math.max(0, (a + 45) / 22.5)), i = Math.floor(u), t = u - i;
  const p0 = r[Math.max(0, i - 1)], p1 = r[i], p2 = r[i + 1], p3 = r[Math.min(4, i + 2)];
  // Catmull-Rom on radius vs angle: smooth through every known distance.
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

export const fenceFor = (stadium: string | null | undefined): Fence => (stadium && STADIUMS[stadium]) || DEFAULT_FENCE;
