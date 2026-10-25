/* ARCHMAGE: RIFTBOUND (3D Edition) — static game content.
   Seeded RNG, 13 elements, 78 resonances, 19 foes, 5 tyrants, 6 biomes,
   scaling curves, tribute rewards, Reliquary, meta save.
   Imports types.ts ONLY. */

/* --- TYPE LAYER (reconstructed during Phase 2 recovery) --------------------
   The browser capture only preserved runtime code; these interfaces are
   ported from the older editable source snapshot and extended for the newer
   systems (six terrains, save slots, FOV/percent-brightness settings).     */
export interface RNG {
  next(): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(arr: T[]): T[];
}
export type ElementId =
  | "fire" | "ice" | "lightning" | "earth" | "shadow" | "light" | "time"
  | "void" | "arcane" | "blood" | "nature" | "wind" | "sonic";
export type DropKind = "spell" | "heart" | "resonance" | "tribute" | "none";
export interface SpellDef {
  id: ElementId;
  name: string;
  tagline: string;
  color: string; // css hex
  glow: string;
  manaCost: number;
  cooldown: number; // seconds
  baseDamage: number;
  radius?: number; // aoe radius where relevant (world units)
  desc: string;
  /** 3D behavior archetype consumed by spells.ts */
  behavior:
    | "orb"        // arcing explosive sphere (fire)
    | "shards"     // piercing line of 3 shards + slow (ice)
    | "chain"      // instant chain lightning (lightning)
    | "ward"       // raise a blocking wall segment (earth)
    | "blink"      // teleport strike toward aim (shadow)
    | "lance"      // piercing beam (light)
    | "timenova"   // slow-field nova around aim (time)
    | "well"       // gravity well pull+crush (void)
    | "fan"        // 5 homing seekers (arcane)
    | "javelin"    // heavy piercing bolt (blood)
    | "pod"        // lobbed poison cloud (nature)
    | "crescents"  // 3 piercing knockback blades (wind)
    | "nova";      // radial knockback nova around player (sonic)
}
export interface ComboDef { name: string; lore: string }
export type EnemyType =
  | "goblin" | "archer" | "swarm" | "imp" | "skitter" | "knight" | "assassin"
  | "bomber" | "mage" | "tank" | "lancer" | "elemental" | "necromancer"
  | "warden" | "shadow" | "timewalker" | "mender" | "golem" | "voidbeast"
  | "boss";
export type EnemyBrain =
  | "chaser" | "ranged" | "orbit" | "tank" | "fast" | "flyer" | "bomber"
  | "charger" | "healer";
export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  speed: number;       // world units / s
  damage: number;
  radius: number;      // world units (collision + 3D scale hint)
  color: string;
  glow: string;
  score: number;
  cost: number;        // wave budget cost
  unlockWave: number;
  brain: EnemyBrain;
  shootsEvery?: number;
  flying?: boolean;
  /** 3D body kit for entities.ts */
  body: "imp" | "brute" | "wraith" | "orb" | "knight" | "caster" | "swarmlet";
}
export type EliteAffix = "blazing" | "swift" | "bulwark" | "leech";
export interface EliteDef { name: string; color: string; hpMult: number; spdMult: number; resist: number }
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
  brain: string;
  body?: "brute" | "wraith" | "orb" | "knight" | "caster";
  mechanics: string;
}
export interface ActPalette {
  sky: string;
  rune: string;
  pillar: string[];
  mote: string;
  ground: string;
  groundAccent: string;
}
export interface ActDef {
  id: number;
  name: string;
  subtitle: string;
  waves: [number, number];
  palette: ActPalette;
  flavor: string;
}
export interface ScaledEnemy { hp: number; damage: number; speed: number; score: number }
export interface RewardDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  maxStacks: number;
}
export type ReliquaryKey = "vitality" | "power" | "focus" | "swiftness";
export interface ReliquaryDef {
  id: ReliquaryKey;
  name: string;
  desc: string;
  icon: string;
  color: string;
  maxLevel: number;
  cost: (level: number) => number;
  /** cumulative bonus text for the HUD (percent by default) */
  effect: (level: number) => string;
}
export interface GameSettings {
  master: number; // 0..1
  music: number;
  sfx: number;
  ambience: number; // 0..1 biome ambience layer (audio.ts setAmbienceMood)
  muted: boolean;
  screenShake: boolean;
  damageNumbers: boolean;
  reduceFlashes: boolean;
  aimAssist: boolean;
  quality: number; // 0.5..1 render scale / effect density
  brightness: number; // 50..250 percent (screen filter; 100 = neutral) — Wave 11 widened range
  fov: number; // 45..80 degrees camera field of view — Wave 11 redesign
  autoQuality: boolean; // dynamic resolution / effect scaling to hold 60 fps
  perfOverlay: boolean; // debug perf/FPS telemetry panel (F3)
  /* v2.1 cross-device: auto-immersive snap (fullscreen + landscape lock) on
     touch-primary devices; portrait devices without lock support get the
     rotate gate. See ImmersiveManager.tsx. */
  autoImmersive: boolean;
  /* --- v2.2 approved-scope settings (uploaded scope report §5/§7) --- */
  /** Colorblind-safe element palette: "default" | "deuteranopia" |
   *  "protanopia" | "tritanopia" — display only, never sim-affecting. */
  palette: string;
  /** Mirror the touch cluster for left-thumb play (TouchControls). */
  leftHanded: boolean;
  /** One-thumb mode: cast aims along the move stick's direction. */
  tapToCast: boolean;
  /** navigator.vibrate haptic cues (cast-ready / hit / tyrant arrival). */
  haptics: boolean;
  /** Low-HP danger vignette strength 0..1 (0 = off; independent of reduceFlashes). */
  vignette: number;
  /** Frame-rate cap: 0 = uncapped, else 30 | 60 (thermals/battery). */
  fpsCap: number;
  /** HUD density tier: "compact" | "standard" | "expanded". */
  hudDensity: string;
  /** 3-2-1 countdown after unpausing a live run (accessibility override). */
  resumeCountdown: boolean;
  /** Auto battery-saver at/below 20% while discharging (quality clamp +
   *  30 fps floor; manual quality/FPS settings still override). */
  batterySaver: boolean;
}
export interface MetaSave {
  version: number;
  shards: number; // aether glyphs (meta currency)
  upgrades: Record<ReliquaryKey, number>;
  bestWave: number;
  bestScore: number;
  bestEndless: number;
  runs: number;
  victories: number;
  totalKills: number;
  totalDamage: number;
  totalTimeSec: number;
  combosFound: string[];
  seenEnemies: string[];
  seenBosses: string[];
  /** element ids the player has actually held (spell-discovery gating, P2-2) */
  seenSpells: string[];
  mercyDeaths: number;
  mercyTierSel: number; // -1 = auto
  settings: GameSettings;
}
export type TerrainId = "rubble" | "plaza" | "ring" | "lanes" | "chaos" | "graveyard" | "caldera" | "glacial" | "thornwild" | "astral";
/** F-05 (audit): internal obstacle topology, DECOUPLED from the visual
 *  TerrainId. The biome deck picks the theme; a separate seeded stream picks
 *  the layout kind from the terrain's compatibility set. */
export type ArenaLayoutKind = "scatter" | "ring" | "lanes" | "islands" | "radial";
export interface TerrainDef { id: TerrainId; name: string; desc: string; isNew?: boolean }
/* --- END TYPE LAYER ------------------------------------------------------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    shuffle
  };
}
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function randomSeedString() {
  const words = ["rune", "veil", "ember", "tide", "crown", "star", "gloom", "pyre", "frost", "echo", "hex", "dawn"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
}
export function streamRng(seed, salt) {
  return mulberry32(hashSeed(`${seed}:${salt}`));
}
export const SPELL_ORDER: ElementId[] = ["fire", "ice", "lightning", "earth", "shadow", "light", "time", "void", "arcane", "blood", "nature", "wind", "sonic"];
export const STARTER_SPELLS: ElementId[] = ["fire", "ice", "lightning"];
export const EQUIP_SLOTS = 3;
export const TRIBUTE_INTERVAL = 5;
export const VICTORY_WAVE = 50;
export const DIFFICULTY_MULT = 0.81;
/** F-03 (audit): global foe LOCOMOTION tuning — ONE named knob applied to
 *  every intended enemy movement path (pursuit, strafe/orbit, retreat,
 *  wind-up charges, elite swift variants and the hard-coded tyrant dash
 *  speeds). 0.92 = the audited initial ~8% slowdown. Deliberately NOT
 *  applied to: enemy HP, contact damage, projectile speeds, spawn budgets,
 *  player movement, knockback impulses (those are player-spell physics).
 *  If playtesting demands a different pace, change this single constant. */
