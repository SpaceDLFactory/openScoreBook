<script lang="ts">
  import type { NaverGameMeta } from '../lib/naver/types';
  let { games, current, onchange }: { games: NaverGameMeta[]; current: string; onchange: (id: string) => void } = $props();
  const label = (g: NaverGameMeta) =>
    `${(g.gameDate ?? '').slice(5).replace('-', '/')} ${g.awayTeamName} ${g.awayTeamScore ?? ''}:${g.homeTeamScore ?? ''} ${g.homeTeamName} · ${g.stadium ?? ''}`;
</script>

{#if games.length > 1}
  <select id="gamesel" class="gamesel" aria-label="경기 선택" value={current} onchange={(e) => { const id = e.currentTarget.value; e.currentTarget.value = current; onchange(id); }}>
    {#each games as g (g.gameId)}<option value={g.gameId}>{label(g)}</option>{/each}
  </select>
{/if}
