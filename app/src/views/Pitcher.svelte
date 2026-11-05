<script lang="ts">
  // One pitcher's game: pitch mix with average velocity, and every pitch location colored by type.
  import type { Game } from '../lib/naver/parse';
  import { TYPE_COL } from '../lib/ui';
  let { game }: { game: Game } = $props();
  const order = $derived([...new Set(game.pas.flatMap((p) => p.pitches.map((q) => q.pitcher)))]);
  let picked = $state<string | null>(null);
  const sel = $derived(picked && order.includes(picked) ? picked : order[0]);
  const mine = $derived(game.pas.filter((p) => p.pitches.some((q) => q.pitcher === sel)));
  const ps = $derived(mine.flatMap((p) => p.pitches).filter((q) => q.pitcher === sel));
  const rec = $derived([...game.lineups.away.pitcher, ...game.lineups.home.pitcher].find((p) => p.pcode === sel));
  const types = $derived.by(() => {
    const groups: Record<string, typeof ps> = {};
    for (const p of ps) (groups[p.stuff || '기타'] ??= []).push(p);
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([t, arr], i) => {
      const v = arr.filter((p) => p.speed).map((p) => +p.speed!);
      return { t, n: arr.length, col: TYPE_COL[i % TYPE_COL.length], pct: Math.round((arr.length / ps.length) * 100),
        avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '-' };
    });
  });
  const colOf = $derived(Object.fromEntries(types.map((t) => [t.t, t.col])));
  const strikes = $derived(ps.filter((p) => p.call !== 'B').length);
  const team = $derived(game.lineups.away.pitcher.some((p) => p.pcode === sel) ? game.awayName : game.homeName);
  const W = 220, H = 230, sx = (x: number) => W / 2 + x * 48, sz = (z: number) => H - 14 - z * 40;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
</script>

<div class="h1">투수 분석</div>
<div class="sub">{team} · {(game.hands[sel] ?? '').slice(0, 2)} · 이 경기</div>
<div class="pchips">{#each order as c (c)}<button data-p={c} class:on={c === sel} onclick={() => (picked = c)}>{game.names[c]}</button>{/each}</div>
<div class="kpis">
  <div class="card kpi"><b>{rec?.inn ?? '-'}</b><span>이닝</span></div><div class="card kpi"><b>{ps.length}</b><span>투구</span></div>
  <div class="card kpi"><b>{rec?.kk ?? '-'}</b><span>삼진</span></div><div class="card kpi"><b>{ps.length ? Math.round((strikes / ps.length) * 100) : 0}%</b><span>스트라이크</span></div>
</div>
<div class="cols2">
  <div>
    <div class="sect"><span>구종 구사 · 평균 구속</span><span>{mine.length}타자 상대</span></div>
    <div class="card mix">
      {#each types as t (t.t)}
        <div class="row"><span class="nm"><span class="dot" style="background:{t.col}"></span>{t.t}</span><div class="bar"><div style="width:{t.pct}%;background:{t.col}"></div></div><span class="pct">{t.pct}%</span><span class="v">{t.avg}㎞</span></div>
      {/each}
    </div>
  </div>
  <div>
    <div class="sect"><span>투구 위치 · 포수 시점</span><span>{ps.length}구</span></div>
    <div class="card zc">
      <svg width={W} height={H} viewBox="0 0 {W} {H}">
        <rect x={sx(-0.708)} y={sz(3.4)} width={sx(0.708) - sx(-0.708)} height={sz(1.6) - sz(3.4)} fill="rgba(245,158,11,.05)" stroke="#4a5566" stroke-width="1.5" />
        {#each ps as p}{#if p.xz}<circle cx={clamp(sx(p.xz[0]), 6, W - 6)} cy={clamp(sz(p.xz[1]), 6, H - 6)} r="5" fill={colOf[p.stuff || '기타']} opacity=".8" />{/if}{/each}
        <line x1={sx(-0.708)} y1={H - 6} x2={sx(0.708)} y2={H - 6} stroke="#4a5566" stroke-width="2" />
      </svg>
    </div>
  </div>
</div>
