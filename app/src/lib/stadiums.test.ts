import { describe, expect, it } from 'vitest';
import { DEFAULT_FENCE, STADIUMS, customFence, fenceDist, fenceOk, savedParks } from './stadiums';
import { FH, FW, HX, HY, SCALE, fieldOf, fieldScale } from './field';

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

describe('custom parks', () => {
  const small = customFence([70, null, 90, null, 72]);

  it('goes through every distance it was given', () => {
    expect(fenceDist(small, -45)).toBeCloseTo(70);
    expect(fenceDist(small, 0)).toBeCloseTo(90);
    expect(fenceDist(small, 45)).toBeCloseTo(72);
    const full = customFence([70, 80, 90, 81, 72]);
    expect(fenceDist(full, -22.5)).toBeCloseTo(80);
    expect(fenceDist(full, 22.5)).toBeCloseTo(81);
  });
  it('marks only the empty gaps as estimated', () => {
    expect(small.src).toEqual(['ok', 'est', 'ok', 'est', 'ok']);
  });
  it('bulges an empty gap in proportion, leaving the 99/122 default as it was', () => {
    expect(fenceDist(DEFAULT_FENCE, -22.5)).toBeCloseTo(116.5);
    expect(fenceDist(small, -22.5)).toBeCloseTo(80 * (116.5 / 110.5));
  });
  it('needs the lines and CF, in 30-200 m; the gaps are optional', () => {
    expect(fenceOk([70, null, 90, null, 72])).toBe(true);
    expect(fenceOk([70, 80, 90, 80, 72])).toBe(true);
    expect(fenceOk([70, null, null, null, 72])).toBe(false);
    expect(fenceOk([29, null, 90, null, 72])).toBe(false);
    expect(fenceOk([70, 201, 90, null, 72])).toBe(false);
  });
  it('lists each name once, the newest version', () => {
    expect(savedParks([
      { stadium: '한강', fence: [70, null, 92, null, 70] },
      { stadium: '대구' },
      { stadium: '한강', fence: [60, null, 80, null, 60] },
      { stadium: '남양주', fence: [80, null, 100, null, 80] },
    ])).toEqual([{ name: '한강', fence: [70, null, 92, null, 70] }, { name: '남양주', fence: [80, null, 100, null, 80] }]);
  });
});

describe('field scale', () => {
  it('keeps every KBO park on the one scale', () => {
    for (const fence of [...Object.values(STADIUMS), DEFAULT_FENCE]) expect(fieldScale(fence)).toBe(SCALE);
  });
  it('fills the drawing with a small park and keeps a huge one in view', () => {
    for (const f of [[60, null, 75, null, 60], [70, null, 90, null, 72], [125, null, 170, null, 125], [200, null, 200, null, 200]]) {
      const fence = customFence(f);
      const { toPx, toM } = fieldOf(fence);
      const [cx, cy] = toPx(0, fenceDist(fence, 0));
      expect(cx).toBe(HX);
      expect(HY - cy).toBeGreaterThan(200); // same height as a pro park's center field
      expect(cy).toBeGreaterThan(0);
      for (const a of [-45, 45]) {
        const rad = (a * Math.PI) / 180, d = fenceDist(fence, a);
        const [x, y] = toPx(d * Math.sin(rad), d * Math.cos(rad));
        expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(FW); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(FH);
      }
      const [mx, my] = toM(...toPx(12.5, 61.25));
      expect(mx).toBeCloseTo(12.5); expect(my).toBeCloseTo(61.25);
    }
  });
});

describe('parks of other leagues', () => {
  it('lists each league\'s parks under one name each', async () => {
    const { PARKS, LISTED, LEAGUES } = await import('./stadiums');
    const count = Object.fromEntries(LEAGUES.map(([lg]) => [lg, PARKS.filter((p) => p.league === lg).length]));
    expect(count).toEqual({ KBO: 9, NPB: 12, MLB: 30, AAA: 29, AA: 30, 'A+': 29, A: 29 });
    expect(new Set(PARKS.map((p) => p.name)).size).toBe(PARKS.length);
    expect(Object.keys(LISTED)).toHaveLength(PARKS.length);
  });

  it('has plausible walls everywhere: lines and center known, center deepest or near it', async () => {
    const { PARKS } = await import('./stadiums');
    for (const p of PARKS) {
      const [lf, , cf, , rf] = p.fence.f as number[];
      for (const v of [lf, cf, rf]) expect(v, p.name).toBeGreaterThan(75);
      expect(cf, p.name).toBeGreaterThanOrEqual(Math.max(lf, rf));
      expect(fenceDist(p.fence, 0), p.name).toBeCloseTo(cf, 0);
    }
  });

  it('draws the MLB parks with a fitted outline on it, meeting their labels', async () => {
    const { PARKS } = await import('./stadiums');
    const traced = PARKS.filter((p) => p.fence.p && p.league !== 'KBO'); // KBO outlines come from aerial imagery
    expect(traced.filter((p) => p.league !== 'MLB')).toEqual([]);
    expect(traced.length).toBe(17); // 16 traced outlines that still fit, and Angel Stadium measured on NAIP imagery
    for (const p of traced) {
      expect(p.fence.p, p.name).toHaveLength(91);
      for (const [i, a] of [[0, -45], [2, 0], [4, 45]] as const) expect(fenceDist(p.fence, a), p.name).toBeCloseTo(p.fence.f[i]!, 0);
      // a wall, not noise: no jump of more than 4 m between neighbouring degrees
      expect(Math.max(...p.fence.p!.slice(1).map((v, i) => Math.abs(v - p.fence.p![i]))), p.name).toBeLessThan(4);
    }
  });

  it('finds a listed park by name', async () => {
    const { fenceFor } = await import('./stadiums');
    expect(fenceFor('Fenway Park').f[0]).toBeCloseTo(94.5, 0); // the Green Monster line, 310 ft
    expect(fenceFor('도쿄돔').f).toEqual([100, 110, 122, 110, 100]);
    expect(fenceFor('없는 구장')).toBe(fenceFor(null));
  });
});
