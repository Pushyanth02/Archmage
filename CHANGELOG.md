# Changelog

Source of truth: the `CHANGELOG` array in `src/game3d/content.ts`; this file mirrors it, and the in-game Codex renders the same notes.

## Version 3.2.0 — Rift Night (2026-11-21)

- One art direction, everywhere: the master Rift Night palette (void `#171321`, ink `#140E1D`, gold `#D9BA72`, violet `#A991F7`, teal `#58D6C2`, crimson `#E96578`) governs the arena, the HUD and every menu; panels flattened to a single elevation with crisp 1px gold and violet borders.
- One boot, one title: a single loading gate (RiftBootGate) and a single Title & Loadout Hub over the live PixelArenaBackdrop — the old WebGL title stack (TitleScreen, MenuScene, UIManager) is retired.
- Pixel-icon parity by construction: one registry (`palette.ts`) feeds every element, currency, portrait, relic and preview icon across HUD, hub, Vault, Runes, Codex and overlays; the Lucide vector set is gone from game surfaces.
- The shared RiftScreen shell: header, tab strip, scroll body and currency rail with identical geometry across Vault, Runes, Codex and Settings, with Esc-to-close and keyboard focus states.
- Codex rebuilt: search plus nine tabs (Classes, Spells, Resonances, Bestiary, Tyrants, Biomes, Controls, Changelog, Credits) with a discovery progress bar.
- The deploy sheds the retired keyart JPEGs, legacy icon set and player sheets; the asset manifest is reconciled with the shipped v3.1 library and validates clean (128/128).

## Version 3.0.0 — The Pixel Reforging (2026-11-20)

- The whole game is re-skinned to the v3 concept boards: enchanted dark-purple panels with gold filigree corners, diamond ornaments, notched hex plaques, keycap chips and gem finials across every screen.
- The main menu is the concept vista — a pixel-art rift twilight with the star-in-arch title, hex SOLO RUN / ONLINE PARTY plaques, a dice-and-pencil seed bar and the VAULT · RUNES · CODEX · SETTINGS rail.
- The combat HUD is the concept layout: octagonal portrait with pill bars and icon sockets, the act/wave banner with its gold underline, the tyrant bar with skull socket and counter, score chip, currency pills, a live minimap with foe blips, rift objectives, a party plate and the keycapped ability bar with the conic SURGE ring.
- Every in-run overlay speaks the upgrade-card language — banner tabs, hex medallions, inset stat boxes, trait callouts and diamond-pip rows over the wizard-sanctum vista.
- The defeat and victory screens are full-bleed results boards: gradient DEFEAT/VICTORY titles with laurels, cause-of-death and fell-at panels, YOUR BUILD with spell tiles and resonance chips, six-stat strips, run summary and rewards.
- The settings dialog is the three-column concept layout: nav rail, center pane per section, HUD/colorblind/flashing column and the Reset · Discard · Save action bar.
- The bestiary is now chibi pixel sprites, canvas-drawn in-engine: skeleton warriors, cultist mages, goblin raiders, wraiths, rift oozes, imps, bats and thorn menders — with idle, walk, attack, hurt and death frames.
- The five tyrants take their concept names and silhouettes: Bone Regent the Grave Tyrant, Pyre Behemoth the Infernal Engine, Void Seraph the Eclipse Herald, Rift Colossus the Shattered Guardian and Frost Leviathan the Glacial Wyrm.
- You play the chibi witch from the reference sheet — purple hat, gold-trimmed robe and a glowing staff, with cast, hurt and KO poses.
- The arena floor is a pixel-cobblestone plaza with a breathing gold summoning circle at its heart.
- The GLTF bestiary and its clip bank are retired — the deploy sheds their megabytes; terrain decor, particles and spell icons remain, credited in the Codex.

## Version 2.2.0 — The Reforged Update (2026-10-28)

