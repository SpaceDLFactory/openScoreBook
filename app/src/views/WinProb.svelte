<script lang="ts">
  // Naver's win-probability line over the game and the five biggest swings.
  import type { Game, PA } from '../lib/naver/parse';
  import { halfName } from '../lib/ui';
  let { game, onpick }: { game: Game; onpick: (i: number) => void } = $props();
  const fin = $derived(game.pas[game.pas.length - 1].after);
  type Pt = { i: number; wr: number; pa: PA | null; idx?: number; d?: number };
  const pts = $derived.by(() => {
    const out: Pt[] = [{ i: 0, wr: 50, pa: null }];
    game.pas.forEach((pa, i) => {
      const m = pa.wp;
      if (m && (m.homeTeamWinRate || m.awayTeamWinRate)) out.push({ i: i + 1, wr: m.homeTeamWinRate ?? 0, pa, idx: i });
    });
    for (let k = 1; k < out.length; k++) out[k].d = out[k].wr - out[k - 1].wr;
    return out;
  });
  const W = 350, H = 180;
  const X = (i: number) => 10 + (i / game.pas.length) * (W - 20), Y = (w: number) => 10 + ((100 - w) / 100) * (H - 20);
  const innStarts = $derived(game.pas.map((pa, i) => ({ pa, i })).filter(({ pa, i }) => pa.top && (i === 0 || game.pas[i - 1].inn !== pa.inn)));
  const swings = $derived(pts.filter((p) => p.pa).sort((a, b) => Math.abs(b.d!) - Math.abs(a.d!)).slice(0, 5));
  const finalWr = $derived(pts[pts.length - 1].wr);
</script>

<div class="h1">승부 확률</div>
<div class="sub">{game.awayName} {fin.awayScore} : {fin.homeScore} {game.homeName} · {game.homeName} 승리확률 기준 · 네이버 제공값</div>
<div class="card wpc">
  <svg width="100%" viewBox="0 0 {W} {H}">
    <line x1="10" x2={W - 10} y1={Y(50)} y2={Y(50)} stroke="#2b333f" stroke-dasharray="3 3" />
    {#each innStarts as { pa, i }}
      <line x1={X(i)} x2={X(i)} y1="10" y2={H - 10} stroke="#1e2630" /><text x={X(i) + 3} y={H - 2} font-size="9" fill="#5c6672">{pa.inn}</text>
    {/each}
    <polyline fill="none" stroke="var(--inplay)" stroke-width="2" points={pts.map((p) => `${X(p.i)},${Y(p.wr)}`).join(' ')} />
    {#each swings as p}<circle cx={X(p.i)} cy={Y(p.wr)} r="4" fill="var(--inplay)" stroke="#0d1014" stroke-width="2" />{/each}
    <text x="12" y="20" font-size="9" fill="#5c6672">{game.homeName} 100%</text><text x="12" y={H - 14} font-size="9" fill="#5c6672">{game.awayName} 100%</text>
  </svg>
</div>
<div class="sect"><span>결정적 장면 · 승리확률 변동</span><span>최종 {game.homeName} {Math.round(finalWr)}%</span></div>
<div class="swings">
  {#each swings as p, k}
    {@const pa = p.pa!}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="swing" data-pa={p.idx} onclick={() => onpick(p.idx!)}>
      <span class="rk">{k + 1}</span>
      <div class="tx">{(pa.result || pa.events.join(' · ')).replace(/^[^:]+ : /, `${game.names[pa.batter]} `)}<small>{halfName(pa)} · {pa.top ? game.awayName : game.homeName} 공격 · {pa.after.awayScore}:{pa.after.homeScore}</small></div>
      <span class="d" style="color:{p.d! > 0 ? 'var(--inplay)' : 'var(--out)'}">{p.d! > 0 ? '+' : ''}{p.d!.toFixed(1)}%p</span>
    </div>
  {/each}
</div>