export const FOE_MOVE_SPEED_SCALE = 0.92;
export const HEART_DROP_HEAL_FRAC = 0.25;
export const SPELL_OFFER_COUNT = 3;
export const RESONANCE_WINDOW = 1.5; // seconds between two different-element casts
export const SPELL_DROP_WAVE_MIN = 3; // spell tear cadence (rolled per drop)
export const SPELL_DROP_WAVE_MAX = 5;
export const SPELL_DROP_NERF = 0.19; // chance a scheduled tear is reabsorbed by the rift
export const SPELLS: Record<ElementId, SpellDef> = {
  fire: {
    id: "fire",
    name: "Ember",
    tagline: "Burn bright",
    color: "#ff7847",
    glow: "#ffb08a",
    manaCost: 14,
    cooldown: 0.48,
    baseDamage: 34,
    radius: 3.2,
    desc: "Hurls a searing orb that bursts into flame. Applies Smolder.",
    behavior: "orb"
  },
  ice: {
    id: "ice",
    name: "Frost",
    tagline: "Freeze deep",
    color: "#7fd8ff",
    glow: "#c8efff",
    manaCost: 12,
    cooldown: 0.36,
    baseDamage: 22,
    desc: "Impaling ice shards skewer the line and numb flesh to stillness.",
    behavior: "shards"
  },
  lightning: {
    id: "lightning",
    name: "Bolt",
    tagline: "Chain strike",
    color: "#ffe86b",
    glow: "#fff6c0",
    manaCost: 20,
    cooldown: 1.0,
    baseDamage: 30,
    desc: "Instant chain-lightning that leaps between the nearest foes.",
    behavior: "chain"
  },
  earth: {
    id: "earth",
    name: "Wall",
    tagline: "Stand firm",
    color: "#c9955a",
    glow: "#eec390",
    manaCost: 18,
    cooldown: 3.0,
    baseDamage: 0,
    desc: "Raises a stone wall that blocks enemies and hostile bolts.",
    behavior: "ward"
  },
  shadow: {
    id: "shadow",
    name: "Shade",
    tagline: "Ghost step",
    color: "#b06bff",
    glow: "#d9b3ff",
    manaCost: 16,
    cooldown: 2.0,
    baseDamage: 40,
    radius: 4,
    desc: "Blink through the dark, striking everything near your arrival.",
    behavior: "blink"
  },
  light: {
    id: "light",
    name: "Lance",
    tagline: "Pierce true",
    color: "#fff3b0",
    glow: "#fffbe0",
    manaCost: 22,
    cooldown: 1.45,
    baseDamage: 70,
    desc: "A searing shaft of light that pierces in a straight line.",
    behavior: "lance"
  },
  time: {
    id: "time",
    name: "Slow",
    tagline: "Hold still",
    color: "#6bf0c2",
    glow: "#c0ffe6",
    manaCost: 24,
    cooldown: 4.2,
    baseDamage: 8,
    radius: 7,
    desc: "Freezes time in a field — caught foes crawl at a tenth speed.",
    behavior: "timenova"
  },
  void: {
    id: "void",
    name: "Null",
    tagline: "Swallow all",
    color: "#d05bff",
    glow: "#ecb3ff",
    manaCost: 22,
    cooldown: 2.6,
    baseDamage: 26,
    radius: 5,
    desc: "A collapsing wound in the world that drags nearby foes inward and crushes them.",
    behavior: "well"
  },
  arcane: {
    id: "arcane",
    name: "Hex",
    tagline: "Never miss",
    color: "#9a7bff",
    glow: "#c9baff",
    manaCost: 19,
    cooldown: 0.8,
    baseDamage: 13,
    desc: "Sprays a fan of hex-seekers in a wide cone. Never misses for long.",
    behavior: "fan"
  },
  blood: {
    id: "blood",
    name: "Spike",
    tagline: "Run through",
    color: "#ff4d6b",
    glow: "#ffa3b5",
    manaCost: 26,
    cooldown: 1.6,
    baseDamage: 110,
    desc: "A heavy piercing spike of blood. Skewers everything in its line.",
    behavior: "javelin"
  },
  nature: {
    id: "nature",
    name: "Spore",
    tagline: "Spread rot",
    color: "#7ed957",
    glow: "#b9f29a",
    manaCost: 17,
    cooldown: 2.0,
    baseDamage: 15,
    radius: 4.5,
    desc: "Lobs a rot pod that bursts into a choking cloud — poison and slow within.",
    behavior: "pod"
  },
  wind: {
    id: "wind",
    name: "Gale",
    tagline: "Shove back",
    color: "#8ce8dc",
    glow: "#d2fff8",
    manaCost: 13,
    cooldown: 0.55,
    baseDamage: 18,
    desc: "Three crescent blades of wind — piercing, and they shove foes backwards.",
    behavior: "crescents"
  },
  sonic: {
    id: "sonic",
    name: "Echo",
    tagline: "Blast away",
    color: "#ff9ede",
    glow: "#ffd6f2",
    manaCost: 15,
    cooldown: 1.15,
    baseDamage: 30,
    radius: 6,
    desc: "A screaming ring around you — damages, slows and hurls every nearby foe away.",
    behavior: "nova"
  }
};
export function comboKey(a, b) {
  return [a, b].sort().join("+");
}
export const COMBOS: Record<string, ComboDef> = {
  "fire+ice": {
    name: "Steam Cloud",
    lore: "Scalding mist that burns and chills at once."
  },
  "fire+lightning": {
    name: "Plasma Surge",
    lore: "Superheated arcs of raw plasma."
  },
  "earth+fire": {
    name: "Magma Vent",
    lore: "The ground itself erupts in molten fury."
  },
  "fire+shadow": {
    name: "Ashen Veil",
    lore: "Choking cinders that swallow the light."
  },
  "fire+light": {
    name: "Solar Flare",
    lore: "A fragment of the sun, briefly held."
  },
  "fire+time": {
    name: "Ember Loop",
    lore: "Flames that reignite yesterday's wounds."
  },
  "fire+void": {
    name: "Void Fire",
    lore: "Fire that consumes even absence."
  },
  "ice+lightning": {
    name: "Static Frost",
    lore: "Crackling ice that snaps like lightning."
  },
  "earth+ice": {
    name: "Permafrost",
    lore: "An ancient cold locked in stone."
  },
  "ice+shadow": {
    name: "Frozen Nightmare",
    lore: "Fear given edges of black ice."
  },
  "ice+light": {
    name: "Aurora Lance",
    lore: "The northern sky, sharpened to a point."
  },
  "ice+time": {
    name: "Deep Freeze",
    lore: "A moment preserved in perfect cold."
  },
  "ice+void": {
    name: "Absolute Zero",
    lore: "The temperature at which reality stops."
  },
  "earth+lightning": {
    name: "Magnetic Storm",
    lore: "Charged stone that drags iron and flesh."
  },
  "lightning+shadow": {
    name: "Shadow Storm",
    lore: "Thunder that strikes from inside your shadow."
  },
  "light+lightning": {
    name: "Sun Storm",
    lore: "A storm with a heart of daylight."
  },
  "lightning+time": {
    name: "Time Spark",
    lore: "Lightning that arrives before it is thrown."
  },
  "lightning+void": {
    name: "Event Horizon",
    lore: "The last light before the fall."
  },
  "earth+shadow": {
    name: "Buried Dread",
    lore: "Something moves beneath the flagstones."
  },
  "earth+light": {
    name: "Gold Wall",
    lore: "Stone blessed until it gleams."
  },
  "earth+time": {
    name: "Still Moment",
    lore: "A second, carved in granite."
  },
  "earth+void": {
    name: "Collapse",
    lore: "The weight of everything, briefly, in one place."
  },
  "light+shadow": {
    name: "Reality Tear",
    lore: "Where both touch, the world comes unstitched."
  },
  "shadow+time": {
    name: "Dark Hour",
    lore: "A wound that was always already there."
  },
  "shadow+void": {
    name: "Null Whisper",
    lore: "The quiet between two heartbeats of the dark."
  },
  "light+time": {
    name: "Prophecy",
    lore: "Tomorrow's dawn, borrowed."
  },
  "light+void": {
    name: "Starfall",
    lore: "A dying sun, delivered by hand."
  },
  "time+void": {
    name: "Paradox",
    lore: "A place where causes forget their effects."
  },
  "arcane+fire": {
    name: "Prism Fire",
    lore: "Light split into a thousand hungry flames."
  },
  "arcane+ice": {
    name: "Glass Storm",
    lore: "Shards of spellglass, beautiful and cruel."
  },
  "arcane+lightning": {
    name: "Runeflash",
    lore: "The alphabet of storms, read aloud."
  },
  "arcane+earth": {
    name: "Floating Stones",
    lore: "Geometry too heavy for the sky."
  },
  "arcane+shadow": {
    name: "Unwritten Hex",
    lore: "A curse in a language never spoken."
  },
  "arcane+light": {
    name: "Bright Proof",
    lore: "Proof, concluded, that light always wins."
  },
  "arcane+time": {
    name: "Time Loop",
    lore: "A second that casts itself."
  },
  "arcane+void": {
    name: "Void Engine",
    lore: "It computes with the absence of number."
  },
  "blood+fire": {
    name: "Burning Blood",
    lore: "What burns in the veins burns twice as bright."
  },
  "blood+ice": {
    name: "Red Frost",
    lore: "Frozen at the exact moment of shedding."
  },
  "blood+lightning": {
    name: "Pulse Storm",
    lore: "A heartbeat audible across the field."
  },
  "blood+earth": {
    name: "Ironroot",
    lore: "The ground drinks deep and grows thorns."
  },
  "blood+shadow": {
    name: "Open Wound",
    lore: "The dark leans in to drink."
  },
  "blood+light": {
    name: "Martyr's Dawn",
    lore: "Spilled light rises as steam."
  },
  "blood+time": {
    name: "Old Debt",
    lore: "Paid by the hearts of your grandfathers."
  },
  "blood+void": {
    name: "Dead Star",
    lore: "Not even light escapes a thirst like this."
  },
  "fire+nature": {
    name: "Crownfire",
    lore: "The forest's answer to the torch."
  },
  "ice+nature": {
    name: "Winter Bloom",
    lore: "Flowers that only open for frost."
  },
  "lightning+nature": {
    name: "Stormsap",
    lore: "Trees grow fastest under a lightning sky."
  },
  "earth+nature": {
    name: "Old Garden",
    lore: "Beneath the stone, the old garden still dreams."
  },
  "nature+shadow": {
    name: "Nightshade Garden",
    lore: "Every herb has a quieter, darker cousin."
  },
  "light+nature": {
    name: "Chorus of Leaves",
    lore: "Every leaf sings toward the sun."
  },
  "nature+time": {
    name: "Endless Spring",
    lore: "A springtime that returns daily."
  },
  "nature+void": {
    name: "Black Rot",
    lore: "Rot that consumes meaning, not flesh."
  },
  "arcane+blood": {
    name: "Blood Rune",
    lore: "Runes drawn in the only ink that obeys."
  },
  "arcane+nature": {
    name: "Grafted Runes",
    lore: "The sigils took root and grew."
  },
  "blood+nature": {
    name: "Grave Bloom",
    lore: "The garden rises from what falls."
  },
  "wind+fire": {
    name: "Firestorm",
    lore: "A weather system with a grudge."
  },
  "wind+ice": {
    name: "Glacier Gale",
    lore: "A blizzard compressed to a blade."
  },
  "wind+lightning": {
    name: "Thunderhead",
    lore: "The cloud that argues loudest."
  },
  "wind+earth": {
    name: "Sandstorm",
    lore: "A desert, briefly weaponized."
  },
  "wind+shadow": {
    name: "Night Wind",
    lore: "It passes through without arriving."
  },
  "wind+light": {
    name: "First Light",
    lore: "Morning, arriving early and angry."
  },
  "wind+time": {
    name: "Lost Breeze",
    lore: "Wind from a season that never happened."
  },
  "wind+void": {
    name: "Silence Between",
    lore: "The pause where the storm forgot itself."
  },
  "arcane+wind": {
    name: "Rune Winds",
    lore: "Spells that travel by timetable."
  },
  "blood+wind": {
    name: "Crimson Gale",
    lore: "A red sky at any hour."
  },
  "nature+wind": {
    name: "Seed Storm",
    lore: "Tomorrow's forest, scattered today."
  },
  "sonic+fire": {
    name: "Big Bang",
    lore: "The finale arrives all at once."
  },
  "sonic+ice": {
    name: "Shatter Note",
    lore: "One pitch that breaks crystal."
  },
  "sonic+lightning": {
    name: "Thunder Chord",
    lore: "A song the sky cannot hold."
  },
  "earth+sonic": {
    name: "Tremor Bass",
    lore: "The deep note that moves stone."
  },
  "shadow+sonic": {
    name: "Low Song",
    lore: "Played behind a wall of night."
  },
  "light+sonic": {
    name: "Radiant Chime",
    lore: "A bell cast from dawn."
  },
  "sonic+time": {
    name: "Cold Song",
    lore: "The singer stops; the song does not."
  },
  "sonic+void": {
    name: "Null Song",
    lore: "Two silences, harmonized."
  },
  "arcane+sonic": {
    name: "Sound Rune",
    lore: "Geometry you can hear."
  },
  "blood+sonic": {
    name: "Heartbeat",
    lore: "A heartbeat played in a cathedral."
  },
  "nature+sonic": {
    name: "Blooming Chorus",
    lore: "Every flower opens on the beat."
  },
  "sonic+wind": {
    name: "Storm Voice",
    lore: "The storm learned to speak."
  }
};
export const ALL_PAIRS = (() => {
  const out: [ElementId, ElementId][] = [];
  for (let i = 0; i < SPELL_ORDER.length; i++) {
    for (let j = i + 1; j < SPELL_ORDER.length; j++) out.push([SPELL_ORDER[i], SPELL_ORDER[j]]);
  }
  return out;
})();
export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  goblin: {
    type: "goblin",
    name: "Ghoul",
    hp: 26,
    speed: 6.3,
    damage: 8,
    radius: 0.65,
    color: "#7ed957",
    glow: "#b9f29a",
    score: 10,
    cost: 1,
    unlockWave: 1,
    brain: "chaser",
    body: "imp"
  },
  archer: {
    type: "archer",
    name: "Bone Archer",
    hp: 20,
    speed: 4.8,
    damage: 5,
    radius: 0.6,
    color: "#d9a05b",
    glow: "#f2c99a",
    score: 14,
    cost: 1.4,
    unlockWave: 2,
    brain: "ranged",
    shootsEvery: 2.6,
    body: "knight"
  },
  swarm: {
    type: "swarm",
    name: "Gnat",
    hp: 8,
    speed: 7.4,
    damage: 3,
    radius: 0.4,
    color: "#b06bff",
    glow: "#d9b3ff",
    score: 5,
    cost: 0.5,
    unlockWave: 3,
    brain: "flyer",
    flying: true,
    body: "swarmlet"
  },
  imp: {
    type: "imp",
    name: "Fire Imp",
    hp: 18,
    speed: 5.8,
    damage: 6,
    radius: 0.55,
    color: "#ff8a5c",
    glow: "#ffc4a3",
    score: 12,
    cost: 1.3,
    unlockWave: 4,
    brain: "flyer",
    flying: true,
    body: "imp"
  },
  skitter: {
    type: "skitter",
    name: "Skitter",
    hp: 10,
    speed: 8.4,
    damage: 3,
    radius: 0.45,
    color: "#e8c46b",
    glow: "#ffe9a8",
    score: 6,
    cost: 0.5,
    unlockWave: 5,
    brain: "fast",
    body: "swarmlet"
  },
  knight: {
    type: "knight",
    name: "Rust Knight",
    hp: 72,
    speed: 3.1,
    damage: 14,
    radius: 0.85,
    color: "#9aa7c9",
    glow: "#d4ddf2",
    score: 24,
    cost: 2.4,
    unlockWave: 6,
    brain: "tank",
    body: "knight"
  },
  assassin: {
    type: "assassin",
    name: "Stalker",
    hp: 30,
    speed: 6.75,
    damage: 12,
    radius: 0.6,
    color: "#6ee7c8",
    glow: "#b7f5e5",
    score: 26,
    cost: 2.6,
    unlockWave: 8,
    brain: "fast",
    body: "wraith"
  },
  bomber: {
    type: "bomber",
    name: "Husk",
    hp: 24,
    speed: 6.6,
    damage: 16,
    radius: 0.6,
    color: "#ff6b3d",
    glow: "#ffb08a",
    score: 18,
    cost: 1.8,
    unlockWave: 9,
    brain: "bomber",
    body: "orb"
  },
  mage: {
    type: "mage",
    name: "Cultist",
    hp: 30,
    speed: 4.2,
    damage: 6,
    radius: 0.65,
    color: "#8f7bff",
    glow: "#c6baff",
    score: 28,
    cost: 2.6,
    unlockWave: 10,
    brain: "ranged",
    shootsEvery: 3.0,
    body: "caster"
  },
  tank: {
    type: "tank",
    name: "Colossus",
    hp: 160,
    speed: 2.1,
    damage: 20,
    radius: 1.1,
    color: "#8a6f5a",
    glow: "#c4a98d",
    score: 40,
    cost: 3.4,
    unlockWave: 11,
    brain: "tank",
    body: "brute"
  },
  lancer: {
    type: "lancer",
    name: "Lancer",
    hp: 46,
    speed: 4.6,
    damage: 14,
    radius: 0.7,
    color: "#43e8d8",
    glow: "#aef2ea",
    score: 30,
    cost: 2.8,
    unlockWave: 12,
    brain: "charger",
    body: "knight"
  },
  elemental: {
    type: "elemental",
    name: "Wraith",
    hp: 55,
    speed: 4.4,
    damage: 10,
    radius: 0.75,
    color: "#5bd0e7",
    glow: "#aeeaf5",
    score: 34,
    cost: 3.0,
    unlockWave: 13,
    brain: "orbit",
    shootsEvery: 3.4,
    flying: true,
    body: "wraith"
  },
  necromancer: {
    type: "necromancer",
    name: "Bone Speaker",
    hp: 42,
    speed: 3.5,
    damage: 6,
    radius: 0.7,
    color: "#b7d95b",
    glow: "#ddf29a",
    score: 38,
    cost: 3.2,
    unlockWave: 15,
    brain: "ranged",
    shootsEvery: 3.4,
    body: "caster"
  },
  warden: {
    type: "warden",
    name: "Herald",
    hp: 58,
    speed: 3.8,
    damage: 8,
    radius: 0.75,
    color: "#7fb2ff",
    glow: "#c9e0ff",
    score: 44,
    cost: 3.4,
    unlockWave: 16,
    brain: "orbit",
    shootsEvery: 3.2,
    flying: true,
    body: "caster"
  },
  shadow: {
    type: "shadow",
    name: "Shade",
    hp: 38,
    speed: 6.1,
    damage: 13,
    radius: 0.65,
    color: "#7a5cff",
    glow: "#bfaeff",
    score: 36,
    cost: 3.0,
    unlockWave: 17,
    brain: "fast",
    body: "wraith"
  },
  timewalker: {
    type: "timewalker",
    name: "Time Wraith",
    hp: 48,
    speed: 5.0,
    damage: 11,
    radius: 0.7,
    color: "#6bf0c2",
    glow: "#c0ffe6",
    score: 42,
    cost: 3.4,
    unlockWave: 19,
    brain: "chaser",
    body: "wraith"
  },
  mender: {
    type: "mender",
    name: "Weaver",
    hp: 40,
    speed: 3.3,
    damage: 5,
    radius: 0.65,
    color: "#f2a6ff",
    glow: "#ffd6f6",
    score: 46,
    cost: 3.6,
    unlockWave: 21,
    brain: "healer",
    shootsEvery: 2.8,
    body: "caster"
  },
  golem: {
    type: "golem",
    name: "Void Golem",
    hp: 120,
    speed: 2.6,
    damage: 16,
    radius: 1.0,
    color: "#7fd8ff",
    glow: "#d5f4ff",
    score: 50,
    cost: 4.0,
    unlockWave: 22,
    brain: "tank",
    body: "brute"
  },
  voidbeast: {
    type: "voidbeast",
    name: "Null Beast",
    hp: 90,
    speed: 3.8,
    damage: 15,
    radius: 0.9,
    color: "#d05bff",
    glow: "#ecb3ff",
    score: 55,
    cost: 4.2,
    unlockWave: 25,
    brain: "fast",
    body: "brute"
  },
  boss: {
    type: "boss",
    name: "Tyrant",
    hp: 950,
    speed: 2.8,
    damage: 26,
    radius: 2.2,
    color: "#ff4d6b",
    glow: "#ffa3b5",
    score: 500,
    cost: 0,
    unlockWave: 10,
    brain: "chaser",
    body: "brute"
  }
};
export const ENEMY_ORDER = Object.keys(ENEMY_DEFS).filter(t => t !== "boss");
export const ELITE_DEFS: Record<EliteAffix, EliteDef> = {
  blazing: {
    name: "Blazing",
    color: "#ff7847",
    hpMult: 1.3,
    spdMult: 1.05,
    resist: 0
  },
  swift: {
    name: "Swift",
    color: "#6bf0c2",
    hpMult: 1.06,
    spdMult: 1.65,
    resist: 0
  },
  bulwark: {
    name: "Sturdy",
    color: "#9aa7c9",
    hpMult: 1.75,
    spdMult: 0.82,
    resist: 0.18
  },
  leech: {
    name: "Leech",
    color: "#d05bff",
    hpMult: 1.3,
    spdMult: 1.0,
    resist: 0
  }
};
export const ELITE_ORDER = ["blazing", "swift", "bulwark", "leech"];
export const ELITE_BONUS = 1.35; // spells hit +35% harder vs elites
export function eliteChance(wave) {
  return wave < 5 ? 0 : Math.min(0.05 + (wave - 5) * 0.012, 0.24) * DIFFICULTY_MULT;
}
export const BOSS_DEFS: BossDef[] = [{
  id: "vorrac",
  name: "Grimm",
  title: "the Maw",
  hp: 950,
  damage: 26,
  speed: 5.5,
  radius: 1.9,
  color: "#ff4d6b",
  glow: "#ffa3b5",
  brain: "charger",
  mechanics: "Stampede charger — stalks, then chains two to three lane dashes with fan volleys between."
}, {
  id: "korrath",
  name: "Cinder",
  title: "the Pyre",
  hp: 1300,
  damage: 30,
  speed: 2.5,
  radius: 2.1,
  color: "#ff7847",
  glow: "#ffb08a",
  brain: "juggernaut",
  mechanics: "Immovable juggernaut — never charges; walks you down, slams expanding shockwave rings, and sheds Fire Imps."
}, {
  id: "solenne",
  name: "Sable",
  title: "the Dancer",
  hp: 1650,
  damage: 34,
  speed: 3.0,
  radius: 1.8,
  color: "#43e8d8",
  glow: "#aeeaf5",
  brain: "dancer",
  mechanics: "Blade dancer — orbits at fencing range on a rising tempo of triple fans, then chains lunges through you."
}, {
  id: "ysed",
  name: "Dusk",
  title: "the Hollow",
  hp: 2000,
  damage: 38,
  speed: 2.3,
  radius: 1.9,
  color: "#c0ffeb",
  glow: "#e0fff5",
  brain: "fortress",
  mechanics: "Blink fortress — anchors and channels rotating twin-arm spiral barrages, then blinks around you with a landing pulse."
}, {
  id: "maelthar",
  name: "Vex",
  title: "the Sunder",
  hp: 2600,
  damage: 44,
  speed: 3.3,
  radius: 2.1,
  color: "#ff4d6b",
  glow: "#ffe9ad",
  brain: "storm",
  mechanics: "The apex storm — cycles stampede charges, a multi-arm spiral, and a vortex that drags you into the nova."
}];
export const ACTS: ActDef[] = [{
  id: 1,
  name: "The Dark Gate",
  subtitle: "Waves 1–10 · the long night",
  waves: [1, 10],
  palette: {
    sky: "88,58,160",
    rune: "245,201,107",
    pillar: ["#2b1d4d", "#191030"],
    mote: "200,180,255",
    ground: "#241840",
    groundAccent: "#3a2a66"
  },
  flavor: "The dark opens — ten trials to the first tyrant."
}, {
  id: 2,
  name: "The Cinder Halls",
  subtitle: "Waves 11–20 · the heat rises",
  waves: [11, 20],
  palette: {
    sky: "140,74,44",
    rune: "255,180,110",
    pillar: ["#3d2620", "#1e120c"],
    mote: "255,190,130",
    ground: "#2e1a12",
    groundAccent: "#59291a"
  },
  flavor: "The halls burn — foes grow bolder."
}, {
  id: 3,
  name: "The Drowned City",
  subtitle: "Waves 21–30 · sunken depths",
  waves: [21, 30],
  palette: {
    sky: "26,110,124",
    rune: "120,240,226",
    pillar: ["#123a42", "#082126"],
    mote: "150,235,225",
    ground: "#0d2b33",
    groundAccent: "#124b52"
  },
  flavor: "Deep water — faster, stranger foes."
}, {
  id: 4,
  name: "The Silent Tomb",
  subtitle: "Waves 31–40 · frozen stillness",
  waves: [31, 40],
  palette: {
    sky: "70,140,128",
    rune: "200,255,235",
    pillar: ["#1e3d3a", "#0d1f1e"],
    mote: "190,255,238",
    ground: "#152e2c",
    groundAccent: "#27504c"
  },
  flavor: "Stillness — everything hits harder."
}, {
  id: 5,
  name: "The Abyss",
  subtitle: "Waves 41–50 · the final wound",
  waves: [41, 50],
  palette: {
    sky: "96,40,110",
    rune: "255,150,170",
    pillar: ["#3a1230", "#1a0916"],
    mote: "240,170,200",
    ground: "#2a0f24",
    groundAccent: "#4d1a3e"
  },
  flavor: "The final heart — seal it or fall."
}, {
  id: 6,
  name: "The Endless Echo",
  subtitle: "Waves 51+ · it never ends",
  waves: [51, 99999],
  palette: {
    sky: "34,20,64",
    rune: "170,140,255",
    pillar: ["#241640", "#100a20"],
    mote: "190,170,255",
    ground: "#191030",
    groundAccent: "#31215c"
  },
  flavor: "The rift is sealed — yet the weave still hums."
}];
export function actForWave(wave): ActDef {
  for (let i = ACTS.length - 1; i >= 0; i--) {
    if (wave >= ACTS[i].waves[0]) return ACTS[i];
  }
  return ACTS[0];
}
export function attunement(wave) {
  const w = Math.max(1, wave);
  const lin = 1 + (w - 1) * 0.055;
  const comp = w > 8 ? Math.pow(1.055, w - 8) : 1;
  return Math.min(lin * comp, 44);
}
export function scaleEnemy(def, wave) {
  const w = Math.max(1, wave);
  const lin = 1 + Math.max(0, w - 1) * 0.13;
  const comp = w > 6 ? Math.pow(1.09, w - 6) : 1;
  const hpMult = Math.min(lin * comp, 150) * DIFFICULTY_MULT;
  const dmgMult = Math.min((1 + Math.max(0, w - 1) * 0.04) * (w > 8 ? Math.pow(1.045, w - 8) : 1), 12) * DIFFICULTY_MULT;
  const spdMult = Math.min(1 + w * 0.012, 1.6);
  return {
    hp: def.hp * hpMult,
    damage: def.damage * dmgMult,
    speed: def.speed * spdMult * FOE_MOVE_SPEED_SCALE,
    score: Math.round(def.score * (1 + w * 0.07))
  };
}
export function bossHpMult(wave) {
  return 1 + (attunement(wave) - 1) * 0.58;
}
export function bossDmgMult(wave) {
  return 1 + (attunement(wave) - 1) * 0.024;
}
export function waveBudget(wave) {
  const base = Math.max(3, Math.min(4 + wave * 2.1, 88) * DIFFICULTY_MULT);
  return wave > VICTORY_WAVE ? base * endlessMult(wave) : base;
}
export function endlessMult(wave) {
  return Math.pow(1.035, Math.max(0, wave - VICTORY_WAVE));
}
export function endlessHpMult(wave) {
  return Math.pow(1.025, Math.max(0, wave - VICTORY_WAVE));
}
export function endlessBossMult(wave) {
  return 1 + 0.22 * Math.max(0, Math.floor((wave - VICTORY_WAVE) / 10));
}
export function spawnWindow(wave) {
  return Math.min(3.5 + wave * 0.7, 18);
}
export function spawnCap(wave) {
  return Math.max(6, Math.round(Math.min(8 + Math.floor(wave * 1.4), 30) * DIFFICULTY_MULT));
}
export function availableTypes(wave) {
  return ENEMY_ORDER.filter(t => ENEMY_DEFS[t].unlockWave <= wave);
}
export function poolBias(seed) {
  const rng = mulberry32(hashSeed(seed + ":ecology"));
  const out = {};
  for (const t of ENEMY_ORDER) out[t] = 0.3 + rng.next() * 1.7;
  const star1 = rng.pick(ENEMY_ORDER);
  let star2 = rng.pick(ENEMY_ORDER);
  if (star2 === star1) star2 = ENEMY_ORDER[(ENEMY_ORDER.indexOf(star1) + 3) % ENEMY_ORDER.length];
  out[star1] *= 2.4;
  out[star2] *= 2.4;
  return out;
}
/* Mercy ladder — the single authoritative source for every mercy axis
 * (v2.2 integrity fix, scope report §4.1). The engine and entities module
 * import these constants; NO inline mercy multipliers exist anywhere else:
 *
 *   MERCY_ATTACK  outgoing player damage boost  (spells.ts power/volley/resonance)
 *   MERCY_SPAWNS  wave-budget reduction         (engine.ts waveBudget)
 *   MERCY_CAPLIVE live-spawn cap reduction      (engine.ts spawnCap)
 *   MERCY_HP      enemy HP reduction            (entities.ts spawn stats)
 *   MERCY_SPD     enemy speed reduction         (entities.ts spawn stats)
 *
 * Damage TAKEN scales with the full mercyF by definition (`1 - mercyF` in
 * engine.damagePlayer) — that is the ladder itself, not a separate axis.
 * scripts/validate-mercy.ts is the regression harness: it proves these
 * constants drive runtime behavior (change one → behavior changes). */
