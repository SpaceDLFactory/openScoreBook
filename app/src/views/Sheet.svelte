<script lang="ts">
  // Traditional scorebook grid: batting slot x inning, notation per PA, a dot when that batter scored.
  import type { Game } from '../lib/naver/parse';
  import { notation, runsScored, type Note } from '../lib/notation';
  let { game, onpick }: { game: Game; onpick: (i: number) => void } = $props();
  const fin = $derived(game.pas[game.pas.length - 1].after);
  const inns = $derived(Array.from({ length: Math.max(...game.pas.map((p) => p.inn)) }, (_, i) => i + 1));
  const sides = $derived.by(() => {
    const order: Record<string, number> = {};
    for (const side of ['away', 'home'] as const) for (const b of game.lineups[side].batter) order[b.pcode] = b.batOrder;
    const scored = runsScored(game);
    return (['away', 'home'] as const).map((side) => {
      const top = side === 'away', L = game.lineups[side];
      const cells: Record<string, (Note & { run: boolean; i: number })[]> = {};
      game.pas.forEach((pa, i) => {
        if (pa.top !== top) return;
        const no = notation(pa);
        if (!no) return;
        const slot = order[pa.batter] || +pa.title.split('번')[0];
        const run = !!scored[pa.inn + (top ? 't' : 'b')]?.includes(game.names[pa.batter]);
        (cells[slot + ':' + pa.inn] ??= []).push({ ...no, run, i });
      });
      const slots = Array.from({ length: Math.max(9, ...L.batter.map((b) => b.batOrder)) }, (_, k) => {
        const ps = L.batter.filter((b) => b.batOrder === k + 1).sort((x, y) => x.seqno - y.seqno);
        const sum = (key: 'ab' | 'hit' | 'rbi') => ps.reduce((t, b) => t + (+b[key] || 0), 0);
        return { slot: k + 1, ps, ab: sum('ab'), hit: sum('hit'), rbi: sum('rbi') };
      });
      return { side, top, name: top ? game.awayName : game.homeName, cells, slots, is: game.inningScore[side], total: top ? fin.awayScore : fin.homeScore };
    });
  });
</script>

<div class="h1">기록지</div>
<div class="sub">{game.awayName} {fin.awayScore} : {fin.homeScore} {game.homeName}</div>
{#each sides as s (s.side)}
  <div class="sect"><span>{s.top ? '원정' : '홈'} · {s.name}</span></div>
  <div class="card sheet"><table>
    <tbody>
    <tr><th class="nmh">타순</th>{#each inns as i}<th>{i}</th>{/each}<th>타수</th><th>안타</th><th>타점</th></tr>
    {#each s.slots as r (r.slot)}
      <tr>
        <td class="nm"><b>{r.slot}</b> {#each r.ps as b, j}{#if j}<span class="subn">{b.name}</span>{:else}{b.name}<span class="pos">{b.posName ?? ''}</span>{/if}{/each}</td>
        {#each inns as i}
          <td class="cell">{#each s.cells[r.slot + ':' + i] ?? [] as c}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span class="nt {c.k}" data-pa={c.i} onclick={() => onpick(c.i)}>{c.c}{#if c.run}<em></em>{/if}</span>
          {/each}</td>
        {/each}
        <td>{r.ab}</td><td>{r.hit}</td><td>{r.rbi}</td>
      </tr>
    {/each}
    <tr class="tot"><td class="nm">득점</td>{#each inns as i}<td>{s.is[i] ?? ''}</td>{/each}<td colspan="3">{s.total}점</td></tr>
    </tbody>
  </table></div>
{/each}
<div class="sheetleg"><span class="nt hit">1B</span>안타 <span class="nt walk">BB</span>볼넷·사구 <span class="nt out">6-3</span>아웃 <span class="nt er">E6</span>실책·야선 <span class="nt hit">1B<em></em></span>득점 · 칸을 누르면 그 타석으로 이동</div>
