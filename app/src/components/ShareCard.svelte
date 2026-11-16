<script lang="ts">
  // The game's score card: a preview, and a PNG of it for the phone's share sheet (a download where there is none).
  import { cardSvg, type CardSummary } from '../lib/card';
  let { summary }: { summary: CardSummary } = $props();
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
</script>

<div class="card sharecard">
  <img {src} alt="{summary.away} {summary.score[0]} : {summary.score[1]} {summary.home} 스코어 카드" />
  <button id="shareCard" disabled={busy} onclick={share}>{busy ? '만드는 중…' : '이미지 공유'}</button>
  {#if error}<div class="cmp-d">{error}</div>{/if}
</div>
