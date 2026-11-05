<script lang="ts">
  import { fixtureSource } from './lib/source';
  import type { Game, ResClass } from './lib/naver/parse';
  import type { NaverGameMeta } from './lib/naver/types';
  import { legacyLandings } from './lib/landings';
  import { eventsFromLegacy, foldLandings, newId, type GameEvent, type LandingEvent } from './lib/events';
  import * as store from './lib/store';
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
  let events = $state<GameEvent[]>([]);
  const landings = $derived(foldLandings(events));
  let saveError = $state<string | null>(null);
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
    let evs = await store.gameEvents(id);
    if (!evs.length) {
      // first open since the event log: carry over what the prototype stored in localStorage (left in place)
      const legacy = eventsFromLegacy(id, legacyLandings(id));
      if (legacy.length) { await store.append(legacy); evs = await store.gameEvents(id); }
    }
    events = evs;
    idx = 0;
    game = g;
    if (first) readHash(g);
  }

  (async () => {
    await store.flushPending();
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

  // ---- landing edits (current PA): append to the log; the view folds it
  const pa = $derived(game?.pas[idx]);
  function record(e: LandingEvent) {
    if (!game) return;
    const ev: GameEvent = { ...e, id: newId(), gameId: game.gameId, at: Date.now() };
    events.push(ev);
    store.record(ev).catch((err) => (saveError = `기록 저장 실패: ${err?.message ?? err}`));
  }
  function tap([x, y]: [number, number]) {
    if (!pa) return;
    if (landings[pa.no]) record({ kind: 'landing.path', pa: pa.no, x, y });
    else record({ kind: 'landing.set', pa: pa.no, x, y, res: pa.res, inn: pa.inn, batter: pa.batter, result: pa.result });
  }
  function undo() { if (pa && landings[pa.no]) record({ kind: 'landing.undo', pa: pa.no }); }
  function clear() { if (pa && landings[pa.no]) record({ kind: 'landing.clear', pa: pa.no }); }
  function setRes(r: ResClass) { if (pa && landings[pa.no]) record({ kind: 'landing.res', pa: pa.no, res: r, manual: r !== pa.res }); }
  function setTraj(t: string) { if (pa && landings[pa.no]) record({ kind: 'landing.traj', pa: pa.no, traj: t }); }
  function exportJSON() {
    const data = { gameId: game?.gameId, landings, events: $state.snapshot(events) };
    return navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => true, () => false);
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

{#if saveError}<div class="err">{saveError}</div>{/if}
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
