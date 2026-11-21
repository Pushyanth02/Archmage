/* ARCHMAGE: RIFTBOUND — "Rift Night" art-direction system.
   ONE module owns the master palette, the typography roles and the unified
   pixel-art icon registry. Every surface (canvas, HUD, menus, overlays)
   imports from here — no component may hand-roll a color, an element-icon
   mapping or a legacy fallback path again.

   Perspective contract: top-down 3/4 orthographic, nearest-neighbor pixel
   rendering (CSS image-rendering: pixelated + canvas imageSmoothingEnabled
   = false), feet-anchored ground pivots, cast ground shadows, 4-directional
   character facing (down/up/left/right). */

import { assetPath } from "@/lib/asset-path";

/* ------------------------------------------------------------------ */
/*  MASTER PALETTE — the Rift Night standard                           */
/* ------------------------------------------------------------------ */
export const PALETTE = {
  /* grounds & ink */
  void: "#171321",        // canvas void / deep shadow (primary 60% ground)
  ink: "#140E1D",         // universal outer silhouette ink
  panel: "#1B1528",       // recessed surface / panel fill (low)
  panelRaised: "#241C33", // recessed surface / panel fill (high)
  stone: "#3D3152",       // gothic stone midtone
  stoneRim: "#7A669C",    // gothic stone rim highlight
  /* metals & magic */
  gold: "#D9BA72",        // antique gold — trim, headings, active selection
  goldHi: "#F8E7BF",      // gold highlight
  violet: "#A991F7",      // arcane violet — magic core, borders, accents
  violetHi: "#E8D6FF",    // arcane violet peak
  teal: "#58D6C2",        // aether teal — frost, mana, verified states
  crimson: "#E96578",     // danger crimson — HP, telegraphs, hazards
  /* text hierarchy */
  text: "#EFEAF7",        // primary
  textDim: "#BFB5D4",     // secondary
  textMuted: "#9E93B5",   // muted
} as const;

/** Rarity color coding for the Vault (drawn from the master palette —
 *  every rarity stays inside the approved hues). */
export const RARITY = {
  common: { label: "Common", color: PALETTE.textDim },
  attuned: { label: "Attuned", color: PALETTE.teal },
  arcane: { label: "Arcane", color: PALETTE.violet },
  regal: { label: "Regal", color: PALETTE.gold },
} as const;
export type RarityKey = keyof typeof RARITY;

/* ------------------------------------------------------------------ */
/*  TYPOGRAPHY ROLES                                                   */
/*  display = Cinzel (sharp fantasy/editorial) · body = Alegreya Sans   */
/*  (clean geometric sans) · mono = tabular numerics (stats/cooldowns)  */
/*  Wired in globals.css (.font-display / .font-body / .font-mono).    */
/* ------------------------------------------------------------------ */
export const TYPE = {
  display: "font-display", // titles & headings
  body: "font-body",       // body copy & controls
  mono: "font-mono tabular-nums tracking-wider", // every stat/cost/timer
} as const;

/* ------------------------------------------------------------------ */
/*  UNIFIED PIXEL-ART ICON REGISTRY                                    */
/*  ONE source of truth mapping every game concept to its v3.1 pixel   */
/*  asset. Gameplay HUD, Title Hub, Vault, Runes and Codex all render  */
/*  through these functions — 100% icon parity by construction.        */
/* ------------------------------------------------------------------ */

/** The v3.1 pack renames the classic element trio + nature. */
const V31_ELEMENT: Record<string, string> = {
  fire: "ember",
  ice: "frost",
  lightning: "volt",
  nature: "vitality",
};
/** Elements whose v3.1 file name is the plain element id. */
const V31_ONE_TO_ONE = new Set([
  "earth", "shadow", "light", "time", "void", "arcane", "wind",
]);

/** The one and only element-icon resolver (HUD + all screens + overlays). */
export function elementIcon(el: string): string {
  if (!el) return "";
  if (V31_ONE_TO_ONE.has(el)) return assetPath(`/assets/v31/icons/element-${el}.png`);
  const renamed = V31_ELEMENT[el];
  if (renamed) return assetPath(`/assets/v31/icons/element-${renamed}.png`);
  /* blood & sonic have no v3.1 crest — the arcane rune stands in (still
     pixel art, still the palette; no legacy 64px set is shipped anymore) */
  return assetPath("/assets/v31/icons/element-arcane.png");
}

/** HUD / Vault / Runes / Codex shared currency & vitals icons. */
export const ICON = {
  heart: () => assetPath("/assets/v31/icons/heart.png"),
  flask: () => assetPath("/assets/v31/icons/flask.png"),      // aether vial
  crystal: () => assetPath("/assets/v31/icons/crystal.png"),  // aether glyphs
  coins: () => assetPath("/assets/v31/icons/coins.png"),      // gold / score
  chest: () => assetPath("/assets/v31/icons/chest.png"),      // the Vault
} as const;

/** Class & boss portraits (the exact busts the HUD and results screens use). */
export const PORTRAIT = {
  player: () => assetPath("/assets/v31/portraits/stormcaller.png"),
  boss: (id: string) => assetPath(`/assets/v31/portraits/${id}.png`),
  /** The six playable classes (Codex + Runes previews). */
  class: (id: string) => assetPath(`/assets/v31/portraits/${id}.png`),
} as const;

