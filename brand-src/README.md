# Brand source art

Masters for every shipped icon and image. Not part of the deploy (kept out of
`public/` so visitors never download them).

- `src/keyart.png` — the key art master. Retired from shipping in v3.2: the
  in-engine pixel arena owns every backdrop now, so no `public/art/keyart.jpg`
  is produced; kept here for possible future marketing art.
- `src/cover.png` — 1600×900 menu cover master (shipped as `public/art/cover.png`).
- `src/logo.png`, `src/poster.jpg` — the sigil raster and poster master.
- `public/art/og-image.jpg` — the live Open Graph share image (mastered
  separately; see git history for its origin).

Regenerating shipped assets: resize/compress from these masters (the shipped
JPEGs target < 300 KB each). Icons (`public/favicon-*.png`, `icon-192/512`,
`maskable-icon.png`, `apple-touch-icon.png`) are resized from `src/logo.png`.
`public/favicon.svg` and `public/logo.svg` are hand-authored vectors.
