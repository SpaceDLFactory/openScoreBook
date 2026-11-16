// Talking to the share server (server/, docs/design/sharing.md). Only builds given VITE_SHARE_API have it; the app
// works the same without. The links this browser made are kept here with their delete keys: without accounts,
// the key is the only way to take a share down.
import type { CardSummary } from './card';
import type { GameEvent } from './events';
import { readShareEvents, shareRequest } from './share';

const API = (import.meta.env.VITE_SHARE_API as string | undefined)?.replace(/\/+$/, '');
export const shareEnabled = !!API;

export interface MyShare { id: string; url: string; deleteKey: string; at: number }
const KEY = 'scorebook:shares';
const all = (): Record<string, MyShare[]> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (m: Record<string, MyShare[]>) => localStorage.setItem(KEY, JSON.stringify(m));
/** this browser's links to a game, newest last */
export const mySharesOf = (gameId: string): MyShare[] => all()[gameId] ?? [];

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try { res = await fetch(`${API}${path}`, init); } catch { throw new Error('공유 서버에 연결하지 못했어요.'); }
  if (!res.ok && res.status !== 404) {
    const msg = await res.json().then((j: { error?: string }) => j.error, () => null);
    throw new Error(msg ?? `공유 서버 오류 (${res.status})`);
  }
  return res;
}

/** Share a game as it is now; a later share of the same game is a new link. */
export async function createShare(gameId: string, events: GameEvent[]): Promise<MyShare> {
  const res = await call('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shareRequest(events)) });
  const { id, url, deleteKey } = await res.json() as MyShare;
  const s: MyShare = { id, url, deleteKey, at: Date.now() };
  const m = all();
  m[gameId] = [...(m[gameId] ?? []), s];
  // a link whose key can't be kept could never be taken down: take it down now instead
  try { save(m); } catch {
    const undone = await call(`/api/share/${id}`, { method: 'DELETE', headers: { 'X-Delete-Key': deleteKey } }).then(() => true, () => false);
    if (undone) throw new Error('이 기기에 삭제 키를 저장할 수 없어서 공유를 취소했어요. 브라우저 저장 공간을 확인해 주세요.');
    // still up, and nothing here remembers it: these are the only way to take it down
    throw new Error(`삭제 키를 저장하지 못했고 공유 취소도 실패했어요. 링크는 공개된 상태예요. 지우려면 이 값을 보관하세요 · 링크 ${url} · 삭제 키 ${deleteKey}`);
  }
  return s;
}

/** Take a link down (gone already counts as done) and forget it. */
export async function deleteShare(gameId: string, s: MyShare): Promise<void> {
  await call(`/api/share/${s.id}`, { method: 'DELETE', headers: { 'X-Delete-Key': s.deleteKey } });
  const m = all();
  m[gameId] = (m[gameId] ?? []).filter((x) => x.id !== s.id);
  if (!m[gameId].length) delete m[gameId];
  save(m);
}

/** A shared game, checked and replayed here too. */
export async function fetchShare(id: string): Promise<{ events: GameEvent[]; summary: CardSummary }> {
  if (!API) throw new Error('이 앱에는 공유 서버가 설정되어 있지 않아요.');
  const res = await call(`/api/share/${id}`);
  if (res.status === 404) throw new Error('공유된 기록이 없어요. 지워졌을 수 있어요.');
  return readShareEvents(await res.json());
}