export const MERCY_BASE = 0.02;
export const MERCY_PER_TIER = 0.04;
export const MERCY_RUN_GROWTH = 0.005;
export const MERCY_RUN_GROWTH_CAP = 0.02;
export const MERCY_MAX_TIER = 8;
export const MERCY_ATTACK = 0.75;
export const MERCY_SPAWNS = 0.6;
export const MERCY_CAPLIVE = 0.4;
export const MERCY_HP = 0.35;
export const MERCY_SPD = 0.25;
export function mercyTierBase(tier) {
  if (tier <= 0) return 0;
  const t = Math.min(tier, MERCY_MAX_TIER);
  return MERCY_BASE + (t - 1) * MERCY_PER_TIER;
}
export function mercyForRound(wave, tier) {
  if (tier <= 0) return 0;
  const base = mercyTierBase(tier);
  const growth = Math.min(MERCY_RUN_GROWTH_CAP, Math.max(0, wave - 1) * MERCY_RUN_GROWTH);
  return base + growth;
}
export const REWARD_DEFS: RewardDef[] = [{
  id: "vitality",
  name: "Vitality",
  desc: "+18 Max HP and mend 18 HP",
  icon: "heart",
  color: "#ff4d6b",
  maxStacks: 12
}, {
  id: "mend",
  name: "Mend",
  desc: "Heal 45% of max HP now",
  icon: "cross",
  color: "#ff8fa3",
  maxStacks: 99
}, {
  id: "power",
  name: "Wrath",
  desc: "+14% spell damage",
  icon: "flame",
  color: "#ff7847",
  maxStacks: 12
}, {
  id: "focus",
  name: "Focus",
  desc: "+22 max aether, +20% regen",
  icon: "sparkles",
  color: "#9a7bff",
  maxStacks: 12
}, {
  id: "swift",
  name: "Swift",
  desc: "+10% move speed",
  icon: "zap",
  color: "#6bf0c2",
  maxStacks: 8
}, {
  id: "haste",
  name: "Haste",
  desc: "−12% spell cooldowns",
  icon: "timer",
  color: "#ffe86b",
  maxStacks: 6
}, {
  id: "surge",
  name: "Tempest",
  desc: "Surge charges 25% faster",
  icon: "battery",
  color: "#43e8d8",
  maxStacks: 5
}, {
  id: "ward",
  name: "Ward",
  desc: "+8% damage resistance",
  icon: "shield",
  color: "#9aa7c9",
  maxStacks: 6
}, {
  id: "greed",
  name: "Greed",
  desc: "+30% aether glyph payout",
  icon: "gem",
  color: "#f5c96b",
  maxStacks: 6
}, {
  id: "volley",
  name: "Volley",
  desc: "+1 arcane volley bolt, +10% volley damage",
  icon: "target",
  color: "#c9baff",
  maxStacks: 5
}];
export const REWARD_COUNT = 3;
export const RELIQUARY = [{
  key: "vitality",
  name: "Vitality",
  desc: "+8% max HP per level",
  icon: "heart",
  color: "#ff4d6b",
  perLevel: "+8% HP"
}, {
  key: "power",
  name: "Power",
  desc: "+6% spell damage per level",
  icon: "flame",
  color: "#ff7847",
  perLevel: "+6% DMG"
}, {
  key: "focus",
  name: "Focus",
  desc: "+8% max aether & regen per level",
  icon: "sparkles",
  color: "#9a7bff",
  perLevel: "+8% AETHER"
}, {
  key: "swiftness",
  name: "Swift",
  desc: "+3% move speed per level",
  icon: "zap",
  color: "#6bf0c2",
  perLevel: "+3% SPEED"
}];
export const RELIQUARY_MAX_LEVEL = 6;
export function reliquaryCost(level) {
  return Math.round(20 + 18 * level + 8 * level * level);
}
export function computeBonuses(upgrades) {
  return {
    hpMult: 1 + upgrades.vitality * 0.08,
    dmgMult: 1 + upgrades.power * 0.06,
    aetherMult: 1 + upgrades.focus * 0.08,
    speedMult: 1 + upgrades.swiftness * 0.03
  };
}
export const TERRAIN_IDS: TerrainId[] = ["rubble", "plaza", "ring", "lanes", "chaos", "graveyard", "caldera", "glacial", "thornwild", "astral"];
/** The four biomes added by the audit expansion (F-05) — deck rules guarantee
 *  at least two of these appear in every run's first five act bands. */
