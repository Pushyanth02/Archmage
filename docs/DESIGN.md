# ARCHMAGE: RIFTBOUND — Interface & Design Reference

Distilled from the shipped component code (`src/components/game3d/*`, `src/app/globals.css`). Every metric below exists in the tree; this file replaces the 1,419-line wireframes document.

## Screen inventory

| Screen | Guard | What is on it |
|---|---|---|
| Main menu | `screen==='menu' && phase==='menu'` | Keyart backdrop (52s ken-burns drift, dusk veil, tri-radial glows), gold sigil ring + motes/embers, film grain, collapsing letterbox bars. Title in Cinzel `clamp(52px,9vw,110px)`, version tag bottom-right, biome panel with 5-stop itinerary preview, seed row (input + reroll + copy), ENTER THE RIFT CTA, Vault / Runes / Codex / Settings row, records strip, legal row. |
| Run HUD | mounted while `inRun` | Vitals plate top-left: vitality `#ff4d6b→#ff8fa3`, aether `#9a7bff→#c9baff`, surge `#b8860b→#f5c96b`, RIFT MERCY badge while mercy > 0.1%. Wave plate + boss bar top-center (boss fill = boss color). Score / glyph / foes top-right. Spell bar bottom: 3 slots with rising cooldown curtains, weave window (1.5s resonance timer), blink pip. Hints strip at ≥640px non-touch. Engine pushes `HudSnapshot` at 30 Hz; `apply()` writes DOM refs directly, zero React renders. |
| Pause | `phase==='paused'` | One `max-w-sm` card (`#14101f`): THE WEAVE HOLDS ITS BREATH, Resume / Settings / Abandon Run, h-11 buttons. Sim frozen, scene keeps rendering. |
| Defeat | `phase==='gameover' && !triumph` | FELL AT WAVE in 6xl serif, killer + last three wounds, 6 stats, glyph payout (25% banked on death, 75% to the rift), seed, Re-Enter Same Rift (restarts from wave 1) / Return. |
| Victory | `phase==='credits'` | Deeds roll (waves, foes, damage, first-woven resonances, tyrants, time, glyphs at 100% banked), Return (seal it) or Fight the Endless Echo (wave 51+, escalating). |
| Codex | `screen==='codex'` | Controls per device, lore, the changelog, art credits. |
| Vault | `screen==='reliquary'` | 4 upgrade tracks × 6 levels, cost `round(20 + 18L + 8L²)` glyphs, level pips, live bonus footer. |
| Runes | `screen==='arcanum'` | 5 tabs: Spellbook (13 element cards), Resonances (78 pair cards, locked pairs hidden until woven), Bestiary (first-kill discovery), Tyrants (waves 10/20/30/40/50), Records. |
| Settings | Radix dialog, z-50, over any screen incl. pause | Audio sliders + Mute All (M hotkey), video/feel toggles, quality 50–100, brightness, auto-performance, mercy tier chips (AUTO + tiers), touch & comfort (left-hand mirror, one-thumb, haptics), two-step reset dialog. |
| Legal | dialog from the menu footer | Terms of Service + Privacy Policy; one dialog, two documents, tab switch. |

In-run overlays (sim frozen, arena renders on, Escape does not dismiss): Banner (top 10%, z-30, 1.1s min-show / 2.5s life, newer banners queue), Tribute Gate (every 5th wave, 3 boon cards, mandatory pick), Spell Tear (3-card pool with explicit destination-slot plates, skip is legal), Sacrifice Merge (waves 9/19/29/39/49, pick exactly two), Evolve (after wave 12, v2.1).

## Loading veils (v2.2)

Two stages, one look: rune spinner, violet/teal ambient glows, `role="status"` + `aria-live`, fits 390px.

- **Boot, "Summoning the Rift"** — holds the menu reveal while the essentials tier streams (particle sprites, the mage/staff/imp trio, the shared clip bank). Byte-accurate progress, 6s cap.
- **Run, "Attuning the Rift"** — holds a run click while the rest of the relics stream (bestiary, terrain, spell icons). Live MB progress, 30s ceiling, then procedural fallback.

The spinner halts under `prefers-reduced-motion`; the progress bar pulse is reduced-motion aware.

## Breakpoints and orientation tiers

Tailwind defaults; `sm:` does most of the work. base <640px runs compact HUD (wave plate stacks below vitals, spell bar rides `bottom-52` to clear the touch cluster); ≥640px gets full metrics; `md:` only upsizes the menu title and the tyrant grid; `lg:` only adds Runes third column; `xl:` has no rules. Touch targets are ≥44px everywhere (menu buttons `min-h-11`).

