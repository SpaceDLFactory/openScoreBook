import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, normalize } from 'node:path'

// Dev only: serve ../fixtures at /fixtures. Naver relay data must not end up in a build.
const fixtures = (): Plugin => ({
  name: 'scorebook-fixtures',
  apply: 'serve',
  configureServer(server) {
    const root = normalize(join(__dirname, '../fixtures'))
    server.middlewares.use('/fixtures', (req, res, next) => {
      const file = normalize(join(root, decodeURIComponent((req.url ?? '/').split('?')[0])))
      if (!file.startsWith(root)) return next()
      // answer 404 ourselves: falling through would serve index.html with 200 (SPA fallback)
      if (!existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end() }
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      createReadStream(file).pipe(res)
    })
  },
})

// Build only: emit sw.js precaching every built file plus public/ (index.html, wasm, manifest, icons).
// VERSION is a hash of the file list, so a new build installs a fresh shell cache.
const pwa = (): Plugin => ({
  name: 'scorebook-pwa',
  apply: 'build',
  generateBundle(_, bundle) {
    const pub = join(__dirname, 'public')
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name).slice(pub.length + 1)]))
    const files = ['index.html', ...Object.keys(bundle).filter((f) => f !== 'index.html'), ...walk(pub)].sort()
    const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
    const shell = ['./', ...files.map((f) => `./${f}`)]
    const source = readFileSync(join(__dirname, 'sw.template.js'), 'utf8')
      .replace('__VERSION__', JSON.stringify(version)).replace('__SHELL__', JSON.stringify(shell))
    this.emitFile({ type: 'asset', fileName: 'sw.js', source })
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [svelte(), fixtures(), pwa()],
})