export const NEW_TERRAIN_IDS: TerrainId[] = ["caldera", "glacial", "thornwild", "astral"];
export const TERRAINS: TerrainDef[] = [{
  id: "rubble",
  name: "Rubble Field",
  desc: "Scattered stones"
}, {
  id: "plaza",
  name: "Open Plaza",
  desc: "Almost clear"
}, {
  id: "ring",
  name: "Pillar Ring",
  desc: "A ring of stone"
}, {
  id: "lanes",
  name: "Twin Lanes",
  desc: "Two winding rows"
}, {
  id: "chaos",
  name: "Stone Chaos",
  desc: "Dense and wild"
}, {
  id: "graveyard",
  name: "Graveyard",
  desc: "Old stones and dead trees"
}, {
  id: "caldera",
  name: "Ashen Caldera",
  desc: "Cooled lava shards under drifting embers",
  isNew: true
}, {
  id: "glacial",
  name: "Glacial Archive",
  desc: "Pale stone and cold crystal clusters",
  isNew: true
}, {
  id: "thornwild",
  name: "Thornwild Blight",
  desc: "Twisted roots and blighted thickets",
  isNew: true
}, {
  id: "astral",
  name: "Astral Shardfield",
  desc: "Leaning obsidian shards under star-sigils",
  isNew: true
}];
export function isTerrainId(v): v is TerrainId {
  return typeof v === "string" && (TERRAIN_IDS as string[]).includes(v);
}
/* ---- F-05: layout compatibility — which topologies read well on which
   biome (readability rule: open biomes keep open kinds, dense biomes keep
   dense kinds; every biome allows ≥2 kinds so seed variety is real). */