| Condition | Rule | Effect |
|---|---|---|
| portrait ≤639px | wave plate `top:10rem`, spell slots `bottom:13rem` | plates clear the corner stacks and the touch cluster |
| landscape ≤430h | `[data-hud-root] { zoom: 0.84 }` | the whole HUD (offsets + fonts) scales down together |
| landscape ≤360h | `zoom: 0.72` | very short 320–360h devices |
| everything else | Tailwind `top-4` / `bottom-5` anchors | desktop, landscape phones, portrait tablets |

`zoom` (not `transform: scale`) reflows layout, so absolute px offsets stay coherent; pre-126 Firefox ignores it and falls back to full size. The damage-number layer sits outside `[data-hud-root]`, so world-aligned numbers stay 1:1.

## Touch controls

Twin-thumb layer, z-20, mounts only in touch mode while `playing`. Left 40%×45% move zone summons a floating stick at the touch point (104px ring, 48px gold knob, ≤52px travel, up = −Z). Right cluster positions and sizes from CSS custom properties on `.tc-root`:

| Token | Value | Phone 375h | Tablet 768h+ |
|---|---|---|---|
| `--tc-cast` | `clamp(72px, 15vh, 96px)` | 72px | 96px |
| `--tc-btn` | `clamp(56px, 11.5vh, 74px)` | 56px | 74px |
| `--tc-mini` | `clamp(48px, 10vh, 62px)` | 48px | 62px |
| `--tc-hint` | `clamp(96px, 20vh, 124px)` | 96px | 124px |
| `--tc-edge` / `--tc-gap` | 16/12px (20/16px at ≥700h coarse) | 16/12px | 20/16px |

Every offset adds `env(safe-area-inset-bottom/right)` inside inline `calc()` (Tailwind arbitrary values cannot compile `env()` fallbacks), so the cluster clears notched and home-bar edges in every rotation. CAST and VOLLEY hold; BLINK, SURGE and SPELL tap. Per-pointer capture keeps stick + buttons working simultaneously; held inputs zero on release, cancel and layer hide. Meters come from a 250ms HUD-snapshot mirror.

Left-hand mirror (Settings → Touch & Comfort) flips zones and cluster to the left edge via `data-mirrored` CSS. One-thumb mode aims casts along the move stick, with auto-target covering standing still. Touch-primary devices auto-go immersive on the first gesture (fullscreen + `screen.orientation.lock("landscape")` on Android; portrait rotate-gate at z-70 where lock is refused, iOS included), auto-pausing the run on rotation; the installed PWA launches pre-snapped (manifest `display:"fullscreen"`, `orientation:"landscape"`).

## Type system

**Cinzel** (display) + **Alegreya Sans** (body), self-hosted and preloaded since v2.2, the only fonts the site ships (no third-party font requests). Signature grimoire caps: headings uppercase with 0.12–0.42em tracking, gold with glow; seeds and stat numerals in mono; body copy at `text-xs` white/50 with italic flavor at white/40.

## Color palette

Dark-grimoire: near-black arcane ground, gold serif accents, thin `white/10` glass borders, colored glows instead of drop shadows. No blue/indigo primaries.

| Token | Value | Role |
|---|---|---|
| Night | `#0a0812` | app background; full screens wash it at 95% |
| Gold | `#f5c96b`, bright `#ffe9ad` | accents, CTA text and glow, seals, surge bar, glyph numerals |
| Violet | `#9a7bff` | aether, arcane element, resonance theming |
| Teal | `#43e8d8` | blink, quality slider, positive accents |
| Crimson | `#ff4d6b` | vitality, danger actions, defeat theming |
| Panel | `#14101f` (defeat card `#14080f`) | modal and card fills |

Text hierarchy is a white-alpha ramp from `white/90` down to `white/20`. The 13 element colors drive spell-slot borders, offer cards and VFX: fire `#ff7847`, ice `#7fd8ff`, lightning `#ffe86b`, earth `#c9955a`, shadow `#b06bff`, light `#fff3b0`, time `#6bf0c2`, void `#d05bff`, arcane `#9a7bff`, blood `#ff4d6b`, nature `#7ed957`, wind `#8ce8dc`, sonic `#ff9ede`. Colorblind palettes (deuteranopia, protanopia, tritanopia) remap these with lightness separation; shape and name cues always carry identity too.

## Motion rules

- Shell-wide framer `MotionConfig reducedMotion="user"`; entrances respect `prefers-reduced-motion`.
- Overlays fade + y:20 in ~0.3s, exit 0.2–0.35s; card children stagger 0.09–0.14s; menu cascade 0.25→1.05s; banner in/out 0.3s.
- Decorative CSS loops (ken-burns, sigil spin, motes, embers, grain, veil spinner) stop under `prefers-reduced-motion`.
- World-side pulses are gated by the reduce-flashes setting; UI motion is not reduced by it.
