<script lang="ts">
  // One plate appearance: matchup, pitch zone + log, result; for balls in play the field to record where it
  // landed and rolled. PC adds the PA list as a sidebar.
  import type { Game, ResClass } from '../lib/naver/parse';
  import { landingInfo, type Landings } from '../lib/landings';
  import { fenceDist, fenceFor } from '../lib/stadiums';
  import { RES, TRAJ, callColor, callLabel, halfName, slotOf } from '../lib/ui';
  import Zone from '../components/Zone.svelte';
  import Field from '../components/Field.svelte';
  import LogRows from '../components/LogRows.svelte';

  interface Props {
    game: Game; idx: number; landings: Landings; wide: boolean;
    ongo: (i: number) => void;
    ontap: (pt: [number, number]) => void; onundo: () => void; onclear: () => void;
    onres: (r: ResClass) => void; ontraj: (t: string) => void; onexport: () => Promise<boolean>;
  }
  let { game, idx, landings, wide, ongo, ontap, onundo, onclear, onres, ontraj, onexport }: Props = $props();

  const pa = $derived(game.pas[idx]);
  const fence = $derived(fenceFor(game.stadium));
  const st = $derived(pa.pitches[pa.pitches.length - 1].state);
  const saved = $derived(landings[pa.no]);
  const isOut = $derived(/아웃|병살/.test(pa.result ?? ''));
  const curRes = $derived(saved?.res ?? pa.res);
  const nextInPlay = $derived.by(() => { const j = game.pas.findIndex((p, i) => i > idx && p.inPlay); return j < 0 ? game.pas.length - 1 : j; });
  const hasNextInPlay = $derived(game.pas.some((p, i) => i > idx && p.inPlay));
  const note = $derived(
    `${game.stadium ?? '구장 미상'} 펜스 기준${fence.p ? ' · 위성사진 기반 윤곽' : ''}${fence.src.includes('sat') ? ' · ≈ 위성사진 기반 값' : ''}` +
      `${fence.src.some((x) => x !== 'ok' && x !== 'sat') ? ' · * 추정/비공식 수치' : ''}`,
  );
  let exportLabel = $state('JSON 복사');
  $effect(() => { void game.gameId; exportLabel = 'JSON 복사'; });

  let sidebar: HTMLElement | undefined = $state();
  $effect(() => { void idx; sidebar?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }); });
</script>

{#snippet pitchPart()}
  <div class="top">
    <button class="ico" id="prev" onclick={() => ongo(idx - 1)}>‹</button>
    <div class="mid">{halfName(pa)} · <span class="dim">{game.awayName}</span> {pa.after.awayScore} : {pa.after.homeScore} <span class="dim">{game.homeName}</span></div>
    <button class="ico" id="next" onclick={() => ongo(idx + 1)}>›</button>
  </div>
  <div class="mu">
    <div class="side"><div class="r">P</div><div class="n">{game.names[pa.pitcher] ?? pa.pitcher}</div><div class="s">{pa.pitcherPitches}구 · {(game.hands[pa.pitcher] ?? '').slice(0, 2)}</div></div>
    <div class="arw">→</div>
    <div class="side"><div class="r">AB</div><div class="n">{game.names[pa.batter] ?? pa.batter} <span style="font-size:11px;color:var(--muted)">{slotOf(pa)}번</span></div><div class="s">{(game.hands[pa.batter] ?? '').slice(2)}</div></div>
    <div class="cnt"><div class="bs">{st.ball}-{st.strike}</div><div class="o">{'●'.repeat(pa.before.out)}{'○'.repeat(3 - pa.before.out)} {pa.before.out}아웃</div></div>
  </div>
  <div class="zonewrap">
    <div class="card zonecard"><div class="cap">투구 위치 · 포수 시점</div><Zone {pa} /></div>
    <div class="leg">
      <div class="it"><span class="d" style="background:var(--strike)"></span>스트라이크</div>
      <div class="it"><span class="d" style="background:var(--ball)"></span>볼</div>
      <div class="it"><span class="d" style="background:var(--foul)"></span>파울</div>
      <div class="it"><span class="d" style="border:2px dashed var(--inplay)"></span>인플레이</div>
      <div class="src">네이버 PTS<br />자동 반영</div>
    </div>
  </div>
  <div class="log">
    {#each pa.pitches as p}
      <div class="r"><span class="pn">{p.n}</span><span class="ty">{p.stuff || '-'}</span><span class="ve">{p.speed ? p.speed + '㎞' : ''}</span><span>{callLabel(p.call)}</span><span class="rs" style="color:{callColor(p.call)}">{p.call}</span></div>
    {/each}
    {#each pa.events as e}<div class="ev">{e}</div>{/each}
  </div>
  {#if pa.result}<div class="result" class:out={isOut}>{pa.result}</div>{/if}
{/snippet}

{#snippet fieldPart()}
  {#if pa.inPlay}
    <div class="sect"><span>{saved ? '② 이후 타구 흐름 · 탭 (선택)' : '① 최초 낙구지점 · 탭'}</span><span class="saved">{saved ? `저장됨 · ${landingInfo(saved, (a) => fenceDist(fence, a))}` : ''}</span></div>
    <div class="card fieldcard"><Field {pa} {fence} {landings} {ontap} /></div>
    {#if saved}
      <div class="pathbar"><button id="undo" onclick={onundo}>↶ 되돌리기</button><button id="clear" onclick={onclear}>지우기</button><span>흐름 {saved.path?.length ?? 0}점</span></div>
    {/if}
    <div class="fnote">{note}</div>
    <div class="sect"><span>결과</span><span>{saved?.resManual ? '직접 수정' : '네이버 판정 자동'}</span></div>
    <div class="chips res">
      {#each RES as [k, l, c]}
        <button class="chip" class:sel={curRes === k} data-r={k} style={curRes === k ? `border-color:${c};color:${c};background:${c}1a` : ''} onclick={() => onres(k)}>{l}</button>
      {/each}
    </div>
    <div class="sect"><span>궤적</span></div>
    <div class="chips">{#each TRAJ as t}<button class="chip" class:sel={saved?.traj === t} data-t={t} onclick={() => ontraj(t)}>{t}</button>{/each}</div>
  {:else if wide}
    <div class="empty">인플레이 타석이 아니에요.<br />타구 기록은 인플레이 타석에서 해요. <kbd>N</kbd> 다음 인플레이</div>
  {/if}
{/snippet}

{#snippet navPart()}
  <div class="nav"><button id="prev2" onclick={() => ongo(idx - 1)}>← 이전 타석</button><button class="next" id="next2" onclick={() => ongo(nextInPlay)}>{hasNextInPlay ? '다음 인플레이 →' : '마지막 →'}</button></div>
  <div class="foot"><span>{idx + 1} / {game.pas.length} 타석 · 낙구 {Object.keys(landings).length}개</span>
    <button id="export" onclick={async () => (exportLabel = (await onexport()) ? '복사됨' : '복사 실패')}>{exportLabel}</button></div>
{/snippet}

{#if wide}
  <div class="dgrid">
    <aside class="dcol dlog" id="dlog" bind:this={sidebar}><LogRows {game} compact cur={idx} onpick={ongo} /></aside>
    <section class="dcol">{@render pitchPart()}{@render navPart()}<div class="keys"><kbd>←</kbd><kbd>→</kbd> 타석 이동 · <kbd>N</kbd> 다음 인플레이</div></section>
    <section class="dcol">{@render fieldPart()}</section>
  </div>
{:else}
  {@render pitchPart()}{@render fieldPart()}{@render navPart()}
{/if}