export const TERRAIN_LAYOUTS_ALLOWED: Record<TerrainId, ArenaLayoutKind[]> = {
  rubble: ["scatter", "islands"],
  plaza: ["scatter", "radial"],
  ring: ["ring", "radial"],
  lanes: ["lanes", "radial"],
  chaos: ["scatter", "islands"],
  graveyard: ["scatter", "islands", "lanes"],
  caldera: ["islands", "scatter", "radial"],
  glacial: ["radial", "ring", "scatter"],
  thornwild: ["islands", "lanes", "scatter"],
  astral: ["radial", "ring", "islands"]
};
/** First-decade deck (F-05 rule 4): five UNIQUE themes across the run's five
 *  act bands, INCLUDING 2–3 of the four new biomes; the remaining five fill
 *  endless act bands 6–10. Later decades are a plain seeded reshuffle, so
 *  endless never repeats a biome until all ten have been shown. */
function buildFirstDeck(rng: RNG): TerrainId[] {
  const newCount = 2 + rng.int(0, 1); // 2 or 3 new themes in the first five
  const firstNew = rng.shuffle([...NEW_TERRAIN_IDS]).slice(0, newCount);
  const firstOld = rng.shuffle(TERRAIN_IDS.filter(t => !NEW_TERRAIN_IDS.includes(t))).slice(0, 5 - newCount);
  const first = rng.shuffle([...firstNew, ...firstOld]);
  const rest = rng.shuffle(TERRAIN_IDS.filter(t => !first.includes(t)));
  return [...first, ...rest];
}
/** Deterministic biome deck per seed (F-05): pure function of (seed, act).
 *  actId is the VIRTUAL act index — the engine advances it past 6 in endless
 *  mode so the deck keeps cycling (decade = full 10-theme permutation, then
 *  a deterministic reshuffle). */
export function terrainForAct(seed, actId): TerrainId {
  const idx = Math.max(0, Math.round(actId) - 1);
  const decade = Math.floor(idx / 10);
  const slot = idx % 10;
  const rng = mulberry32(hashSeed(`${seed}:deck${decade}`));
  const deck = decade === 0 ? buildFirstDeck(rng) : rng.shuffle([...TERRAIN_IDS]);
  return deck[slot];
}
/** Full deck preview (deterministic from the seed) — the menu itinerary. */
export function biomeDeckFor(seed): TerrainId[] {
  const rng = mulberry32(hashSeed(`${seed}:deck0`));
  return buildFirstDeck(rng);
}
/** Topology pick (F-05): separate RNG stream (never perturbs the deck, the
 *  cosmetic dressing, or combat), constrained by the biome's compatibility
 *  set so every theme stays readable. */
export function layoutForAct(seed, actId, terrain: TerrainId): ArenaLayoutKind {
  const rng = mulberry32(hashSeed(`${seed}:act${actId}:kind`));
  const allowed = TERRAIN_LAYOUTS_ALLOWED[terrain] ?? ["scatter"];
  return allowed[Math.floor(rng.next() * allowed.length) % allowed.length];
}
export const DEFAULT_SETTINGS = {
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  ambience: 0.5,
  muted: false,
  screenShake: true,
  damageNumbers: true,
  reduceFlashes: false,
  aimAssist: true,
  quality: 1,
  brightness: 130,
  fov: 62,
  autoQuality: true,
  perfOverlay: false,
  autoImmersive: true,
  /* v2.2 approved scope */
  palette: "default",
  leftHanded: false,
  tapToCast: false,
  haptics: true,
  vignette: 1,
  fpsCap: 0,
  hudDensity: "standard",
  resumeCountdown: true,
  batterySaver: true
};
export const META_VERSION = 3;
export const DEFAULT_META = {
  version: META_VERSION,
  shards: 0,
  upgrades: {
    vitality: 0,
    power: 0,
    focus: 0,
    swiftness: 0
  },
  bestWave: 0,
  bestScore: 0,
  bestEndless: 0,
  runs: 0,
  victories: 0,
  totalKills: 0,
  totalDamage: 0,
  totalTimeSec: 0,
  combosFound: [],
  seenEnemies: [],
  seenBosses: [],
  seenSpells: [],
  mercyDeaths: 0,
  mercyTierSel: -1,
  settings: {
    ...DEFAULT_SETTINGS
  }
};
export const META_KEY = "archmage-rift3d-meta-v3";
export const META_NUM_MAX = {
  shards: 999_999_999,
  bestWave: 999_999,
  bestScore: 999_999_999_999,
  bestEndless: 999_999,
  runs: 999_999,
  victories: 999_999,
  totalKills: 999_999_999,
  totalDamage: 999_999_999_999,
  totalTimeSec: 999_999_999,
  mercyDeaths: 99
};
export const META_STR_MAX = {
  item: 100,
  list: 500
};
export const SETTINGS_RANGES = {
  master: [0, 1],
  music: [0, 1],
  sfx: [0, 1],
  ambience: [0, 1],
  quality: [0.5, 1],
  brightness: [50, 250],
  fov: [45, 80],
  vignette: [0, 1],
  fpsCap: [0, 60]
};
/** Allow-listed string-enum settings (v2.2): a persisted value must be a
 *  member of its enum or it falls back to the default — the same coercion
 *  philosophy as the numeric ranges above. */
export const SETTINGS_ENUMS: Record<string, string[]> = {
  palette: ["default", "deuteranopia", "protanopia", "tritanopia"],
  hudDensity: ["compact", "standard", "expanded"]
};
/** Keys never copied from persisted data (prototype-pollution guard).
 *  JSON.parse produces OWN "__proto__" data properties (CreateDataProperty
 *  bypasses the setter), so a blind merge (Object.assign / nested
 *  assignment) would fire the setter and pollute every later object
 *  literal in the app. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Own-property read that ignores inherited members and pollution keys. */
