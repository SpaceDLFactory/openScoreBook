<script lang="ts">
  // New manually scored game: teams, park, batting orders and starting pitchers.
  import type { Player, Setup } from '../lib/manual';
  import { POS_NAME } from '../lib/manual';
  import { LEAGUES, LISTED, PARKS, customFence, fenceOk, type Park } from '../lib/stadiums';
  import { FH, FW, HX, HY, fieldOf } from '../lib/field';
  import type { Roster } from '../lib/rosters';
  /** rosters: teams seen in earlier games, for names to pick and last lineups to reuse */
  let { parks, rosters = {}, oncreate, oncancel }: { parks: Park[]; rosters?: Record<string, Roster>; oncreate: (s: Setup) => void; oncancel: () => void } = $props();
  const teams = $derived(Object.values(rosters).sort((a, b) => b.date.localeCompare(a.date)).map((r) => r.team));
  const POSITIONS = [...POS_NAME.slice(1), '지명타자', '추가타자'];
  const COUNTS = [9, 10, 11, 12, 13, 14, 15];
  const today = new Date().toISOString().slice(0, 10);
  let date = $state(today), stadium = $state('대구'), awayName = $state(''), homeName = $state('');
  const blank = () => Array.from({ length: 9 }, () => ({ name: '', pos: '' }));
  /** extra hitters (some amateur leagues bat 10 or more) */
  function setCount(list: { name: string; pos: string }[], n: number) {
    while (list.length < n) list.push({ name: '', pos: '' });
    list.splice(n);
  }
  let away = $state(blank()), home = $state(blank());
  let awayPitcher = $state(''), homePitcher = $state('');
  const rosterOf = (side: 'away' | 'home') => rosters[(side === 'away' ? awayName : homeName).trim()];
  /** the team's last batting order (names and positions), to adjust for today */
  function loadLineup(side: 'away' | 'home') {
    const r = rosterOf(side), list = side === 'away' ? away : home;
    if (!r) return;
    setCount(list, r.lineup.length);
    r.lineup.forEach((p, i) => { list[i].name = p.name; list[i].pos = p.pos; });
  }
  /** a known batter picked by name brings his latest position, when none is set */
  function knownPos(side: 'away' | 'home', b: { name: string; pos: string }) {
    const hit = rosterOf(side)?.batters.find((x) => x.name === b.name.trim());
    if (hit?.pos && !b.pos) b.pos = hit.pos;
  }
  const md = (d: string) => d.slice(5).replace('-', '/');
  const NEW_PARK = '__new', FENCE_LABELS = ['좌', '좌중', '중', '우중', '우'];
  let parkName = $state(''), dist = $state<(number | null)[]>([null, null, null, null, null]);
  const isNew = $derived(stadium === NEW_PARK);
  const newName = $derived(parkName.trim());
  const newDist = $derived(dist.map((v) => (typeof v === 'number' ? v : null)));
  const taken = $derived(newName === '기타' || newName === NEW_PARK || newName in LISTED);
  const shape = $derived(fenceOk(newDist) ? fieldOf(customFence(newDist)) : null);
  const blocked = $derived(isNew && (!newName || taken || !shape));
  function create() {
    const t = (side: 'away' | 'home', list: { name: string; pos: string }[], label: string): Player[] =>
      list.map((b, i) => ({ id: `${side[0]}${i + 1}-${Date.now().toString(36)}`, name: b.name.trim() || `${label}${i + 1}번`, pos: b.pos }));
    const a = awayName.trim() || '원정', h = homeName.trim() || '홈';
    const fence = isNew ? newDist : parks.find((p) => p.name === stadium)?.fence;
    const park = !isNew && !fence && LISTED[stadium] ? $state.snapshot(LISTED[stadium]) : undefined;
    oncreate({
      date, stadium: isNew ? newName : stadium, ...(fence && { fence }), ...(park && { park }), awayName: a, homeName: h, away: t('away', away, a), home: t('home', home, h),
      awayPitcher: { id: `ap-${Date.now().toString(36)}`, name: awayPitcher.trim() || `${a} 선발`, pos: '투수' },
      homePitcher: { id: `hp-${Date.now().toString(36)}`, name: homePitcher.trim() || `${h} 선발`, pos: '투수' },
    });
  }
