# ARCHMAGE: RIFTBOUND — Operations

Build, verify, deploy. Companions: root README (project layout), `docs/AUDITS.md` (verification history).

## Two build modes

| Mode | Command | Output | Target |
|---|---|---|---|
| Default (standalone) | `bun run build` | `.next/standalone/` + packaged static/public | Vercel, any Node host |
| GitHub Pages static | `BUILD_MODE=pages BASE_PATH=/Archmage bun run build:pages` | `out/` | GitHub Pages project site |

The modes never contaminate each other; Pages is selected purely through environment variables. In pages mode `next.config.ts` switches `output` to `"export"`, sets `images.unoptimized`, applies `basePath`/`assetPrefix`, and mirrors `BASE_PATH` into `NEXT_PUBLIC_BASE_PATH`. The `assetPath()` helper (`src/lib/asset-path.ts`) prefixes hand-written public URLs (icons, key art, the GLB manifest), which Next's basePath rewrites do not touch. `public/.nojekyll` rides along so Pages skips Jekyll and keeps `_next/` intact. A user-root site builds by omitting `BASE_PATH`.

## CI gates (`.github/workflows/ci.yml`, every push and PR)

1. `bun run lint`, then `bunx tsc --noEmit`.
2. The 11 validators: saves, terrain, runcommit, enemy-motion, audio-mute, blink, spell-offer, mercy, evolutions, web, assets. Assets runs `continue-on-error: true` for the 3 permission-pending license rows only (see `docs/AUDITS.md`).
3. Both production builds: the standalone build and the Pages export under `/Archmage`.
4. Export smoke gate: `out/index.html`, `out/.nojekyll`, `out/_next`, `out/assets/manifests/assets.json`, and chunk URLs carrying the base path.

## Pages deploy (`.github/workflows/deploy-pages.yml`)

Runs on push to `main` plus manual dispatch. Lint + typecheck, then the static export under `/${{ github.event.repository.name }}`, a deeper smoke gate (the CI checks plus the brand suite: favicon ladder, apple-touch icon, 192/512 + maskable icons, manifest, og art, llms.txt, robots, sitemap, 404.html; source maps deleted and asserted absent), artifact upload, then `actions/deploy-pages@v4`. One-time setup: repository Settings → Pages → Source "GitHub Actions". A concurrency group cancels superseded deploys.

## Local verification

```bash
bun install
bun run dev                      # http://localhost:3000
bun run lint && bunx tsc --noEmit
bun scripts/validate-saves.ts    # 21 fixtures, 906 checks
bun scripts/validate-terrain.ts  # seed determinism, 100 seeds
bun scripts/validate-runcommit.ts
bun scripts/validate-enemy-motion.ts
bun scripts/validate-audio-mute.ts
bun scripts/validate-blink.ts
bun scripts/validate-spell-offer.ts
bun scripts/validate-mercy.ts
bun scripts/validate-evolutions.ts
bun scripts/validate-web.ts      # version/SEO/llms/robots pinning
bun scripts/validate-assets.ts   # license gate (3 known pending rows)
BUILD_MODE=pages BASE_PATH=/Archmage NEXT_PUBLIC_BASE_PATH=/Archmage bun run build:pages
bunx serve out -l 4173           # http://localhost:4173/Archmage/
```

`validate-web.ts` is the maintenance contract: it pins version equality across `GAME_VERSION` / `SITE_VERSION` / `CHANGELOG[0].version`, update-name equality, llms.txt version/URLs/stance, the static sitemap, canonical + JSON-LD in the layout, the single prerendered `<h1>`, and changelog-derived labels. Any drift fails CI before it can ship.

## Vercel

The default build is Vercel-ready as-is. Do not set `BUILD_MODE` or `BASE_PATH` there (that would force the static export). No environment variables are required; `NEXT_PUBLIC_SITE_URL` is optional for canonical/OG metadata.

## brand-src/ — icon and image masters

Masters for every shipped icon and image, kept out of `public/` so visitors never download them: `src/keyart.png` (the menu backdrop ships as the compressed `public/art/keyart.jpg`, the share image as `public/art/og-image.jpg`), `src/cover.png`, `src/logo.png`, `src/poster.jpg`.

Regenerate shipped assets by resizing and compressing from these masters; shipped JPEGs target < 300 KB each. The icon ladder (`favicon-16/32.png`, `icon-192.png`, `icon-512.png`, `maskable-icon.png`, `apple-touch-icon.png`) resizes from `src/logo.png`; `favicon.svg` and `logo.svg` are hand-authored vectors.

## Debugging

- `F3` toggles the in-engine telemetry overlay (FPS, frame ms, draw calls, quality scale, asset and memory telemetry).
- The pause screen shows the active rift seed; paste it into the menu seed field to replay the identical world.
- `dev.log` captures the dev server output.
