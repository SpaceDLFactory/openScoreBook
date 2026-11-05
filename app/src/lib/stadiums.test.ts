import { describe, expect, it } from 'vitest';
import { STADIUMS, fenceDist } from './stadiums';

describe('stadium fences', () => {
  for (const [park, fence] of Object.entries(STADIUMS)) {
    it(`${park}: labels match the profile the app measures taps against`, () => {
      [-45, -22.5, 0, 22.5, 45].forEach((a, i) => {
        const label = fence.f[i], d = fenceDist(fence, a);
        if (label == null) return;
        if (fence.src[i] === 'sat') expect(Math.round(d)).toBe(label);
        else if (fence.p) expect(Math.abs(d - label)).toBeLessThanOrEqual(0.15);
      });
      if (fence.p) {
        expect(fence.p).toHaveLength(91);
        for (const v of fence.p) expect(v).toBeGreaterThan(85), expect(v).toBeLessThan(135);
      }
    });
  }
});
