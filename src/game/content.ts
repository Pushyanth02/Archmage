/* Static game content: seeded RNG, spells, combinations, enemies, scaling, arena generation.
   Patch 7.0 "The Pure Arcanum": the story layer is GONE — no cutscenes, no
   NPC dialogue, no art beyond the cover. Acts remain as biome definitions
   (canvas palettes + music roots), bosses keep their identities as pure
   mechanical encounters, and the meta save gains bestiary discovery
   tracking (seenEnemies / seenBosses). Settings lose the cutscenes toggle
   and gain a damage-numbers toggle. All prior cadences are unchanged:
   3 starting spells, drops every 3-5 waves, merges every 10 waves, tribute
   gates every 5 waves, five shuffled bosses.
   Patch 9.0 "The Expanded Rift": +2 elements (wind, sonic → 13 spells,
   78 resonances), +5 normal enemy types (19 total), Rift Mercy reworked to
   a per-death assist ladder with a selectable tier, the global −10%
   difficulty now ALSO covers spawn pressure, and the arena became a fixed
   1920×1280 world with five seed-driven layout archetypes.
   Patch 10.2 "The Thinking Rift": the world grows to 2560×1600 with EIGHT
   layout archetypes (three new floor plans), and the Rift Seed now also
   drives an enemy ECOLOGY — poolBias() bends every foe type's spawn weight
   per seed (two "featured" stars surge, some fade), so altering the seed
   reshapes both the map AND the monster pool.
   Patch 11.0 "The Umbral Requiem": full dark-arcane REBRAND — every spell,
   tyrant, foe and act is renamed into the black-grimoire register (ids stay
   stable so saves keep working), and the DROP ECONOMY becomes STRICT: each
   wave fields exactly ONE drop type (spell / heart / resonance / tribute),
   spell orbs no longer heal (hearts are their own drop), and resonance orbs
   demand a sacrifice — two bound spells fused into one. */

