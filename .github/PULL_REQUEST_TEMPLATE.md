<!-- Pull request template (R-10, v2.0) — fill what applies; delete sections that genuinely do not. -->

## What & why

<!-- One short paragraph: what changes and the player/engine reason. Reference the audit item (R-01…R-11) or issue # if applicable. -->

## Verification run

<!-- REQUIRED: paste the actual commands + results. "Should work" is not evidence. -->

- [ ] `bunx tsc --noEmit` — 0 errors
- [ ] `bun run lint` — clean
- [ ] Relevant validators (`bun scripts/validate-*.ts`) — pass counts pasted
- [ ] Browser smoke (dev server) — what was clicked/verified

```
paste command output here
```

## Regression risk

<!-- What existing behavior could this touch? Save compatibility, seed determinism, HUD update path, audio lifecycle, input handling. -->

## Screenshots / clips

<!-- For anything visual (HUD, overlays, glyphs, branding). -->
