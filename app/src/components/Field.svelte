<script lang="ts">
  // Park-shaped field; taps report meters from home plate. Recorded landings are drawn, the current PA's
  // with its line from home and the ball's later path.
  import type { PA } from '../lib/naver/parse';
  import type { Landings } from '../lib/landings';
  import { FH, FW, HX, HY, fencePath, toM, toPx } from '../lib/field';
  import { fenceDist, type Fence } from '../lib/stadiums';
  import { RES_COL } from '../lib/ui';
  let { pa, fence, landings, ontap }: { pa: PA; fence: Fence; landings: Landings; ontap: (pt: [number, number]) => void } = $props();
  const b = 27.43 / Math.SQRT2;
  const labels = $derived(
    [-45, -22.5, 0, 22.5, 45].map((a, i) => {
      const d = fence.f[i] ?? Math.round(fenceDist(fence, a) * 2) / 2, rad = (a * Math.PI) / 180, k = fence.src[i];
      const [x, y] = toPx((d + 5) * Math.sin(rad), (d + 5) * Math.cos(rad));
      return { x, y, t: `${k === 'sat' ? '≈' : ''}${d}${k === 'ok' || k === 'sat' ? '' : '*'}` };
    }),
  );
  const pts = (q: [number, number][]) => q.map((p) => p.join(',')).join(' ');
  function tap(e: MouseEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(), k = FW / r.width;
    const [x, y] = toM((e.clientX - r.left) * k, (e.clientY - r.top) * k);
    ontap([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<svg id="field" viewBox="0 0 {FW} {FH}" onclick={tap} role="img" aria-label="필드 · 탭해서 낙구지점 기록">
  <path d="M{HX} {HY} L{fencePath(fence)} Z" fill="rgba(34,197,94,.06)" stroke="#3a5a44" stroke-width="1.5" />
  <path d="M{HX} {HY} L{toPx(-b, b)} L{toPx(0, 2 * b)} L{toPx(b, b)} Z" fill="rgba(160,120,80,.12)" stroke="#4a5566" />
  <circle cx={toPx(0, 18.44)[0]} cy={toPx(0, 18.44)[1]} r="4" fill="#4a5566" />
  {#each labels as l}<text x={l.x} y={l.y} text-anchor="middle" font-size="9" fill="#5c6672">{l.t}</text>{/each}
  {#each Object.entries(landings) as [k, v] (k)}
    {@const [x, y] = toPx(v.x, v.y)}
    {@const cur = +k === pa.no}
    {@const col = (v.res && RES_COL[v.res]) || '#8b95a3'}
    {#if cur}
      {@const path = (v.path ?? []).map(([px, py]) => toPx(px, py))}
      <line x1={HX} y1={HY} x2={x} y2={y} stroke={col} stroke-width="1.5" stroke-dasharray="4 3" />
      {#if path.length}
        <polyline fill="none" stroke={col} stroke-width="2.5" stroke-linejoin="round" points={pts([[x, y], ...path])} />
        {#each path as [px, py], i}
          {#if i === path.length - 1}<circle cx={px} cy={py} r="6" fill="#0d1014" stroke={col} stroke-width="2.5" />
          {:else}<circle cx={px} cy={py} r="3" fill={col} />{/if}
        {/each}
      {/if}
      <circle cx={x} cy={y} r="8" fill={col} stroke="#0d1014" stroke-width="2" />
    {:else}
      <circle cx={x} cy={y} r="4.5" fill={col} opacity=".6" />
    {/if}
  {/each}
</svg>
