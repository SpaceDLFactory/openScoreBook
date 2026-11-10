<script lang="ts">
  // Every game in this browser: open one, or delete a manually scored one for good.
  import type { NaverGameMeta } from '../lib/naver/types';
  import { isManualId } from '../lib/views';
  let { games, current, onopen, ondelete, onnew, onclose }: {
    games: NaverGameMeta[]; current: string | null;
    onopen: (id: string) => void; ondelete: (id: string) => void; onnew: () => void; onclose: (() => void) | null;
  } = $props();
  const title = (g: NaverGameMeta) => `${g.awayTeamName} : ${g.homeTeamName}`;
  function del(g: NaverGameMeta) {
    if (confirm(`${g.gameDate ?? ''} ${title(g)} 경기를 지울까요?\n지운 기록은 되돌릴 수 없어요. 필요하면 먼저 기록 백업을 받아 두세요.`)) ondelete(g.gameId);
  }
</script>

<div class="h1">경기 목록</div>
<div class="sub">{games.length ? `${games.length}경기 · 누르면 그 경기를 열어요` : '경기가 없어요.'}</div>
<div class="card glist">
  {#each games as g (g.gameId)}
    <div class="grow" class:cur={g.gameId === current} data-game={g.gameId}>
      <button class="gopen" onclick={() => onopen(g.gameId)}>
        <b>{title(g)}</b>
        <span>{[g.gameDate, g.stadium, g.gameId === 'm-sample' ? '예시 경기' : ''].filter(Boolean).join(' · ')}</span>
      </button>
      {#if isManualId(g.gameId)}<button class="gdel" aria-label="{title(g)} 삭제" onclick={() => del(g)}>삭제</button>{/if}
    </div>
  {/each}
</div>
<div class="nav">{#if onclose}<button onclick={onclose}>닫기</button>{/if}<button class="next" onclick={onnew}>＋ 새 기록</button></div>
