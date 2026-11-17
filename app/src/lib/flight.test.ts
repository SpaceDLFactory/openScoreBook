import { describe, expect, it } from 'vitest';
import { estimate, flight } from './flight';

describe('trajectory model', () => {
  it('matches the calibration script (tools/hang_time/model.py) trajectory for trajectory', () => {
    // reference values printed by model.py with the same constants
    for (const [ev, la, d, t] of [[100, 30, 112.91, 5.393], [95, 20, 95.21, 3.686], [85, 40, 89.16, 5.456], [105, 15, 88.21, 2.844]]) {
      const f = flight(ev, la)!;
      expect(f.d).toBeCloseTo(d, 1);
      expect(f.t).toBeCloseTo(t, 2);
    }
  });

  it('comes down to a catch earlier and shorter than to the ground', () => {
    const g = flight(100, 30)!, c = flight(100, 30, 1.8)!;
    expect(c.t).toBeLessThan(g.t);
    expect(c.d).toBeLessThan(g.d);
  });
});

describe('estimate from distance and hang time', () => {
  it('gives back the exit velocity and launch angle a ball was hit with', () => {
    for (const [ev, la] of [[100, 30], [92, 18], [80, 45]]) {
      const c = flight(ev, la, 1.8)!;
      const e = estimate(c.d, c.t, true, 0)!;
      expect(e.la).toBeCloseTo(la, -0.5); // within a degree or so
      expect(Math.abs(e.evKmh / 1.609344 - ev)).toBeLessThan(4);
      expect(e.laSd).toBeLessThan(4);
    }
  });

  it('adds the timer\'s delay back: a short reading means a lower, harder ball unless corrected', () => {
    const c = flight(95, 25, 1.8)!;
    const raw = estimate(c.d, c.t - 0.22, true, 0)!, fixed = estimate(c.d, c.t - 0.22, true, 0.22)!;
    expect(raw.la).toBeLessThan(fixed.la);
    expect(Math.abs(fixed.la - 25)).toBeLessThan(1.5);
  });

  it('declines what no ball could do', () => {
    expect(estimate(110, 0.8, false, 0)).toBeNull(); // 110 m in under a second
    expect(estimate(20, 7, false, 0)).toBeNull(); // 7 s in the air to land 20 m away
  });
});
