<script lang="ts">
  import type { Game } from '../lib/naver/parse';
  import LogRows from '../components/LogRows.svelte';
  let { game, onpick }: { game: Game; onpick: (i: number) => void } = $props();
  const fin = $derived(game.pas[game.pas.length - 1].after);
</script>

<div class="h1">플레이 로그</div>
<div class="sub">{game.awayName} {fin.awayScore} : {fin.homeScore} {game.homeName} · {game.pas.length}타석</div>
<LogRows {game} {onpick} />
