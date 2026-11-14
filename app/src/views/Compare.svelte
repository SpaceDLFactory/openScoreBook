<script lang="ts">
  // Two records of one game: how far they agree, and each plate appearance where they don't.
  import { LANDING_TOL, SPEED_TOL, type Comparison, type Row, type Tally } from '../lib/compare';
  let { c, labelA, labelB, onclose }: { c: Comparison; labelA: string; labelB: string; onclose: () => void } = $props();
  let all = $state(false);
  const shown = $derived(all ? c.rows : c.rows.filter((r) => r.diffs.length));
  // rounded down: 100% only when every one agrees
  const pct = (t: Tally) => (t.both ? `${Math.floor((100 * t.agree) / t.both)}%` : '–');
  const of = (t: Tally) => (t.both ? `${t.agree} / ${t.both}` : '둘 다 기록한 것 없음');
  const who = (r: Row) => (r.a ?? r.b)!.title;
  const s = $derived(c.stats);
  const lines: [string, Tally, string][] = $derived([
    ['타석 결과', s.pa, s.pa.onlyA || s.pa.onlyB ? `A에만 ${s.pa.onlyA} · B에만 ${s.pa.onlyB}` : ''],
    ['투구 수', s.pitchCount, ''],
    ['판정', s.call, ''],
    ['코스', s.zone, ''],
    ['구종', s.stuff, ''],
    ['구속', s.speed, s.speed.meanDiff != null ? `±${SPEED_TOL}km/h · 평균 차 ${s.speed.meanDiff.toFixed(1)}` : ''],
    ['낙구지점', s.landing, s.landing.median != null ? `${LANDING_TOL}m 안 · 중앙값 ${s.landing.median.toFixed(1)}m` : ''],
  ]);
</script>

<div class="h1">기록 비교</div>
<div class="sub">A · {labelA}<br />B · {labelB}</div>
<div class="card cmp-score">
  <span>최종 점수</span><b class:off={c.score.a.join() !== c.score.b.join()}>A {c.score.a.join(' : ')} · B {c.score.b.join(' : ')}</b>
</div>
<div class="card cmp-stats">
  {#each lines as [name, t, note]}
    <div class="cmp-stat"><span>{name}</span><b class:off={t.both > 0 && t.agree < t.both}>{pct(t)}</b><em>{of(t)}{note ? ` · ${note}` : ''}</em></div>
  {/each}
</div>
<div class="sect cmp-head">
  <span>{all ? '모든 타석' : `다른 타석 ${shown.length}개`}</span>
  <button class="x" id="cmpAll" onclick={() => (all = !all)}>{all ? '다른 것만' : '모두 보기'}</button>
</div>
<div class="card cmp-rows">
  {#each shown as r}
    <div class="cmp-row" class:same={!r.diffs.length}>
      <div class="cmp-pa">{r.inn}회{r.top ? '초' : '말'} · {who(r)}</div>
      {#each r.diffs as d}<div class="cmp-d">{d}</div>{:else}<div class="cmp-d ok">일치</div>{/each}
    </div>
  {:else}
    <div class="cmp-row same"><div class="cmp-d ok">두 기록이 모든 타석에서 같아요.</div></div>
  {/each}
</div>
<div class="nav"><button onclick={onclose}>닫기</button></div>
