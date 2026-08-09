# Docs Site Design · C2 (v1.0 release)

> Status: **implemented** (2026-08-09). This document records the selection
> trade-offs and the resulting structure of the static docs site.

## 1. Goal

A static documentation site covering: quick start, DI, routing/middleware,
contract-first, per-package guides (session / CORS / rate-limit / WebSocket /
testing), and a migration guide — all sourced from existing docs
(`README.md`, `llms.txt`, `docs/api-freeze.md`, design specs) without
inventing API.

## 2. Selection trade-offs

| Option | Pros | Cons | Verdict |
| ------ | ---- | ---- | ------- |
| **VitePress** | Nice UX, search, out-of-the-box nav | Pulls Vue + a large dep tree into a zero-dep-philosophy Bun monorepo; adds a build step; bun-lock churn; overkill for ~12 pages | Rejected |
| **Hand-written HTML per page** | Full control, zero deps | Duplicates the Markdown sources (README/specs); double maintenance; diverges from source of truth | Rejected |
| **Markdown pages + hand-written shell** | Zero deps, zero build, content *is* the Markdown (GitHub renders it natively); the shell makes it browsable on any static host | Shell's inline viewer is a tiny hand-rolled md renderer | **Chosen** |

**Chosen: Markdown-first pages in `docs/site/` + a single hand-written
`index.html` shell.**

- The canonical content lives in `.md` files (single source of truth, no
  duplication with README/specs).
- GitHub renders `docs/` Markdown natively — the site works with zero
  infrastructure in the repo.
- `index.html` is self-contained (inline CSS + ~100 lines of vanilla JS that
  fetches and renders the `.md` pages client-side). No CDN, no npm
  dependencies, no build step. It exists purely so the same directory is
  browsable on any static host (Cloudflare Pages, Netlify, GitHub Pages, …).
- No-JS fallback: the sidebar links point to the raw `.md` files directly.

## 3. Site structure

```
docs/
├── site-design.md        # this document
├── api-freeze.md         # existing (C1) — linked, not copied
└── site/
    ├── index.html        # shell: sidebar nav + inline Markdown viewer
    ├── quickstart.md     # install + hello world + BYO container
    ├── di.md             # core concepts: container, scopes, inject* sugar
    ├── routing.md        # router, params, groups, static, ZebraRequest
    ├── middleware.md     # compose, dep-aware helper, Problem+Json errors
    ├── lifecycle.md      # boot/ready/shutdown, disposal
    ├── websocket.md      # app.ws, DI upgrade, ws.data.session
    ├── contract-first.md # zc builder, implement, client, testing
    ├── session.md        # @zebra/session guide
    ├── cors.md           # @zebra/cors guide
    ├── rate-limit.md     # @zebra/rate-limit guide
    ├── testing.md        # @zebra/testing guide
    └── migration.md      # v0.1 → v0.2 → v1.0 changes
```

Sidebar sections:

- **Getting started**: Quick start
- **Core concepts**: DI · Routing · Middleware · Lifecycle · WebSocket
- **Contract-first**: Contract-first
- **Packages**: Session · CORS · Rate limiting · Testing
- **Release**: Migration guide · API freeze (links to `../api-freeze.md`)

## 4. Content sourcing (no invented API)

| Page | Sources |
| ---- | ------- |
| quickstart | `README.md` (install, quick start, BYO container) |
| di | `README.md`, `llms.txt` core principles, `docs/api-freeze.md` §3 `@zebra/core` DI exports, `packages/core/test/di/` |
| routing | `README.md` Features, `llms.txt` (radix router, params), api-freeze §3 |
| middleware | `README.md` (Koa-style compose, dep-aware `middleware()`), `packages/core/src/middleware/` doc comments, tests |
| lifecycle | `README.md` (boot/ready/shutdown), `packages/core/test/app/lifecycle.test.ts` |
| websocket | `README.md` Features (ws), `packages/core/test/ws.test.ts`, session `wsSession` doc comment |
| contract-first | `README.md`, `llms.txt` (contract bullet), `docs/superpowers/specs/2026-08-09-zebra-contract-first-design.md`, `examples/contract-blog/` |
| session | `README.md` Features, `packages/session/src/middleware.ts` doc comments, `packages/session/test/integration.test.ts` |
| cors | `README.md` Features, `packages/cors/src/cors.ts` + `origin.ts` doc comments |
| rate-limit | `README.md` Features, `packages/rate-limit/src/middleware.ts` doc comments (header semantics) |
| testing | `README.md` Features, `docs/api-freeze.md` §3, tests |
| migration | git history (v0.1 → v0.2 → v1.0 commits), `docs/api-freeze.md` §5 audit record, README Status |

The API freeze page is **linked** (`../api-freeze.md`), not duplicated — it is
the authoritative v1 surface and must not drift from `docs/api-freeze.md`.

## 5. Deployment

The site is a static directory; deploy by serving `docs/site/` (or the whole
`docs/`). No server rendering, no build, no dependencies. The repo's `docs/`
folder renders on GitHub as-is; any static host that can serve a directory
works unchanged.

## 6. Non-goals / future

- A build-based generator (VitePress / Astro / custom) can be layered on top
  later: the `.md` files are already the content model. Adding search or
  syntax highlighting is a follow-up, not part of C2.
- C3 benchmark page (from `bench/`) will land in this site as `bench.md` once
  C3 is implemented.
