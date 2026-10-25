# ARCHMAGE: RIFTBOUND — Roadmap

Quality-of-life and new-systems work, kept separate from bugfix scope. Shipped items are struck through with their release; items removed by the approved v2.0 scope decision are struck through as excluded and must not be reintroduced indirectly. Everything unmarked is open. Each new feature needs a short spec first (player problem, interaction loop, data model, seed impact, save migration, balance knobs, a11y/reduced-motion behavior, test matrix, rollback switch).

## Tier 1 — immediate quality of life

1. Slot loadout editor: explicit select-and-replace, reorder, merged-slot breakdown, cost/cooldown comparison.
2. Blink range/landing preview: pointer target, max-range ring, blocked-landing feedback.
3. Combat timeline: recent resonance chains, affixes, boss phase changes, glyph pickups.
4. ~~Run recap~~ (excluded by the approved v2.0 scope).
5. ~~Quick settings~~ (most rows shipped in v2.1).
6. ~~HUD modes~~ (density tiers, compact/standard/expanded, shipped in v2.1).
7. Input customization: one-thumb mode + unified detection shipped in v2.1; remapping, hold/toggle cast, gamepad dead zones and the touch layout editor remain open.

## Tier 2 — new systems and progression

1. ~~Spell Evolutions~~ SHIPPED v2.1 (22 cards across all 13 elements, deterministic per seed).
2. Relic/boon synergies: multi-piece sets that alter mechanics, synergy previews, respec path.
3. ~~Arena interactions~~ (excluded by the approved v2.0 scope).
4. Fateweaver practice assistant: opt-in auto-cast training with transparent rules, no meta reward exploit.
5. Boss Rush & training room: pick discovered tyrants, test loadouts outside normal progress.
6. Challenge modifiers: glass mage, no blink, single-element, resonance-only runs; local scores only.
7. Daily/weekly seeds: UTC rollover, local score first; disclose any online dependency before adding one.
8. Codex upgrades: counterplay hints, telegraph glossary, resonance history, personal bests.

## Tier 3 — long-term platform work

1. ~~Run history and share codes~~ (excluded by the approved v2.0 scope; the local ledger and seed share-links went with it).
2. Save export/import: schema-versioned JSON, integrity checksum, recovery slot.
3. Offline PWA: versioned service worker with cache invalidation and a clear offline status.
4. Mod support: validated data-pack schema, numeric/size limits, no executable scripts.
5. Performance harness: GPU/device classes, 30-minute soak, context-loss recovery, P50/P95 frames.
6. Accessibility/localization: ~~colorblind palettes~~ SHIPPED v2.1; text size, narration cadence, localization catalogs, reduced-sensory preset remain open.
7. Community contribution kit: issue templates, spell design spec, art/license checklist, reproducible seed fixtures.

## Audit items not taken

Heart-drop gating and the swift-elite chase cap (audit V3 P1 recommendations) were never scoped into a release. The optional service worker from the V5 fix list (immutable caching + true offline) also remains open.

## Documented deferrals

Attract-mode menu camera (judged redundant beside the ken-burns keyart backdrop) and the screens.tsx/engine.ts file splits (waiting on stable, behavior-preserving slices) are documented deferrals from v2.1.
