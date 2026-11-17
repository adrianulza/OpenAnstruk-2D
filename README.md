# OpenAnstruk-2D

<p align="center">
  <strong>Open tool, open knowledge, open access.</strong>
</p>

<p align="center">
  <a href="https://openanstruk.org"><img alt="website" src="https://img.shields.io/badge/openanstruk.org-1a2f5e?logo=googlechrome&logoColor=white"></a>
  <a href="./LICENSE"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

A 2D structural analysis web application for modeling, loading, and analyzing frame structures.

> *"Whether you code, test, document, or use it — you belong here."*

## Features

- Interactive modeling: nodes, members (frame + truss), supports — snap-to-grid canvas
- Zoom (scroll-wheel + pinch) with adaptive view scaling; snap-to-node and snap-to-grid toggles
- Point loads and distributed loads (local-axis and global-axis modes)
- Direct stiffness method (DSM) solver — runs entirely in the browser
- Shear force, bending moment, axial force, and deformation diagrams
- RC design checks (beams + rectangular/circular columns, ACI 318-25 / SNI 2847:2019) and steel design checks (IWF / RHS / CHS / tee / single angle, AISC 360-16 / SNI 1729:2020) — see [Design Rules](docs/DESIGN_RULES.md)
- **Live mode**: pull any node with a "rope" and watch the deformed shape, N/V/M diagrams and reactions respond in real time (touch supported)
- Parametric template builder for beams, frames, and trusses
- Undo / redo (buttons + Ctrl+Z / Ctrl+Y) covering all model and load edits
- Save / load models as JSON from the File menu
- Mobile-responsive landing page; touch panning on the app canvas
- No installation — works offline after first load

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Documentation

| Doc | Description |
|-----|-------------|
| [User Guide](docs/USER_GUIDE.md) | How to model, load, analyze, and design structures in the app |
| [Architecture](docs/ARCHITECTURE.md) | Codebase structure, solver internals, and design decisions |
| [Design Rules](docs/DESIGN_RULES.md) | Design core: designability, demands, orchestration, extension guide |
| [Design — RC](docs/DESIGN_RC.md) | Reinforced concrete: flexure, P–M columns, shear, detailing, per-code tables |
| [Design — Steel](docs/DESIGN_STEEL.md) | Structural steel: classification, axial, flexure + LTB, shear, AISC Chapter H |
| [Development](docs/DEVELOPMENT.md) | Roadmap, known issues, and planned phases |
| [Contributing](docs/CONTRIBUTING.md) | How to report bugs, submit features, or get involved |

## Getting Started

```bash
npm install
npm run dev
```

- Landing page: [http://localhost:5173](http://localhost:5173)
- App: [http://localhost:5173/app.html](http://localhost:5173/app.html)

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run format` | Format with Prettier |

## Tech Stack

React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · shadcn/ui · Canvas API

## Contributing

All contributions are welcome — code, bug reports, documentation, feedback. See [CONTRIBUTING.md](docs/CONTRIBUTING.md) to get started.

**Email:** team@openanstruk.org  
**GitHub Issues:** for bug reports and feature requests

## License

[MIT](LICENSE) — free to use, modify, and distribute.

## Sign-in

The 2D app at `2d.openanstruk.org` (a custom domain on this same Worker; `openanstruk.org/app` redirects there) and the 3D app at `3d.openanstruk.org` require a Google account and a
one-time profile (name, birth year, occupation, institution, consent to `/privasi`).
`worker/index.ts` handles sign-in, the profile, account deletion and the gate; the landing
page and every other static file are served without it. Accounts live in the D1 database
`openanstruk-users` (`schema.sql`), shared with the 3D Worker. Nothing about a user's models
is stored.

Setup, once:

1. Google Cloud Console: an OAuth consent screen and a Web OAuth client with the JavaScript
   origins `https://openanstruk.org`, `https://www.openanstruk.org`, `https://2d.openanstruk.org`,
   `https://3d.openanstruk.org`, `http://localhost:8787` and `http://localhost`.
   Put its client ID in `wrangler.toml` (`GOOGLE_CLIENT_ID`; it is not a secret).
2. `npx wrangler d1 create openanstruk-users`, put the `database_id` in `wrangler.toml` here
   and in the 3D repo, then `npx wrangler d1 execute openanstruk-users --remote --file schema.sql`.
3. `npx wrangler secret put SESSION_SECRET` here and in the 3D repo (the same random value,
   at least 32 characters) and `npx wrangler secret put ADMIN_EMAIL` here.

Local: put `SESSION_SECRET`, `ADMIN_EMAIL`, `AUTH_ENABLED=1`, `COOKIE_DOMAIN=`, `APP_URL=http://127.0.0.1:8787/`,
`SITE=http://localhost:8787` and `APP_ORIGINS=http://127.0.0.1:8787` in `.dev.vars` (the two host names play the
main site and the app host),
`npx wrangler d1 execute openanstruk-users --local --file schema.sql`, `npm run build`,
`npx wrangler dev`. Tests: `npx vitest run -c config/vitest.config.ts worker`.

Data: `node scripts/export-users.mjs` writes `exports/users-<date>.csv` and
`exports/visits-<date>.csv` (not tracked). Signed in as `ADMIN_EMAIL`, the same tables
download from `/api/admin/users.csv` and `/api/admin/visits.csv`.
