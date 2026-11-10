<script lang="ts">
  // New manually scored game: teams, park, batting orders and starting pitchers.
  import type { Player, Setup } from '../lib/manual';
  import { POS_NAME } from '../lib/manual';
  import { STADIUMS, customFence, fenceOk, type Park } from '../lib/stadiums';
  import { FH, FW, HX, HY, fieldOf } from '../lib/field';
  let { parks, oncreate, oncancel }: { parks: Park[]; oncreate: (s: Setup) => void; oncancel: () => void } = $props();
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
  const NEW_PARK = '__new', FENCE_LABELS = ['좌', '좌중', '중', '우중', '우'];
  let parkName = $state(''), dist = $state<(number | null)[]>([null, null, null, null, null]);
  const isNew = $derived(stadium === NEW_PARK);
  const newName = $derived(parkName.trim());
  const newDist = $derived(dist.map((v) => (typeof v === 'number' ? v : null)));
  const taken = $derived(newName === '기타' || newName === NEW_PARK || newName in STADIUMS);
  const shape = $derived(fenceOk(newDist) ? fieldOf(customFence(newDist)) : null);
  const blocked = $derived(isNew && (!newName || taken || !shape));
  function create() {
    const t = (side: 'away' | 'home', list: { name: string; pos: string }[], label: string): Player[] =>
      list.map((b, i) => ({ id: `${side[0]}${i + 1}-${Date.now().toString(36)}`, name: b.name.trim() || `${label}${i + 1}번`, pos: b.pos }));
    const a = awayName.trim() || '원정', h = homeName.trim() || '홈';
    const fence = isNew ? newDist : parks.find((p) => p.name === stadium)?.fence;
    oncreate({
      date, stadium: isNew ? newName : stadium, ...(fence && { fence }), awayName: a, homeName: h, away: t('away', away, a), home: t('home', home, h),
      awayPitcher: { id: `ap-${Date.now().toString(36)}`, name: awayPitcher.trim() || `${a} 선발`, pos: '투수' },
      homePitcher: { id: `hp-${Date.now().toString(36)}`, name: homePitcher.trim() || `${h} 선발`, pos: '투수' },
    });
  }
</script>

<div class="h1">새 기록</div>
<div class="sub">이름을 비워 두면 "팀 N번"으로 채워요. 나중에 교체로 바꿀 수 있어요.</div>
<div class="card setup">
  <label>날짜 <input type="date" bind:value={date} /></label>
  <label>구장 <select id="stadium" bind:value={stadium}>{#each parks as p (p.name)}<option value={p.name}>{p.name}</option>{/each}{#each Object.keys(STADIUMS) as k}<option value={k}>{k}</option>{/each}<option value="">기타</option><option value={NEW_PARK}>직접 입력</option></select></label>
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
    <div class="card setup">
      <label>{side === 'away' ? '원정' : '홈'} 팀 {#if side === 'away'}<input id="awayName" bind:value={awayName} placeholder="원정" />{:else}<input id="homeName" bind:value={homeName} placeholder="홈" />{/if}</label>
      <label>타자 수 <select class="nbat" data-side={side} value={list.length} onchange={(e) => setCount(list, +e.currentTarget.value)}>{#each COUNTS as n}<option value={n}>{n}명</option>{/each}</select></label>
      {#each list as b, i}
        <div class="lrow"><b>{i + 1}</b><input class="bname" data-side={side} bind:value={b.name} placeholder="{i + 1}번 타자" />
          <select bind:value={b.pos}><option value="">포지션</option>{#each POSITIONS as p}<option value={p}>{p}</option>{/each}</select></div>
      {/each}
      <label>선발 투수 {#if side === 'away'}<input bind:value={awayPitcher} />{:else}<input bind:value={homePitcher} />{/if}</label>
    </div>
  {/each}
</div>
<div class="nav"><button onclick={oncancel}>취소</button><button class="next" id="create" disabled={blocked} onclick={create}>기록 시작</button></div>
