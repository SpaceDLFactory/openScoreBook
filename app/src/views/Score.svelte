<script lang="ts">
  // Manual scoring input: situation, pitch pad (tap the zone, then the call), and panels for the PA result
  // with runner moves, runner plays and substitutions. Walks and strikeouts complete themselves from the count.
  import type { Advance, PaResultType, Spot } from '../lib/engine';
  import type { Game } from '../lib/naver/parse';
  import { POS_NAME, defaultAdvances, type ManualEvent, type Now, type RunnerPlay, type Side, type SubRole } from '../lib/manual';
  import { callColor, callLabel } from '../lib/ui';

  let { game, now, onrecord, onundo }: { game: Game; now: Now; onrecord: (e: ManualEvent[]) => void; onundo: () => void } = $props();

  const side: Side = $derived(now.top ? 'away' : 'home');
  const field: Side = $derived(now.top ? 'home' : 'away');
  const cur = $derived.by(() => { const l = game.pas.at(-1); return l && !l.result && l.inn === now.inning && l.top === now.top ? l : undefined; }); // PA in progress
  const occupied = $derived(now.bases.map((b) => !!b));

  // ---- pitch pad
  const W = 230, H = 260, KX = 56, KZ = 50, sx = (x: number) => W / 2 + x * KX, sz = (z: number) => H - 16 - z * KZ;
  let spot = $state<[number, number] | null>(null);
  let stuff = $state<string | null>(null);
  const STUFF = ['직구', '투심', '커터', '슬라이더', '커브', '체인지업', '포크', '기타'];
  function tapZone(e: MouseEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(), k = W / r.width;
    const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
    spot = [Math.round(((px - W / 2) / KX) * 100) / 100, Math.round(((H - 16 - py) / KZ) * 100) / 100];
  }
  function pitch(call: 'B' | 'T' | 'S' | 'F' | 'H') {
    const evs: ManualEvent[] = [{ kind: 'm.pitch', call, ...(spot ? { x: spot[0], z: spot[1] } : {}), ...(stuff ? { stuff } : {}) }];
    const balls = now.balls + (call === 'B' ? 1 : 0), strikes = now.strikes + (call === 'T' || call === 'S' || (call === 'F' && now.strikes < 2) ? 1 : 0);
    if (call === 'B' && balls === 4) evs.push(pa('Walk', [], defaultAdvances('Walk', occupied), { auto: true }));
    if ((call === 'T' || call === 'S') && strikes === 3) evs.push(pa('Strikeout', [], defaultAdvances('Strikeout', occupied), { auto: true }));
    onrecord(evs);
    spot = null; stuff = null;
    if (call === 'H') openResult();
  }
  function hitByPitch() {
    onrecord([{ kind: 'm.pitch', call: 'B', ...(spot ? { x: spot[0], z: spot[1] } : {}) }, pa('HitByPitch', [], defaultAdvances('HitByPitch', occupied), { auto: true })]);
    spot = null;
  }
  function intentional() { onrecord([pa('Walk', [], defaultAdvances('Walk', occupied), { ibb: true })]); }
  const pa = (result: PaResultType, fielders: number[], advances: Advance[], extra: { line?: boolean; ibb?: boolean; auto?: boolean } = {}): ManualEvent =>
    ({ kind: 'm.pa', result, fielders, advances, ...extra });

  // ---- panels
  let panel = $state<null | 'result' | 'runners' | 'sub'>(null);
  const RESULTS: [string, PaResultType, boolean][] = [
    ['1루타', 'Single', false], ['2루타', 'Double', false], ['3루타', 'Triple', false], ['홈런', 'HomeRun', false],
    ['땅볼', 'GroundOut', false], ['플라이', 'FlyOut', false], ['라이너', 'FlyOut', true], ['병살', 'DoublePlay', false],
    ['야선', 'FieldersChoice', false], ['실책', 'Error', false], ['희생플라이', 'SacFly', false], ['희생번트', 'SacBunt', false],
    ['삼진', 'Strikeout', false], ['볼넷', 'Walk', false], ['사구', 'HitByPitch', false],
  ];
  let resKey = $state<string | null>(null);
  let fielders = $state<number[]>([]);
  let dest = $state<Record<string, Spot>>({}); // from -> to (rows not listed stay)
  const START: Spot[] = ['First', 'Second', 'Third'];
  const DEST_LABEL: [Spot, string][] = [['First', '1루'], ['Second', '2루'], ['Third', '3루'], ['Home', '홈'], ['Out', '아웃']];
  const setDest = (adv: Advance[]) => { dest = Object.fromEntries(adv.map((a) => [a.from, a.to])); };
  function openResult() { panel = 'result'; resKey = null; fielders = []; dest = { Batter: 'Out' }; }
  function chooseResult(k: string) {
    resKey = k;
    const r = RESULTS.find((x) => x[0] === k)![1];
    setDest(defaultAdvances(r, occupied));
  }
  const moves = (withBatter: boolean): Advance[] =>
    Object.entries(dest).filter(([from, to]) => (withBatter || from !== 'Batter') && from !== to).map(([from, to]) => ({ from: from as Spot, to }));
  function confirmResult() {
    const [, r, line] = RESULTS.find((x) => x[0] === resKey)!;
    onrecord([pa(r, fielders, moves(true), { line })]);
    panel = null;
  }

  const PLAYS: [RunnerPlay, string][] = [['SB', '도루'], ['CS', '도루실패'], ['WP', '폭투'], ['PB', '포일'], ['BK', '보크'], ['PO', '견제사'], ['ETC', '기타']];
  let play = $state<RunnerPlay>('SB');
  function openRunners() {
    panel = 'runners'; play = 'SB';
    // default: the lead runner takes the next base
    const lead = [2, 1, 0].find((i) => occupied[i]);
    dest = lead === undefined ? {} : { [START[lead]]: lead === 2 ? 'Home' : START[lead + 1] };
  }
  function choosePlay(p: RunnerPlay) {
    play = p;
    const up = (i: number): Spot => (i === 2 ? 'Home' : START[i + 1]);
    const runners = [0, 1, 2].filter((i) => occupied[i]);
    const lead = runners.at(-1);
    if (p === 'WP' || p === 'PB' || p === 'BK') dest = Object.fromEntries(runners.map((i) => [START[i], up(i)]));
    else if ((p === 'CS' || p === 'PO') && lead !== undefined) dest = { [START[lead]]: 'Out' };
    else if (p === 'SB' && lead !== undefined) dest = { [START[lead]]: up(lead) };
    else dest = {};
  }
  function confirmRunners() { onrecord([{ kind: 'm.runners', play, advances: moves(false) }]); panel = null; }

  let role = $state<SubRole>('PH'), subName = $state(''), subPos = $state(''), subSlot = $state(0), subBase = $state(0);
  function openSub() { panel = 'sub'; role = 'PH'; subName = ''; subPos = ''; subSlot = now.slot; subBase = occupied.findIndex(Boolean); }
  function confirmSub() {
    if (!subName.trim()) return;
    const slot = role === 'PH' ? now.slot : role === 'PR' ? now.lineup[side].findIndex((p) => p.id === now.bases[subBase]?.id) : subSlot;
    if (slot < 0) return;
    const s: Side = role === 'P' || role === 'DEF' ? subSide : side;
    onrecord([{ kind: 'm.sub', side: s, role, slot, player: { id: `p-${Date.now().toString(36)}`, name: subName.trim(), pos: role === 'P' ? '투수' : subPos } }]);
    panel = null;
  }
  let subSide = $state<Side>('home');
  $effect(() => { if (panel === 'sub') subSide = field; });
