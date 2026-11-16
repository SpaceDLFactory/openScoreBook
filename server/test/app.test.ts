import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine } from '../../app/src/lib/engine.ts';
import { shareRequest } from '../../app/src/lib/share.ts';
import type { GameEvent } from '../../app/src/lib/events.ts';
import sample from '../../app/src/lib/sample-game.json';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store.ts';

beforeAll(async () => { await loadEngine(readFileSync(join(__dirname, '../../app/src/engine/engine_bg.wasm'))); });

const events = (sample as Record<string, unknown>[]).map((e, i) => ({ ...e, id: `e${i}`, gameId: 'm-sample', at: i })) as unknown as GameEvent[];
const make = (perHour?: number) => createApp({
  store: new MemoryStore(), publicUrl: 'https://share.test', appUrl: 'https://app.test/', origins: ['https://app.test'],
  png: async (svg) => new TextEncoder().encode(svg), perHour, clientId: (c) => c.req.header('x-test-client') ?? 'local',
});
const post = (app: ReturnType<typeof make>, body: unknown, ip = '1.2.3.4') =>
  app.request('/api/share', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-test-client': ip } });

describe('share server', () => {
  it('stores a game, serves it back with a summary it worked out itself, and deletes it with the key', async () => {
    const app = make();
    const res = await post(app, { ...shareRequest(events), summary: { away: '가짜' } });
    expect(res.status).toBe(201);
    const { id, url, deleteKey } = await res.json() as { id: string; url: string; deleteKey: string };
    expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(url).toBe(`https://share.test/g/${id}`);
    const got = await (await app.request(`/api/share/${id}`)).json() as Record<string, unknown>;
    expect(got.summary).toMatchObject({ away: '청룡', home: '백호', score: [4, 5], status: 'final', date: '2026-04-04', stadium: '잠실' });
    expect((got.events as unknown[]).length).toBe(events.length);
    expect(got).not.toHaveProperty('deleteHash');
    expect((await app.request(`/api/share/${id}`, { method: 'DELETE', headers: { 'X-Delete-Key': 'wrong' } })).status).toBe(403);
    expect((await app.request(`/api/share/${id}`, { method: 'DELETE', headers: { 'X-Delete-Key': deleteKey } })).status).toBe(204);
    expect((await app.request(`/api/share/${id}`)).status).toBe(404);
    expect((await app.request(`/g/${id}`)).status).toBe(404);
  });

  it('gives the link a preview of that game, and sends people to the app', async () => {
    const app = make();
    const { id } = await (await post(app, shareRequest(events))).json() as { id: string };
    const html = await (await app.request(`/g/${id}`)).text();
    expect(html).toContain('<meta property="og:title" content="청룡 4 : 5 백호">');
    expect(html).toContain('<meta property="og:description" content="2026-04-04 · 잠실 · 경기 종료">');
    expect(html).toContain(`<meta property="og:image" content="https://share.test/g/${id}/card.png">`);
    expect(html).toContain(`location.replace("https://app.test/#share=${id}")`);
    const card = await app.request(`/g/${id}/card.png`);
    expect(card.headers.get('content-type')).toBe('image/png');
    expect(await card.text()).toContain('4 : 5');
  });

  it('refuses what is not a game that replays cleanly', async () => {
    const app = make();
    const bad = async (body: unknown) => { const r = await post(app, body); return [r.status, ((await r.json()) as { error: string }).error]; };
    expect(await bad({ app: 'other', events })).toEqual([400, '공유 기록 형식이 아니에요.']);
    expect(await bad(shareRequest(events.slice(1)))).toEqual([400, '경기 설정이 없어요.']);
    const raw = (evs: GameEvent[]) => ({ app: 'openScoreBook', kind: 'share', version: 1, events: evs });
    expect(await bad(raw([...events, { ...events[5], id: 'x', gameId: 'm-other' }]))).toEqual([400, '경기 하나만 공유할 수 있어요.']);
    // a landing pointing at an object property instead of a PA, or past the game's last PA
    const land = (pa: unknown) => raw([...events, { id: 'l', gameId: 'm-sample', at: 1, kind: 'landing.res', pa, res: '1B', manual: true } as unknown as GameEvent]);
    expect(await bad(land('__proto__'))).toEqual([400, '공유 기록이 손상됐어요.']);
    expect(await bad(land(9999))).toEqual([400, '공유 기록이 손상됐어요.']);
    expect(await bad(raw(events.map((e, i) => (i === 3 ? { ...e, stuff: 'x'.repeat(201) } : e))))).toEqual([400, '공유 기록이 손상됐어요.']);
    // a runner sent to a base someone already holds: the engine drops him
    const clash = [...events, { id: 'c', gameId: 'm-sample', at: 999, kind: 'm.runners', play: 'ETC', advances: [{ from: 'First', to: 'Second' }] } as unknown as GameEvent];
    const [status] = await bad(shareRequest(clash));
    expect(status).toBe(400);
    const huge = await app.request('/api/share', { method: 'POST', body: 'x'.repeat(1_000_001) });
    expect(huge.status).toBe(413);
    // no length given up front: cut off while reading
    let sent = 0;
    const stream = new ReadableStream({ pull(ctl) { if (sent > 3_000_000) ctl.close(); else { ctl.enqueue(new Uint8Array(64_000)); sent += 64_000; } } });
    const streamed = await app.request('/api/share', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThan(3_000_000);
  });

  it('refuses a substitution aimed at object internals before replaying anything', async () => {
    const app = make();
    const evil = { id: 'z', gameId: 'm-sample', at: 1, kind: 'm.sub', side: '__proto__', role: 'DEF', slot: 'toString', player: { id: 'p', name: 'p', pos: '' } };
    const before = Object.prototype.toString;
    const r = await post(app, { app: 'openScoreBook', kind: 'share', version: 1, events: [...events, evil] });
    expect(r.status).toBe(400);
    expect(Object.prototype.toString).toBe(before);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'name')).toBe(false);
  });

  it('answers ids it never made with 404, without touching the store', async () => {
    const app = make();
    for (const id of ['short', '../../etc/passwd', 'AAAAAAAAAAAA']) expect((await app.request(`/api/share/${encodeURIComponent(id)}`)).status).toBe(404);
  });

  it('limits how many shares one client tries per hour, failed ones too', async () => {
    const app = make(2);
    expect((await post(app, shareRequest(events))).status).toBe(201);
    expect((await post(app, { app: 'bad' })).status).toBe(400);
    expect((await post(app, shareRequest(events))).status).toBe(429);
    expect((await post(app, shareRequest(events), '5.6.7.8')).status).toBe(201);
  });

  it('keeps none of the sharer\'s own ids', async () => {
    const app = make();
    const { id } = await (await post(app, shareRequest(events.map((e) => ({ ...e, gameId: 'm-mine-123', id: `secret-${e.id}` }))))).json() as { id: string };
    const got = await (await app.request(`/api/share/${id}`)).json() as { events: GameEvent[] };
    expect(new Set(got.events.map((e) => e.gameId))).toEqual(new Set(['shared']));
    expect(got.events.some((e) => e.id.startsWith('secret'))).toBe(false);
  });

  it('draws a card for a very long team name quickly', async () => {
    const { cardSvg } = await import('../../app/src/lib/card.ts');
    const t = performance.now();
    const svg = cardSvg({ date: '', stadium: '', away: 'A'.repeat(20_000), home: '가'.repeat(20_000), score: [0, 0], innings: { away: [], home: [] }, status: 'final', inning: 9, top: false });
    expect(performance.now() - t).toBeLessThan(200);
    expect(svg.length).toBeLessThan(20_000);
  });

  it('lets only the app\'s origin call the API from a browser', async () => {
    const app = make();
    const ok = await app.request('/api/share', { method: 'OPTIONS', headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'POST' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.test');
    const other = await app.request('/api/share', { method: 'OPTIONS', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