/* ------------------------------ Seeded RNG ------------------------------ */
export interface RNG {
  next(): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeedString(): string {
  const words = ["rune", "veil", "ember", "tide", "crown", "star", "gloom", "pyre", "frost", "echo", "hex", "dawn"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/* Static-asset base path (empty in dev/standalone; set to the repo subpath
   for the GitHub Pages static export, e.g. NEXT_PUBLIC_BASE_PATH=/archmage).
   The game ships exactly ONE image — the menu cover — so this is the only
   place raw asset URLs need a prefix. */
export const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/* ------------------------------- Elements ------------------------------- */
export type ElementId =
  | "fire" | "ice" | "lightning" | "earth" | "shadow" | "light" | "time" | "void"
  | "arcane" | "blood" | "nature" | "wind" | "sonic";

export const SPELL_ORDER: ElementId[] = [
  "fire", "ice", "lightning", "earth", "shadow", "light", "time", "void",
  "arcane", "blood", "nature", "wind", "sonic",
];

/* Keycaps shown on the HUD slots — only 3 are visible at a time (Patch 4.0).
   Extra entries are kept for any future slot expansion. */
export const SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "–"];

/* Patch 5.0 — The Reforged Path. Player begins with three starter spells.
   Spell drops are SCHEDULED every 3-5 waves (strict, no per-kill %).
   Merge-spell intermission triggers every 10 waves (at waves 9/19/29/39/49
   — i.e. one wave before each boss) so the player can fuse two equipped
   spells into a single more powerful merged slot. Patch 6.0 replaces the
   old boon gate with a mandatory TRIBUTE gate of scalable stat rewards
   every 5 waves. Five unique bosses (one per 10-round set) are shuffled
   per restart so each run sees a different tyrant order through the acts. */
export const STARTER_SPELLS: ElementId[] = ["fire", "ice", "lightning"];
export const EQUIP_SLOTS = 3;
export const TRIBUTE_INTERVAL = 5;         // tribute (reward) gate cadence (waves) — mandatory pick
export const MERGE_INTERVAL = 10;          // merge-spell cadence (waves)
/* Drop cadence is a strict [min,max] wave interval, rolled once at run start
   and re-rolled after each drop. NO per-kill % rolls — the user's directive.
   Patch 10.0: SPELL_DROP_NERF is a flat global nerf to the magic-spell drop
   rate — exactly 10%. Patch 11.0 stacks a SECOND flat −10% on top
   (1 − 0.9 × 0.9 = 0.19): each scheduled spell drop has a 19% chance to be
   reabsorbed by the rift (silently skipped, cadence re-rolled), so the
   expected number of spell drops over any stretch of waves is exactly
   0.81× the pre-10.0 rate. Applies everywhere, every device, whole run.
   Patch 11.0 STRICT ECONOMY: every wave resolves exactly ONE drop type —
   spell, heart, resonance or tribute (see resolveWaveDrop in engine.ts).
   Tribute waves pay out through the end-of-wave gate only; resonance orbs
   open the sacrifice-two merge; hearts are the only source of drop healing
   (spell orbs no longer mend). */
export const SPELL_DROP_WAVE_MIN = 3;
export const SPELL_DROP_WAVE_MAX = 5;
export const SPELL_DROP_NERF = 0.19;        // two cumulative −10% nerfs (10.0 + 11.0)
export const HEART_DROP_HEAL_FRAC = 0.25;   // hearts mend 25% max HP (the dedicated heal drop)
export const SPELL_OFFER_COUNT = 3;        // spells shown per drop overlay

/** The strict per-wave drop economy: a wave fields AT MOST one of these. */
export type DropKind = "spell" | "heart" | "resonance" | "tribute" | "none";

/* ------------------------- Patch 6.0 — balance knobs ------------------------- */

/* Global difficulty: all enemy HP and damage are scaled by this factor.
   0.9 = the requested "10% easier" across the board (speed untouched so the
   game FEELS identical, just less punishing). Applies to bosses + hazards
   as well (boss stats come from BOSS_DEFS; hazards scale with wave).
   Patch 10.1 — a SECOND global −10% (0.9 × 0.9 = 0.81): the foundational
   update lowers base difficulty another tenth across HP, damage, wave
   budget, spawn cap and elite pressure. Rift Mercy then personalizes on
   top of this gentler baseline. */
export const DIFFICULTY_MULT = 0.81;

/* Patch 10.0 — the victory wave: clearing wave 50's tyrant seals the rift
   and rolls the end-credit sequence ("you closed the rift"), after which
   the player chooses RETURN (bank the triumph) or FIGHT (endless mode). */
export const VICTORY_WAVE = 50;

/* Rift Mercy — Patch 9.0 "Per-Death Assist Ladder".
   -----------------------------------------------------------------------
   Mercy no longer climbs per round. It accumulates across PLAYTHROUGHS:
   every death banks one mercy stack (a victory clears the ladder), and the
   effective TIER converts into a full assist package (see engine.ts for the
   attack/defense/spawn applications):
     tier 1 (first death)   → 2% base, scaling to 4% within a run
     tier 2 (second death)  → 6% base, scaling to 8%
     tier 3+                → +4% per additional death
   In-run growth: +0.5% per round survived, capped at base+2%. The ladder
   tops out at MERCY_MAX_TIER (8 → 30%) so the rift can always bite back.
   The player may manually select any LOWER tier (or none) in Settings —
   Hades-God-Mode style dignity: the assist is offered, never forced. */
export const MERCY_BASE = 0.02;          // tier-1 starting assist
export const MERCY_PER_TIER = 0.04;      // +4% per additional death tier
export const MERCY_RUN_GROWTH = 0.005;   // +0.5% per round survived, in-run
export const MERCY_RUN_GROWTH_CAP = 0.02; // growth caps at +2% within a run
export const MERCY_MAX_TIER = 8;         // ladder cap (tier 8 = 30%)

/** Base assist fraction for a mercy tier (0 → 0%). */
export function mercyTierBase(tier: number): number {
  if (tier <= 0) return 0;
  const t = Math.min(tier, MERCY_MAX_TIER);
  return MERCY_BASE + (t - 1) * MERCY_PER_TIER;
}

/** Effective Rift Mercy fraction at the given wave for the given tier. */
export function mercyForRound(wave: number, tier: number): number {
  if (tier <= 0) return 0;
  const base = mercyTierBase(tier);
  const growth = Math.min(MERCY_RUN_GROWTH_CAP, Math.max(0, wave - 1) * MERCY_RUN_GROWTH);
  return base + growth;
}

/* The concrete assist package a mercy fraction grants (applied in engine):
   defense  — incoming damage × (1 − m)
   attack   — spell damage   × (1 + m × 0.75)
   spawns   — wave budget    × (1 − m × 0.60)   (fewer enemies per wave)
              live cap       × (1 − m × 0.40)
   foes     — enemy HP       × (1 − m × 0.35)
              enemy speed    × (1 − m × 0.25)
   These multipliers live next to their call sites in engine.ts. */
export const MERCY_ATTACK = 0.75;
export const MERCY_SPAWNS = 0.60;
export const MERCY_CAPLIVE = 0.40;
export const MERCY_HP = 0.35;
export const MERCY_SPD = 0.25;

/* Tribute gate reward count. */
export const REWARD_COUNT = 3;

/* ------------------------------- Bosses -------------------------------- */
/* Five unique bosses — one per 10-round set. On every run the engine
   shuffles BOSS_ORDER via the seed so the player faces them in a different
   order each restart. Patch 7.0: bosses are PURE mechanical encounters —
   no art, no backstory, no dialogue. Patch 10.2: every tyrant now runs a
   fully DISTINCT behavior set (see the boss brains in engine.ts) — the
   `mechanics` line below honestly describes each one's actual kit. All of
   them enrage below half health by ADDING to their pattern, never by
   merely speeding up. */
export interface BossDef {
  id: string;
  name: string;
  title: string;
  hp: number;
  damage: number;
  speed: number;
  radius: number;
  color: string;
  glow: string;
  /** short mechanical readout — what this tyrant actually does in combat */
  mechanics: string;
}

export const BOSS_DEFS: BossDef[] = [
  {
    id: "vorrac",
    name: "Malgrym",
    title: "the Maw of Ruin",
    hp: 950, damage: 26, speed: 55, radius: 44,
    color: "#ff4d6b", glow: "#ffa3b5",
    mechanics: "Stampede charger — stalks, then chains two-to-three re-aimed lane dashes with aimed fan volleys between.",
  },
  {
    id: "korrath",
    name: "Ashgorim",
    title: "the Unquenched Pyre",
    hp: 1300, damage: 30, speed: 50, radius: 46,
    color: "#ff7847", glow: "#ffb08a",
    mechanics: "Immovable juggernaut — never charges; walks you down, slams expanding shockwave rings, and sheds ashfiends.",
  },
  {
    id: "solenne",
    name: "Sylthara",
    title: "the Reaving Waltz",
    hp: 1650, damage: 34, speed: 60, radius: 42,
    color: "#43e8d8", glow: "#aeeaf5",
    mechanics: "Blade dancer — orbits at fencing range on an accelerating tempo of triple fans, then chains lunges through you.",
  },
  {
    id: "ysed",
    name: "Ysolth",
    title: "the Hollow Hour",
    hp: 2000, damage: 38, speed: 45, radius: 44,
    color: "#c0ffeb", glow: "#e0fff5",
    mechanics: "Blink fortress — anchors and channels rotating twin-arm spiral barrages, then blinks around you with a landing pulse.",
  },
  {
    id: "maelthar",
    name: "Mordrax",
    title: "the First Sundering",
    hp: 2600, damage: 44, speed: 65, radius: 48,
    color: "#ff4d6b", glow: "#ffe9ad",
    mechanics: "The apex storm — cycles stampede charges, a multi-arm spiral, and a gravity rift that drags you into the nova.",
  },
];

export const BOSS_ORDER: string[] = BOSS_DEFS.map((b) => b.id);

/* --------------------------------- Acts --------------------------------- */
/* Patch 7.0: acts survive the story purge as BIOME definitions — they drive
   the canvas arena palette, the ambient music root note and the menu's
   progress card. Subtitles are mechanical descriptors, not lore. */
export interface ActPalette {
  /** deep background tint used in the arena gradient */
  sky: string;
  /** rune / border accent (canvas) */
  rune: string;
  /** pillar body gradient ends */
  pillar: [string, string];
  /** ambient mote tint */
  mote: string;
}

export interface ActDef {
  id: number;
  name: string;
  subtitle: string;
  /** waves [start, end] inclusive */
  waves: [number, number];
  palette: ActPalette;
  /** one-line banner text when the act begins (informative, not narrative) */
  flavor: string;
}

export const ACTS: ActDef[] = [
  {
    id: 1,
    name: "The Sunless Vestibule",
    subtitle: "Waves 1–10 · the outer dark",
    waves: [1, 10],
    palette: {
      sky: "88,58,160",
      rune: "245,201,107",
      pillar: ["#2b1d4d", "#191030"],
      mote: "200,180,255",
    },
    flavor: "The dark opens — ten trials to the first tyrant.",
  },
  {
    id: 2,
    name: "The Cinder Labyrinth",
    subtitle: "Waves 11–20 · burning halls",
    waves: [11, 20],
    palette: {
      sky: "140,74,44",
      rune: "255,180,110",
      pillar: ["#3d2620", "#1e120c"],
      mote: "255,190,130",
    },
    flavor: "The maze burns — foes grow bolder.",
  },
  {
    id: 3,
    name: "The Drowned Necropolis",
    subtitle: "Waves 21–30 · sunken depths",
    waves: [21, 30],
    palette: {
      sky: "26,110,124",
      rune: "120,240,226",
      pillar: ["#123a42", "#082126"],
      mote: "150,235,225",
    },
    flavor: "Deep water — faster, stranger foes.",
  },
  {
    id: 4,
    name: "The Silent Sepulcher",
    subtitle: "Waves 31–40 · frozen stillness",
    waves: [31, 40],
    palette: {
      sky: "70,140,128",
      rune: "200,255,235",
      pillar: ["#1e3d3a", "#0d1f1e"],
      mote: "190,255,238",
    },
    flavor: "Stillness — everything hits harder.",
  },
  {
    id: 5,
    name: "The Heart of the Abyss",
    subtitle: "Waves 41–50 · the final wound",
    waves: [41, 50],
    palette: {
      sky: "96,40,110",
      rune: "255,150,170",
      pillar: ["#3a1230", "#1a0916"],
      mote: "240,170,200",
    },
    flavor: "The final heart — seal it or fall.",
  },
  /* Patch 10.0 — THE ENDLESS ECHO: after the credits and the player's FIGHT
     choice, waves 51+ roll on forever inside a sealed-but-humming rift. */
  {
    id: 6,
    name: "The Endless Dirge",
    subtitle: "Waves 51+ · the endless echo",
    waves: [51, 99999],
    palette: {
      sky: "34,20,64",
      rune: "170,140,255",
      pillar: ["#241640", "#100a20"],
      mote: "190,170,255",
    },
    flavor: "The rift is sealed — yet the weave still hums.",
  },
];

export function actForWave(wave: number): ActDef {
  for (let i = ACTS.length - 1; i >= 0; i--) {
    if (wave >= ACTS[i].waves[0]) return ACTS[i];
  }
  return ACTS[0];
}


export interface SpellDef {
  id: ElementId;
  name: string;
  tagline: string;
  color: string;
  glow: string;
  manaCost: number;
  hpCost?: boolean;        // paid in health instead of mana
  cooldown: number;        // seconds
  baseDamage: number;
  desc: string;
}

export const SPELLS: Record<ElementId, SpellDef> = {
  fire: {
    id: "fire", name: "Pyroclasm", tagline: "Hellmouth", color: "#ff7847", glow: "#ffb08a",
    manaCost: 14, cooldown: 0.48, baseDamage: 34,
    desc: "Hurls a searing orb that detonates in profane flame. Applies Smolder.",
  },
  ice: {
    id: "ice", name: "Gravefrost", tagline: "Rimefang", color: "#7fd8ff", glow: "#c8efff",
    manaCost: 12, cooldown: 0.36, baseDamage: 22,
    desc: "Impaling shards of grave-ice skewer the line and numb flesh to stillness.",
  },
  lightning: {
    id: "lightning", name: "Wraithbolt", tagline: "Gallows Spark", color: "#ffe86b", glow: "#fff6c0",
    manaCost: 20, cooldown: 1.0, baseDamage: 30,
    desc: "Instant chain-lightning that leaps between the nearest souls.",
  },
  earth: {
    id: "earth", name: "Gravewarden", tagline: "Ossuary", color: "#c9955a", glow: "#eec390",
    manaCost: 18, cooldown: 3.0, baseDamage: 0,
    desc: "Raises a bone-stone ward that blocks enemies and hostile bolts.",
  },
  shadow: {
    id: "shadow", name: "Umbral Passage", tagline: "The Long Dark", color: "#b06bff", glow: "#d9b3ff",
    manaCost: 16, cooldown: 2.0, baseDamage: 40,
    desc: "Blink through the long dark, striking everything near your arrival.",
  },
  light: {
    id: "light", name: "Lance of Judgment", tagline: "Wrathlight", color: "#fff3b0", glow: "#fffbe0",
    manaCost: 22, cooldown: 1.45, baseDamage: 70,
    desc: "A searing shaft of wrathlight that pierces in a straight line, scorching every foe in its column.",
  },
  time: {
    id: "time", name: "Chronoshroud", tagline: "The Frozen Hour", color: "#6bf0c2", glow: "#c0ffe6",
    manaCost: 24, cooldown: 4.2, baseDamage: 8,
    desc: "Freezes time in a shroud — caught foes crawl at a tenth speed.",
  },
  void: {
    id: "void", name: "Null Rift", tagline: "Hungering Dark", color: "#d05bff", glow: "#ecb3ff",
    manaCost: 22, cooldown: 2.6, baseDamage: 26,
    desc: "A collapsing wound in the world that drags nearby foes inward and crushes them.",
  },
  arcane: {
    id: "arcane", name: "Hexweave Fan", tagline: "Thousand Eyes", color: "#9a7bff", glow: "#c9baff",
    manaCost: 19, cooldown: 0.8, baseDamage: 13,
    desc: "Sprays a fan of hex-seekers in a wide cone. Never misses for long.",
  },
  blood: {
    id: "blood", name: "Crimson Requiem", tagline: "The Tithe", color: "#ff4d6b", glow: "#ffa3b5",
    manaCost: 26, cooldown: 1.6, baseDamage: 110,
    desc: "A heavy piercing javelin of congealed blood. Skewers everything in its line.",
  },
  nature: {
    id: "nature", name: "Blightspore", tagline: "Rotgarden", color: "#7ed957", glow: "#b9f29a",
    manaCost: 17, cooldown: 2.0, baseDamage: 15,
    desc: "Lobs a rot pod that bursts into a choking blight — poison and slow within.",
  },
  /* Patch 9.0 — the rift exhales two new elements. */
  wind: {
    id: "wind", name: "Soulscythe", tagline: "The Hollow Gale", color: "#8ce8dc", glow: "#d2fff8",
    manaCost: 13, cooldown: 0.55, baseDamage: 18,
    desc: "Three crescent blades of hollow wind — piercing, and they shove foes backwards.",
  },
  sonic: {
    id: "sonic", name: "Dirge Nova", tagline: "The Banshee's Cry", color: "#ff9ede", glow: "#ffd6f2",
    manaCost: 15, cooldown: 1.15, baseDamage: 30,
    desc: "A banshee's requital around you — damages, slows and hurls every nearby foe away.",
  },
};

/* ----------------------------- Combinations ----------------------------- */
export function comboKey(a: ElementId, b: ElementId): string {
  return [a, b].sort().join("+");
}

export interface ComboDef { name: string; lore: string }

export const COMBOS: Record<string, ComboDef> = {
  "fire+ice": { name: "Steam Cloud", lore: "Scalding mist that burns and chills at once." },
  "fire+lightning": { name: "Plasma Surge", lore: "Superheated arcs of raw plasma." },
  "earth+fire": { name: "Magma Vent", lore: "The ground itself erupts in molten fury." },
  "fire+shadow": { name: "Ashen Veil", lore: "Choking cinders that swallow the light." },
  "fire+light": { name: "Solar Flare", lore: "A fragment of the sun, briefly held." },
  "fire+time": { name: "Ember Loop", lore: "Flames that reignite yesterday's wounds." },
  "fire+void": { name: "Cinder of Unmaking", lore: "Fire that consumes even absence." },
  "ice+lightning": { name: "Static Frost", lore: "Crackling ice that snaps like lightning." },
  "earth+ice": { name: "Permafrost", lore: "An ancient cold locked in stone." },
  "ice+shadow": { name: "Frozen Nightmare", lore: "Fear given edges of black ice." },
  "ice+light": { name: "Aurora Lance", lore: "The northern sky, sharpened to a point." },
  "ice+time": { name: "Glacial Stasis", lore: "A moment preserved in perfect cold." },
  "ice+void": { name: "Absolute Zero", lore: "The temperature at which reality stops." },
  "earth+lightning": { name: "Magnetic Storm", lore: "Charged stone that drags iron and flesh." },
  "lightning+shadow": { name: "Umbra Storm", lore: "Thunder that strikes from inside your shadow." },
  "light+lightning": { name: "Radiant Tempest", lore: "A storm with a heart of daylight." },
  "lightning+time": { name: "Chrono Discharge", lore: "Lightning that arrives before it is thrown." },
  "lightning+void": { name: "Event Horizon", lore: "The last light before the fall." },
  "earth+shadow": { name: "Buried Dread", lore: "Something moves beneath the flagstones." },
  "earth+light": { name: "Gilded Bastion", lore: "Stone blessed until it gleams." },
  "earth+time": { name: "Petrified Moment", lore: "A second, carved in granite." },
  "earth+void": { name: "Collapse", lore: "The weight of everything, briefly, in one place." },
  "light+shadow": { name: "Reality Tear", lore: "Where both touch, the world comes unstitched." },
  "shadow+time": { name: "Echo of Dusk", lore: "A wound that was always already there." },
  "shadow+void": { name: "Null Whisper", lore: "The quiet between two heartbeats of the dark." },
  "light+time": { name: "Prophecy", lore: "Tomorrow's dawn, borrowed." },
  "light+void": { name: "Starfall", lore: "A dying sun, delivered by hand." },
  "time+void": { name: "Paradox Rift", lore: "A place where causes forget their effects." },
  /* --- Weavebound resonances (patch 2.0) --- */
  "arcane+fire": { name: "Prism Pyre", lore: "Light split into a thousand hungry flames." },
  "arcane+ice": { name: "Glass Storm", lore: "Shards of spellglass, beautiful and cruel." },
  "arcane+lightning": { name: "Runeflash", lore: "The alphabet of storms, read aloud." },
  "arcane+earth": { name: "Levitating Array", lore: "Geometry too heavy for the sky." },
  "arcane+shadow": { name: "Unwritten Hex", lore: "A curse in a language never spoken." },
  "arcane+light": { name: "Lucid Theorem", lore: "Proof, concluded, that light always wins." },
  "arcane+time": { name: "Recursive Moment", lore: "A second that casts itself." },
  "arcane+void": { name: "Paradox Engine", lore: "It computes with the absence of number." },
  "blood+fire": { name: "Boiling Ichor", lore: "What burns in the veins burns twice as bright." },
  "blood+ice": { name: "Crimson Rime", lore: "Frozen at the exact moment of shedding." },
  "blood+lightning": { name: "Pulse Storm", lore: "A heartbeat audible across the field." },
  "blood+earth": { name: "Ironroot", lore: "The ground drinks deep and grows thorns." },
  "blood+shadow": { name: "Night's Open Wound", lore: "The dark leans in to drink." },
  "blood+light": { name: "Martyr's Dawn", lore: "Spilled light rises as steam." },
  "blood+time": { name: "Ancestral Debt", lore: "Paid by the hearts of your grandfathers." },
  "blood+void": { name: "Exsanguinated Star", lore: "Not even light escapes a thirst like this." },
  "fire+nature": { name: "Crownfire", lore: "The forest's answer to the torch." },
  "ice+nature": { name: "Winter Bloom", lore: "Flowers that only open for frost." },
  "lightning+nature": { name: "Stormsap", lore: "Trees grow fastest under a lightning sky." },
  "earth+nature": { name: "Deep Loam", lore: "Beneath the stone, the old garden still dreams." },
  "nature+shadow": { name: "Nightshade Garden", lore: "Every herb has a quieter, darker cousin." },
  "light+nature": { name: "Chorus of Leaves", lore: "Every leaf sings toward the sun." },
  "nature+time": { name: "Perennial Hour", lore: "A springtime that returns daily." },
  "nature+void": { name: "Blight of Unbeing", lore: "Rot that consumes meaning, not flesh." },
  "arcane+blood": { name: "Hemomantic Circuit", lore: "Runes drawn in the only ink that obeys." },
  "arcane+nature": { name: "Grafted Runes", lore: "The sigils took root and grew." },
  "blood+nature": { name: "Carrion Bloom", lore: "The garden rises from what falls." },
  /* --- Patch 9.0 — wind & sonic resonances --- */
  "wind+fire": { name: "Firestorm Front", lore: "A weather system with a grudge." },
  "wind+ice": { name: "Glacier Gale", lore: "A blizzard compressed to a blade." },
  "wind+lightning": { name: "Thunderhead", lore: "The cloud that argues loudest." },
  "wind+earth": { name: "Sandstorm Scepter", lore: "A desert, briefly weaponized." },
  "wind+shadow": { name: "Night Wind", lore: "It passes through without arriving." },
  "wind+light": { name: "Dawn Zephyr", lore: "Morning, arriving early and angry." },
  "wind+time": { name: "Lost Breeze", lore: "Wind from a season that never happened." },
  "wind+void": { name: "Silence Between", lore: "The pause where the storm forgot itself." },
  "arcane+wind": { name: "Rune Winds", lore: "Spells that travel by timetable." },
  "blood+wind": { name: "Crimson Gale", lore: "A red sky at any hour." },
  "nature+wind": { name: "Seed Storm", lore: "Tomorrow's forest, scattered today." },
  "sonic+fire": { name: "Detonation Chorus", lore: "The finale arrives all at once." },
  "sonic+ice": { name: "Shatter Note", lore: "One pitch that breaks crystal." },
  "sonic+lightning": { name: "Discharge Anthem", lore: "A song the sky cannot hold." },
  "earth+sonic": { name: "Tremor Bass", lore: "The deep note that moves stone." },
  "shadow+sonic": { name: "Muffled Dirge", lore: "Played behind a wall of night." },
  "light+sonic": { name: "Radiant Chime", lore: "A bell cast from dawn." },
  "sonic+time": { name: "Frozen Aria", lore: "The singer stops; the song does not." },
  "sonic+void": { name: "Antiphon of Null", lore: "Two silences, harmonized." },
  "arcane+sonic": { name: "Harmonic Rune", lore: "Geometry you can hear." },
  "blood+sonic": { name: "Pulse Requiem", lore: "A heartbeat played in a cathedral." },
  "nature+sonic": { name: "Blooming Chorus", lore: "Every flower opens on the beat." },
  "sonic+wind": { name: "Voice of the Rift", lore: "The storm learned to speak." },
};

export const COMBO_COUNT = Object.keys(COMBOS).length;

/* All element pairs, precomputed once for the Codex. */
export const ALL_PAIRS: [ElementId, ElementId][] = (() => {
  const out: [ElementId, ElementId][] = [];
  for (let i = 0; i < SPELL_ORDER.length; i++) {
    for (let j = i + 1; j < SPELL_ORDER.length; j++) out.push([SPELL_ORDER[i], SPELL_ORDER[j]]);
  }
  return out;
})();

/* -------------------------------- Enemies ------------------------------- */
export type EnemyType =
  | "goblin" | "archer" | "swarm" | "imp" | "skitter" | "knight" | "assassin" | "bomber" | "mage"
  | "tank" | "lancer" | "elemental" | "necromancer" | "warden" | "shadow" | "timewalker"
  | "mender" | "golem" | "voidbeast" | "boss";

export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  speed: number;
  damage: number;      // contact damage
  radius: number;
  color: string;
  glow: string;
  score: number;
  cost: number;        // wave budget cost
  unlockWave: number;
  ranged?: boolean;
  shootsEvery?: number;
  flying?: boolean;
}

/* Patch 11.0 — the bestiary is re-registered in the black-grimoire register:
   every foe keeps its mechanical id (saves stay valid) but answers to a
   darker name. */
export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  goblin:      { type: "goblin", name: "Gutter Ghoul", hp: 26, speed: 126, damage: 8, radius: 13, color: "#7ed957", glow: "#b9f29a", score: 10, cost: 1, unlockWave: 1 },
  archer:      { type: "archer", name: "Ossuary Archer", hp: 20, speed: 96, damage: 5, radius: 12, color: "#d9a05b", glow: "#f2c99a", score: 14, cost: 1.4, unlockWave: 2, ranged: true, shootsEvery: 2.6 },
  swarm:       { type: "swarm", name: "Gravemote", hp: 8, speed: 148, damage: 3, radius: 8, color: "#b06bff", glow: "#d9b3ff", score: 5, cost: 0.5, unlockWave: 3, flying: true },
  imp:         { type: "imp", name: "Ashfiend", hp: 18, speed: 116, damage: 6, radius: 11, color: "#ff8a5c", glow: "#ffc4a3", score: 12, cost: 1.3, unlockWave: 4, flying: true },
  /* Patch 9.0 — five new normal enemy types, slotted between the existing
     unlocks so the bestiary paces out to 19 across the five acts. */
  skitter:     { type: "skitter", name: "Gloom Skitter", hp: 10, speed: 168, damage: 3, radius: 9, color: "#e8c46b", glow: "#ffe9a8", score: 6, cost: 0.5, unlockWave: 5 },
  knight:      { type: "knight", name: "Rustbound Knight", hp: 72, speed: 62, damage: 14, radius: 17, color: "#9aa7c9", glow: "#d4ddf2", score: 24, cost: 2.4, unlockWave: 6 },
  assassin:    { type: "assassin", name: "Shroud Stalker", hp: 30, speed: 135, damage: 12, radius: 12, color: "#6ee7c8", glow: "#b7f5e5", score: 26, cost: 2.6, unlockWave: 8 },
  bomber:      { type: "bomber", name: "Pyrehusk", hp: 24, speed: 132, damage: 16, radius: 12, color: "#ff6b3d", glow: "#ffb08a", score: 18, cost: 1.8, unlockWave: 9 },
  mage:        { type: "mage", name: "Umbra Cultist", hp: 30, speed: 84, damage: 6, radius: 13, color: "#8f7bff", glow: "#c6baff", score: 28, cost: 2.6, unlockWave: 10, ranged: true, shootsEvery: 3.0 },
  tank:        { type: "tank", name: "Bone Colossus", hp: 160, speed: 42, damage: 20, radius: 22, color: "#8a6f5a", glow: "#c4a98d", score: 40, cost: 3.4, unlockWave: 11 },
  lancer:      { type: "lancer", name: "Abyssal Lancer", hp: 46, speed: 92, damage: 14, radius: 14, color: "#43e8d8", glow: "#aef2ea", score: 30, cost: 2.8, unlockWave: 12 },
  elemental:   { type: "elemental", name: "Errant Wraith", hp: 55, speed: 88, damage: 10, radius: 15, color: "#5bd0e7", glow: "#aeeaf5", score: 34, cost: 3.0, unlockWave: 13 },
  necromancer: { type: "necromancer", name: "Bonespeaker", hp: 42, speed: 70, damage: 6, radius: 14, color: "#b7d95b", glow: "#ddf29a", score: 38, cost: 3.2, unlockWave: 15, ranged: true, shootsEvery: 3.4 },
  warden:      { type: "warden", name: "Tempest Herald", hp: 58, speed: 76, damage: 8, radius: 15, color: "#7fb2ff", glow: "#c9e0ff", score: 44, cost: 3.4, unlockWave: 16, ranged: true, shootsEvery: 3.2 },
  shadow:      { type: "shadow", name: "Nightmare Shade", hp: 38, speed: 122, damage: 13, radius: 13, color: "#7a5cff", glow: "#bfaeff", score: 36, cost: 3.0, unlockWave: 17 },
  timewalker:  { type: "timewalker", name: "Chronowraith", hp: 48, speed: 100, damage: 11, radius: 14, color: "#6bf0c2", glow: "#c0ffe6", score: 42, cost: 3.4, unlockWave: 19 },
  mender:      { type: "mender", name: "Corpseweaver", hp: 40, speed: 66, damage: 5, radius: 13, color: "#f2a6ff", glow: "#ffd6f6", score: 46, cost: 3.6, unlockWave: 21, ranged: true, shootsEvery: 2.8 },
  golem:       { type: "golem", name: "Voidcage Golem", hp: 120, speed: 52, damage: 16, radius: 20, color: "#7fd8ff", glow: "#d5f4ff", score: 50, cost: 4.0, unlockWave: 22 },
  voidbeast:   { type: "voidbeast", name: "Nullmaw Beast", hp: 90, speed: 76, damage: 15, radius: 18, color: "#d05bff", glow: "#ecb3ff", score: 55, cost: 4.2, unlockWave: 25 },
  boss:        { type: "boss", name: "Umbral Tyrant", hp: 950, speed: 55, damage: 26, radius: 44, color: "#ff4d6b", glow: "#ffa3b5", score: 500, cost: 0, unlockWave: 10 },
};