- A real loading screen: the game now opens behind a byte-accurate summoning veil (sprites, the mage and the clip bank arrive first; the bestiary and terrain stream behind it), and starting a run waits for the relics with live MB progress instead of falling through to fallback art after 8 seconds.
- New-device smoothness: the arena now builds behind the loading veil, the twenty in-run glass panels dropped their per-frame backdrop blur, and the 3D loop stops rendering entirely behind the fully opaque menu, defeat and credits screens.
- The whole deploy shed about 9 MB: unreferenced source art moved out of the site, the two byte-identical social images became one 133 KB JPEG, the 651 KB favicon became a 1 KB vector, and 49 unused packages left the project.
- The brand typefaces (Cinzel + Alegreya Sans) are now self-hosted and preloaded — no third-party font requests, one less origin in the privacy policy.
- Truthful numbers everywhere: the defeat-screen tithe now reads the way the code pays (75% to the rift), a run is described as five act bands drawn from ten terrains, and the data-stance copy claims exactly what the game does.
- Landscape phones see the Enter button without scrolling (short-viewport menu compaction), pinch zoom works again, the first Tab key no longer lands on an invisible link, and Wave 1 reads as Wave 1 from the opening countdown.
- Time Survived now counts the run you actually played (wall time in play, countdowns included), Re-Enter says it restarts from wave 1, and the seed field shows a visible focus ring.
- Installed-to-home-screen launches land on the game, not the host root (manifest start_url fixed for the subpath deploy).

## Version 2.1.1 — The Visibility Update (2026-10-27)

- Search and AI discoverability: an XML sitemap, a canonical URL, VideoGame structured data and an llms.txt written for language models.
- A prerendered, screen-reader-first summary makes the rift legible without JavaScript; every version label in the game derives from this changelog.
- Terms of Service and a Privacy Policy state exactly what the game collects (nothing), reachable from the main menu.
- One intentional type system (Cinzel + Alegreya Sans only), a branded 404, standard 1200×630 social-share images, entrances that respect prefers-reduced-motion, micro-captions lifted to readable contrast.

## Version 2.1 — The Evolution Update (2026-10-26)

- Spell Evolutions: 22 evolution cards across all 13 elements. After wave 12, a long-bound spell may be offered an evolution with real trade-offs (heavier and slower, or faster and lighter); one evolution per spell per run, deterministic per seed.
- The five MERCY_* constants became the single source of truth for the mercy ladder, read directly by the engine, spell and spawn code (behavior-preserving, regression-harnessed).
- Colorblind-safe element palettes (deuteranopia, protanopia, tritanopia), left-hand mirror mode and one-thumb tap-to-cast.
- Death-cause log, off-screen threat markers, Screen Wake Lock, gamepad-disconnect auto-pause, battery-aware quality/FPS mode, and an offline crash-snapshot overlay.
- QoL batch: 3-2-1 resume countdown, quick same-seed re-entry, haptic cues, low-HP vignette slider, music ducking, 30/60 fps cap; dead exports removed and the 250 ms HUD poll retired for the engine's event stream.

## Version 2.0 — The Resonance Update (2026-10-24)

- The game became ARCHMAGE: RIFTBOUND — 3D Edition, its own line beside the original Archmage: Rift Survivor.
- Readable cooldowns (exact remaining seconds + READY), absolute Mute All, blink at about nine strides following the mouse with a safe-spot search, readable aether glyphs, input hygiene across menus, combat, pauses and overlays, explicit destination-slot binding, and static GitHub Pages deployment beside the normal server build.

## Version 1.2 — The Shifting Rift (2026-10-24)

- Ground tied to the rift seed: Rift's Choice rolls a fresh terrain every act (every 10 waves), every run rolls a fresh rift; six terrains that look nothing alike, including the Graveyard dressed from Kenney's kit.
- Melee foes chain true attack combos with a heavy finisher, the fallen collapse to the ground, tyrants move with weight; brightness range widened 50–250, a field-of-view setting, three save slots, credits and controls moved into the Codex.

## Version 1.1 — The Living Rift (2026-10-23)

- Real animation clips for the imp and brute families; ghost, slime and plant motion rebuilt; foe bodies match their true hitboxes.
- Five arena terrains, rift-seed control (same seed and terrain build the same arena), a brightness rescale, the Codex section, simplified names, and a touch-target audit (every tap zone 44px or larger).

## Version 1.0 — The Third Dimension (2026-10-21)

- The base release: fifty waves, thirteen spells, seventy-eight resonances, five tyrants and six biomes from the Dark Gate to the Abyss.
- The Vault (permanent upgrades bought with aether glyphs), the mercy ladder, a true 3D arena with a quality governor easing resolution toward 60 fps, every input modality, and open-source art from seven itch.io packs.
