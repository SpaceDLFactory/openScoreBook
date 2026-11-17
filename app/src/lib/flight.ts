// Launch angle and exit velocity estimated from what a scorer can see: how far the ball went and how long it was in
// the air. A drag + backspin trajectory model calibrated on public Statcast data (tools/hang_time: 3,295 MLB air
// balls, 2025-06-01..10, distance within 4.8 m on average) is run over a grid of exit velocities and launch angles,
// and the (distance, hang time) recorded is matched against it. Checked by hand on 29 broadcast clips: launch angle
// within 2-3 degrees, exit velocity within about 4 mph once the timer's reaction delay is added back. Only for balls
// in the air that carry to the outfield; MLB ball and sea-level air.

const MPH = 0.44704, KMH_PER_MPH = 1.609344;
const M = 0.145, R = 0.0366, A = Math.PI * R * R, G = 9.81, RHO = 1.2;
/** calibrated in tools/hang_time (model.py on all ten days) */
const CD = 0.4504, SPIN0 = -1549.2, SPIN_PER_DEG = 137.95;
const Z0 = 0.9, CATCH_Z = 1.8, DT = 0.01;

/** Seconds a scorer's stopwatch runs short, mostly reacting late to contact (0.22 s measured in tools/hang_time). */
export const HANG_DELAY_DEFAULT = 0.22;
const DELAY_KEY = 'scorebook:hangDelay';
export function hangDelay(): number {
  try { const v = Number(localStorage.getItem(DELAY_KEY)); return localStorage.getItem(DELAY_KEY) != null && v >= 0 && v <= 1 ? v : HANG_DELAY_DEFAULT; } catch { return HANG_DELAY_DEFAULT; }
}
export function setHangDelay(v: number) { try { localStorage.setItem(DELAY_KEY, String(v)); } catch { /* private mode */ } }

/** Where (m) and when (s) the ball comes down through height zEnd: the ground (0) or a catch (1.8 m). */
export function flight(evMph: number, laDeg: number, zEnd = 0): { d: number; t: number } | null {
  const la = (laDeg * Math.PI) / 180, v = evMph * MPH;
  const omega = (Math.min(4500, Math.max(300, SPIN0 + SPIN_PER_DEG * laDeg)) * 2 * Math.PI) / 60;
  const k = (0.5 * RHO * A) / M;
  const acc = (vx: number, vz: number): [number, number] => {
    const sp = Math.hypot(vx, vz), S = (R * omega) / Math.max(sp, 1e-6), cl = S / (0.4 + 2.32 * S);
    return [-k * CD * sp * vx - k * cl * sp * vz, -G - k * CD * sp * vz + k * cl * sp * vx];
  };
  let x = 0, z = Z0, vx = v * Math.cos(la), vz = v * Math.sin(la), t = 0;
  for (let i = 0; i < 1500; i++) {
    const [ax1, az1] = acc(vx, vz);
    const [ax2, az2] = acc(vx + (ax1 * DT) / 2, vz + (az1 * DT) / 2);
    const [ax3, az3] = acc(vx + (ax2 * DT) / 2, vz + (az2 * DT) / 2);
    const [ax4, az4] = acc(vx + ax3 * DT, vz + az3 * DT);
    const nx = x + DT * (vx + (DT / 6) * (ax1 + ax2 + ax3)), nz = z + DT * (vz + (DT / 6) * (az1 + az2 + az3));
    const nvx = vx + (DT / 6) * (ax1 + 2 * ax2 + 2 * ax3 + ax4), nvz = vz + (DT / 6) * (az1 + 2 * az2 + 2 * az3 + az4);
    if (nz <= zEnd && z > zEnd && t > 0.05 && (zEnd === 0 || nvz < 0)) {
      const f = (z - zEnd) / (z - nz);
      return { d: x + f * (nx - x), t: t + f * DT };
    }
    x = nx; z = nz; vx = nvx; vz = nvz; t += DT;
  }
  return null;
}

interface Cell { ev: number; la: number; d0: number; t0: number; dc: number; tc: number }
let grid: Cell[] | null = null;
/** exit velocity 55-121 mph by 2 and launch angle 6-61 degrees by 1, built on first use. Coarse is enough: the
 *  estimate is a weighted average over many neighbouring cells (the errors allowed are 5 m and 0.25 s). */
function cells(): Cell[] {
  if (grid) return grid;
  grid = [];
  for (let ev = 55; ev <= 121; ev += 2) for (let la = 6; la <= 61; la++) {
    const g = flight(ev, la, 0), c = flight(ev, la, CATCH_Z);
    if (g && c) grid.push({ ev, la, d0: g.d, t0: g.t, dc: c.d, tc: c.t });
  }
  return grid;
}

export interface Estimate { evKmh: number; evSd: number; la: number; laSd: number }

/** distance: meters from home to where it landed or was caught; hang: seconds as timed (the delay is added back here).
 *  Null when no ball in the model's range could do that. */
export function estimate(distance: number, hang: number, caught: boolean, delay = hangDelay()): Estimate | null {
  const t = hang + delay, SD_D = 5, SD_T = 0.25;
  const g = cells(), cost = g.map((c) => ((caught ? c.dc : c.d0) - distance) ** 2 / SD_D ** 2 + ((caught ? c.tc : c.t0) - t) ** 2 / SD_T ** 2);
  const best = Math.min(...cost);
  if (best > 9) return null; // nothing within three standard errors
  let w = 0, ev = 0, la = 0, ev2 = 0, la2 = 0;
  g.forEach((c, i) => { const x = Math.exp(-0.5 * (cost[i] - best)); w += x; ev += x * c.ev; la += x * c.la; ev2 += x * c.ev * c.ev; la2 += x * c.la * c.la; });
  ev /= w; la /= w;
  return { evKmh: ev * KMH_PER_MPH, evSd: Math.sqrt(Math.max(0, ev2 / w - ev * ev)) * KMH_PER_MPH, la, laSd: Math.sqrt(Math.max(0, la2 / w - la * la)) };
}