/* Enemy types in unlock order (stable list, avoids Object.keys per wave). */
export const ENEMY_ORDER: EnemyType[] = (Object.keys(ENEMY_DEFS) as EnemyType[]).filter((t) => t !== "boss");

/* Elite affixes — Version 1.0 rebalance: elites are marked prey, not walls.
   Bulwark lost over half of his effective pool (2.30/0.35 → 1.75/0.18) and
   every affix shed HP, while the new ELITE_BONUS makes the weave itself hunt
   the marked — spells strike +35% harder against any elite, so a golden-ringed
   foe reads as a REWARD, never a bullet sponge. */
export type EliteAffix = "blazing" | "swift" | "bulwark" | "leech";

export interface EliteDef { name: string; color: string; hpMult: number; spdMult: number; resist: number }

export const ELITE_DEFS: Record<EliteAffix, EliteDef> = {
  blazing:  { name: "Blazing",  color: "#ff7847", hpMult: 1.30, spdMult: 1.05, resist: 0 },
  swift:    { name: "Swift",    color: "#6bf0c2", hpMult: 1.06, spdMult: 1.65, resist: 0 },
  bulwark:  { name: "Bulwark",  color: "#9aa7c9", hpMult: 1.75, spdMult: 0.82, resist: 0.18 },
  leech:    { name: "Leech",    color: "#d05bff", hpMult: 1.30, spdMult: 1.00, resist: 0 },
};

