<script lang="ts">
  // The game's score card: a preview, and a PNG of it for the phone's share sheet (a download where there is none).
  // With a share server, also a link to the game, whose preview is this card.
  import { cardSvg, type CardSummary } from '../lib/card';
  import type { GameEvent } from '../lib/events';
  import { createShare, deleteShare, mySharesOf, shareEnabled, type MyShare } from '../lib/shareApi';
  /** linkable: false for a game someone else shared (it is theirs to link) */
  let { summary, gameId, events, linkable = true }: { summary: CardSummary; gameId: string; events: () => GameEvent[]; linkable?: boolean } = $props();
  let links = $state<MyShare[]>([]);
  $effect(() => { links = mySharesOf(gameId); });
  const link = $derived(links.at(-1));
  let copied = $state(false);
  const svg = $derived(cardSvg(summary));
  const src = $derived(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const name = $derived(`openscorebook-${[summary.date, summary.away, summary.home].join('-').replace(/[^\p{L}\p{N}-]+/gu, '_')}.png`);
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** the SVG drawn at twice its size, so text stays sharp on phones */
  async function png(): Promise<Blob> {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 2400; c.height = 1260;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('이미지를 만들지 못했어요.'))), 'image/png'));
  }
  async function share() {
    busy = true; error = null;
    try {
      const file = new File([await png()], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `${summary.away} ${summary.score[0]} : ${summary.score[1]} ${summary.home}` }); }
        catch (e) { if ((e as Error).name !== 'AbortError') throw e; } // closing the share sheet is not an error
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) { error = `공유 실패: ${(e as Error).message}`; }
    busy = false;
  }

  async function makeLink() {
    if (!confirm('이 경기를 링크로 공유할까요?\n링크를 아는 누구나 이 경기 기록(선수 이름 포함)을 볼 수 있어요. 이 기기에서 언제든 링크를 지울 수 있어요.')) return;
    busy = true; error = null;
    try {
      await createShare(gameId, events());
      links = mySharesOf(gameId);
      await send();
    } catch (e) { error = `링크 공유 실패: ${(e as Error).message}`; }
    busy = false;
  }
  /** the link to the share sheet, or to the clipboard */
  async function send() {
    if (!link) return;
    copied = false;
    if (navigator.share) {
      try { await navigator.share({ url: link.url, title: `${summary.away} ${summary.score[0]} : ${summary.score[1]} ${summary.home}` }); return; }
      catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(link.url); copied = true; } catch { /* the link is on screen to copy by hand */ }
  }
  async function removeLink() {
    if (!link || !confirm('이 링크를 지울까요? 링크를 받은 사람도 더는 열 수 없어요.')) return;
    busy = true; error = null;
    try { await deleteShare(gameId, link); links = mySharesOf(gameId); } catch (e) { error = `링크 삭제 실패: ${(e as Error).message}`; }
    busy = false;
  }
</script>

<div class="card sharecard">
  <img {src} alt="{summary.away} {summary.score[0]} : {summary.score[1]} {summary.home} 스코어 카드" />
  <button id="shareCard" disabled={busy} onclick={share}>{busy ? '만드는 중…' : '이미지 공유'}</button>
  {#if shareEnabled && linkable}
    {#if link}
      <div class="sharelink"><a id="shareUrl" href={link.url} target="_blank" rel="noopener">{link.url}</a>{#if copied}<span>복사됨</span>{/if}</div>
      <div class="sharerow">
        <button id="shareSend" disabled={busy} onclick={send}>링크 보내기</button>
        <button id="shareAgain" disabled={busy} onclick={makeLink}>새 링크</button>
        <button id="shareDelete" class="del" disabled={busy} onclick={removeLink}>링크 삭제</button>
      </div>
    {:else}
      <button id="shareLink" disabled={busy} onclick={makeLink}>링크 공유</button>
    {/if}
  {/if}
  {#if error}<div class="cmp-d">{error}</div>{/if}
</div>
