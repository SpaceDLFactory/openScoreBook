<script lang="ts">
  // One plate appearance: matchup, pitch zone + log, result; for balls in play the field to record where it
  // landed and rolled. PC adds the PA list as a sidebar.
  import type { Game, ResClass } from '../lib/naver/parse';
  import { caughtByResult, landingInfo, type Landings } from '../lib/landings';
  import { LISTED, fenceDist, fenceFor } from '../lib/stadiums';
  import { RES, TRAJ, callColor, callLabel, halfName, slotOf } from '../lib/ui';
  import Zone from '../components/Zone.svelte';
  import Field from '../components/Field.svelte';
  import LogRows from '../components/LogRows.svelte';
  import { directionIssue } from '../lib/direction';
  import { estimate, hangDelay, setHangDelay } from '../lib/flight';

  interface Props {
    game: Game; idx: number; landings: Landings; wide: boolean;
    /** a shared game: landings are shown, not edited */
    readonly?: boolean;
    ongo: (i: number) => void;
    ontap: (pt: [number, number]) => void; onundo: () => void; onclear: () => void;
    onres: (r: ResClass) => void; ontraj: (t: string) => void; onexport: () => Promise<boolean>;
    onhang: (sec: number | null) => void; oncaught: (v: boolean) => void;
  }
  let { game, idx, landings, wide, readonly = false, ongo, ontap, onundo, onclear, onres, ontraj, onhang, oncaught, onexport }: Props = $props();

  const pa = $derived(game.pas[idx]);
  const fence = $derived(game.fence ?? fenceFor(game.stadium));
  /** the outline stored with the game is not the one listed now (it has been measured again since) */
  const older = $derived(!!game.fence && !!game.stadium && game.stadium in LISTED && JSON.stringify(game.fence) !== JSON.stringify(LISTED[game.stadium]));
  const st = $derived(pa.pitches[pa.pitches.length - 1]?.state ?? pa.after);
  const saved = $derived(landings[pa.no]);
  const isOut = $derived(/아웃|병살/.test(pa.result ?? ''));
  const curRes = $derived(saved?.res ?? pa.res);
  const nextInPlay = $derived.by(() => { const j = game.pas.findIndex((p, i) => i > idx && p.inPlay); return j < 0 ? game.pas.length - 1 : j; });
  const hasNextInPlay = $derived(game.pas.some((p, i) => i > idx && p.inPlay));
  const note = $derived(
    `${game.stadium ?? '구장 미상'} 펜스 기준${older ? ' · 기록 당시 윤곽' : ''}${fence.p ? ' · 위성사진 기반 윤곽' : ''}${fence.src.includes('sat') ? ' · ≈ 위성사진 기반 값' : ''}` +
      `${fence.src.some((x) => x !== 'ok' && x !== 'sat') ? ' · * 추정/비공식 수치' : ''}`,
  );
  // landings that disagree with the fielder their result names: this PA's, and how many in the game
  const issue = $derived(saved ? directionIssue(pa.result, saved.x, saved.y) : null);
  const flagged = $derived(game.pas.flatMap((p, i) => { const l = landings[p.no]; return l && directionIssue(p.result, l.x, l.y) ? [i] : []; }));
  const nextFlagged = $derived(flagged.find((i) => i > idx) ?? flagged[0]);
  const caught = $derived(saved?.caught ?? caughtByResult(pa.result));
  // hang time by stopwatch, for scoring from video: press at contact, press again when it lands
  let started = $state<number | null>(null);
  $effect(() => { void pa.no; started = null; });
  function stopwatch() {
    if (started == null) { started = performance.now(); return; }
    const sec = Math.round((performance.now() - started) / 100) / 10;
    started = null;
    if (sec > 0 && sec <= 15) onhang(sec);
  }
  // launch angle and exit velocity from distance and hang time, for balls in the air that carry
  let delay = $state(hangDelay());
  const est = $derived(saved?.hang != null && saved.traj !== '땅볼' && saved.traj !== '번트' && Math.hypot(saved.x, saved.y) >= 40
    ? estimate(Math.hypot(saved.x, saved.y), saved.hang, caught, delay) : null);
  function changeDelay() {
    const v = prompt('스톱워치를 늦게 누르는 만큼 더할 시간(초). 기본 0.22초', String(delay));
    if (v == null) return;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1) { delay = n; setHangDelay(n); }
  }
  function typed(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    onhang(Number.isFinite(v) && v > 0 && v <= 15 ? Math.round(v * 10) / 10 : null);
  }
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
    <div class="side"><div class="r">P</div><div class="n">{game.names[pa.pitcher] ?? pa.pitcher}</div><div class="s">{[`${pa.pitcherPitches}구`, (game.hands[pa.pitcher] ?? '').slice(0, 2)].filter(Boolean).join(' · ')}</div></div>
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
    <div class="sect"><span>{readonly ? '낙구지점' : saved ? '② 이후 타구 흐름 · 탭 (선택)' : '① 최초 낙구지점 · 탭'}</span><span class="saved">{saved ? `저장됨 · ${landingInfo(saved, (a) => fenceDist(fence, a))}` : ''}</span></div>
    <div class="card fieldcard"><Field {pa} {fence} {landings} ontap={readonly ? () => {} : ontap} /></div>
    {#if issue}<div class="dirwarn" id="dirwarn">방향 확인 · {issue}</div>{/if}
    <div class="legend" id="legend">{#each RES as [, l, c]}<span><i style="background:{c}"></i>{l}</span>{/each}<span class="cur">큰 점 · 이 타석</span></div>
    {#if saved && !readonly}
      <div class="pathbar"><button id="undo" onclick={onundo}>↶ 되돌리기</button><button id="clear" onclick={onclear}>지우기</button><span>흐름 {saved.path?.length ?? 0}점</span></div>
    {/if}
    <div class="fnote">{note}</div>
    <div class="sect"><span>결과</span><span>{readonly ? '' : saved?.resManual ? '직접 수정' : '결과 문구로 자동 판정'}</span></div>
    <div class="chips res">
      {#each RES as [k, l, c]}
        <button class="chip" class:sel={curRes === k} data-r={k} style={curRes === k ? `border-color:${c};color:${c};background:${c}1a` : ''} disabled={readonly} onclick={() => onres(k)}>{l}</button>
      {/each}
    </div>
    <div class="sect"><span>궤적</span></div>
    <div class="chips">{#each TRAJ as t}<button class="chip" class:sel={saved?.traj === t} data-t={t} disabled={readonly} onclick={() => ontraj(t)}>{t}</button>{/each}</div>
    {#if saved}
      <div class="sect"><span>수비 처리</span><span>{saved.caught != null ? '직접 수정' : '결과에서 판정'}</span></div>
      <div class="chips"><button class="chip" id="caughtYes" class:sel={caught} disabled={readonly} onclick={() => oncaught(true)}>낙구 전 잡힘</button><button class="chip" id="caughtNo" class:sel={!caught} disabled={readonly} onclick={() => oncaught(false)}>땅에 떨어짐</button></div>
      <div class="sect"><span>체공시간 · 선택</span><span>{saved.hang != null ? `${saved.hang}초` : ''}</span></div>
      <div class="hang">
        <input id="hang" type="number" inputmode="decimal" step="0.1" min="0.1" max="15" placeholder="초" value={saved.hang ?? ''} disabled={readonly} onchange={typed} />
        {#if !readonly}<button id="hangTimer" class:on={started != null} onclick={stopwatch}>{started == null ? '시간 재기 · 타격 순간' : '낙구 순간에 누르기'}</button>{/if}
        {#if saved.hang != null && !readonly}<button id="hangClear" onclick={() => onhang(null)}>지우기</button>{/if}
      </div>
      {#if est}
        <div class="est" id="estimate"><span>추정 · 발사각 <b>{Math.round(est.la)}°</b> (±{Math.max(1, Math.round(est.laSd))}) · 타구속도 <b>{Math.round(est.evKmh)}km/h</b> (±{Math.max(3, Math.round(est.evSd))})</span>
          <button id="delay" onclick={changeDelay}>반응 보정 +{delay}초</button></div>
      {:else if saved.hang != null && saved.traj !== '땅볼' && saved.traj !== '번트' && Math.hypot(saved.x, saved.y) >= 40}
        <div class="est muted" id="estimate">이 거리와 체공시간에 맞는 타구가 없어요. 낙구지점이나 시간을 확인해 주세요.</div>
      {/if}
    {/if}
  {:else if wide}
    <div class="empty">인플레이 타석이 아니에요.<br />타구 기록은 인플레이 타석에서 해요. <kbd>N</kbd> 다음 인플레이</div>
  {/if}
{/snippet}

{#snippet navPart()}
  <div class="nav"><button id="prev2" onclick={() => ongo(idx - 1)}>← 이전 타석</button><button class="next" id="next2" onclick={() => ongo(nextInPlay)}>{hasNextInPlay ? '다음 인플레이 →' : '마지막 →'}</button></div>
  <div class="foot"><span>{idx + 1} / {game.pas.length} 타석 · 낙구 {Object.keys(landings).length}개</span>
    {#if flagged.length}<button id="nextFlag" class="flag" onclick={() => ongo(nextFlagged)}>방향 확인 {flagged.length}건</button>{/if}
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
