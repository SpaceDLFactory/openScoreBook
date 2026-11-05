<script lang="ts">
  // Pitch locations for one PA, catcher's view; numbered in pitch order.
  import type { PA } from '../lib/naver/parse';
  import { callColor } from '../lib/ui';
  let { pa }: { pa: PA } = $props();
  const W = 164, H = 196, sx = (x: number) => W / 2 + x * 40, sz = (z: number) => H - 12 - z * 36;
  const zone = $derived(pa.pitches.find((p) => p.sz)?.sz ?? [1.6, 3.4]);
  const zx0 = sx(-0.708), zx1 = sx(0.708);
  const zy0 = $derived(sz(zone[1])), zy1 = $derived(sz(zone[0]));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
</script>

<svg width={W} height={H} viewBox="0 0 {W} {H}">
  <rect x="1" y="1" width={W - 2} height={H - 2} rx="8" fill="rgba(255,255,255,.012)" stroke="#1e2630" />
  <rect x={zx0} y={zy0} width={zx1 - zx0} height={zy1 - zy0} fill="rgba(245,158,11,.05)" stroke="#4a5566" stroke-width="1.5" />
  {#each [1 / 3, 2 / 3] as f}
    <line x1={zx0 + (zx1 - zx0) * f} y1={zy0} x2={zx0 + (zx1 - zx0) * f} y2={zy1} stroke="#2b333f" />
    <line x1={zx0} y1={zy0 + (zy1 - zy0) * f} x2={zx1} y2={zy0 + (zy1 - zy0) * f} stroke="#2b333f" />
  {/each}
  <path d="M{sx(-0.708)} {H - 8} L{sx(0.708)} {H - 8}" stroke="#4a5566" stroke-width="2" />
  {#each pa.pitches as p}
    {#if p.xz}
      {@const cx = clamp(sx(p.xz[0]), 10, W - 10)}
      {@const cy = clamp(sz(p.xz[1]), 10, H - 10)}
      {#if p.call === 'H'}
        <circle {cx} {cy} r="11" fill="none" stroke={callColor(p.call)} stroke-width="2.5" stroke-dasharray="3 3" />
        <text x={cx} y={cy + 4} text-anchor="middle" font-size="11" font-weight="800" fill="#7ee2a4">{p.n}</text>
      {:else}
        <circle {cx} {cy} r="10" fill={callColor(p.call)} opacity=".95" />
        <text x={cx} y={cy + 4} text-anchor="middle" font-size="11" font-weight="800" fill="#0d1014">{p.n}</text>
      {/if}
    {/if}
  {/each}
</svg>
