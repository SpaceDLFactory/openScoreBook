<script lang="ts">
  // One pitcher's game: pitch mix with average and top velocity, every pitch location colored by type, and a
  // scout's pitch sheet: one row per batter faced, one cell per pitch (type, speed, location, call), then the result.
  import type { Game, Pitch } from '../lib/naver/parse';
  import type { Landings } from '../lib/landings';
  import { notation } from '../lib/notation';
  import { TYPE_COL, callColor } from '../lib/ui';
  let { game, landings, onpick }: { game: Game; landings: Landings; onpick: (i: number) => void } = $props();
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
        avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '-', max: v.length ? Math.max(...v) : '-' };
    });
  });
  const colOf = $derived(Object.fromEntries(types.map((t) => [t.t, t.col])));
  const strikes = $derived(ps.filter((p) => p.call !== 'B').length);
  const team = $derived(game.lineups.away.pitcher.some((p) => p.pcode === sel) ? game.awayName : game.homeName);
  const W = 220, H = 230, sx = (x: number) => W / 2 + x * 48, sz = (z: number) => H - 14 - z * 40;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // ---- pitch sheet
  const CODE: Record<string, string> = { 직구: '직', 투심: '투', 싱커: '싱', 커터: '컷', 슬라이더: '슬', 스위퍼: '스', 커브: '커', 체인지업: '체', 포크: '포', 너클볼: '너' };
  const code = (s: string | undefined) => (s && s !== '기타' ? (CODE[s] ?? s[0]) : '·');
  const LETTER: Record<string, string> = { B: 'B', T: 'C', S: 'S', F: 'F', W: 'L', H: 'X' }; // W: Naver's foul bunt
  const DIRS = ['좌', '좌중', '중', '우중', '우'];
  /** spray direction of a landing, meters from home (x < 0: left field) */
  const dir = (x: number, y: number) => { const a = (Math.atan2(x, y) * 180) / Math.PI; return Math.abs(a) > 45 ? '파울' : DIRS[Math.min(4, Math.floor((a + 45) / 18))]; };
  const rows = $derived(game.pas.flatMap((pa, i) => {
    const own = pa.pitches.filter((q) => q.pitcher === sel);
    if (!own.length && pa.pitcher !== sel) return [];
    const cells: (Pitch | undefined)[] = [];
    for (const q of own) cells[q.n - 1] = q;
    const l = landings[pa.no];
    return [{ pa, i, cells, note: pa.pitcher === sel ? notation(pa) : null, hit: l ? [l.traj, dir(l.x, l.y)].filter(Boolean).join(' · ') : '' }];
  }));
  const cols = $derived(Math.max(1, ...rows.map((r) => r.cells.length)));
  const side = (pcode: string) => (game.hands[pcode] ?? '').slice(2, 3);
  // mini strike zone per pitch: x -1.5..1.5 ft, z 0.8..4.2 ft
  const gx = (x: number) => clamp(1 + ((x + 1.5) / 3) * 12, 1.5, 12.5), gz = (z: number) => clamp(15 - ((z - 0.8) / 3.4) * 14, 1.5, 14.5);
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
    <div class="sect"><span>구종 구사 · 평균 / 최고 구속</span><span>{mine.length}타자 상대</span></div>
    <div class="card mix">
      {#each types as t (t.t)}
        <div class="row"><span class="nm"><span class="dot" style="background:{t.col}"></span>{t.t}</span><div class="bar"><div style="width:{t.pct}%;background:{t.col}"></div></div><span class="pct">{t.pct}%</span><span class="v">{t.avg}㎞</span><span class="v mx">{t.max}</span></div>
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

<div class="sect"><span>투구 기록지</span><span>{rows.length}타석 · {ps.length}구</span></div>
<div class="card sheet scout"><table>
  <tbody>
  <tr><th class="nmh">회 · 타자</th>{#each { length: cols } as _, k}<th>{k + 1}</th>{/each}<th class="res">결과</th></tr>
  {#each rows as r, j (r.i)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <tr data-pa={r.i} class:newinn={j > 0 && rows[j - 1].pa.inn !== r.pa.inn} onclick={() => onpick(r.i)}>
      <td class="nm"><b class:ditto={j > 0 && rows[j - 1].pa.inn === r.pa.inn}>{r.pa.inn}회</b>{game.names[r.pa.batter]}<span class="pos">{side(r.pa.batter)}</span></td>
      {#each { length: cols } as _, k}
        {@const q = r.cells[k]}
        <td class="pc">{#if q}<div class="pw">
          <span class="ty" style="color:{colOf[q.stuff || '기타']}">{code(q.stuff)}</span><span class="cl" style="color:{callColor(q.call)}">{LETTER[q.call] ?? q.call}</span>
          <span class="sp">{q.speed ?? ''}</span>
          {#if q.xz}<svg class="gz" width="14" height="16" viewBox="0 0 14 16"><rect x={gx(-0.708)} y={gz(3.4)} width={gx(0.708) - gx(-0.708)} height={gz(1.6) - gz(3.4)} fill="none" stroke="#4a5566" /><circle cx={gx(q.xz[0])} cy={gz(q.xz[1])} r="1.8" fill={callColor(q.call)} /></svg>{/if}
        </div>{/if}</td>
      {/each}
      <td class="res">{#if r.note}<span class="nt {r.note.k}">{r.note.c}</span>{:else if r.pa.result}<span class="hitd">교체</span>{/if}{#if r.hit}<span class="hitd">{r.hit}</span>{/if}</td>
    </tr>
  {/each}
  </tbody>
</table></div>
<div class="sheetleg">
  {#each types as t (t.t)}<span style="color:{t.col}">{code(t.t)} {t.t}</span>{/each}
  <span>· <b style="color:var(--ball)">B</b> 볼 <b style="color:var(--strike)">C</b> 루킹 <b style="color:var(--strike)">S</b> 헛스윙 <b style="color:var(--foul)">F</b> 파울 <b style="color:var(--foul)">L</b> 번트파울 <b style="color:var(--inplay)">X</b> 타격 · 행을 누르면 그 타석으로 이동</span>
</div>