export const ELITE_ORDER: EliteAffix[] = ["blazing", "swift", "bulwark", "leech"];

/* Version 1.0 — the weave hunts the marked: every spell deals +35% damage
   to elite foes. Replaces raw HP inflation with felt power. */
export const ELITE_BONUS = 1.35;

export function eliteChance(wave: number): number {
  /* Patch 9.0: the global −10% also trims elite pressure. */
  return wave < 5 ? 0 : Math.min(0.05 + (wave - 5) * 0.012, 0.24) * DIFFICULTY_MULT;
}

export interface ScaledEnemy {
  hp: number;
  damage: number;
  speed: number;
  score: number;
}

/* Version 1.0 — THE ATTUNEMENT CURVE (anti-bullet-sponge).
   ----------------------------------------------------------------------
   Enemy HP used to compound at 1.11^wave with a 420× cap while player
   damage barely tripled by wave 50 — late foes were bullet sponges and
   bosses were paper. Now BOTH sides ride matched curves:
     · enemy HP   : linear 13%/wave × 1.09^wave, capped 150× (softer + lower)
     · enemy dmg  : linear 4%/wave × 1.045^wave, capped 12× (survivable)
     · the MAGE   : attunement(wave) — the rift itself teaches you; every
       spell, burn, ward and resonance grows ×1.055^wave (capped ×44), so
       magic stays CRISP against trash, ELITES melt under the +35% marked
       bonus, and difficulty rises from pressure, not from HP walls.
   Tyrants scale off the SAME curve (bossHpMult) so every act's climax
   fight holds a constant hit-count regardless of shuffle position. */