function ownData(obj, key) {
  if (FORBIDDEN_KEYS.has(key)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return obj[key];
}
/** Parse unknown → number. Numeric strings ("7") coerce; NaN/±Infinity,
 *  blank strings, booleans, objects and arrays fall back. */
function toNum(v, fallback) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
/** Finite integer clamped to [min, max] — the "integer-coerced" semantic
 *  (3.7 → 4; -5 clamps to min). */
function int(v, fallback, min, max) {
  return Math.min(max, Math.max(min, Math.round(toNum(v, fallback))));
}
/** Fractional clamp for slider settings (no integer coercion). */
function unit(v, fallback, lo, hi) {
  return Math.min(hi, Math.max(lo, toNum(v, fallback)));
}
export function migrateBrightness(v) {
  const n = toNum(v, NaN); // garbage/NaN/±Infinity/missing → NaN
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.brightness;
  const percent = n < 2.5 ? Math.round(n * 100) : Math.round(n);
  return Math.min(250, Math.max(50, percent));
}
/** Boolean coercion: only real booleans pass; everything else keeps default. */
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
/** Sanitize a persisted string[]: strings only, trimmed, item-length-capped,
 *  empty + duplicate entries dropped, list-length-capped. */
function strArr(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const s = item.trim().slice(0, META_STR_MAX.item);
    if (s === "" || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= META_STR_MAX.list) break;
  }
  return out;
}
/** Fresh clone of the defaults (deep enough: meta + upgrades + settings). */
function defaultMeta() {
  return {
    ...DEFAULT_META,
    upgrades: {
      ...DEFAULT_META.upgrades
    },
    settings: {
      ...DEFAULT_SETTINGS
    }
  };
}
export function migrateMeta(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return defaultMeta();
  const r = raw;
  /* Reliquary levels: known ReliquaryKey entries only, clamped 0..max. */
  const upgrades = {
    ...DEFAULT_META.upgrades
  };
  const upRaw = ownData(r, "upgrades");
  if (typeof upRaw === "object" && upRaw !== null && !Array.isArray(upRaw)) {
    for (const def of RELIQUARY) {
      upgrades[def.key] = int(ownData(upRaw, def.key), 0, 0, RELIQUARY_MAX_LEVEL);
    }
  }
  /* Settings: defaults-merge over whatever DEFAULT_SETTINGS declares, so
   fields added later (e.g. perfOverlay, fov) migrate without touching this
   code — a missing key just keeps its default; unknown legacy keys (e.g.
   the pre-11-a `terrain` choice) are dropped. Sliders clamp to their
   declared ranges, booleans coerce strictly.
   EXCEPTION — brightness carries a scale migration (9-c): values from
   pre-9-c saves pass through migrateBrightness, not the plain clamp. */
  const settings = {
    ...DEFAULT_SETTINGS
  };
  const stRaw = ownData(r, "settings");
  if (typeof stRaw === "object" && stRaw !== null && !Array.isArray(stRaw)) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const dv = DEFAULT_SETTINGS[key];
      const v = ownData(stRaw, key);
      if (typeof dv === "number") {
        if (key === "brightness") {
          settings[key] = migrateBrightness(v); // 9-c scale migration (above)
        } else {
          const [lo, hi] = SETTINGS_RANGES[key] ?? [0, 1];
          settings[key] = unit(v, dv, lo, hi);
        }
      } else if (typeof dv === "boolean") {
        settings[key] = bool(v, dv);
      } else if (typeof dv === "string") {
        /* v2.2: string-enum settings (palette, hudDensity) — member-checked,
           so any unknown/legacy value falls back to the default. */
        const allowed = SETTINGS_ENUMS[key];
        settings[key] = typeof v === "string" && allowed && allowed.includes(v) ? v : dv;
      }
    }
  }
  /* Build the result from allow-listed keys only — no spreads of user data. */
  return {
    version: META_VERSION,
    shards: int(ownData(r, "shards"), 0, 0, META_NUM_MAX.shards),
    upgrades,
    bestWave: int(ownData(r, "bestWave"), 0, 0, META_NUM_MAX.bestWave),
    bestScore: int(ownData(r, "bestScore"), 0, 0, META_NUM_MAX.bestScore),
    bestEndless: int(ownData(r, "bestEndless"), 0, 0, META_NUM_MAX.bestEndless),
    runs: int(ownData(r, "runs"), 0, 0, META_NUM_MAX.runs),
    victories: int(ownData(r, "victories"), 0, 0, META_NUM_MAX.victories),
    totalKills: int(ownData(r, "totalKills"), 0, 0, META_NUM_MAX.totalKills),
    totalDamage: int(ownData(r, "totalDamage"), 0, 0, META_NUM_MAX.totalDamage),
    totalTimeSec: int(ownData(r, "totalTimeSec"), 0, 0, META_NUM_MAX.totalTimeSec),
    combosFound: strArr(ownData(r, "combosFound")),
    seenEnemies: strArr(ownData(r, "seenEnemies")),
    seenBosses: strArr(ownData(r, "seenBosses")),
    seenSpells: strArr(ownData(r, "seenSpells")),
    mercyDeaths: int(ownData(r, "mercyDeaths"), 0, 0, META_NUM_MAX.mercyDeaths),
    mercyTierSel: int(ownData(r, "mercyTierSel"), -1, -1, MERCY_MAX_TIER),
    settings: settings
  };
}
export function loadMeta() {
  return loadSlotMeta(readActiveSlot());
}
export function saveMeta(meta) {
  saveSlotMeta(readActiveSlot(), meta);
}
export const SAVE_SLOT_COUNT = 3;
export function slotKey(i) {
  return `archmage-rift3d-slot-v3:${i}`;
}
const ACTIVE_SLOT_KEY = "archmage-rift3d-active-slot";
export function parseActiveSlot(raw) {
  if (raw === "0" || raw === "1" || raw === "2") return Number(raw);
  return 0;
}
export function resolveSlotPlan(pointerRaw, legacyPresent) {
  if (pointerRaw === "0" || pointerRaw === "1" || pointerRaw === "2") {
    return {
      slot: Number(pointerRaw),
      migrateLegacy: false
    };
  }
  return {
    slot: 0,
    migrateLegacy: legacyPresent
  };
}
export function readActiveSlot() {
  try {
    const plan = resolveSlotPlan(window.localStorage.getItem(ACTIVE_SLOT_KEY), window.localStorage.getItem(META_KEY) !== null);
    if (plan.migrateLegacy) {
      const legacy = window.localStorage.getItem(META_KEY);
      if (legacy !== null) {
        window.localStorage.setItem(slotKey(0), legacy);
        window.localStorage.setItem(ACTIVE_SLOT_KEY, "0");
        window.localStorage.removeItem(META_KEY);
      }
      return 0;
    }
    if (!window.localStorage.getItem(ACTIVE_SLOT_KEY)) {
      window.localStorage.setItem(ACTIVE_SLOT_KEY, String(plan.slot));
    }
    return plan.slot;
  } catch {
    return 0; // storage unavailable (private mode) — in-memory slot 0
  }
}
export function writeActiveSlot(i) {
  try {
    window.localStorage.setItem(ACTIVE_SLOT_KEY, String(parseActiveSlot(String(i))));
  } catch {
    /* storage unavailable — slot choice lives in memory for this session */}
}
export function loadSlotMeta(i) {
  try {
    const raw = window.localStorage.getItem(slotKey(i));
    if (!raw) return defaultMeta();
    // migrateMeta is total: every shape heals or defaults (plan §9 recovery).
    return migrateMeta(JSON.parse(raw));
  } catch {
    return defaultMeta();
  }
}
export function peekSlotMeta(i) {
  try {
    const raw = window.localStorage.getItem(slotKey(i));
    if (!raw) return null;
    return migrateMeta(JSON.parse(raw));
  } catch {
    return null; // unreadable slot shows as "damaged — overwrite to heal"
  }
}
/* v2.2 save-integrity watchdog (scope report §7): a refused write (quota
 * exceeded, private mode, disabled storage) must never be SILENT — the
 * warning is latched here and consumed by the store, which surfaces it as
 * an in-game banner. Progress stays live in memory for the session. */
let saveWriteWarning: string | null = null;
export function consumeSaveWriteWarning(): string | null {
  const w = saveWriteWarning;
  saveWriteWarning = null;
  return w;
}
export function saveSlotMeta(i, meta) {
  try {
    window.localStorage.setItem(slotKey(i), JSON.stringify(meta));
  } catch (err) {
    saveWriteWarning = err instanceof Error && err.name === "QuotaExceededError" ? "Storage is full" : "Storage refused the write (private mode or blocked)";
  }
}
export function computeRunCommit(prev, result) {
  const isVictory = result.kind === "victory";
  const isEndlessDeath = result.kind === "endless-death";
  /* endless-death contributes ONLY the post-victory delta */
  const d = isEndlessDeath ? result.delta ?? {
    kills: 0,
    damage: 0,
    timeSec: 0,
    glyphs: 0,
    score: 0
  } : null;
  const kills = Math.max(0, Math.round(d ? d.kills : result.kills));
  const damage = Math.max(0, Math.round(d ? d.damage : result.damage));
  const timeSec = Math.max(0, Math.round(d ? d.timeSec : result.timeSec));
  const payout = Math.max(0, Math.round(result.payout));
  /* resonance roster: dedupe against BOTH the already-found list and any
   repeats inside this result (endless deaths replay the run's full
   newCombos list — everything woven before the victory is already found) */
  const combosFound = [...prev.combosFound];
  for (const c of result.newCombos) if (!combosFound.includes(c)) combosFound.push(c);
  return {
    ...prev,
    runs: prev.runs + (isEndlessDeath ? 0 : 1),
    victories: prev.victories + (isVictory ? 1 : 0),
    bestWave: Math.max(prev.bestWave, result.wave),
    bestScore: Math.max(prev.bestScore, result.score),
    bestEndless: Math.max(prev.bestEndless, result.endless ? result.wave : 0),
    totalKills: prev.totalKills + kills,
    totalDamage: prev.totalDamage + damage,
    totalTimeSec: prev.totalTimeSec + timeSec,
    shards: prev.shards + payout,
    combosFound,
    mercyDeaths: isVictory ? prev.mercyDeaths : Math.min(prev.mercyDeaths + 1, META_NUM_MAX.mercyDeaths),
    mercyTierSel: isVictory ? -1 : prev.mercyTierSel
  };
}
export function draftGateChoices(wave, held, rng) {
  const eligible = REWARD_DEFS.filter(r => (held[r.id] ?? 0) < r.maxStacks);
  const weights = eligible.map(r => 1 / (1 + (held[r.id] ?? 0)));
  const picks: RewardDef[] = [];
  const pool = [...eligible];
  const wpool = [...weights];
  while (picks.length < REWARD_COUNT && pool.length > 0) {
    const total = wpool.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < wpool.length; i++) {
      roll -= wpool[i];
      if (roll <= 0) {
        idx = i;
        break;
      }
    }
    picks.push(pool[idx]);
    pool.splice(idx, 1);
    wpool.splice(idx, 1);
  }
  return picks.map(r => ({
    id: r.id,
    name: r.name,
    desc: r.desc,
    icon: r.icon,
    color: r.color,
    tier: held[r.id] ?? 0
  }));
}
export function draftSpellOffer(equipped, rng) {
  const owned = new Set();
  for (const e of equipped) {
    if (typeof e === "string") owned.add(e);else if (e && e.merged) e.merged.forEach(m => owned.add(m));
  }
  const bag = rng.shuffle(SPELL_ORDER.filter(s => !owned.has(s)));
  return bag.slice(0, SPELL_OFFER_COUNT);
}
/* ================================================================== */
/*  v2.2 — COLORBLIND-SAFE ELEMENT PALETTES (scope report §6)          */
/*  Display-layer only: elementColor/elementGlow are consulted by HUD, */
/*  overlays, screens, the staff tint and projectile/vfx colors. They  */
/*  never touch the simulation, RNG streams or damage math.            */
/* ================================================================== */
export type PaletteId = "default" | "deuteranopia" | "protanopia" | "tritanopia";
export const PALETTE_IDS: PaletteId[] = ["default", "deuteranopia", "protanopia", "tritanopia"];
export const PALETTE_LABELS: Record<PaletteId, string> = {
  default: "Default",
  deuteranopia: "Deuteranopia",
  protanopia: "Protanopia",
  tritanopia: "Tritanopia"
};
type PaletteEntry = { color: string; glow: string };
/** Per-palette color+glow overrides. Values are chosen so that within EACH
 *  palette every element differs from its neighbors in lightness AND the
 *  palette's safe hue axis — never hue alone. Unlisted elements fall back
 *  to the base SPELLS color. */
const ELEMENT_PALETTES: Record<Exclude<PaletteId, "default">, Partial<Record<ElementId, PaletteEntry>>> = {
  /* deuteranopia (red-green): push greens toward teal, reds toward
     orange/pink, browns toward gold — separation lands on the blue-yellow axis */
  deuteranopia: {
    fire: { color: "#ff9550", glow: "#ffcf9e" },
    nature: { color: "#3ec9b8", glow: "#a2f0e6" },
    earth: { color: "#e0c24e", glow: "#f4e29a" },
    blood: { color: "#ff7ab8", glow: "#ffc0dd" },
    wind: { color: "#9ee06a", glow: "#d7f2b4" },
    arcane: { color: "#8f9dff", glow: "#c9d2ff" }
  },
  /* protanopia (red-blind): reds read dark — lift fire/blood luminance,
     keep greens cool so the pair splits on lightness */
  protanopia: {
    fire: { color: "#ffb35c", glow: "#ffe0b0" },
    nature: { color: "#39c9c0", glow: "#a5efe9" },
    earth: { color: "#e8cd55", glow: "#f7eaa0" },
    blood: { color: "#ff8fc2", glow: "#ffd0e4" },
    wind: { color: "#a8e27a", glow: "#daf5c2" },
    arcane: { color: "#8b9bff", glow: "#c7d0ff" }
  },
  /* tritanopia (blue-yellow): blue vs green and yellow vs violet collide —
     push ice toward deep blue, wind toward yellow-green, light toward gold */
  tritanopia: {
    ice: { color: "#5a8dff", glow: "#b3c8ff" },
    wind: { color: "#c0d84e", glow: "#e8f2a6" },
    light: { color: "#ffd23e", glow: "#fff0a8" },
    void: { color: "#c04dd8", glow: "#e8b0f5" },
    time: { color: "#42d9a0", glow: "#a8f2d8" },
    sonic: { color: "#ff7ad0", glow: "#ffc2ea" }
  }
};
/** Active palette (module state — display concern only). The engine and the
 *  settings UI keep this in sync via setActiveElementPalette; "default"
 *  restores the base SPELLS colors. */
