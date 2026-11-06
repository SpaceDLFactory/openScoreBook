<script lang="ts">
  import { isOver, pickSource, type GameSource } from './lib/source';
  import type { Game, ResClass } from './lib/naver/parse';
  import type { NaverGameMeta } from './lib/naver/types';
  import { legacyLandings } from './lib/landings';
  import { eventsFromLegacy, foldLandings, newId, type GameEvent, type LandingEvent } from './lib/events';
  import * as store from './lib/store';
  import { isManualId, isView, type View } from './lib/views';
  import { engineEvents, manualGame, resolve, type ManualEvent, type Now, type Setup as GameSetup } from './lib/manual';
  import { deriveSteps } from './lib/engine';
  import Tabs from './components/Tabs.svelte';
  import GameSelect from './components/GameSelect.svelte';
  import Chart from './views/Chart.svelte';
  import Sheet from './views/Sheet.svelte';
  import Log from './views/Log.svelte';
  import Box from './views/Box.svelte';
  import Pitcher from './views/Pitcher.svelte';
  import WinProb from './views/WinProb.svelte';
  import Score from './views/Score.svelte';
  import Setup from './views/Setup.svelte';

  let source: GameSource;
  const LAST_GAME = 'scorebook:game';

  let games = $state<NaverGameMeta[]>([]);
  let game = $state<Game | null>(null);
  let events = $state<GameEvent[]>([]);
  const landings = $derived(foldLandings(events));
  let saveError = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let now = $state<Now | null>(null); // manual games: the situation for the input screen
  let loaded = $state(false);
  const manual = $derived(!!game && isManualId(game.gameId));
  let idx = $state(0);
  let view = $state<View>('chart');
  let error = $state<string | null>(null);

  const WIDE = matchMedia('(min-width: 1024px)');
  let wide = $state(WIDE.matches);
  WIDE.addEventListener('change', () => (wide = WIDE.matches));
  $effect(() => { document.body.classList.toggle('wide', wide); });

  const fin = $derived(game ? (game.pas.at(-1)?.after ?? { awayScore: now?.awayScore ?? 0, homeScore: now?.homeScore ?? 0 }) : null);

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

  /** Fold a manual game's edits through the engine into the Game the views read. */
  async function manualFrom(id: string, evs: GameEvent[]) {
    const edits = evs.filter((e) => e.kind.startsWith('m.')) as unknown as ManualEvent[];
    const ee = engineEvents(resolve(edits));
    return manualGame(id, edits, await deriveSteps(ee.config, ee.events));
  }

  async function openGame(id: string, first = false) {
    const g = isManualId(id) ? null : await source.loadGame(id);
    try { localStorage.setItem(LAST_GAME, id); } catch { /* private mode */ }
    let evs = await store.gameEvents(id);
    if (!g) {
      const m = await manualFrom(id, evs);
      events = evs; idx = Math.max(0, m.game.pas.length - 1); now = m.now; game = m.game; view = 'score';
      if (first) readHash(m.game);
      return;
    }
    now = null;
    if (!evs.length) {
      // first open since the event log: carry over what the prototype stored in localStorage (left in place)
      const legacy = eventsFromLegacy(id, legacyLandings(id));
      if (legacy.length) { await store.append(legacy); evs = await store.gameEvents(id); }
    }
    events = evs;
    idx = 0;
    game = g;
    if (g.meta && !games.some((x) => x.gameId === id)) games = [g.meta, ...games];
    if (first) readHash(g);
  }

  (async () => {
    await store.flushPending();
    source = await pickSource();
    games = [...(await store.manualSetups()).map(manualMeta), ...(await source.listGames())];
    // ?game= opens that game even when the list doesn't have it (e.g. an older game through the relay server)
    let pick = new URLSearchParams(location.search).get('game');
    if (!pick) {
      try { pick = localStorage.getItem(LAST_GAME); } catch { /* private mode */ }
      if (games.length && !games.some((g) => g.gameId === pick)) pick = games[0].gameId;
    }
    if (!pick) throw new Error('경기 데이터가 없어요. 먼저 중계 데이터를 받아 주세요.');
    // the last game may not be loadable (offline and never cached): fall back to the others
    let firstErr: unknown = null;
    for (const id of [pick, ...games.map((g) => g.gameId).filter((id) => id !== pick)]) {
      try { await openGame(id, true); if (firstErr) notice = (firstErr as Error).message; return; } catch (e) { firstErr ??= e; }
    }
    throw firstErr;
  })().catch((e) => (error = e.message)).finally(() => (loaded = true));

  // A game in progress is reloaded every 15 s. Someone looking at the latest PA follows the new ones.
  const POLL_MS = 15_000;
  const live = $derived(!!game && !manual && !isOver(game.meta?.statusCode));
  $effect(() => {
    if (!live || !game) return;
    const id = game.gameId;
    const t = setInterval(async () => {
      try {
        const g = await source.loadGame(id);
        if (game?.gameId !== id) return;
        const follow = idx === game.pas.length - 1;
        game = g;
        if (follow) idx = g.pas.length - 1;
      } catch { /* offline or relay hiccup: try again next tick */ }
    }, POLL_MS);
    return () => clearInterval(t);
  });

  function switchGame(id: string) {
    scrollTo(0, 0);
    notice = null;
    // keep the current game on screen when the other one can't be loaded (e.g. offline and never opened)
    openGame(id).catch((e) => (notice = e.message));
  }
  // ---- manual scoring
  function manualMeta(e: GameEvent): NaverGameMeta {
    const s = (e as unknown as { setup: GameSetup }).setup;
    return { gameId: e.gameId, gameDate: s.date, stadium: s.stadium, awayTeamName: s.awayName, homeTeamName: s.homeName, statusCode: 'MANUAL' };
  }
  async function createGame(setup: GameSetup) {
    const id = `m-${Date.now().toString(36)}`;
    const ev = { kind: 'm.setup', setup: $state.snapshot(setup), id: newId(), gameId: id, at: Date.now() } as GameEvent;
    await store.record(ev).catch((err) => (saveError = `기록 저장 실패: ${err?.message ?? err}`));
    games = [manualMeta(ev), ...games];
    await openGame(id);
  }
  async function recordManual(list: ManualEvent[]) {
    if (!game) return;
    const id = game.gameId;
    for (const e of list) {
      // plain copy: values bound in the input screen are Svelte proxies, which IndexedDB can't clone
      const ev = { ...$state.snapshot(e), id: newId(), gameId: id, at: Date.now() } as GameEvent;
      events.push(ev);
      store.record(ev).then(() => (saveError = null), (err) => (saveError = `기록 저장 실패: ${err?.message ?? err}`));
    }
    const m = await manualFrom(id, $state.snapshot(events) as GameEvent[]);
    if (game?.gameId !== id) return;
    now = m.now; game = m.game; idx = Math.max(0, m.game.pas.length - 1);
  }
  function undoManual() {
    const edits = resolve(events.filter((e) => e.kind.startsWith('m.')) as unknown as ManualEvent[]);
    const last = edits.at(-1);
    if (!last || last.kind === 'm.setup') return;
    // an automatic walk/strikeout goes back together with the pitch that made it
    recordManual(last.kind === 'm.pa' && last.auto ? [{ kind: 'm.undo' }, { kind: 'm.undo' }] : [{ kind: 'm.undo' }]);
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
    // a failed write stays queued and is retried with the next edit; the banner clears once one lands
    store.record(ev).then(() => (saveError = null), (err) => (saveError = `기록 저장 실패: ${err?.message ?? err}`));
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
{#if notice}<div class="err" id="notice">{notice}</div>{/if}
{#if view === 'setup'}
  <main class={wide ? 'dmain' : ''}><Setup oncreate={createGame} oncancel={() => (view = game ? (manual ? 'score' : 'chart') : 'chart')} /></main>
{:else if error}
  <div class="err">{error}</div>
{:else if game && fin}
  {#if wide}
    <header class="dhead">
      <div class="dtitle"><b>{game.awayName} {fin.awayScore} : {fin.homeScore} {game.homeName}{#if live} <span class="live">LIVE</span>{/if}</b><span>{[game.meta?.gameDate, game.stadium, manual ? '직접 기록' : ''].filter(Boolean).join(' · ')}</span></div>
      <GameSelect {games} current={game.gameId} onchange={switchGame} />
      <button class="newgame" id="newgame" onclick={() => (view = 'setup')}>＋ 새 기록</button>
      <Tabs {view} {manual} onselect={select} />
    </header>
  {:else}
    <div class="gbar">{#if live}<span class="live">LIVE</span>{/if}<GameSelect {games} current={game.gameId} onchange={switchGame} /><button class="newgame" id="newgame" onclick={() => (view = 'setup')}>＋ 새 기록</button></div>
  {/if}

  {#if view === 'score' && manual && now}
    <main class={wide ? 'dmain' : ''}><Score {game} {now} onrecord={recordManual} onundo={undoManual} /></main>
  {:else if !game.pas.length}
    <div class="empty">아직 기록한 타석이 없어요.{#if manual} <b>기록</b> 탭에서 시작해요.{/if}</div>
  {:else if view === 'chart'}
    <Chart {game} {idx} {landings} {wide} ongo={go} ontap={tap} onundo={undo} onclear={clear} onres={setRes} ontraj={setTraj} onexport={exportJSON} />
  {:else}
    <main class={wide ? `dmain v-${view}` : ''}>
      {#if view === 'sheet'}<Sheet {game} onpick={pick} />
      {:else if view === 'log'}<Log {game} onpick={pick} />
      {:else if view === 'box'}<Box {game} />
      {:else if view === 'pitcher'}<Pitcher {game} />
      {:else if view === 'wp' && !manual}<WinProb {game} onpick={pick} />{/if}
    </main>
  {/if}

  {#if !wide}<Tabs {view} {manual} onselect={select} />{/if}
{:else if loaded}
  <div class="empty">경기가 없어요. <button class="newgame" id="newgame" onclick={() => (view = 'setup')}>＋ 새 기록</button></div>
{/if}
