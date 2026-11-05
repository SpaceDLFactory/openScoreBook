import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'
import { createReadStream, existsSync, statSync } from 'node:fs'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), fixtures()],
})