export function attunement(wave: number): number {
  const w = Math.max(1, wave);
  const lin = 1 + (w - 1) * 0.055;
  const comp = w > 8 ? Math.pow(1.055, w - 8) : 1;
  return Math.min(lin * comp, 44);
}

export function scaleEnemy(def: EnemyDef, wave: number): ScaledEnemy {
  const w = Math.max(1, wave);
  const lin = 1 + Math.max(0, w - 1) * 0.13;
  const comp = w > 6 ? Math.pow(1.09, w - 6) : 1;
  const hpMult = Math.min(lin * comp, 150) * DIFFICULTY_MULT;
  const dmgMult = Math.min((1 + Math.max(0, w - 1) * 0.04) * (w > 8 ? Math.pow(1.045, w - 8) : 1), 12) * DIFFICULTY_MULT;
  const spdMult = Math.min(1 + w * 0.012, 1.6);
  return {
    hp: def.hp * hpMult,
    damage: def.damage * dmgMult,
    speed: def.speed * spdMult,
    score: Math.round(def.score * (1 + w * 0.07)),
  };
}

/* Tyrant scaling — anchored to the attunement curve so every boss is a
   proper duel at any shuffle position (×1.38 at wave 10 → ×20 at wave 50).
   Endless echoes stack endlessBossMult() on top (engine spawnEnemy). */
