// Scout sheet: the 9-way location number of a pitch.
import type { Pitch } from './naver/parse';

const HALF = 0.708; // half the plate, ft
const BALL = 0.121, ABS_SIDE = 0.066; // ball radius; KBO's ABS widens the zone 2 cm each side

/** Location number, catcher's view: 1-9 in the zone (1 2 3 top row, left to right), outside 11 12 / 13 14 by the
 *  zone's center lines. In the zone as ABS calls it: any part of the ball over the plate (+2 cm) and within sz
 *  ([bottom, top] in ft); the thirds are the plate's, edge balls go to the edge cells. null without tracking. */
export function zoneOf(p: Pick<Pitch, 'xz' | 'sz'>): number | null {
  if (!p.xz) return null;
  const [x, z] = p.xz, [bot, top] = p.sz ?? [1.6, 3.4];
  if (Math.abs(x) <= HALF + ABS_SIDE + BALL && z >= bot - BALL && z <= top + BALL) {
    const third = (v: number) => Math.max(0, Math.min(2, Math.floor(v * 3)));
    const col = third((x + HALF) / (2 * HALF)), row = third((top - z) / (top - bot));
    return 1 + row * 3 + col;
  }
  return (z > (bot + top) / 2 ? 11 : 13) + (x < 0 ? 0 : 1);
}
