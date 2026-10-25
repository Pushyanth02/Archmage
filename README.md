# ARCHMAGE: RIFTBOUND — 3D Edition

**Fifty waves. Five tyrants. One last archmage.** A free arcade 3D roguelike that runs entirely in the browser. Fifty waves across 5 act bands drawn from 10 terrains, 13 elements binding into 3 slots, 78 resonances, 22 spell evolutions, 5 tyrants at waves 10/20/30/40/50, and the Endless Echo beyond wave 50. Every run is a deterministic seed; the same seed walks the same ground, down to the boss order.

**Play:** <https://pushyanth02.github.io/Archmage/>

## Platform and inputs

Built for every device. Keyboard + mouse (WASD move, LMB cast, RMB volley, Space blink, F surge, Q/E/1-2-3 slots). Twin-thumb touch controls with a left-hand mirror and one-thumb tap-to-cast; phones auto-enter fullscreen landscape, with a rotate gate where the OS refuses the lock. A full gamepad rite (sticks, triggers, A/X/Y/B, D-pad, rumble). The Codex inside the game documents every binding per device.

## Data stance

The whole game is client-side. No accounts, no ads, no analytics; saves live in your browser's localStorage. Crash snapshots copy to the clipboard and stay there. Terms of Service and the Privacy Policy are reachable from the main menu.

## Technology

- Next.js 16 (App Router), React 19, TypeScript 5
- Three.js r186: fixed-timestep 3D arena, GLTF bestiary, pooled VFX, a quality governor that eases resolution toward 60 fps
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

## Version 2.2.0 — The Reforged Update

Current release (2026-10-28):

- A real loading screen: the game opens behind a byte-accurate summoning veil (sprites, the mage and the clip bank arrive first; the bestiary and terrain stream behind it), and starting a run waits for the relics with live MB progress.
- New-device smoothness: the arena builds behind the veil, the twenty in-run glass panels dropped their per-frame backdrop blur, and the 3D loop stops rendering behind the opaque menu, defeat and credits screens.
- The deploy shed about 9 MB: unreferenced source art moved out, the two byte-identical social images became one 133 KB JPEG, the 651 KB favicon became a 1 KB vector, 49 unused packages left.
- The brand typefaces (Cinzel + Alegreya Sans) are self-hosted and preloaded.
- Truthful numbers everywhere: the defeat-screen tithe reads the way the code pays (75% to the rift), a run is five act bands from ten terrains, the data-stance copy claims exactly what the game does.
- Landscape phones see the Enter button without scrolling, pinch zoom works again, the first Tab lands on a visible control, Wave 1 reads as Wave 1.
- Time Survived counts the run you actually played, Re-Enter says it restarts from wave 1, the seed field shows a focus ring.
- Installed-to-home-screen launches land on the game itself (manifest start_url fixed for the subpath deploy).

Full history: [CHANGELOG.md](./CHANGELOG.md).

## Credits and licenses

Code and design: the Archmage contributors, [MIT](./LICENSE). Art from open-source packs: KayKit, Quaternius, Kronbits, Kenney and dunpixel (CC0 / QAL / free-commercial); the Augusto Faria monster pack ships in the free build with attribution pending author confirmation for commercial use. Per-pack status lives in [docs/AUDITS.md](./docs/AUDITS.md) and renders live in the Codex credits. Key art conjured by AI. Everything else, music, sound and engine, is synthesized in code.