let activePalette: PaletteId = "default";
export function setActiveElementPalette(p: string): void {
  activePalette = PALETTE_IDS.includes(p as PaletteId) ? (p as PaletteId) : "default";
}
export function activeElementPalette(): PaletteId {
  return activePalette;
}
/** Palette-aware element color for DISPLAY (HUD, overlays, vfx tint). */
export function elementColor(el: string): string {
  if (activePalette !== "default") {
    const o = ELEMENT_PALETTES[activePalette][el as ElementId];
    if (o) return o.color;
  }
  return SPELLS[el as ElementId]?.color ?? "#f5c96b";
}
/** Palette-aware element glow (drop-shadow / halo tint). */
export function elementGlow(el: string): string {
  if (activePalette !== "default") {
    const o = ELEMENT_PALETTES[activePalette][el as ElementId];
    if (o) return o.glow;
  }
  return SPELLS[el as ElementId]?.glow ?? "#ffe9ad";
}
/* ================================================================== */
/*  v2.2 — SPELL EVOLUTIONS (flagship, scope report §2/§6)             */
/*  22 cards across 13 elements (9 dual-branch + 4 single-branch).     */
/*  A card multiplies the base SpellDef's stats — behavior archetype   */
/*  is untouched (same 3D cast, tuned numbers + a shifted identity).   */
/*  Every card carries an explicit trade-off: no strict upgrades.      */
/* ================================================================== */
export interface EvolutionMods {
  dmg?: number; // baseDamage multiplier (default 1)
  mana?: number; // manaCost multiplier
  cd?: number; // cooldown multiplier
  radius?: number; // aoe radius multiplier (where the behavior uses it)
}
export interface EvolutionDef {
  id: string; // unique, stable — "fire:cinderwake"
  base: ElementId; // the spell this evolves
  name: string;
  tagline: string;
  desc: string;
  color: string; // evolved identity tint (stays in the base hue family)
  glow: string;
  mods: EvolutionMods;
  /** honest mechanical trade-off lines, shown on the card */
  tradeoffs: string[];
}
export const EVOLUTIONS: EvolutionDef[] = [
/* fire — Ember (orb) */
{ id: "fire:cinderwake", base: "fire", name: "Cinderwake", tagline: "The slow cataclysm", desc: "The orb swells into a falling star — a vast, molten bloom.", color: "#ff5c33", glow: "#ffb08a", mods: { dmg: 1.45, radius: 1.3, mana: 1.35, cd: 1.25 }, tradeoffs: ["+45% damage, +30% blast radius", "+35% aether cost, +25% cooldown"] },
{ id: "fire:wildfire", base: "fire", name: "Wildfire", tagline: "The hungry flicker", desc: "A quick, cheap flame that never stops feeding.", color: "#ffa14d", glow: "#ffd9ad", mods: { dmg: 0.8, cd: 0.6, mana: 0.85 }, tradeoffs: ["−40% cooldown, −15% aether cost", "−20% damage"] },
/* ice — Frost (shards) */
{ id: "ice:blackfrost", base: "ice", name: "Blackfrost", tagline: "The heavy lance", desc: "Fewer, darker lances of ice that hit like falling masonry.", color: "#5aa8d8", glow: "#bfe4ff", mods: { dmg: 1.5, cd: 1.3, mana: 1.15 }, tradeoffs: ["+50% damage", "+30% cooldown, +15% aether cost"] },
{ id: "ice:hailstorm", base: "ice", name: "Hailstorm", tagline: "The chattering swarm", desc: "A relentless rattle of small needles.", color: "#a8e4ff", glow: "#e0f7ff", mods: { dmg: 0.75, cd: 0.55, mana: 0.85 }, tradeoffs: ["−45% cooldown, −15% aether cost", "−25% damage"] },
/* lightning — Bolt (chain) */
{ id: "lightning:stormcrown", base: "lightning", name: "Stormcrown", tagline: "The crowned surge", desc: "Each leap lands with a tyrant's weight.", color: "#ffd23e", glow: "#fff2a8", mods: { dmg: 1.35, mana: 1.2, cd: 1.15 }, tradeoffs: ["+35% damage", "+20% aether cost, +15% cooldown"] },
{ id: "lightning:sparkflow", base: "lightning", name: "Sparkflow", tagline: "The stuttering arc", desc: "The arc snaps again and again, faster than thought.", color: "#fff2a0", glow: "#fffbe0", mods: { dmg: 0.75, cd: 0.6, mana: 0.85 }, tradeoffs: ["−40% cooldown, −15% aether cost", "−25% damage"] },
/* shadow — Shade (blink) */
{ id: "shadow:longnight", base: "shadow", name: "Long Night", tagline: "The deeper strike", desc: "You arrive out of a longer dark, and the dark bites harder.", color: "#8f3fff", glow: "#cfb0ff", mods: { dmg: 1.4, radius: 1.25, cd: 1.15 }, tradeoffs: ["+40% damage, +25% arrival blast", "+15% cooldown"] },
{ id: "shadow:flicker", base: "shadow", name: "Flicker", tagline: "The quick step", desc: "Short hops, one after another, cheap as breath.", color: "#c99aff", glow: "#e8d4ff", mods: { dmg: 0.8, cd: 0.6, mana: 0.75 }, tradeoffs: ["−40% cooldown, −25% aether cost", "−20% damage"] },
/* light — Lance (beam) */
{ id: "light:dawnbreaker", base: "light", name: "Dawnbreaker", tagline: "The searing shaft", desc: "A heavier beam that burns a wider story through the line.", color: "#ffe070", glow: "#fffbe0", mods: { dmg: 1.35, mana: 1.2, cd: 1.2 }, tradeoffs: ["+35% damage", "+20% aether cost, +20% cooldown"] },
{ id: "light:radiance", base: "light", name: "Radiance", tagline: "The steady glow", desc: "A gentler light, held up more often.", color: "#fff8cf", glow: "#ffffff", mods: { dmg: 0.75, cd: 0.65, mana: 0.9 }, tradeoffs: ["−35% cooldown", "−25% damage, −10% aether cost"] },
/* void — Null (well) */
{ id: "void:eventhorizon", base: "void", name: "Event Horizon", tagline: "The wider wound", desc: "The well gapes wider and crushes harder.", color: "#b03eff", glow: "#e0b0ff", mods: { dmg: 1.25, radius: 1.3, cd: 1.2, mana: 1.2 }, tradeoffs: ["+25% damage, +30% pull radius", "+20% cooldown, +20% aether cost"] },
{ id: "void:singularity", base: "void", name: "Singularity", tagline: "The tight knot", desc: "A small, hungry point that opens again and again.", color: "#e88fff", glow: "#f5c8ff", mods: { dmg: 1.15, radius: 0.75, cd: 0.65, mana: 0.85 }, tradeoffs: ["−35% cooldown, +15% damage", "−25% pull radius"] },
/* arcane — Hex (fan) */
{ id: "arcane:hexstorm", base: "arcane", name: "Hexstorm", tagline: "The heavy curse", desc: "Each seeker carries a house-breaking hex.", color: "#7a5cff", glow: "#b9a8ff", mods: { dmg: 1.5, cd: 1.25, mana: 1.2 }, tradeoffs: ["+50% damage", "+25% cooldown, +20% aether cost"] },
{ id: "arcane:hexvolley", base: "arcane", name: "Hexvolley", tagline: "The endless spite", desc: "A drumbeat of small grudges.", color: "#b0a1ff", glow: "#dcd4ff", mods: { dmg: 0.7, cd: 0.6, mana: 0.75 }, tradeoffs: ["−40% cooldown, −25% aether cost", "−30% damage"] },
/* blood — Spike (javelin) */
{ id: "blood:impaler", base: "blood", name: "Impaler", tagline: "The running-through", desc: "A heavier spike that pins shadows to the far wall.", color: "#ff2f56", glow: "#ff9aad", mods: { dmg: 1.3, mana: 1.2, cd: 1.15 }, tradeoffs: ["+30% damage", "+20% aether cost, +15% cooldown"] },
{ id: "blood:bloodletting", base: "blood", name: "Bloodletting", tagline: "The quick cut", desc: "Cheap, fast, and never enough.", color: "#ff7d95", glow: "#ffc4d0", mods: { dmg: 0.7, cd: 0.6, mana: 0.9 }, tradeoffs: ["−40% cooldown", "−30% damage"] },
/* wind — Gale (crescents) */
{ id: "wind:hurricane", base: "wind", name: "Hurricane", tagline: "The great shove", desc: "Heavier blades that throw foes like leaves.", color: "#4fd8c8", glow: "#c2fff6", mods: { dmg: 1.45, cd: 1.15, mana: 1.15 }, tradeoffs: ["+45% damage", "+15% cooldown, +15% aether cost"] },
{ id: "wind:zephyr", base: "wind", name: "Zephyr", tagline: "The light breath", desc: "A quick sigh of wind, one after another.", color: "#b2f2ea", glow: "#e0fffa", mods: { dmg: 0.75, cd: 0.6, mana: 0.7 }, tradeoffs: ["−40% cooldown, −30% aether cost", "−25% damage"] },
/* earth — Wall (ward) — single branch */
{ id: "earth:deeproots", base: "earth", name: "Deeproots", tagline: "The standing stone", desc: "Walls rise swift and cheap, root-deep and patient.", color: "#e0b060", glow: "#f5d9a0", mods: { cd: 0.68, mana: 0.78 }, tradeoffs: ["−32% cooldown, −22% aether cost", "The wall's strength is unchanged — this is economy, not might"] },
/* time — Slow (timenova) — single branch */
{ id: "time:eternity", base: "time", name: "Eternity", tagline: "The longer stillness", desc: "The frozen field stretches further into the fight.", color: "#3ee0aa", glow: "#b0ffe2", mods: { radius: 1.3, mana: 1.25, cd: 1.1 }, tradeoffs: ["+30% field radius", "+25% aether cost, +10% cooldown"] },
/* nature — Spore (pod) — single branch */
{ id: "nature:rotgarden", base: "nature", name: "Rotgarden", tagline: "The spreading blight", desc: "The cloud blooms wider and rots deeper.", color: "#5ec93e", glow: "#bdf29a", mods: { dmg: 1.3, radius: 1.35, cd: 1.2 }, tradeoffs: ["+30% damage, +35% cloud radius", "+20% cooldown"] },
/* sonic — Echo (nova) — single branch */
{ id: "sonic:cathedral", base: "sonic", name: "Cathedral", tagline: "The great ring", desc: "One vast, tolling circle that hurls everything away.", color: "#ff7ad0", glow: "#ffd6f2", mods: { radius: 1.3, dmg: 1.25, cd: 1.2, mana: 1.15 }, tradeoffs: ["+25% damage, +30% ring radius", "+20% cooldown, +15% aether cost"] }];
/** All evolution cards for one element (may be empty). */
export function evolutionsFor(el: ElementId): EvolutionDef[] {
  return EVOLUTIONS.filter(e => e.base === el);
}
export const EVOLVE_WAVE_MIN = 12; // no evolutions before wave 12
export const EVOLVE_BOUND_WAVES = 6; // the spell must have been bound ≥6 waves
export const EVOLVE_CHANCE = 0.6; // per-wave-end gate once eligible (seeded)
/** Deterministic evolution draft (scope report: "deterministic offer
 *  generation"). Consumes from the PASSED rng ONLY when at least one
 *  eligible spell exists (documented call order for the seed contract):
 *    roll 1 — chance gate; roll 2 — eligible-spell pick.
 *  Returns null (no rng consumed) when nothing is eligible. */
