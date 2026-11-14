# SUNLOCK — web app

React + TypeScript + Vite front end for the SUNLOCK lunar landing-window navigator.
See the [repository README](../README.md) for the project, method and data sources.

```bash
npm install
npm run dev      # http://localhost:5173/sunlock/
npm run build    # type-check + production build into dist/
```

The app is served from a sub-path (`/sunlock/`) — see `base` in `vite.config.ts`.
Terrain assets live in `public/terrain/` and are rebuilt by `../scripts/build-terrain.mjs`.
