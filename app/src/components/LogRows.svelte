<script lang="ts">
  // Plate appearances grouped by half inning; compact = the PC chart sidebar (current PA highlighted).
  import type { Game } from '../lib/naver/parse';
  import { stripName } from '../lib/notation';
  import { callColor, halfName, slotOf } from '../lib/ui';
  let { game, compact = false, cur = -1, onpick }: { game: Game; compact?: boolean; cur?: number; onpick: (i: number) => void } = $props();
</script>

{#each game.pas as pa, i (pa.no)}
  {@const hn = halfName(pa)}
  {@const nxt = game.pas[i + 1]}
  {#if i === 0 || halfName(game.pas[i - 1]) !== hn}
    <div class="half">{hn} · {pa.top ? game.awayName : game.homeName} 공격</div>
  {/if}
  {@const chg = pa.after.awayScore !== pa.before.awayScore || pa.after.homeScore !== pa.before.homeScore}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="pa" class:last={!nxt || halfName(nxt) !== hn} class:cur={compact && i === cur} data-pa={i} onclick={() => onpick(i)}>
    <div class="who">{game.names[pa.batter] ?? ''}<small>{slotOf(pa)}번 · {pa.pitches.length}구</small></div>
    <div class="what">
      {stripName(pa.result ?? pa.events[pa.events.length - 1] ?? '')}
      {#if !compact && pa.events.length}
        <div style="color:var(--dim);font-size:11px;margin-top:3px">{pa.events.map(stripName).join(' · ')}</div>
      {/if}
      <div class="seq">{#each pa.pitches as p}<i style="background:{callColor(p.call)}">{p.call}</i>{/each}</div>
    </div>
    <div class="sc" class:chg>{pa.after.awayScore}:{pa.after.homeScore}</div>
  </div>
{/each}
