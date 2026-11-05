# scorebook app

Svelte 5 + Vite + TypeScript PWA (work in progress; ported from `../web/index.html`).

```sh
npm install
npm run dev      # http://localhost:5173, serves ../fixtures at /fixtures (dev only)
npm test         # vitest: relay parser checks run against ../fixtures/naver when present
npm run check    # svelte-check + tsc
```

Fetch games first with `../tools/naver_relay.py relay <gameId>`. Fixtures hold Naver relay data: they stay out
of git and out of builds.