export function draftEvolutionOffer(equipped: (string | { merged: string[] } | null)[], evolved: Record<string, string>, boundWave: Record<string, number>, wave: number, rng: { next(): number }): { element: ElementId; cards: EvolutionDef[] } | null {
  if (wave < EVOLVE_WAVE_MIN) return null;
  const eligible: ElementId[] = [];
  for (const slot of equipped) {
    if (typeof slot !== "string") continue; // merged slots walk the resonance path instead
    if (evolved[slot]) continue; // one evolution per element per run
    if (!EVOLUTIONS.some(e => e.base === slot)) continue;
    if (wave - (boundWave[slot] ?? 0) < EVOLVE_BOUND_WAVES) continue;
    eligible.push(slot as ElementId);
  }
  if (eligible.length === 0) return null;
  if (!rngNextBool(rng, EVOLVE_CHANCE)) return null;
  const pick = eligible[Math.min(eligible.length - 1, Math.floor(rng.next() * eligible.length))];
  return { element: pick, cards: evolutionsFor(pick) };
}
function rngNextBool(rng: { next(): number }, p: number): boolean {
  return rng.next() < p;
}
/** Effective spell def with an evolution's multipliers applied (pure — no
 *  mutation of SPELLS). Cost/cooldown/damage/radius scale; behavior
 *  archetype, element id and resonance identity are untouched. */
export function evolvedSpellDef(el: ElementId, evoId: string | null | undefined): SpellDef {
  const base = SPELLS[el];
  const evo = evoId ? EVOLUTIONS.find(e => e.id === evoId) : null;
  if (!evo || evo.base !== el) return base;
  const m = evo.mods;
  return {
    ...base,
    name: evo.name,
    tagline: evo.tagline,
    color: evo.color,
    glow: evo.glow,
    manaCost: Math.max(1, Math.round(base.manaCost * (m.mana ?? 1) * 10) / 10),
    cooldown: Math.round(base.cooldown * (m.cd ?? 1) * 100) / 100,
    baseDamage: Math.round(base.baseDamage * (m.dmg ?? 1)),
    radius: base.radius !== undefined ? Math.round(base.radius * (m.radius ?? 1) * 10) / 10 : undefined
  };
}
export function hexNum(css) {
  return parseInt(css.replace("#", ""), 16);
}
/** Canonical game version (crash snapshots, save diagnostics, README sync).
    Keep in lockstep with src/lib/site.ts SITE_VERSION and the llms.txt
    copy — machine-checked on every CI run by scripts/validate-web.ts. */
export const GAME_VERSION = "2.2.0";
export const CHANGELOG = [{
  version: "2.2.0",
  name: "The Reforged Update",
  date: "2026-10-28",
  notes: ["A real loading screen: the game now opens behind a byte-accurate summoning veil (sprites, the mage and the clip bank arrive first; the bestiary and terrain stream behind it), and starting a run waits for the relics with live MB progress instead of falling through to fallback art after 8 seconds", "New-device smoothness: the arena now builds behind the loading veil, the twenty in-run glass panels dropped their per-frame backdrop blur, and the 3D loop stops rendering entirely behind the fully opaque menu, defeat and credits screens", "The whole deploy shed about 9 MB: unreferenced source art moved out of the site, the two byte-identical social images became one 133 KB JPEG, the 651 KB favicon became a 1 KB vector, and 49 unused packages left the project", "The brand typefaces (Cinzel + Alegreya Sans) are now self-hosted and preloaded — no third-party font requests, one less origin in the privacy policy", "Truthful numbers everywhere: the defeat-screen tithe now reads the way the code pays (75% to the rift), a run is described as five act bands drawn from ten terrains, and the data-stance copy claims exactly what the game does", "Landscape phones see the Enter button without scrolling (short-viewport menu compaction), pinch zoom works again, the first Tab key no longer lands on an invisible link, and Wave 1 reads as Wave 1 from the opening countdown", "Time Survived now counts the run you actually played (wall time in play, countdowns included), Re-Enter says it restarts from wave 1, and the seed field shows a visible focus ring", "Installed-to-home-screen launches land on the game, not the host root (manifest start_url fixed for the subpath deploy)"]}, {
  version: "2.1.1",
  name: "The Visibility Update",
  date: "2026-10-27",
  notes: ["Search and AI discoverability: an XML sitemap, a canonical URL, VideoGame structured data and an llms.txt written for language models", "A prerendered, screen-reader-first summary of the game — the rift is now legible without JavaScript, and every version label in the game derives from this changelog (no more stale 2.0 tags)", "Terms of Service and a Privacy Policy that state exactly what the game collects (nothing) — reachable from the main menu", "One intentional type system: the brand faces (Cinzel + Alegreya Sans) are now the only fonts the site ships; the unused scaffold font is gone", "A branded 404 for sealed corridors of the rift, and standard 1200×630 social-share images", "Accessibility polish: framer entrances now respect prefers-reduced-motion, and informational micro-captions were lifted to readable contrast"]}, {
  version: "2.1",
  name: "The Evolution Update",
  date: "2026-10-26",
  notes: ["Spell Evolutions — 22 evolution cards across all 13 elements: after wave 12, a long-bound spell may be offered an evolution with real trade-offs (heavier and slower, or faster and lighter). One evolution per spell per run, deterministic per seed", "The five MERCY_* constants are now the single source of truth for the mercy ladder — the engine, spell and spawn code all read them directly (behavior-preserving integrity fix, regression-harnessed)", "Colorblind-safe element palettes (deuteranopia, protanopia, tritanopia) — every element stays readable without hue alone", "Left-hand mirror mode and one-thumb tap-to-cast for touch players", "Death-cause log — the defeat screen names your killer and recalls your last three wounds", "Off-screen threat markers point at elites and tyrants beyond your view", "Screen Wake Lock holds the display awake during live runs; a lost controller auto-pauses the trial", "Battery-aware mode eases quality and frame rate below 20% charge", "3-2-1 resume countdown after unpausing (toggleable), quick same-seed re-entry from defeat, haptic cues, low-HP vignette slider, music ducking behind overlays, and a 30/60 fps cap setting", "A crash snapshot overlay copies seed, settings and version to the clipboard when the rift breaks — offline, nothing uploaded", "Dead exports removed (RNG_STREAM_SALTS, SLOT_KEYS, COMBO_COUNT, BOSS_ORDER, the no-op onVictory) and the duplicated element color map consolidated"]
}, {
  version: "2.0",
  name: "The Resonance Update",
  date: "2026-10-24",
  notes: ["The game is now ARCHMAGE: RIFTBOUND — 3D Edition, its own line beside the original Archmage: Rift Survivor", "Spell cooldowns are now readable at a glance — every slot counts down the exact remaining seconds and calls READY the instant it can cast again", "Mute All is now absolute — effects, interface sounds, music and ambience all stop and stay stopped, and unmuting brings back exactly the right track", "Blink reaches farther (about nine strides) and follows your mouse — aim where you want to land, and the rift finds a safe spot even beside rubble", "Aether glyphs now shine with a bright core, a dark outline and a golden ground ring — no more losing them in the spell-light", "Accidental right-click menus, drags and text selection are silenced across the whole game — menus, combat, pauses and overlays — while inputs always release cleanly when you switch away", "Binding a new spell now names its destination — empty slots are offered first, and replacing a bound spell asks you to pick the exact slot and confirm", "Static deployment support for GitHub Pages alongside the normal server build"]
}, {
  version: "1.2",
  name: "The Shifting Rift",
  date: "2026-10-24",
  notes: ["The ground is now tied to the rift seed — Rift's Choice rolls a fresh terrain every act (every 10 waves), and every run rolls a fresh rift", "Six terrains that look nothing alike — pillars, corridors, spike fields, plazas, rubble, and the new Graveyard dressed with tombstones, crypts and dead trees from Kenney's open-source kit", "Melee foes chain true attack combos with a heavy finisher, and the fallen now collapse to the ground instead of vanishing", "Tyrants move with weight — slower idle, heavier gait", "New impact ripples and slash arcs, and the frame order of animations and effects is now a documented contract", "Brighter rift — default brightness raised, range widened from 50 to 250", "Larger camera with a field-of-view setting — from tight and cinematic to wide and tactical", "Three save slots — keep three mages, switch or overwrite them from Settings", "Credits and honors moved into the Codex — the open-source makers get their roll of honor", "The landing is lean — controls and lore now live in the Codex"]
}, {
  version: "1.1",
  name: "The Living Rift",
  date: "2026-10-23",
  notes: ["Every foe walks, sprints and swings — real animation clips for the imp and brute families, from open-source itch.io packs", "Ghost, slime and plant motion rebuilt — ghosts drift, slimes hop, plants sway", "Foe bodies now match their true hitboxes, and boss regalia was refitted to match", "Five arena terrains — Rubble Field, Open Plaza, Pillar Ring, Twin Lanes, Stone Chaos", "Rift seed control — same seed and same terrain build the same arena", "Brightness setting rescaled — 40 to 200, default 100", "The landing breathes — deeper drift, richer motes and embers", "New Codex section — the full controls rite and this changelog", "Every name simplified — Pyroclasm to Ember, Reliquary to Vault, Arcanum to Runes, Malgrym to Grimm, Ashgorim to Cinder, Gutter Ghoul to Ghoul, Ashfiend to Fire Imp, Bulwark to Sturdy, The Endless Dirge to The Endless Echo, and more", "Touch targets audited — every tap zone is 44px or larger"]
}, {
  version: "1.0",
  name: "The Third Dimension",
  date: "2026-10-21",
  notes: ["The base release — fifty waves, thirteen spells, seventy-eight resonances", "Five tyrants and six biomes, from the Dark Gate to the Abyss", "The Vault — permanent upgrades bought with aether glyphs", "A mercy ladder — every fall arms the next stand", "A true 3D arena with a quality governor that eases resolution toward 60 fps", "Built for every device — keyboard and mouse, touch sticks, gamepad with rumble", "Open-source art from seven itch.io packs — KayKit, Quaternius, Kronbits, dunpixel, Augusto Faria (see Assets & Credits)"]
}];