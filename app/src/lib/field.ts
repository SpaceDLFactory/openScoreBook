// Field drawing in meters: home plate at origin, +y toward CF, foul lines at ±45°.
import { fenceDist, type Fence } from './stadiums';

export const FW = 366, FH = 330, SCALE = 2.1, HX = FW / 2, HY = FH - 14;
export const toPx = (x: number, y: number): [number, number] => [HX + x * SCALE, HY - y * SCALE];
export const toM = (px: number, py: number): [number, number] => [(px - HX) / SCALE, (HY - py) / SCALE];

/** SVG path points for the fence, LF pole to RF pole. */
export function fencePath(fence: Fence): string {
  return Array.from({ length: 91 }, (_, k) => k - 45)
    .map((a) => {
      const d = fenceDist(fence, a), rad = (a * Math.PI) / 180;
      return toPx(d * Math.sin(rad), d * Math.cos(rad)).join(' ');
    })
    .join(' L');
}
