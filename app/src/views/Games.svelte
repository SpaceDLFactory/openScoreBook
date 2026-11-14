<script lang="ts">
  // Every game in this browser: open one, delete a manually scored one for good, or pick two to compare.
  import type { NaverGameMeta } from '../lib/naver/types';
  import { isManualId } from '../lib/views';
  let { games, current, onopen, ondelete, oncompare, onnew, onclose }: {
    games: NaverGameMeta[]; current: string | null;
    onopen: (id: string) => void; ondelete: (id: string) => void; oncompare: (a: string, b: string) => void; onnew: () => void; onclose: (() => void) | null;
  } = $props();
  const title = (g: NaverGameMeta) => `${g.awayTeamName} : ${g.homeTeamName}`;
  function del(g: NaverGameMeta) {
    if (confirm(`${g.gameDate ?? ''} ${title(g)} 경기를 지울까요?\n지운 기록은 되돌릴 수 없어요. 필요하면 먼저 기록 백업을 받아 두세요.`)) ondelete(g.gameId);
  }
  let picking = $state(false);
  let picked = $state<string[]>([]);
  function pick(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2);
  }
  const mark = (id: string) => (picked[0] === id ? 'A' : picked[1] === id ? 'B' : '');
</script>

<div class="h1">경기 목록</div>
<div class="sub">
  {#if picking}같은 경기를 기록한 두 기록을 골라요 · {picked.length}/2
  {:else}{games.length ? `${games.length}경기 · 누르면 그 경기를 열어요` : '경기가 없어요.'}{/if}
</div>
<div class="card glist">
  {#each games as g (g.gameId)}
    {#if !picking || isManualId(g.gameId)}
      <div class="grow" class:cur={!picking && g.gameId === current} class:picked={!!mark(g.gameId)} data-game={g.gameId}>
        <button class="gopen" onclick={() => (picking ? pick(g.gameId) : onopen(g.gameId))}>
          <b>{#if mark(g.gameId)}<i class="gmark">{mark(g.gameId)}</i>{/if}{title(g)}</b>
          <span>{[g.gameDate, g.stadium, g.gameId === 'm-sample' ? '예시 경기' : ''].filter(Boolean).join(' · ')}</span>
        </button>
        {#if !picking && isManualId(g.gameId)}<button class="gdel" aria-label="{title(g)} 삭제" onclick={() => del(g)}>삭제</button>{/if}
      </div>
    {/if}
  {/each}
</div>
<div class="nav">
  {#if picking}
    <button onclick={() => { picking = false; picked = []; }}>취소</button>
    <button class="next" id="cmpGo" disabled={picked.length < 2} onclick={() => oncompare(picked[0], picked[1])}>비교하기</button>
  {:else}
    {#if onclose}<button onclick={onclose}>닫기</button>{/if}
    <button id="cmpPick" disabled={games.filter((g) => isManualId(g.gameId)).length < 2} onclick={() => (picking = true)}>기록 비교</button>
    <button class="next" onclick={onnew}>＋ 새 기록</button>
  {/if}
</div>