export function bossHpMult(wave: number): number {
  return 1 + (attunement(wave) - 1) * 0.58;
}
export function bossDmgMult(wave: number): number {
  return 1 + (attunement(wave) - 1) * 0.024;
}

/* --------------------------- Wave composition --------------------------- */
/* Patch 9.0: the global −10% difficulty now ALSO covers spawn pressure —
   every wave fields ~10% less budget than the pre-9.0 curve (HP/damage were
   already scaled by DIFFICULTY_MULT since Patch 6.0). */
export function waveBudget(wave: number): number {
  const base = Math.max(3, Math.min(4 + wave * 2.1, 88) * DIFFICULTY_MULT);
  /* Patch 10.0 — endless escalation: past wave 50 the budget compounds +3.5%
     per wave so ENDLESS survival keeps tightening (the base curve caps at 40). */
  return wave > VICTORY_WAVE ? base * endlessMult(wave) : base;
}

/* Patch 10.0 — ENDLESS MODE multipliers (applied past wave 50 only):
   budget +3.5%/wave compounding, enemy HP +2.5%/wave compounding, and each
   recurring tyrant (every 10th wave) +22% stats per endless cycle. */
export function endlessMult(wave: number): number {
  return Math.pow(1.035, Math.max(0, wave - VICTORY_WAVE));
}
export function endlessHpMult(wave: number): number {
  return Math.pow(1.025, Math.max(0, wave - VICTORY_WAVE));
}
export function endlessBossMult(wave: number): number {
  return 1 + 0.22 * Math.max(0, Math.floor((wave - VICTORY_WAVE) / 10));
}

/* Seconds over which a wave's spawns are distributed. */
export function spawnWindow(wave: number): number {
  return Math.min(3.5 + wave * 0.7, 18);
}

/* Soft cap on simultaneous enemies — keeps the arena lethal but legible.
   Patch 9.0: scaled by the global −10% as well. */
export function spawnCap(wave: number): number {
  return Math.max(6, Math.round(Math.min(8 + Math.floor(wave * 1.4), 30) * DIFFICULTY_MULT));
}

export function availableTypes(wave: number): EnemyType[] {
  return ENEMY_ORDER.filter((t) => ENEMY_DEFS[t].unlockWave <= wave);
}

/* Patch 10.2 — seed-driven enemy ECOLOGY. The Rift Seed no longer decides
   only the floor plan: poolBias derives a stable per-seed weight multiplier
   for every foe type (some flourish, some fade) plus two "featured" stars
   that surge 2.4×. Unlock waves still gate availability, so progression
   pacing is untouched — the seed reshapes the MIX, not the difficulty.
   Uses its own RNG stream (seed + ":ecology") so it never perturbs the
   engine's main spawn/arena sequence. */
export function poolBias(seed: string): Record<EnemyType, number> {
  const rng = mulberry32(hashSeed(seed + ":ecology"));
  const out = {} as Record<EnemyType, number>;
  for (const t of ENEMY_ORDER) out[t] = 0.3 + rng.next() * 1.7;
  /* two featured stars of this rift */
  const roster = [...ENEMY_ORDER];
  for (let i = 0; i < 2 && roster.length; i++) {
    const star = roster.splice(Math.floor(rng.next() * roster.length), 1)[0];
    out[star] *= 2.4;
  }
  /* the riffraff never starves — early waves always have chaff */
  out.goblin = Math.max(out.goblin, 0.85);
  out.skitter = Math.max(out.skitter, 0.5);
  return out;
}

/* ------------------------------ Arena gen ------------------------------- */
/* Patch 9.0 — the arena is no longer the viewport. It is a FIXED WORLD
   (WORLD_W × WORLD_H px) explored through a scrolling camera. Patch 10.2
   grows the world to 2560×1600 (+67% area) so the wider Patch-10.1 camera
   has room to roam. Layouts are generated in world pixels from EIGHT
   archetypes, picked by the seed + wave so every Rift Shift can change not
   just pillar positions but the whole floor plan. All archetypes guarantee:
     • a clear spawn ring around the world center (player starts there),
     • ≥ 90px walkable gaps between pillars (enemies can always path),
     • hazards kept off pillars and out of the central ring. */
export const WORLD_W = 2560;
export const WORLD_H = 1600;

export interface ArenaRect { x: number; y: number; w: number; h: number; grad?: CanvasGradient | null }   // world px (grad: V1.1 cached body fill)
export interface ArenaCircle { x: number; y: number; r: number; grad?: CanvasGradient | null }  // world px
export interface Fountain { x: number; y: number; kind: "health" | "mana"; used: boolean; grad?: CanvasGradient | null }

export interface Arena {
  pillars: ArenaRect[];
  hazards: ArenaCircle[];
  fountains: Fountain[];
  /** archetype id — drives layout variety across Rift Shifts */
  style: string;
}

export type ArenaStyle = "temple" | "colonnade" | "ring" | "chambers" | "lanes" | "spiral" | "crosswall" | "scatter";
const ARENA_STYLES: ArenaStyle[] = ["temple", "colonnade", "ring", "chambers", "lanes", "spiral", "crosswall", "scatter"];

/* overlap helper — rects must keep `gap` of clear space between them */
function rectsClear(a: ArenaRect, b: ArenaRect, gap: number): boolean {
  return !(a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y);
}

function pushPillar(list: ArenaRect[], x: number, y: number, w: number, h: number, cx: number, cy: number, centerR: number): boolean {
  const r: ArenaRect = { x, y, w, h };
  /* never seal the center ring (player start + shrine zone) */
  const nx = Math.max(x, Math.min(cx, x + w));
  const ny = Math.max(y, Math.min(cy, y + h));
  if ((nx - cx) ** 2 + (ny - cy) ** 2 < centerR * centerR) return false;
  /* stay inside the walls with breathing room */
  if (x < 70 || y < 70 || x + w > WORLD_W - 70 || y + h > WORLD_H - 70) return false;
  for (const p of list) if (!rectsClear(r, p, 92)) return false;
  list.push(r);
  return true;
}