/** Tyrant portrait rules — boss display name → deployed v3.1 bust
 *  (the five act bosses share four busts; mirrors the HUD's rules). */
const BOSS_PORTRAIT_RULES: [RegExp, string][] = [
  [/bone regent/i, "bone_regent"],
  [/pyre behemoth/i, "tyrant_grave"],
  [/void seraph/i, "blight_colossus"],
  [/rift colossus/i, "blight_colossus"],
  [/frost leviathan/i, "rift_leviathan"],
];
export function bossPortrait(name: string | null | undefined): string | null {
  if (!name) return null;
  for (const [re, id] of BOSS_PORTRAIT_RULES) if (re.test(name)) return PORTRAIT.boss(id);
  return null;
}

/** Relic / artifact icons for the Vault grid, HUD rewards and results. */
export const RELIC = {
  amulet: () => assetPath("/assets/v31/relics/amulet.png"),
  chalice: () => assetPath("/assets/v31/relics/chalice.png"),
  crown: () => assetPath("/assets/v31/relics/crown.png"),
  grimoire: () => assetPath("/assets/v31/relics/grimoire.png"),
  ring: () => assetPath("/assets/v31/relics/ring.png"),
  staff: (kind: "aether" | "chrono" | "fire" | "ice" | "storm" | "void") =>
    assetPath(`/assets/v31/relics/staff_${kind}.png`),
  tome: () => assetPath("/assets/v31/relics/tome.png"),
} as const;

/** The Vault's four permanent upgrades → v3.1 pixel relic art (was lucide). */
export const RELIQUARY_ICON: Record<string, () => string> = {
  vitality: RELIC.chalice,        // +HP     — the life chalice
  power: () => RELIC.staff("fire"), // +DMG   — the pyre staff
  focus: RELIC.amulet,            // +Aether — the arcane amulet
  swiftness: RELIC.ring,          // +Speed  — the quickening ring
};

/** Static pixel-art sprite previews cropped from the validated atlases
 *  (enemy/boss/mage idle/down frame 0) — generated by
 *  scripts/crop-previews.py from the deployed sheets. */
export const PREVIEW = {
  enemies: (id: string) => assetPath(`/assets/v31/preview/enemy_${id}.png`),
  boss: (id: string) => assetPath(`/assets/v31/preview/boss_${id}.png`),
  mage: (id: string) => assetPath(`/assets/v31/preview/mage_${id}.png`),
} as const;

/** The Codex biome gallery — the tileset previews cropped from the
 *  environment atlases (one ground tile per family, 2× block density). */
export const BIOME_TILE = {
  cursed_grove: () => assetPath("/assets/v31/preview/biome_cursed_grove.png"),
  undead_crypt: () => assetPath("/assets/v31/preview/biome_undead_crypt.png"),
  blighted_marsh: () => assetPath("/assets/v31/preview/biome_blighted_marsh.png"),
} as const;
/** Terrain id → tileset family (mirrors v31sheets.TILESET_FOR_TERRAIN). */
export const BIOME_FAMILY: Record<string, keyof typeof BIOME_TILE> = {
  rubble: "cursed_grove",
  plaza: "cursed_grove",
  ring: "cursed_grove",
  lanes: "cursed_grove",
  chaos: "cursed_grove",
  astral: "cursed_grove",
  graveyard: "undead_crypt",
  glacial: "undead_crypt",
  caldera: "blighted_marsh",
  thornwild: "blighted_marsh",
};

/** Enemy type → v3.1 preview id (the exact sheet the engine renders in
 *  combat; mirrors v31sheets.V31_ENEMY_BY_TYPE / BY_BODY). */
export const ENEMY_PREVIEW: Record<string, string | null> = {
  goblin: "plaguebearer",
  archer: "bone_archer",
  swarm: null,        // procedural bat — no sheet
  imp: "skeleton_warrior",
  skitter: null,      // procedural
  knight: "shieldbone_knight",
  assassin: "wraith",
  bomber: "plaguebearer",
  mage: "cultist_acolyte",
  tank: "flesh_construct",
  lancer: "skeleton_warrior",
  elemental: "wraith",
  necromancer: "necromancer",
  warden: "cultist_acolyte",
  shadow: "wraith",
  timewalker: "wraith",
  mender: "necromancer",
  golem: "flesh_construct",
  voidbeast: "wraith",
  boss: "bone_regent",
};
/** Boss id (vorrac/korrath/…) → preview id. */
export const BOSS_PREVIEW: Record<string, string> = {
  vorrac: "bone_regent",
  korrath: "blight_colossus",
  solenne: "rift_leviathan",
  ysed: "blight_colossus",
  maelthar: "rift_leviathan",
};
/** The six playable classes → preview id (v3.1 mage sheets). */
export const CLASS_PREVIEW: Record<string, string> = {
  stormcaller: "stormcaller",
  pyromancer: "pyromancer",
  cryomancer: "cryomancer",
  voidweaver: "voidweaver",
  aethermancer: "aethermancer",
  chronomancer: "chronomancer",
};

/** Integer pixel scales only — crisp atlas crops, never fractional blur. */
export const PIXELATED = "[image-rendering:pixelated] select-none pointer-events-none" as const;
