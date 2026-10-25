/* Shared types for ARCHMAGE: RIFTBOUND (3D Edition).
   This module imports NOTHING — it is the base of the dependency graph. */

export type GamePhase =
  | "menu"
  | "playing"
  | "paused"
  | "gate" // tribute gate overlay (mandatory pick)
  | "offer" // spell tear offer overlay
  | "merge" // sacrifice-merge overlay (resonance orb)
  | "evolve" // spell-evolution offer overlay (v2.2)
  | "gameover"
  | "credits"; // victory credits → return or endless

export interface BannerPayload {
  title: string;
  sub: string | null;
  color: string;
  key: number;
}

/** One draft choice in a tribute gate (every TRIBUTE_INTERVAL waves). */
export interface GateChoice {
  id: string;
  name: string;
  desc: string;
  icon: string; // lucide icon name key, see screens.tsx ICONS
  color: string;
  tier: number; // how many times already held (0 = new)
}

export interface GateOffer {
  wave: number;
  choices: GateChoice[];
}

/** Spell tear offer: pick one of 3 elements or skip. */
export interface SpellOfferPayload {
  pool: string[]; // ElementIds offered
  equipped: (string | { merged: string[] } | null)[]; // 3 slots — snapshot at open
  wave: number;
  /* R-07 (v2.0): the PRIOR selected slot at offer-open (context for the
   *  overlay's slot plates; the commit itself always uses the explicit
   *  target the player confirms, never this value). */
  selected: number;
}

/** Resonance orb: sacrifice exactly 2 equipped spells → merged slot. */
export interface MergeOfferPayload {
  equipped: (string | { merged: string[] } | null)[];
  resonanceName: string;
  resonanceLore: string;
}
/** Spell evolution offer (v2.2): ONE eligible element + its branch cards.
 *  The player picks a card (or declines — the base spell is kept). */
export interface EvolveOfferPayload {
  element: string; // ElementId being offered
  cards: import("./content").EvolutionDef[];
  wave: number;
}

export interface RunStats {
  wave: number;
  score: number;
  kills: number;
  damage: number;
  timeSec: number;
  glyphs: number; // aether glyphs collected this run (banked at 25% on death, 100% on triumph)
  triumph: boolean; // cleared wave 50
  endless: boolean; // died in endless
  newCombos: string[]; // resonance keys first-woven this run
  bossesSlain: string[];
  bestResonance: string | null;
  seed: string;
  /* --- v2.2 death-cause log (scope report §6) --- */
  /** Honest attribution of the killing blow (source display name); null
   *  when unknown. Simultaneous/DOT deaths keep their last cause — the
   *  defeat screen says "the rift's aftermath" when the trail is cold. */
  killedBy: string | null;
  /** The last three damage events before death, newest last. */
  lastHits: { cause: string; amount: number; t: number }[];
  /* --- milestone-result fields (audit P1-1, Wave 10+ idempotent banking) --- */
  runId: string; // fresh per startRun, stable across the victory→endless lifetime
  kind: "death" | "victory" | "endless-death";
  payout: number; // shards banked by this milestone
  /** post-victory delta for endless-death commits (null for other kinds) */
  delta: { kills: number; damage: number; timeSec: number; glyphs: number; score: number } | null;
}