export function generateArena(rng: RNG, waveIndex = 0): Arena {
  /* wider seed variety: the archetype itself rotates with seed + wave so a
     run's Rift Shifts can visit five different floor plans */
  const styleIdx = Math.abs(Math.floor(rng.next() * 1048576) + waveIndex * 7919) % ARENA_STYLES.length;
  const style = ARENA_STYLES[styleIdx];
  const pillars: ArenaRect[] = [];
  const cx = WORLD_W / 2, cy = WORLD_H / 2;

  if (style === "temple") {
    /* ruined temple — 10 pillars in two concentric rings around the center
       (Patch 10.2: rings widened for the bigger world, inner ring doubled) */
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng.range(-0.15, 0.15);
      pushPillar(pillars, cx + Math.cos(a) * 500 - rng.range(38, 54), cy + Math.sin(a) * 500 - rng.range(56, 78), rng.range(74, 104), rng.range(112, 154), cx, cy, 240);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6 + rng.range(-0.2, 0.2);
      pushPillar(pillars, cx + Math.cos(a) * 810 - 44, cy + Math.sin(a) * 810 - 60, rng.range(84, 118), rng.range(108, 160), cx, cy, 240);
    }
  } else if (style === "colonnade") {
    /* colonnade — two long rows of pillars framing an open central lane
       (Patch 10.2: five per row, spread across the wider world) */
    const yTop = cy - rng.range(420, 500);
    const yBot = cy + rng.range(420, 500);
    for (let i = 0; i < 5; i++) {
      const x = 320 + i * ((WORLD_W - 640) / 4) + rng.range(-70, 70);
      pushPillar(pillars, x - 33, yTop - 88, rng.range(62, 84), rng.range(160, 210), cx, cy, 240);
      pushPillar(pillars, x - 33, yBot - 88, rng.range(62, 84), rng.range(160, 210), cx, cy, 240);
    }
  } else if (style === "ring") {
    /* shard ring — eight small shards in a circle + heavy corner anchors */
    const n = 8;
    const rr = rng.range(560, 640);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.12, 0.12);
      pushPillar(pillars, cx + Math.cos(a) * rr - rng.range(30, 44), cy + Math.sin(a) * rr - rng.range(40, 56), rng.range(60, 86), rng.range(80, 112), cx, cy, 240);
    }
    const corners: [number, number][] = [[340, 280], [WORLD_W - 340, 280], [340, WORLD_H - 280], [WORLD_W - 340, WORLD_H - 280]];
    for (const [kx, ky] of corners) {
      if (rng.chance(0.7)) pushPillar(pillars, kx - rng.range(56, 80), ky - rng.range(44, 62), rng.range(110, 155), rng.range(88, 122), cx, cy, 240);
    }
  } else if (style === "chambers") {
    /* quad chambers — four L-shaped corner walls with wide gates
       (Patch 10.2: pushed outward + longer arms for the bigger world) */
    const L = rng.range(270, 340);
    const T = 58;
    const inset = 330;
    const corners: [number, number, number, number][] = [
      [inset, inset, 1, 1], [WORLD_W - inset, inset, -1, 1],
      [inset, WORLD_H - inset, 1, -1], [WORLD_W - inset, WORLD_H - inset, -1, -1],
    ];
    for (const [kx, ky, dx, dy] of corners) {
      pushPillar(pillars, dx > 0 ? kx : kx - L, ky - (dy > 0 ? 0 : T), L, T, cx, cy, 240);
      pushPillar(pillars, kx - (dx > 0 ? 0 : T), dy > 0 ? ky : ky - (L - T), T, L - T, cx, cy, 240);
    }
  } else if (style === "lanes") {
    /* lanes — two long stepped walls carving three horizontal lanes
       (Patch 10.2: four segments per wall for the taller world) */
    for (const fx of [0.33, 0.67]) {
      const x = WORLD_W * fx;
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        if (rng.chance(0.22)) continue;                        // knocked-through gaps
        const y = 240 + s * ((WORLD_H - 480) / (segs - 1)) - 130;
        pushPillar(pillars, x - 29, y, 58, rng.range(170, 230), cx, cy, 240);
      }
    }
  } else if (style === "spiral") {
    /* Patch 10.2 — spiral: an archimedean whorl of shards coiling out from
       the (clear) center. The gaps between coil arms are wide by geometry —
       step angle and radial growth are chosen so arms never touch. */
    let ang = rng.range(0, Math.PI * 2);
    let rad = 330;
    for (let i = 0; i < 12 && rad < 1080; i++) {
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      pushPillar(pillars, px - rng.range(34, 48), py - rng.range(44, 60), rng.range(64, 92), rng.range(84, 116), cx, cy, 240);
      ang += 0.72 + rng.range(-0.06, 0.06);
      rad += 66 + rng.range(-8, 12);
    }
  } else if (style === "crosswall") {
    /* Patch 10.2 — crosswall: four stepped diagonal rays forming a broken
       X through the middle. The center stays clear (first blocks sit at
       400px), and the stepped blocks leave diagonal running lanes. */
    const rays: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of rays) {
      for (const step of [400, 560, 720]) {
        if (rng.chance(0.18)) continue;                        // weathered gaps
        const px = cx + dx * step - 48;
        const py = cy + dy * step - 48;
        pushPillar(pillars, px, py, rng.range(82, 104), rng.range(82, 104), cx, cy, 240);
      }
    }
  } else {
    /* Patch 10.2 — scatter: a drifting field of 12–16 free-floating shards,
       poisson-ish via the ≥92px spacing rule. Maximum freedom of movement,
       minimal structure — the pure kiting floor. */
    const n = rng.int(12, 16);
    for (let i = 0; i < n; i++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const x = rng.range(120, WORLD_W - 260);
        const y = rng.range(120, WORLD_H - 260);
        if (pushPillar(pillars, x, y, rng.range(70, 150), rng.range(70, 150), cx, cy, 240)) break;
      }
    }
  }

  /* hazards — 3-5 pools (Patch 10.2: one more on average for the bigger
     floor), kept off pillars and out of the central ring */
  const hazards: ArenaCircle[] = [];
  const hcount = rng.int(3, 5);
  for (let i = 0; i < hcount; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const x = rng.range(140, WORLD_W - 140);
      const y = rng.range(140, WORLD_H - 140);
      const r = rng.range(44, 66);
      if ((x - cx) ** 2 + (y - cy) ** 2 < 300 * 300) continue;
      let ok = true;
      for (const p of pillars) {
        const nx = Math.max(p.x, Math.min(x, p.x + p.w));
        const ny = Math.max(p.y, Math.min(y, p.y + p.h));
        if ((nx - x) ** 2 + (ny - y) ** 2 < (r + 60) ** 2) { ok = false; break; }
      }
      if (ok) { hazards.push({ x, y, r }); break; }
    }
  }

  /* Patch 4.0: HP comes only from spell drops — the health fountain is gone.
     Two mana fountains now anchor opposite quadrants of the larger world. */
  const fountains: Fountain[] = [
    { x: rng.range(0.72, 0.86) * WORLD_W, y: rng.range(0.14, 0.26) * WORLD_H, kind: "mana", used: false },
    { x: rng.range(0.14, 0.28) * WORLD_W, y: rng.range(0.74, 0.86) * WORLD_H, kind: "mana", used: false },
  ];
  return { pillars, hazards, fountains, style };
}

/* ----------------------------- Meta progress ---------------------------- */

/* Aim assist level: 0 = off, 1 = standard, 2 = strong. */
export type AimAssistLevel = 0 | 1 | 2;

/* Graphics quality preset: 0 = Low, 1 = Medium, 2 = High. Controls render
   resolution cap (DPR), particle budget, ambient motes and (indirectly)
   leaves screen shake to its own toggle below. */
export type GfxLevel = 0 | 1 | 2;

