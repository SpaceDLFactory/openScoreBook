// IndexedDB event store: one append-only object store, indexed by game.
import type { GameEvent } from './events';

const DB = 'scorebook', VERSION = 1, EVENTS = 'events';
let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(EVENTS, { keyPath: 'seq', autoIncrement: true }).createIndex('gameId', 'gameId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { db = null; reject(req.error); };
  }));
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** A game's events in log order. */
export async function gameEvents(gameId: string): Promise<GameEvent[]> {
  const tx = (await open()).transaction(EVENTS, 'readonly');
  const all = await done(tx.objectStore(EVENTS).index('gameId').getAll(gameId) as IDBRequest<GameEvent[]>);
  return all.sort((a, b) => a.seq! - b.seq!);
}

/** Setup events of the manually scored games, newest first. */
export async function manualSetups(): Promise<GameEvent[]> {
  const tx = (await open()).transaction(EVENTS, 'readonly');
  const all = await done(tx.objectStore(EVENTS).getAll() as IDBRequest<GameEvent[]>);
  return all.filter((e) => e.kind === 'm.setup').sort((a, b) => b.at - a.at);
}

/** Every stored event in log order. */
export async function allEvents(): Promise<GameEvent[]> {
  const tx = (await open()).transaction(EVENTS, 'readonly');
  const all = await done(tx.objectStore(EVENTS).getAll() as IDBRequest<GameEvent[]>);
  return all.sort((a, b) => a.seq! - b.seq!);
}

/** The events this browser doesn't have yet (matched by id). */
export async function missing(events: GameEvent[]): Promise<GameEvent[]> {
  await flushPending();
  const have = new Set((await allEvents()).map((e) => e.id));
  return events.filter((e) => !have.has(e.id) && have.add(e.id));
}

/** Store the events this browser doesn't have yet, in the given order; returns those. Runs after queued edits, and
 *  checks and adds in one transaction, so a second restore (or another tab) can't add an event twice. */
export function importEvents(events: GameEvent[]): Promise<GameEvent[]> {
  let added: GameEvent[] = [];
  return serial(async () => {
    await drain();
    const tx = (await open()).transaction(EVENTS, 'readwrite'), store = tx.objectStore(EVENTS);
    const todo: GameEvent[] = [];
    const req = store.getAll() as IDBRequest<GameEvent[]>;
    req.onsuccess = () => {
      const have = new Set(req.result.map((e) => e.id));
      for (const e of events) if (!have.has(e.id)) { have.add(e.id); todo.push(e); store.add(e); }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    added = todo;
  }).then(() => added);
}

/** Append events in one transaction, in order; resolves once they are durable. A failing request aborts the
 *  transaction, so either all of them are stored or none. */
export async function append(events: GameEvent[]): Promise<void> {
  const tx = (await open()).transaction(EVENTS, 'readwrite'), store = tx.objectStore(EVENTS);
  for (const e of events) store.add(e);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

// Write-ahead queue: every edit goes into it first (kept in memory and mirrored to localStorage, whose setItem is
// synchronous, so a page closed before IndexedDB commits loses nothing). Writes run one at a time and always
// store the whole queue in order, so an edit that failed is retried before any later one lands.
const PENDING = 'scorebook:pending';
let queue: GameEvent[] | null = null;
const pending = (): GameEvent[] => {
  if (!queue) { try { queue = JSON.parse(localStorage.getItem(PENDING) || '[]'); } catch { queue = []; } }
  return queue!;
};
function mirror(): boolean {
  try { localStorage.setItem(PENDING, JSON.stringify(pending())); return true; } catch { return false; }
}
let chain: Promise<void> = Promise.resolve();
const serial = (job: () => Promise<void>) => (chain = chain.catch(() => {}).then(job));

async function drain() {
  const batch = [...pending()];
  if (!batch.length) return;
  // skip edits already stored (a write that committed just before the page closed)
  const have = new Set<string>();
  for (const gid of new Set(batch.map((e) => e.gameId))) for (const e of await gameEvents(gid)) have.add(e.id);
  const todo = batch.filter((e) => !have.has(e.id));
  if (todo.length) await append(todo);
  const done = new Set(batch.map((e) => e.id));
  queue = pending().filter((e) => !done.has(e.id));
  mirror();
}

/** Durable append of one user edit. Rejects when it could not be stored (it stays queued and is retried with the
 *  next edit or start); a queue that can't be mirrored to localStorage is reported too. */
export function record(ev: GameEvent): Promise<void> {
  pending().push(ev);
  const mirrored = mirror();
  return serial(drain).then(() => {
    if (!mirrored) throw new Error('임시 저장(localStorage)에 실패했어요. 기록은 저장됐지만 탭 직후 앱을 닫으면 유실될 수 있어요.');
  });
}

/** Store edits left queued by an earlier session. Call before reading a game's events. */
export const flushPending = () => serial(drain);