/** Fast-path HUD snapshot — pushed by engine ~30 Hz, applied to DOM refs. */
export interface HudSnapshot {
  hp: number;
  hpMax: number;
  aether: number;
  aetherMax: number;
  surge: number; // 0..1
  surgeActive: number; // seconds remaining, 0 = inactive
  wave: number;
  waveProgress: number; // 0..1 (spawned+killed budget vs wave budget)
  enemiesLeft: number;
  glyphs: number;
  score: number;
  spellIds: string[]; // currently equipped (element ids; merged slots appear as "a+b")
  spellNames: string[];
  spellColors: string[];
  selected: number;
  cooldowns: number[]; // 0..1 per slot
  /* R-02 (v2.0 audit): authoritative remaining cooldown in SECONDS per slot —
   *  the HUD renders the countdown/READY text from this value instead of
   *  reverse-calculating a max from the fraction (merged slots, Surge and
   *  cd-multipliers make that lossy). Same simulation clock as the fraction. */
  cooldownSeconds: number[];
  castWindow: number; // resonance weave window remaining 0..1 (0 = inactive)
  lastCastElement: string | null;
  blinkCd: number; // 0..1 (1 = ready)
  boss: { name: string; title: string; hp: number; hpMax: number; color: string } | null;
  mercy: number; // effective mercy fraction 0..1
  /* v2.2: per-slot evolution flags — the HUD badges evolved spells. */
  spellEvolved: boolean[];
  /* v2.2: remaining resume-countdown seconds (0 = none). The engine holds
   *  the simulation frozen while this is > 0. */
  countdown: number;
  /* v2.2: off-screen threat markers — screen-space angle (deg, 0 = up,
   *  clockwise) and kind. Max 3, boss first. Empty when nothing looms. */
  threats: { angle: number; kind: "elite" | "boss" }[];
  /* F-06 (audit): biome identity + the FROZEN active-run seed — the HUD
   *  always describes the world actually generated. */
  biomeName: string;
  seed: string;
}

/** Input state — mutated by GameShell (keyboard/mouse) + TouchControls. */
export interface InputState {
  moveX: number; // -1..1 (strafe)
  moveZ: number; // -1..1 (forward)
  aimX: number; // world-space aim point on ground plane
  aimZ: number;
  castHeld: boolean; // LMB / touch FIRE
  volleyHeld: boolean; // RMB / touch VOLLEY
  blink: boolean; // edge-triggered request (engine clears)
  surge: boolean; // edge-triggered
  cycle: 0 | 1 | -1; // spell cycle request (engine clears)
  select: number; // -1 = none, else 0..2 request
  pause: boolean; // edge-triggered
  /* v2.2 tap-to-cast / one-thumb mode: when true the engine derives the aim
   *  point from the CURRENT move direction each step (aim = player + dir*5),
   *  so a single thumb can steer and fire. Aim-assist still applies. */
  aimFromMove: boolean;
}

export function makeInputState(): InputState {
  return {
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: -1,
    castHeld: false,
    volleyHeld: false,
    blink: false,
    surge: false,
    cycle: 0,
    select: -1,
    pause: false,
    aimFromMove: false,
  };
}

export interface EngineCallbacks {
  onPhase: (phase: GamePhase) => void;
  onHud: (snap: HudSnapshot) => void;
  onBanner: (title: string, sub: string | null, color: string) => void;
  onGate: (offer: GateOffer | null) => void;
  onSpellOffer: (offer: SpellOfferPayload | null) => void;
  onMerge: (offer: MergeOfferPayload | null) => void;
  onEvolve: (offer: EvolveOfferPayload | null) => void;
  onStats: (stats: RunStats) => void;
  onCombo: (key: string) => void; // resonance first-weave unlock
  onEnemySeen: (type: string) => void;
  onSpellSeen: (id: string) => void; // spell first-bind unlock (P2-2 discovery gating)
  onBossSeen: (id: string) => void;
}

export interface SfxLike {
  play: (name: string, opts?: { intensity?: number }) => void;
  musicMenu: () => void;
  musicCombat: () => void;
  musicBoss: () => void;
  musicStop: () => void;
  setIntensity: (x: number) => void;
  /** v2.2: duck music ≈−6 dB while an overlay is open (smooth ramp, no
   *  stacked envelopes — a single setTargetAtTime per toggle). */
  duckMusic?: (on: boolean) => void;
}

export interface EngineOpts {
  callbacks: EngineCallbacks;
  sfx: SfxLike;
  bonuses: {
    hpMult: number;
    dmgMult: number;
    aetherMult: number;
    speedMult: number;
  };
  mercyTier: number; // -1 auto, else chosen tier
  mercyDeaths: number;
  settings: import("./content").GameSettings;
}
