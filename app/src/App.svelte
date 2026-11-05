<script lang="ts">
  import { fixtureSource } from './lib/source';
  import type { Game, ResClass } from './lib/naver/parse';
  import type { NaverGameMeta } from './lib/naver/types';
  import { loadLandings, saveLandings, type Landings } from './lib/landings';
  import { isView, type View } from './lib/views';
  import Tabs from './components/Tabs.svelte';
  import GameSelect from './components/GameSelect.svelte';
  import Chart from './views/Chart.svelte';
  import Sheet from './views/Sheet.svelte';
  import Log from './views/Log.svelte';
  import Box from './views/Box.svelte';
  import Pitcher from './views/Pitcher.svelte';
  import WinProb from './views/WinProb.svelte';

  const source = fixtureSource();
  const LAST_GAME = 'scorebook:game';

  let games = $state<NaverGameMeta[]>([]);
  let game = $state<Game | null>(null);
  let landings = $state<Landings>({});
  let idx = $state(0);
  let view = $state<View>('chart');
  let error = $state<string | null>(null);

  const WIDE = matchMedia('(min-width: 1024px)');
  let wide = $state(WIDE.matches);
  WIDE.addEventListener('change', () => (wide = WIDE.matches));
  $effect(() => { document.body.classList.toggle('wide', wide); });

  const fin = $derived(game ? game.pas[game.pas.length - 1].after : null);

  // #pa-12 (chart at a PA) or #log, #box, ... (other views)
  function readHash(g: Game) {
    const m = location.hash.match(/^#pa-(\d+)$/);
    if (m) { view = 'chart'; idx = Math.min(+m[1], g.pas.length - 1); return; }
    const v = location.hash.slice(1);
    if (isView(v) && v !== 'chart') view = v;
  }
  $effect(() => {
    if (!game) return;
    const h = view === 'chart' ? `#pa-${idx}` : `#${view}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  });

  async function openGame(id: string, first = false) {
    const g = await source.loadGame(id);
    try { localStorage.setItem(LAST_GAME, id); } catch { /* private mode */ }
    landings = loadLandings(id);
    idx = 0;
    game = g;
    if (first) readHash(g);
  }

  (async () => {
    games = await source.listGames();
    let pick = new URLSearchParams(location.search).get('game');
    if (!pick) { try { pick = localStorage.getItem(LAST_GAME); } catch { /* private mode */ } }
    if (games.length && !games.some((g) => g.gameId === pick)) pick = games[0].gameId;
    if (!pick) throw new Error('경기 데이터가 없어요. tools/naver_relay.py relay <gameId> 로 먼저 받아 주세요.');
    await openGame(pick, true);
  })().catch((e) => (error = e.message));

  function switchGame(id: string) {
    scrollTo(0, 0);
    openGame(id).catch((e) => (error = e.message));
  }
  function go(i: number) { if (game) idx = Math.max(0, Math.min(game.pas.length - 1, i)); }
  function pick(i: number) { go(i); view = 'chart'; scrollTo(0, 0); }
  function select(v: View) { view = v; scrollTo(0, 0); }

  // ---- landing edits (current PA)
  const pa = $derived(game?.pas[idx]);
  function persist() { if (game) saveLandings(game.gameId, $state.snapshot(landings) as Landings); }
  function tap(pt: [number, number]) {
    if (!pa) return;
    const cur = landings[pa.no];
    if (cur) cur.path.push(pt);
    else landings[pa.no] = { unit: 'm', x: pt[0], y: pt[1], path: [], res: pa.res, inn: pa.inn, batter: pa.batter, result: pa.result, at: Date.now() };
    persist();
  }
  function undo() {
    if (!pa) return;
    const v = landings[pa.no];
    if (v?.path.length) v.path.pop(); else delete landings[pa.no];
    persist();
  }
  function clear() { if (pa) { delete landings[pa.no]; persist(); } }
  function setRes(r: ResClass) { const v = pa && landings[pa.no]; if (v) { v.res = r; v.resManual = r !== pa.res; persist(); } }
  function setTraj(t: string) { const v = pa && landings[pa.no]; if (v) { v.traj = t; persist(); } }
  function exportJSON() {
    return navigator.clipboard.writeText(JSON.stringify({ gameId: game?.gameId, landings }, null, 2)).then(() => true, () => false);
  }

  function onkey(e: KeyboardEvent) {
    if (!game || view !== 'chart' || (e.target as HTMLElement).closest?.('input,textarea,select')) return;
    const nextInPlay = () => { const j = game!.pas.findIndex((p, i) => i > idx && p.inPlay); return j < 0 ? game!.pas.length - 1 : j; };
    const to = e.key === 'ArrowLeft' ? idx - 1 : e.key === 'ArrowRight' ? idx + 1 : e.key === 'n' || e.key === 'N' ? nextInPlay() : null;
    if (to == null) return;
    e.preventDefault();
    go(to);
  }
</script>

<svelte:window onkeydown={onkey} />

{#if error}
  <div class="err">{error}</div>
{:else if game && fin}
  {#if wide}
    <header class="dhead">
      <div class="dtitle"><b>{game.awayName} {fin.awayScore} : {fin.homeScore} {game.homeName}</b><span>{[game.meta?.gameDate, game.stadium].filter(Boolean).join(' · ')}</span></div>
      <GameSelect {games} current={game.gameId} onchange={switchGame} />
      <Tabs {view} onselect={select} />
    </header>
  {:else if games.length > 1}
    <div class="gbar"><GameSelect {games} current={game.gameId} onchange={switchGame} /></div>
  {/if}

  {#if view === 'chart'}
    <Chart {game} {idx} {landings} {wide} ongo={go} ontap={tap} onundo={undo} onclear={clear} onres={setRes} ontraj={setTraj} onexport={exportJSON} />
  {:else}
    <main class={wide ? `dmain v-${view}` : ''}>
      {#if view === 'sheet'}<Sheet {game} onpick={pick} />
      {:else if view === 'log'}<Log {game} onpick={pick} />
      {:else if view === 'box'}<Box {game} />
      {:else if view === 'pitcher'}<Pitcher {game} />
      {:else if view === 'wp'}<WinProb {game} onpick={pick} />{/if}
    </main>
  {/if}

  {#if !wide}<Tabs {view} onselect={select} />{/if}
{/if}
