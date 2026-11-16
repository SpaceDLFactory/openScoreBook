// The share server (docs/design/sharing.md, step B-1): takes a game, keeps it under a random id, serves it back,
// and gives each share a link whose preview (Open Graph tags and a score card image) is that game's.
// Plain Hono on web-standard Request/Response, so it runs on any host; the host supplies the store and the PNG
// renderer (node.ts for running it locally).
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { cardSvg } from '../../app/src/lib/card.ts';
import { readShareEvents, SHARE_MAX_BYTES, SHARE_VERSION, type Share } from '../../app/src/lib/share.ts';
import type { Store } from './store.ts';

export interface Config {
  store: Store;
  /** this server's public address, for links and preview tags (no trailing slash) */
  publicUrl: string;
  /** the app's address; share links send people there */
  appUrl: string;
  /** origins allowed to call the API from a browser */
  origins: string[];
  /** SVG to PNG; the host provides it (it needs a Korean font) */
  png: (svg: string) => Promise<Uint8Array>;
  /** who is asking, for the hourly limit: the host's idea of the client address. Headers like X-Forwarded-For are
   *  set by the client unless a trusted proxy overwrites them, so only the host can say which to believe. */
  clientId: (c: Context) => string;
  /** share attempts one client may make per hour */
  perHour?: number;
}

interface Stored extends Share { deleteHash: string }

const ID = /^[A-Za-z0-9]{12}$/;
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => B62[b % 62]).join('');
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The body as text, read no further than max bytes (null past that), so a huge upload is cut off early. */
async function readLimited(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

export function createApp(cfg: Config) {
  const app = new Hono();
  const perHour = cfg.perHour ?? 30;
  // client -> times of its recent attempts (in this process; a host with many instances needs a shared store)
  const tries = new Map<string, number[]>();
  /** count this attempt now, before any work, so concurrent and failing requests are counted too */
  const allow = (who: string, now: number) => {
    if (tries.size > 10_000) for (const [k, v] of tries) if (v.every((t) => now - t >= 3_600_000)) tries.delete(k);
    const recent = (tries.get(who) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= perHour) { tries.set(who, recent); return false; }
    tries.set(who, [...recent, now]);
    return true;
  };
  const load = async (id: string): Promise<Stored | null> => {
    if (!ID.test(id)) return null;
    const v = await cfg.store.get(id);
    return v ? (JSON.parse(v) as Stored) : null;
  };

  app.use('/api/*', cors({ origin: cfg.origins, allowMethods: ['GET', 'POST', 'DELETE'], allowHeaders: ['Content-Type', 'X-Delete-Key'] }));

  app.post('/api/share', async (c) => {
    const now = Date.now();
    if (!allow(cfg.clientId(c), now)) return c.json({ error: '공유가 너무 많아요. 잠시 뒤에 다시 해 주세요.' }, 429);
    const text = await readLimited(c.req.raw, SHARE_MAX_BYTES);
    if (text == null) return c.json({ error: '경기 기록이 너무 커요.' }, 413);
    let checked;
    try { checked = await readShareEvents(JSON.parse(text)); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
    const id = random(12), deleteKey = random(24);
    const stored: Stored = { app: 'openScoreBook', kind: 'share', version: SHARE_VERSION, createdAt: new Date(now).toISOString(), ...checked, deleteHash: await sha256(deleteKey) };
    await cfg.store.put(id, JSON.stringify(stored));
    return c.json({ id, url: `${cfg.publicUrl}/g/${id}`, deleteKey }, 201);
  });

  app.get('/api/share/:id', async (c) => {
    const s = await load(c.req.param('id'));
    if (!s) return c.json({ error: '공유된 기록이 없어요.' }, 404);
    const { deleteHash: _, ...share } = s;
    return c.json(share);
  });

  app.delete('/api/share/:id', async (c) => {
    const id = c.req.param('id'), s = await load(id);
    if (!s) return c.json({ error: '공유된 기록이 없어요.' }, 404);
    if ((await sha256(c.req.header('X-Delete-Key') ?? '')) !== s.deleteHash) return c.json({ error: '삭제 키가 맞지 않아요.' }, 403);
    await cfg.store.delete(id);
    return c.body(null, 204);
  });

  // the link people share: preview tags for crawlers (which don't run scripts), and the app for everyone else
  app.get('/g/:id', async (c) => {
    const id = c.req.param('id'), s = await load(id);
    if (!s) return c.html('<!doctype html><meta charset="utf-8"><title>openScoreBook</title><p>공유된 기록이 없어요. 지워졌을 수 있어요.</p>', 404);
    const m = s.summary;
    const title = `${m.away} ${m.score[0]} : ${m.score[1]} ${m.home}`;
    const desc = [m.date, m.stadium, m.status === 'final' ? '경기 종료' : `${m.inning}회${m.top ? '초' : '말'} 진행 중`].filter(Boolean).join(' · ');
    const page = `${cfg.publicUrl}/g/${id}`, open = `${cfg.appUrl}#share=${id}`;
    return c.html(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · openScoreBook</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="openScoreBook">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}">
<meta property="og:image" content="${esc(page)}/card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${title} · ${desc}`)}">
<meta name="twitter:card" content="summary_large_image">
</head><body style="background:#0d1014;color:#e6edf3;font-family:sans-serif">
<p><a style="color:#7ee2a4" href="${esc(open)}">openScoreBook에서 ${esc(title)} 경기 열기</a></p>
<script>location.replace(${JSON.stringify(open)})</script>
</body></html>`);
  });

  app.get('/g/:id/card.png', async (c) => {
    const s = await load(c.req.param('id'));
    if (!s) return c.body(null, 404);
    const png = await cfg.png(cardSvg(s.summary));
    // a share never changes (editing makes a new one)
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  });

  return app;
}