</script>

<div class="sit">
  <div class="sl"><b>{now.inning}회{now.top ? '초' : '말'}</b> · {game.awayName} {now.awayScore} : {now.homeScore} {game.homeName}</div>
  <div class="sr"><span class="bs">{now.balls}-{now.strikes}</span><span class="o">{'●'.repeat(now.outs)}{'○'.repeat(3 - now.outs)}</span></div>
</div>
<div class="sit2">
  <div class="diamond">
    {#each [[1, '2루'], [2, '3루'], [0, '1루']] as [i, l]}
      <div class="b b{i}" class:on={!!now.bases[i as number]} title={l as string}>{now.bases[i as number]?.name ?? ''}</div>
    {/each}
  </div>
  <div class="who2">
    <div><span class="r">AB</span> <b id="batter">{now.batter.name}</b> <small>{now.slot + 1}번</small></div>
    <div><span class="r">P</span> <b id="pitcher">{now.pitcher.name}</b> <small>{now.pitches}구</small></div>
  </div>
</div>

{#if panel === null}
  <div class="padwrap">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <svg id="pad" width={W} height={H} viewBox="0 0 {W} {H}" onclick={tapZone} role="img" aria-label="투구 위치 · 포수 시점, 탭">
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="10" fill="rgba(255,255,255,.015)" stroke="#1e2630" />
      <rect x={sx(-0.708)} y={sz(3.4)} width={sx(0.708) - sx(-0.708)} height={sz(1.6) - sz(3.4)} fill="rgba(245,158,11,.05)" stroke="#4a5566" stroke-width="1.5" />
      <line x1={sx(-0.708)} y1={H - 8} x2={sx(0.708)} y2={H - 8} stroke="#4a5566" stroke-width="2" />
      {#each cur?.pitches ?? [] as p}
        {#if p.xz}<circle cx={sx(p.xz[0])} cy={sz(p.xz[1])} r="10" fill={callColor(p.call)} opacity=".85" /><text x={sx(p.xz[0])} y={sz(p.xz[1]) + 4} text-anchor="middle" font-size="11" font-weight="800" fill="#0d1014">{p.n}</text>{/if}
      {/each}
      {#if spot}<circle cx={sx(spot[0])} cy={sz(spot[1])} r="11" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3 2" />{/if}
    </svg>
    <div class="calls">
      <button data-call="B" style="--c:var(--ball)" onclick={() => pitch('B')}>볼</button>
      <button data-call="T" style="--c:var(--strike)" onclick={() => pitch('T')}>스트라이크</button>
      <button data-call="S" style="--c:var(--strike)" onclick={() => pitch('S')}>헛스윙</button>
      <button data-call="F" style="--c:var(--foul)" onclick={() => pitch('F')}>파울</button>
      <button data-call="H" style="--c:var(--inplay)" onclick={() => pitch('H')}>타격</button>
      <button id="hbp" onclick={hitByPitch}>사구</button>
      <button id="ibb" onclick={intentional}>고의4구</button>
    </div>
  </div>
  <div class="chips res">{#each STUFF as t}<button class="chip" class:sel={stuff === t} onclick={() => (stuff = stuff === t ? null : t)}>{t}</button>{/each}</div>
  {#if cur?.pitches.length}
    <div class="plist">{#each cur.pitches as p}<span style="color:{callColor(p.call)}">{p.n} {p.stuff ? p.stuff + ' ' : ''}{callLabel(p.call)}</span>{/each}</div>
  {/if}
  <div class="actions">
    <button id="openResult" onclick={openResult}>결과 입력</button>
    <button id="openRunners" onclick={openRunners} disabled={!occupied.some(Boolean)}>주루</button>
    <button id="openSub" onclick={openSub}>교체</button>
    <button id="undoEdit" onclick={onundo}>↶ 되돌리기</button>
  </div>
{:else if panel === 'result'}
  <div class="sect"><span>타석 결과 · {now.batter.name}</span><button class="x" onclick={() => (panel = null)}>닫기</button></div>
  <div class="chips res">{#each RESULTS as [k]}<button class="chip" data-res={k} class:sel={resKey === k} onclick={() => chooseResult(k)}>{k}</button>{/each}</div>
  <div class="sect"><span>야수 · 공이 간 순서대로</span><button class="x" onclick={() => (fielders = [])}>지우기</button></div>
  <div class="chips res">{#each POS_NAME.slice(1) as p, i}<button class="chip" data-f={i + 1} onclick={() => (fielders = [...fielders, i + 1])}>{i + 1} {p}</button>{/each}</div>
  {#if fielders.length}<div class="plist" id="chain">{fielders.join('-')}</div>{/if}
  {#if resKey}{@render editor(true)}{/if}
  <div class="nav"><button onclick={() => (panel = null)}>취소</button><button class="next" id="confirmResult" disabled={!resKey} onclick={confirmResult}>확정</button></div>
{:else if panel === 'runners'}
  <div class="sect"><span>주루 플레이</span><button class="x" onclick={() => (panel = null)}>닫기</button></div>
  <div class="chips res">{#each PLAYS as [k, l]}<button class="chip" data-play={k} class:sel={play === k} onclick={() => choosePlay(k)}>{l}</button>{/each}</div>
  {@render editor(false)}
  <div class="nav"><button onclick={() => (panel = null)}>취소</button><button class="next" id="confirmRunners" onclick={confirmRunners}>확정</button></div>
{:else}
  <div class="sect"><span>선수 교체</span><button class="x" onclick={() => (panel = null)}>닫기</button></div>
  <div class="chips res">{#each [['PH', '대타'], ['PR', '대주자'], ['P', '투수'], ['DEF', '수비']] as [k, l]}<button class="chip" data-role={k} class:sel={role === k} onclick={() => (role = k as SubRole)}>{l}</button>{/each}</div>
  <div class="card setup">
    {#if role === 'PH'}<div class="sub">{now.slot + 1}번 {now.batter.name} 대신</div>
    {:else if role === 'PR'}
      <label>주자 <select bind:value={subBase}>{#each now.bases as b, i}{#if b}<option value={i}>{i + 1}루 {b.name}</option>{/if}{/each}</select></label>
    {:else}
      <label>팀 <select bind:value={subSide}><option value="away">{game.awayName}</option><option value="home">{game.homeName}</option></select></label>
      {#if role === 'DEF'}<label>타순 <select bind:value={subSlot}>{#each now.lineup[subSide] as p, i}<option value={i}>{i + 1}번 {p.name}</option>{/each}</select></label>{/if}
    {/if}
    <label>이름 <input id="subName" bind:value={subName} /></label>
    {#if role !== 'P'}<label>포지션 <select bind:value={subPos}><option value="">-</option>{#each [...POS_NAME.slice(1), '지명타자'] as p}<option value={p}>{p}</option>{/each}</select></label>{/if}
  </div>
  <div class="nav"><button onclick={() => (panel = null)}>취소</button><button class="next" id="confirmSub" disabled={!subName.trim()} onclick={confirmSub}>교체</button></div>
{/if}

{#snippet editor(withBatter: boolean)}
  <div class="sect"><span>주자 이동</span></div>
  <div class="card adv">
    {#each [2, 1, 0] as i}
      {#if occupied[i]}
        <div class="arow"><span>{i + 1}루 {now.bases[i]?.name}</span>
          <div class="chips res">
            <button class="chip" class:sel={!dest[START[i]] || dest[START[i]] === START[i]} onclick={() => { const d = { ...dest }; delete d[START[i]]; dest = d; }}>그대로</button>
            {#each DEST_LABEL.filter(([s]) => s === 'Out' || s === 'Home' || START.indexOf(s) > i) as [s, l]}
              <button class="chip" data-from={START[i]} data-to={s} class:sel={dest[START[i]] === s} onclick={() => (dest = { ...dest, [START[i]]: s })}>{l}</button>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
    {#if withBatter}
      <div class="arow"><span>타자 {now.batter.name}</span>
        <div class="chips res">{#each DEST_LABEL as [s, l]}<button class="chip" data-from="Batter" data-to={s} class:sel={dest.Batter === s} onclick={() => (dest = { ...dest, Batter: s })}>{l}</button>{/each}</div>
      </div>
    {/if}
    {#if !withBatter && !occupied.some(Boolean)}<div class="sub">주자가 없어요.</div>{/if}
  </div>
{/snippet}
