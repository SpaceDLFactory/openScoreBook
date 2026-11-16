// Run the share server locally: shares as files under server/data, cards drawn with resvg and Noto Sans KR
// (`npm run fonts` fetches the fonts). Settings from the environment:
//   PORT (8787), PUBLIC_URL (http://localhost:PORT), APP_URL (http://localhost:5173/), ORIGINS (APP_URL's origin, comma separated)
import { serve, type HttpBindings } from '@hono/node-server';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadEngine } from '../../app/src/lib/engine.ts';
import { createApp } from './app.ts';
import { FileStore } from './store.ts';

const here = import.meta.dirname;
const port = Number(process.env.PORT ?? 8787);
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
const appUrl = process.env.APP_URL ?? 'http://localhost:5173/';
const origins = (process.env.ORIGINS ?? new URL(appUrl).origin).split(',').map((s) => s.trim());

await loadEngine(readFileSync(join(here, '../../app/src/engine/engine_bg.wasm')));
await initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
const fonts = ['Medium', 'Bold'].map((w) => new Uint8Array(readFileSync(join(here, `../fonts/NotoSansKR-${w}.otf`))));
const png = async (svg: string) => new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: 'Noto Sans KR' } }).render().asPng();

// run directly (no proxy in front): the socket's address is the client
const clientId = (c: { env: unknown }) => (c.env as HttpBindings).incoming.socket.remoteAddress ?? 'unknown';
const app = createApp({ store: new FileStore(join(here, '../data')), publicUrl, appUrl, origins, png, clientId });
serve({ fetch: app.fetch, port }, () => console.log(`share server ${publicUrl} · app ${appUrl} · origins ${origins.join(' ')}`));
