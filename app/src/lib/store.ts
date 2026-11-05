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

/** Append events in one transaction; resolves once they are durable. Returns their seq numbers. */
export async function append(events: GameEvent[]): Promise<number[]> {
  const tx = (await open()).transaction(EVENTS, 'readwrite'), store = tx.objectStore(EVENTS);
  const keys = events.map((e) => done(store.add(e) as IDBRequest<number>));
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
  return Promise.all(keys);
}

// Write-ahead queue in localStorage: setItem is synchronous, so an edit survives a page closed before the
// IndexedDB transaction commits. Entries leave the queue once stored; leftovers are replayed on next start.
const PENDING = 'scorebook:pending';
const readPending = (): GameEvent[] => { try { return JSON.parse(localStorage.getItem(PENDING) || '[]'); } catch { return []; } };
const writePending = (v: GameEvent[]) => { try { localStorage.setItem(PENDING, JSON.stringify(v)); } catch { /* quota, private mode */ } };

/** Durable append of one user edit. */
export function record(ev: GameEvent): Promise<void> {
  writePending([...readPending(), ev]);
  return append([ev]).then(() => writePending(readPending().filter((p) => p.id !== ev.id)));
}

/** Store queued edits left by a page that closed mid-write (skipping ones that did make it). Call before reading. */
export async function flushPending(): Promise<number> {
  const pending = readPending();
  if (!pending.length) return 0;
  const have = new Set<string>();
  for (const gid of new Set(pending.map((p) => p.gameId))) for (const e of await gameEvents(gid)) have.add(e.id);
  const todo = pending.filter((p) => !have.has(p.id));
  if (todo.length) await append(todo);
  writePending([]);
  return todo.length;
}