export interface GameSettings {
  aimAssist: AimAssistLevel;
  /** Hades-style mercy: damage resistance that grows 2% per round. */
  mercy: boolean;
  /* Patch 7.0: cutscenes are gone entirely — the toggle became a damage-
     numbers switch (Vampire-Survivors-style accessibility + perf option). */
  dmgNumbers: boolean;    // floating combat damage numbers
  /* Patch 6.0 — audio / graphics / accessibility settings. */
  master: number;         // 0..100 master volume
  music: number;          // 0..100 ambient music volume
  sfx: number;            // 0..100 sound-effects volume
  gfx: GfxLevel;          // render quality preset
  screenShake: boolean;   // camera shake on impacts
  /* Patch 10.1 — custom UI scaling: multiplies the entire HUD layer
     (vitals / wave plate / spell bar / status chips). 0.75–1.25, default
     0.9 — the HUD ships SMALLER by default for maximum arena legibility.
     V1.0 final: range widened to 1.5 and joined by the full accessibility
     suite below (textScale / reduceFlash / highContrast). */
  hudScale: number;       // 0.75..1.5 UI scale multiplier
  /* V1.0 final — ACCESSIBILITY SUITE. textScale sizes every in-game
     announcement (wave calls, spawn whispers, boss alerts, rift events);
     reduceFlash softens the red damage vignette for photosensitive players;
     highContrast hardens the HUD panels against the arena for low-vision
     legibility. All three live-update from the Settings screen. */
  textScale: number;      // 0.75..1.5 announcement text scale multiplier
  reduceFlash: boolean;   // dampen the red damage vignette / hit flashes
  highContrast: boolean;  // high-contrast HUD panels + banner text
  /* V1.1 — TOUCH CONTROL CUSTOMIZATION (Settings → Touch controls; every
     option applies live to the in-run touch layer and persists):
     touchScale sizes every control; touchOpacity dims the whole layer;
     stickMode picks the movement model (floating: the stick spawns under
     your finger — 1:1 directional control anywhere on screen; docked: the
     classic corner-anchored stick); handSide mirrors the thumb zones for
     left-handed players. */
  touchScale: number;               // 0.75..1.4 control size multiplier
  touchOpacity: number;             // 0.4..1 control layer opacity
  stickMode: "floating" | "docked"; // movement stick origin model
  handSide: "right" | "left";       // thumb-zone mirror for left-handed play
}

export const DEFAULT_SETTINGS: GameSettings = {
  aimAssist: 1, mercy: false, dmgNumbers: true,
  /* Patch 11.0 — the score is mixed LOUD and dramatic: music default raised
     to 85 and the music bus runs at unity into a master compressor (see
     audio.ts), so the requiem reads as a score, not a whisper. */
  master: 80, music: 85, sfx: 90, gfx: 2, screenShake: true,
  /* Patch 10.1 — HUD 10% smaller out of the box (less screen furniture,
     more arena); the Settings slider lets each player re-scale it. */
  hudScale: 0.9,
  /* V1.0 final — announcements ship compact at 100%; scale up to 150% for
     readability or down to 75% for a near-silent arena. */
  textScale: 1,
  reduceFlash: false,
  highContrast: false,
  /* V1.1 — touch customization defaults: full size, full opacity, the
     floating stick (the directional-control fix), right-handed layout. */
  touchScale: 1,
  touchOpacity: 1,
  stickMode: "floating",
  handSide: "right",
};

export interface MetaSave {
  runs: number;
  bestWave: number;
  bestScore: number;
  totalKills: number;
  totalDamage: number;
  totalTimeSec: number;
  shards: number;
  upgrades: { vitality: number; power: number; focus: number; swiftness: number };
  combosFound: string[];
  /* Patch 7.0 — Hades-Codex-style discovery tracking: entries unlock on
     FIRST KILL, never automatically. seenBosses holds BossDef ids. */
  seenEnemies: EnemyType[];
  seenBosses: string[];
  settings: GameSettings;
  victories: number;
  /* Patch 9.0 — Rift Mercy per-death ladder: every death banks a stack
     (cleared by a victory); mercyTierSel −1 = auto (use all stacks), ≥ 0 =
     manually selected (lower) tier. The master on/off remains the mercy
     setting in GameSettings. */
  mercyDeaths: number;
  mercyTierSel: number;
}

export const DEFAULT_META: MetaSave = {
  runs: 0, bestWave: 0, bestScore: 0, totalKills: 0, totalDamage: 0, totalTimeSec: 0,
  shards: 0,
  upgrades: { vitality: 0, power: 0, focus: 0, swiftness: 0 }, combosFound: [],
  seenEnemies: [], seenBosses: [], settings: { ...DEFAULT_SETTINGS }, victories: 0,
  mercyDeaths: 0, mercyTierSel: -1,
};

export const META_KEY = "archmage_save_v1";

/* Version 1.0 — Reliquary scaling (formerly the Sanctum). Replaces the old
   exponential cost curve
   (Math.pow(1.55, lvl)) with a gentler quadratic that stays affordable in
   the early-mid game and tapers at the cap. Effects were also rebalanced:
   vitality +20/lvl, power +8%/lvl, focus +12 mana + +10% regen per lvl,
   swiftness +6%/lvl. The cap is MAX_UPGRADE_LEVEL — beyond it the Reliquary
   panel shows MAXED instead of an empower button. */
export const MAX_UPGRADE_LEVEL = 6;

export function trackCost(lvl: number): number {
  return Math.round(20 + 18 * lvl + 8 * lvl * lvl);
}

export function loadMeta(): MetaSave {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MetaSave>;
      return {
        runs: parsed.runs ?? 0,
        bestWave: parsed.bestWave ?? 0,
        bestScore: parsed.bestScore ?? 0,
        totalKills: parsed.totalKills ?? 0,
        totalDamage: parsed.totalDamage ?? 0,
        totalTimeSec: parsed.totalTimeSec ?? 0,
        shards: parsed.shards ?? 0,
        upgrades: { vitality: 0, power: 0, focus: 0, swiftness: 0, ...(parsed.upgrades ?? {}) },
        combosFound: parsed.combosFound ?? [],
        seenEnemies: parsed.seenEnemies ?? [],
        seenBosses: parsed.seenBosses ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        victories: parsed.victories ?? 0,
        mercyDeaths: parsed.mercyDeaths ?? 0,
        mercyTierSel: parsed.mercyTierSel ?? -1,
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_META, upgrades: { ...DEFAULT_META.upgrades }, combosFound: [], seenEnemies: [], seenBosses: [], settings: { ...DEFAULT_SETTINGS } };
}

/** Patch 9.0 — the effective mercy tier a run starts with.
    A −1 tier selection (auto) uses every banked death; a manual selection can
    only lower it. Returns 0 when mercy is off or nothing is banked. */
export function effectiveMercyTier(meta: MetaSave): number {
  if (!meta.settings.mercy || meta.mercyDeaths <= 0) return 0;
  const capped = Math.min(meta.mercyDeaths, MERCY_MAX_TIER);
  if (meta.mercyTierSel < 0) return capped;
  return Math.max(0, Math.min(meta.mercyTierSel, capped));
}

export function saveMeta(meta: MetaSave) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

export interface MetaBonuses {
  maxHp: number;
  spellPower: number;   // multiplier
  manaRegen: number;    // multiplier
  maxMana: number;
  moveSpeed: number;    // multiplier
}

/* Patch 5.0 — balanced scaling with the new level cap (MAX_UPGRADE_LEVEL=6).
   At cap: vitality=+120 HP, power=+48% spell dmg, focus=+72 mana/+60% regen,
   swiftness=+36% move speed. Comfortable to reach, never game-breaking. */
export function computeBonuses(meta: MetaSave): MetaBonuses {
  const v = Math.min(meta.upgrades.vitality, MAX_UPGRADE_LEVEL);
  const p = Math.min(meta.upgrades.power, MAX_UPGRADE_LEVEL);
  const f = Math.min(meta.upgrades.focus, MAX_UPGRADE_LEVEL);
  const s = Math.min(meta.upgrades.swiftness, MAX_UPGRADE_LEVEL);
  return {
    maxHp: 100 + v * 20,
    spellPower: 1 + p * 0.08,
    manaRegen: 1 + f * 0.10,
    maxMana: 100 + f * 12,
    moveSpeed: 1 + s * 0.06,
  };
}

export interface UpgradeChoice {
  id: string;
  kind: string;
  name: string;
  desc: string;
  icon: string;      // svg icon key used by the UI
  color: string;
}
