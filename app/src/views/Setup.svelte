<script lang="ts">
  // New manually scored game: teams, park, batting orders and starting pitchers.
  import type { Player, Setup } from '../lib/manual';
  import { POS_NAME } from '../lib/manual';
  import { STADIUMS } from '../lib/stadiums';
  let { oncreate, oncancel }: { oncreate: (s: Setup) => void; oncancel: () => void } = $props();
  const POSITIONS = [...POS_NAME.slice(1), '지명타자'];
  const today = new Date().toISOString().slice(0, 10);
  let date = $state(today), stadium = $state('대구'), awayName = $state(''), homeName = $state('');
  const blank = () => Array.from({ length: 9 }, () => ({ name: '', pos: '' }));
  let away = $state(blank()), home = $state(blank());
  let awayPitcher = $state(''), homePitcher = $state('');
  function create() {
    const t = (side: 'away' | 'home', list: { name: string; pos: string }[], label: string): Player[] =>
      list.map((b, i) => ({ id: `${side[0]}${i + 1}-${Date.now().toString(36)}`, name: b.name.trim() || `${label}${i + 1}번`, pos: b.pos }));
    const a = awayName.trim() || '원정', h = homeName.trim() || '홈';
    oncreate({
      date, stadium, awayName: a, homeName: h, away: t('away', away, a), home: t('home', home, h),
      awayPitcher: { id: `ap-${Date.now().toString(36)}`, name: awayPitcher.trim() || `${a} 선발`, pos: '투수' },
      homePitcher: { id: `hp-${Date.now().toString(36)}`, name: homePitcher.trim() || `${h} 선발`, pos: '투수' },
    });
  }
</script>

<div class="h1">새 기록</div>
<div class="sub">이름을 비워 두면 "팀 N번"으로 채워요. 나중에 교체로 바꿀 수 있어요.</div>
<div class="card setup">
  <label>날짜 <input type="date" bind:value={date} /></label>
  <label>구장 <select bind:value={stadium}>{#each Object.keys(STADIUMS) as k}<option value={k}>{k}</option>{/each}<option value="">기타</option></select></label>
</div>
<div class="cols2">
  {#each ['away', 'home'] as const as side (side)}
    {@const list = side === 'away' ? away : home}
    <div class="card setup">
      <label>{side === 'away' ? '원정' : '홈'} 팀 {#if side === 'away'}<input id="awayName" bind:value={awayName} placeholder="원정" />{:else}<input id="homeName" bind:value={homeName} placeholder="홈" />{/if}</label>
      {#each list as b, i}
        <div class="lrow"><b>{i + 1}</b><input class="bname" data-side={side} bind:value={b.name} placeholder="{i + 1}번 타자" />
          <select bind:value={b.pos}><option value="">포지션</option>{#each POSITIONS as p}<option value={p}>{p}</option>{/each}</select></div>
      {/each}
      <label>선발 투수 {#if side === 'away'}<input bind:value={awayPitcher} />{:else}<input bind:value={homePitcher} />{/if}</label>
    </div>
  {/each}
</div>
<div class="nav"><button onclick={oncancel}>취소</button><button class="next" id="create" onclick={create}>기록 시작</button></div>
