// Field drawing in meters: home plate at origin, +y toward CF, foul lines at ±45°.
import { fenceDist, type Fence } from './stadiums';

export const FW = 366, FH = 330, SCALE = 2.1, HX = FW / 2, HY = FH - 14;

/** Pixels per meter. Pro-size parks share one scale; anything else fills the same part of the drawing. */
export function fieldScale(fence: Fence): number {
  let x = 0, y = 0;
  for (let a = -45; a <= 45; a++) {
    const d = fenceDist(fence, a), rad = (a * Math.PI) / 180;
    x = Math.max(x, d * Math.abs(Math.sin(rad)));
    y = Math.max(y, d * Math.cos(rad));
  }
  const fit = 0.83 * Math.min(HX / x, HY / y);
  return Math.abs(fit - SCALE) < 0.15 ? SCALE : fit;
}

/** Meters <-> pixels for this park, and the SVG path points of its fence from LF pole to RF pole. */
export function fieldOf(fence: Fence) {
  const s = fieldScale(fence);
  const toPx = (x: number, y: number): [number, number] => [HX + x * s, HY - y * s];
  const toM = (px: number, py: number): [number, number] => [(px - HX) / s, (HY - py) / s];
  const path = Array.from({ length: 91 }, (_, k) => k - 45)
    .map((a) => {
      const d = fenceDist(fence, a), rad = (a * Math.PI) / 180;
      return toPx(d * Math.sin(rad), d * Math.cos(rad)).join(' ');
    })
    .join(' L');
  return { toPx, toM, path };
}