</script>

<div class="h1">새 기록</div>
<div class="sub">이름을 비워 두면 "팀 N번"으로 채워요. 나중에 교체로 바꿀 수 있어요.</div>
<div class="card setup">
  <label>날짜 <input type="date" bind:value={date} /></label>
  <label>구장 <select id="stadium" bind:value={stadium}>
    {#if parks.length}<optgroup label="직접 만든 구장">{#each parks as p (p.name)}<option value={p.name}>{p.name}</option>{/each}</optgroup>{/if}
    {#each LEAGUES as [lg, label] (lg)}
      <optgroup label={label}>{#each PARKS.filter((p) => p.league === lg) as p (p.name)}<option value={p.name}>{p.name}{p.teams.length ? ` · ${p.teams.join(', ')}` : ''}</option>{/each}</optgroup>
    {/each}
    <optgroup label="그 밖"><option value="">기타</option><option value={NEW_PARK}>직접 입력</option></optgroup>
  </select></label>
  {#if isNew}
    <label>이름 <input id="parkName" bind:value={parkName} placeholder="구장 이름" /></label>
    <div class="fences">{#each FENCE_LABELS as l, i}<label>{l}<input class="fdist" data-i={i} type="number" inputmode="decimal" min="30" max="200" bind:value={dist[i]} placeholder={i % 2 ? '선택' : 'm'} /></label>{/each}</div>
    {#if shape}
      <svg class="fprev" viewBox="0 0 {FW} {FH}" role="img" aria-label="펜스 미리보기"><path d="M{HX} {HY} L{shape.path} Z" fill="rgba(34,197,94,.06)" stroke="#3a5a44" stroke-width="1.5" /></svg>
    {/if}
    {#if taken}<div class="fhint" id="parkHint">이미 있는 구장 이름이에요.</div>
    {:else if blocked}<div class="fhint" id="parkHint">이름과 좌·중·우 펜스 거리를 넣어 주세요. 거리는 30~200m예요.</div>{/if}
  {/if}
</div>
<div class="cols2">
  {#each ['away', 'home'] as const as side (side)}
    {@const list = side === 'away' ? away : home}
    {@const roster = rosterOf(side)}
    <div class="card setup">
      <label>{side === 'away' ? '원정' : '홈'} 팀 {#if side === 'away'}<input id="awayName" list="teams" autocomplete="off" bind:value={awayName} placeholder="원정" />{:else}<input id="homeName" list="teams" autocomplete="off" bind:value={homeName} placeholder="홈" />{/if}</label>
      {#if roster}<button class="loadline" id="load-{side}" onclick={() => loadLineup(side)}>지난 라인업 불러오기 · {md(roster.date)}</button>{/if}
      <datalist id="bat-{side}">{#each roster?.batters ?? [] as b}<option value={b.name}>{b.pos}</option>{/each}</datalist>
      <datalist id="pit-{side}">{#each roster?.pitchers ?? [] as p}<option value={p}></option>{/each}</datalist>
      <label>타자 수 <select class="nbat" data-side={side} value={list.length} onchange={(e) => setCount(list, +e.currentTarget.value)}>{#each COUNTS as n}<option value={n}>{n}명</option>{/each}</select></label>
      {#each list as b, i}
        <div class="lrow"><b>{i + 1}</b><input class="bname" data-side={side} list="bat-{side}" autocomplete="off" bind:value={b.name} onchange={() => knownPos(side, b)} placeholder="{i + 1}번 타자" />
          <select bind:value={b.pos}><option value="">포지션</option>{#each POSITIONS as p}<option value={p}>{p}</option>{/each}</select></div>
      {/each}
      <label>선발 투수 {#if side === 'away'}<input id="awayPitcher" list="pit-away" autocomplete="off" bind:value={awayPitcher} />{:else}<input id="homePitcher" list="pit-home" autocomplete="off" bind:value={homePitcher} />{/if}</label>
    </div>
  {/each}
</div>
<datalist id="teams">{#each teams as t}<option value={t}></option>{/each}</datalist>
<div class="nav"><button onclick={oncancel}>취소</button><button class="next" id="create" disabled={blocked} onclick={create}>기록 시작</button></div>
