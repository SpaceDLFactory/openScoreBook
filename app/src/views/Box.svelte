<script lang="ts">
  import type { Game } from '../lib/naver/parse';
  let { game }: { game: Game } = $props();
  const fin = $derived(game.pas[game.pas.length - 1].after);
  const cols = $derived(Array.from({ length: Object.keys(game.inningScore.away).length }, (_, i) => i + 1));
  const teams = $derived((['away', 'home'] as const).map((side) => {
    const L = game.lineups[side];
    const bat = [...L.batter].sort((x, y) => x.batOrder - y.batOrder || x.seqno - y.seqno);
    const sum = (k: 'ab' | 'hit' | 'rbi' | 'run' | 'bb' | 'so') => bat.reduce((t, b) => t + (+b[k] || 0), 0);
    return { side, name: side === 'away' ? game.awayName : game.homeName, bat, sum, pit: [...L.pitcher].sort((x, y) => x.seqno - y.seqno) };
  }));
</script>

<div class="h1">박스스코어</div>
<div class="sub">{game.awayName} {fin.awayScore} : {fin.homeScore} {game.homeName} · 최종</div>
<div class="card tbl"><table class="ls"><tbody>
  <tr><th>팀</th>{#each cols as c}<th>{c}</th>{/each}<th>R</th><th>H</th><th>E</th></tr>
  <tr><td>{game.awayName}</td>{#each cols as c}<td>{game.inningScore.away[c]}</td>{/each}<td class="rhe">{fin.awayScore}</td><td class="rhe">{fin.awayHit}</td><td class="rhe">{fin.awayError}</td></tr>
  <tr><td>{game.homeName}</td>{#each cols as c}<td>{game.inningScore.home[c]}</td>{/each}<td class="rhe">{fin.homeScore}</td><td class="rhe">{fin.homeHit}</td><td class="rhe">{fin.homeError}</td></tr>
</tbody></table></div>
<div class="cols2">
  {#each teams as t (t.side)}
    <div>
      <div class="sect"><span>타격 · {t.name}</span></div>
      <div class="card tbl"><table><tbody>
        <tr><th>선수</th><th>타수</th><th>안타</th><th>타점</th><th>득점</th><th>볼넷</th><th>삼진</th></tr>
        {#each t.bat as b (b.pcode)}
          <tr class:subp={b.seqno > 1}><td>{b.seqno > 1 ? '' : b.batOrder + ' '}{b.name}<span class="pos">{b.posName ?? ''}</span></td><td>{b.ab}</td><td>{b.hit}</td><td>{b.rbi}</td><td>{b.run}</td><td>{b.bb}</td><td>{b.so}</td></tr>
        {/each}
        <tr class="tot"><td>합계</td><td>{t.sum('ab')}</td><td>{t.sum('hit')}</td><td>{t.sum('rbi')}</td><td>{t.sum('run')}</td><td>{t.sum('bb')}</td><td>{t.sum('so')}</td></tr>
      </tbody></table></div>
      <div class="card tbl" style="margin-top:6px"><table><tbody>
        <tr><th>투수</th><th>이닝</th><th>투구</th><th>피안타</th><th>삼진</th><th>볼넷</th><th>자책</th></tr>
        {#each t.pit as p (p.pcode)}<tr><td>{p.name}</td><td>{p.inn}</td><td>{p.ballCount}</td><td>{p.hit}</td><td>{p.kk}</td><td>{p.bb}</td><td>{p.er}</td></tr>{/each}
      </tbody></table></div>
    </div>
  {/each}
</div>
