# ARCHMAGE: RIFTBOUND

**Fifty waves. Five tyrants. One last archmage.** A free arcade 3D roguelike that runs entirely in the browser. Fifty waves across 5 act bands drawn from 10 terrains, 13 elements binding into 3 slots, 78 resonances, 22 spell evolutions, 5 tyrants at waves 10/20/30/40/50, and the Endless Echo beyond wave 50. Every run is a deterministic seed; the same seed walks the same ground, down to the boss order.

**Play:** <https://pushyanth02.github.io/Archmage/>

## Platform and inputs

Built for every device. Keyboard + mouse (WASD move, LMB cast, RMB volley, Space blink, F surge, Q/E/1-2-3 slots). Twin-thumb touch controls with a left-hand mirror and one-thumb tap-to-cast; phones auto-enter fullscreen landscape, with a rotate gate where the OS refuses the lock. A full gamepad rite (sticks, triggers, A/X/Y/B, D-pad, rumble). The Codex inside the game documents every binding per device.

## Data stance

The whole game is client-side. No accounts, no ads, no analytics; saves live in your browser's localStorage. Crash snapshots copy to the clipboard and stay there. Terms of Service and the Privacy Policy are reachable from the main menu.

## Technology

- Next.js 16 (App Router), React 19, TypeScript 5
- Three.js r186: fixed-timestep 3D arena over a pixel-art presentation layer — the chibi bestiary is canvas-drawn sprite billboards (idle/walk/attack/hurt/death frames), the floor is a generated cobblestone plaza with a breathing gold summoning circle, and pooled VFX run through a quality governor that eases resolution toward 60 fps
- Tailwind CSS 4, framer-motion, Radix primitives
- 100% synthesized WebAudio (4 buses, 3 music moods, per-act ambience) with zero audio files
- Zero-backend: simulation, seeded RNG, saves, all client-side; the site is a static export

## Quick start

```bash
bun install
bun run dev        # http://localhost:3000
```

Build, CI and deploy (standalone + Pages static export, 11 validators, smoke gates): see [docs/OPERATIONS.md](./docs/OPERATIONS.md).

## Project structure

```
src/game3d/            simulation core: engine, spells, entities, arena, vfx, audio, content
src/components/game3d/ React shell: GameShell, HUD, screens, overlays, touch controls
src/app/               single-route app (page, layout, globals.css)
scripts/               11 verification validators (run by CI on every push)
docs/                  DESIGN, AUDITS, OPERATIONS, ROADMAP
brand-src/             icon and image masters, kept out of the deploy
```

## Version 3.2.0 — Rift Night

Current release (2026-11-21):

- One art direction, everywhere: the Rift Night master palette governs the arena, the HUD and every menu, with flattened panels and crisp gold and violet borders.
- One boot, one title: a single loading gate and a single Title & Loadout Hub over the live pixel arena backdrop; the old WebGL title stack is retired.
- Pixel-icon parity by construction: one registry feeds every element, currency, portrait, relic and preview icon across every screen.
- The shared RiftScreen shell carries Vault, Runes, Codex (nine tabs, search, discovery progress) and Settings; the deploy sheds the retired keyart and legacy icon assets.

Full history: [CHANGELOG.md](./CHANGELOG.md).

### Previous — 3.0.0, The Pixel Reforging (2026-11-20)

The complete art overhaul to the v3 concept boards: enchanted purple-and-gold panels, hex plaques, keycaps and diamond filigree on every screen — menu, HUD, overlays, results and settings. The GLTF bestiary retired; every foe, tyrant and the player a chibi pixel sprite drawn in-engine; the five tyrants are the Bone Regent, Pyre Behemoth, Void Seraph, Rift Colossus and Frost Leviathan. The arena floor a generated pixel-cobblestone plaza with a breathing gold summoning circle. Details in the changelog.

## Credits and licenses

Code, design and pixel art: the Archmage contributors, [MIT](./LICENSE). Third-party art still shipping: Kenney (Graveyard Kit terrain decor, CC0; particle pack, CC0) and Kronbits (particles, CC0). The v3.1 sprite-sheet library (mages, bestiary, tyrants, icons, relics, portraits, tilesets) is project-made. The GLTF bestiary and dunpixel icon packs are retired from the deploy. Per-pack status lives in [docs/AUDITS.md](./docs/AUDITS.md) and renders live in the Codex credits. Key art conjured by AI. Everything else, music, sound and engine, is synthesized in code.
