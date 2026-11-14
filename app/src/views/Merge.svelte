<script lang="ts">
  // Several records of one game merged by vote: how much was settled, how each scorer did, and what is in dispute.
  import { FIELDS, type Consensus } from '../lib/consensus';
  let { c, labels, check, onsave, onclose }: {
    c: Consensus;
    /** what each source is, by its letter */
    labels: { label: string; text: string }[];
    /** the merged game replayed: plate appearances and problems the engine found */
    check: { pas: number; issues: string[]; score: string };
    onsave: () => Promise<void>; onclose: () => void;
  } = $props();
  let saving = $state(false);
  const pct = (a: number, b: number) => (b ? `${Math.floor((100 * a) / b)}%` : '–');
  const fields = $derived(FIELDS.filter((f) => c.settled[f].both));
  const ok = $derived(!check.issues.length);
</script>

<div class="h1">기록 합의</div>
<div class="sub">{#each labels as l}{l.label} · {l.text}<br />{/each}</div>
<div class="card cmp-score">
  <span>합의 기록</span><b class:off={!ok}>{check.pas}타석 · {check.score}</b>
</div>
{#if !ok}<div class="err">합의 기록을 다시 계산하니 맞지 않는 곳이 있어요: {check.issues.join(' · ')}</div>{/if}

<div class="sect"><span>합의된 비율 · 둘 이상이 기록한 값 중</span></div>
<div class="card cmp-stats">
  {#each fields as f}
    <div class="cmp-stat"><span>{f}</span><b class:off={c.settled[f].agree < c.settled[f].both}>{pct(c.settled[f].agree, c.settled[f].both)}</b><em>{c.settled[f].agree} / {c.settled[f].both}</em></div>
  {/each}
</div>

<div class="sect"><span>기록자별 · 합의 값과 같은 비율</span></div>
{#if c.scorers.length === 2}<div class="sub">기록이 둘이면 서로 다른 값은 누가 맞는지 정할 수 없어서, 둘 다 100%로 나와요.</div>{/if}
<div class="card cmp-stats">
  {#each c.scorers as s}
    <div class="cmp-stat"><span>{s.label}</span><b class:off={s.agree < s.total}>{pct(s.agree, s.total)}</b><em>{s.agree} / {s.total}</em></div>
  {/each}
</div>

<div class="sect"><span>{c.disputes.length ? `합의 안 된 값 ${c.disputes.length}개` : '합의 안 된 값 없음'}</span></div>
{#if c.disputes.length}<div class="sub">저장하면 그 타석을 가장 잘 맞힌 기록의 값을 그대로 써요.</div>{/if}
{#if c.disputes.length}
  <div class="card cmp-rows">
    {#each c.disputes as d}
      <div class="cmp-row">
        <div class="cmp-pa">{d.inn}회{d.top ? '초' : '말'} · {d.title} · {d.field}</div>
        <div class="cmp-d">{d.values.map((v) => `${v.label} ${v.value}`).join(' · ')}</div>
      </div>
    {/each}
  </div>
{/if}
<div class="nav">
  <button onclick={onclose}>닫기</button>
  <button class="next" id="mergeSave" disabled={saving || !ok} onclick={async () => { saving = true; try { await onsave(); } finally { saving = false; } }}>합의 기록 저장</button>
</div>
