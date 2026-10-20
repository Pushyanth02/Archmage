/* ArchMage engine — canvas simulation: waves, spells, resonances, boss, arena.
   Patch 7.0 "The Pure Arcanum": the story layer is fully excised — no
   cutscene phase, no NPC dialogue, no boss taunts/death lines. Boss clears
   roll straight into evolution offers; victory fires directly. New
   intelligent systems from the roguelike research: bestiary discovery
   callbacks (first-kill per enemy type / boss), elite HP bars, a damage-
   numbers setting, boss phase-2 enrage bursts, an act threat meter in the
   HUD payload, and ADAPTIVE MUSIC INTENSITY (menu / combat / boss) plus
   pause ducking through the shared Sfx instance. All prior cadences are
   unchanged: 3 starting spells, scheduled drops every 3-5 waves (strict),
   merges every 10 waves, tribute gates every 5 waves, five seed-shuffled
   bosses, DIFFICULTY_MULT 0.9.
   Patch 9.0 "The Expanded Rift": the arena became a FIXED 1920×1280 WORLD
   explored through a smooth follow-camera with device-tailored FOV zoom
   (phones/tablets see wider for maximum readability), a flow-field
   pathfinder + LOS raycasts so ground enemies path AROUND pillars instead
   of jamming against them, ring spawns around the player, five new enemy
   behaviors (skitter/bomber/lancer/warden/mender), two new spells (wind,
   sonic), a per-death Rift Mercy ladder with concrete attack/defense/spawn
   effects, a hold-to-fire FIRE button with auto-targeting, and Archmage
   Mode improvements (pillar avoidance, boss-volley dodging, desktop access).
   Patch 10.2 "The Thinking Rift": every tyrant now runs a UNIQUE behavior
   set (stampede charges, slam shockwaves + adds, blade-dance lunges, blink
   spirals, and an apex storm mixing all three) with per-boss enrages, all
   boss spawn cutscenes/title cards/message banners are GONE (pure audio +
   visual telegraphs), the Fateweaver (Archmage Mode's brain) casts with
   line-of-sight discipline — resonance-aware, mana-economical, never firing
   at foes behind walls — and picks boons from live run context, the flow
   field can't be corner-cut or stuck (no-corner-cut descent, faster stuck
   recovery, rift-hop failsafe), the world grows to 2560×1600 with eight
   archetypes, and the Rift Seed drives a per-seed enemy ecology (poolBias).
   Optimized replica: dead-flag entities + in-place compaction (zero per-frame
   array allocation), squared-distance hot paths, cached gradients, seeded
   reward drafts, head-indexed spawn queue, throttled preallocated HUD payload.
   Patch 11.0 "The Umbral Requiem": STRICT DROP ECONOMY (exactly one drop type
   per wave — spell / heart / resonance / tribute — unclaimed orbs dissolve at
   wave end), resonance orbs demand a SACRIFICE of exactly two bound spells
   (mid-wave merge, wave resumes after), spell drops no longer heal (hearts are
   their own drop), a projectile-VFX overhaul (distinct additive silhouettes
   per element + animated beams + eased rings + a triple-ring resonance
   detonation), and full boss-music triggers (entry sting, ENRAGE war-drone,
   instant collapse on the kill). */

import {
  Arena, TRIBUTE_INTERVAL, BOSS_DEFS, BossDef, COMBOS, DIFFICULTY_MULT, ELITE_DEFS, ELITE_ORDER, ElementId, EliteAffix, EnemyType, ENEMY_DEFS,
  EQUIP_SLOTS, GameSettings, MERGE_INTERVAL, MetaBonuses, RNG, SLOT_KEYS, SPELL_ORDER, SPELLS,
  HEART_DROP_HEAL_FRAC, SPELL_DROP_WAVE_MAX, SPELL_DROP_WAVE_MIN, SPELL_DROP_NERF, SPELL_OFFER_COUNT, STARTER_SPELLS,
  UpgradeChoice, availableTypes, comboKey, eliteChance, endlessBossMult, endlessHpMult, generateArena, hashSeed, mercyForRound, mulberry32,
  scaleEnemy, spawnCap, spawnWindow, waveBudget, VICTORY_WAVE, poolBias, DropKind, attunement, bossHpMult, bossDmgMult, ELITE_BONUS,
  ActDef, actForWave, WORLD_W, WORLD_H,
  MERCY_ATTACK, MERCY_SPAWNS, MERCY_CAPLIVE, MERCY_HP, MERCY_SPD,
} from "./content";
import { Sfx } from "./audio";
import { EVOLUTIONS, EvolutionDef, offerEvolutions } from "./evolutions";
import type { FateContext } from "./autopick";
import { Vfx, Juice, Trail, easeOutBack } from "./vfx";

/* --------------------------------- types --------------------------------- */

export type GamePhase = "menu" | "running" | "intermission" | "paused" | "gameover" | "evolution" | "spelloffer" | "mergeoffer" | "epilogue";

export interface HudSpell { cdFrac: number; cost: number; affordable: boolean; hpCost: boolean; evolved: boolean; id: ElementId; merged?: ElementId[]; empty?: boolean }

export interface HudData {
  hp: number; maxHp: number; mana: number; maxMana: number;
  wave: number; enemiesLeft: number; score: number; kills: number;
  actName: string;
  spells: HudSpell[]; selected: number; dashFrac: number;
  attune: { id: ElementId; frac: number } | null;
  resonance: { id: ElementId; frac: number } | null;
  boss: { name: string; frac: number } | null;
  timeSec: number;
  weave: number;              // 0..1
  surge: number | null;       // remaining fraction while active
  mercy: number | null;      // Patch 9.0: live Rift Mercy assist fraction (null = off)
  mercyTier: number;         // Patch 9.0: active mercy tier (deaths ladder)
  threat: number;            // Patch 7.0: act progress 0..1 (fills toward the boss)
  glyphs: number;            // V1.0: aether glyphs collected THIS RUN (motes)
}

export interface SpellOffer { pool: ElementId[] }

/* Patch 5.0 — merge-spell offer. The engine snapshots the indices of single
   spells in the equipped list (length ≥ 2 required); the player picks two
   indices to fuse. Empty slots are filtered out — only single spells can be
   merged (already-merged slots are immutable). */
export interface MergeOffer { slots: number[]; equipped: { id: ElementId; slot: number }[] }

export interface RunStats {
  wave: number; score: number; kills: number; damage: number;
  shards: number; timeSec: number; newCombos: string[]; best: boolean;
  triumph?: boolean;          // wave-50 victory run
  endless?: boolean;          // Patch 10.0: died inside the endless echo
  evolutions: string[];       // spell transmutations woven this run
  merges: string[];           // spell merges woven this run
}

export interface PhasePayload { rewards?: UpgradeChoice[]; tiers?: Record<string, number>; stats?: RunStats; offer?: SpellOffer; merge?: MergeOffer }

export interface EngineOpts {
  canvas: HTMLCanvasElement;
  seed: string;
  bonuses: MetaBonuses;
  knownCombos: string[];
  settings: GameSettings;
  sfx: Sfx;
  onPhase: (phase: GamePhase, payload?: PhasePayload) => void;
  onHud: (h: HudData) => void;
  onBanner: (title: string, sub: string | null, color: string) => void;
  onComboFound: (key: string, a: ElementId, b: ElementId) => void;
  /* Patch 7.0: bestiary discovery — fired ONCE per enemy type / boss id per
     run; the shell writes it into the meta save's seenEnemies / seenBosses. */
  onBestiary: (kind: string) => void;
  onEvolution: (choices: EvolutionDef[]) => void;
  onSpellOffer: (offer: SpellOffer) => void;
  onMerge: (offer: MergeOffer) => void;
  /* Patch 9.0 — effective Rift Mercy tier (0 = off). Computed by the shell
     from the meta save's mercyDeaths ladder + manual tier selection. */
  mercyTier: number;
}

/* -------------------------------- entities -------------------------------- */

interface Enemy {
  type: EnemyType; name: string; color: string; glow: string;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number; speed: number; damage: number; r: number; score: number;
  ranged: boolean; shootsEvery: number; flying: boolean;
  hitFlash: number; burnT: number; burnDps: number; chillT: number; poisonT: number;
  shootT: number; strafeDir: number; actT: number;
  /* Patch 10.2 — actState widened to a free number so each tyrant can run a
     bespoke state machine (state 2 is reserved for "dashing/charging" in
     every pattern so the shared contact-damage multiplier keeps working). */
  actState: number;
  cx: number; cy: number; contactCd: number; wob: number;
  /* Patch 10.2 — boss-pattern scratch: subT = sub-timer / flag, armAng =
     rotating spiral arm angle, count = repeat/phase counter. Unused by
     normal foes (their behaviors keep using actT/actState/cx/cy). */
  subT: number; armAng: number; count: number;
  affix: EliteAffix | null; resist: number; auraT: number; enraged: boolean;
  dead: boolean;                // flagged on death, compacted at frame start
  grad: CanvasGradient | null;  // cached body gradient (origin-relative)
  /* V1.3 — HIT SQUASH: sq is a 0.18s decaying timer set on every wound; sqA
     is the impact axis. drawEnemy squashes along that axis (preserve volume)
     and springs back — the core "hit feel" deformation. */
  sq: number; sqA: number;
  /* V1.3 — cached under-glow sprite (baked per glow color, ref stored). */
  gspr?: HTMLCanvasElement | null;
  /* Patch 9.0 — stuck detection bookkeeping (flow-field safety net).
     Patch 10.2: stuckN counts CONSECUTIVE stuck windows (escalating kicks,
     then a rift-hop relocation) so terrain can never weld a foe in place. */
  lastX: number; lastY: number; stuckT: number; stuckN: number;
}

interface Proj {
  kind: ElementId; x: number; y: number; vx: number; vy: number; r: number;
  dmg: number; life: number; pierce: number; hit: Set<Enemy>; homing: number;
  special?: string;          // evolution behavior key
  back?: boolean;            // Patch 9.0: hurricane blades — returning home
  grad?: CanvasGradient | null;  // Task 2-b: cached bloom gradient (kind/r immutable)
  /* V1.3 — ribbon trail (Float32Array ring buffer; one tapered fill per
     frame, additive pass) + cached bloom sprite. */
  tr?: Trail | null;
  gspr?: HTMLCanvasElement | null;
}
interface EBolt { x: number; y: number; vx: number; vy: number; r: number; dmg: number; life: number; color: string; grad?: CanvasGradient | null; tr?: Trail | null; gspr?: HTMLCanvasElement | null }
interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number;
  size: number; color: string; drag: number; glow: boolean; grav: number;
}
interface Floater { x: number; y: number; text: string; color: string; life: number; maxLife: number; size: number }
interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; maxLife: number; color: string; w: number }
interface Zap { pts: { x: number; y: number }[]; life: number; maxLife: number; color: string }
interface Rock { x: number; y: number; r: number; hp: number; maxHp: number; life: number; maxLife: number; grad: CanvasGradient | null; tick: number }
interface Bubble { x: number; y: number; r: number; life: number; maxLife: number; grad: CanvasGradient | null; rewind: boolean }
interface Cloud { x: number; y: number; r: number; life: number; maxLife: number; dps: number; tick: number; grad: CanvasGradient | null; slow: boolean; dark: boolean }
interface Mote { x: number; y: number; vx: number; vy: number; val: number; life: number }
/* Patch 11.0 — PICKUP ENTITIES for the strict drop economy. A wave fields
   exactly ONE drop type; the orb on the floor is one of:
     spell      → opens the spell-offer overlay (no heal — hearts are their own drop)
     heart      → mends HEART_DROP_HEAL_FRAC of max HP on touch
     resonance  → demands a SACRIFICE: exactly two bound spells fused into one
   (tribute waves pay out through the end-of-wave gate — no orb spawns). */
interface SpellDrop {
  kind: "spell" | "heart" | "resonance";
  x: number; y: number; vx: number; vy: number; life: number; id: ElementId;
  grad: CanvasGradient | null; wob: number;
}

/* Patch 5.0 — equipped slot. A slot holds a list of SPELL_ORDER indices.
   Length 0 → empty (free for a drop refill). Length 1 → single spell.
   Length ≥ 2 → merged spell (fires every spell in the list when cast).
   Single + single can be merged into one slot of length 2; that merged
   slot is then immutable — it can be replaced wholesale by a new drop but
   cannot itself be split back apart or further merged. */
interface EquippedSlot { spells: number[] }

interface Mods {
  power: number; cdr: number; crit: number; critDmg: number; pierce: number; speed: number;
  manaRegen: number; maxManaB: number; maxHpB: number;
  comboWindow: number; comboDmg: number; dashCdM: number; dashDmg: number;
  spread: number; homing: number; range: number; bolts: number;
  dr: number;                   // damage-taken multiplier (armor rewards lower it)
}

/* --------------------------- tribute rewards ---------------------------- */

/* Patch 6.0: the old spell-mod boon pool is REPLACED by scalable stat
   rewards. Every TRIBUTE_INTERVAL waves the rift pays tribute — three cards,
   and one MUST be taken (mandatory selection; the overlay has no skip).
   Rewards are direct, always-relevant stat boosts (Hades keepsake / Brotato
   item style) that stack with clear increments. "cache" is an always-
   available filler so the pool can never run dry. */
export const REWARD_POOL: UpgradeChoice[] = [
  { id: "hp",        kind: "vitality", name: "Bastion Heart",      desc: "+10 maximum health, and mend 10 now.",                              icon: "heart",    color: "#ff4d6b" },
  { id: "armor",    kind: "vitality", name: "Riftward Hide",      desc: "Take 8% less damage from every source.",                            icon: "shield",   color: "#9aa7c9" },
  { id: "critdmg",  kind: "offense",  name: "Ruin Edge",          desc: "+25% critical damage. Crits bite deeper.",                           icon: "sword",    color: "#f5c96b" },
  { id: "crit",     kind: "offense",  name: "Rune of Ruin",       desc: "+6% critical chance.",                                              icon: "star",     color: "#ff7847" },
  { id: "power",    kind: "offense",  name: "Arcane Might",       desc: "+8% spell damage.",                                                 icon: "sword",    color: "#ffe86b" },
  { id: "cdr",      kind: "offense",  name: "Quickened Sigils",   desc: "−8% spell cooldowns. The weaves answer faster.",                    icon: "hourglass", color: "#6bf0c2" },
  { id: "pierce",   kind: "offense",  name: "Splitting Edge",     desc: "Projectiles pierce +1 additional foe.",                             icon: "arrows",  color: "#7fd8ff" },
  { id: "combo",    kind: "offense",  name: "Resonant Soul",      desc: "Resonance window +0.5s and resonance damage +15%.",                icon: "rings",   color: "#b06bff" },
  { id: "mana",     kind: "arcana",   name: "Deep Wellspring",    desc: "+20 maximum aether, restored immediately.",                        icon: "drop",    color: "#43e8d8" },
  { id: "manaregen",kind: "arcana",  name: "Focused Mind",       desc: "+12% aether regeneration.",                                       icon: "mind",    color: "#8f7bff" },
  { id: "speed",    kind: "mobility", name: "Windwalk",          desc: "+6% movement speed. Harder to catch, harder to hit.",              icon: "boot",    color: "#c9955a" },
  { id: "dash",     kind: "mobility", name: "Shadowstride",      desc: "Blink step recharges 15% faster.",                                 icon: "bolt",    color: "#ffe86b" },
  /* always available — never gated */
  { id: "cache",    kind: "tribute",  name: "Aether Cache",       desc: "+400 score and +2 aether glyphs banked for the Reliquary.",       icon: "gem",     color: "#ffe9ad" },
];

const REWARD_MAX: Record<string, number> = {
  hp: 8, armor: 5, critdmg: 6, crit: 7, power: 9, cdr: 6, pierce: 4, combo: 4,
  mana: 7, manaregen: 6, speed: 6, dash: 4,
};

/* --------------------------------- engine --------------------------------- */

const TAU = Math.PI * 2;
const SURGE_DUR = 6;
const N_SPELLS = SPELL_ORDER.length;
const SHRINE_CHANCE = 0.18;
const SHRINE_LIFE = 14;
/* V1.1 — world-pixel size of the pre-baked mote sprite (9px diamond + glow
   halo padding); rendered once at 2× device resolution and blitted. */
const MOTE_SPRITE = 32;
/* Task 2-b — free-list cap for pooled particles. The live particleCap tops
   out at 420, so 512 pooled covers a full swap without unbounded retention. */
const PARTICLE_POOL_MAX = 512;
/* Task 2-b — hoisted: the border corner tuples were rebuilt every frame. */
const WORLD_CORNERS: [number, number, number, number][] = [
  [0, 0, 1, 1], [WORLD_W, 0, -1, 1], [0, WORLD_H, 1, -1], [WORLD_W, WORLD_H, -1, -1],
];
/* Patch 9.0 — flow-field pathfinding grid: 64px cells over the 2560×1600
   (Patch 10.2) world → 40×25 = 1000 cells. Tiny BFS, rebuilt only when the
   player crosses a cell boundary (or twice a second as a safety net). */
const FLOW_CELL = 64;
const FLOW_GW = WORLD_W / FLOW_CELL;
const FLOW_GH = WORLD_H / FLOW_CELL;
const FLOW_UNREACHED = 0xFFFF;
/* V1.3 — SPATIAL HASH: uniform 96px broadphase grid over the live enemy
   set (27×17 cells). The projectile hot-path queries its 3×3 neighborhood
   instead of every foe — the classic horde-game collision win. Cell size
   covers the worst interaction radius (enemy 22 + proj 12 + graze ~20 =
   54px < 96) so 3×3 can never miss a hit. */
const GRID_CELL = 96;
const GRID_W = Math.ceil(WORLD_W / GRID_CELL);
const GRID_H = Math.ceil(WORLD_H / GRID_CELL);

export class ArchmageEngine {
  private o: EngineOpts;
  private ctx: CanvasRenderingContext2D;
  private rng: RNG;
  private raf = 0;
  private last = 0;
  private destroyed = false;
  private goTimer: number | undefined;

  phase: GamePhase = "running";

  private w = 800; private h = 600; private dpr = 1;
  /* Patch 9.0 — the world is a fixed arena (2560×1600 since Patch 10.2);
     this.w/h remain the CANVAS (viewport) size. camX/camY is the world point
     at screen center; zoomCur is the live FOV scale (smoothed toward `zoom`,
     the device-tailored target; combat pressure pulls it out slightly). */
  private camX = WORLD_W / 2; private camY = WORLD_H / 2;
  private zoom = 1; private zoomCur = 1;
  private deviceClass: "phone" | "tablet" | "desktop" = "desktop";
  /* view culling rect in world coords (recomputed per render) */
  private vx0 = 0; private vy0 = 0; private vx1 = 0; private vy1 = 0;
  private arena: Arena;
  private t = 0; private hitStop = 0; private redFlash = 0;
  /* V1.3 — THE RADIANT REWORK CORE: vfx owns every combat effect pool
     (blasts / shocks / sparks / aura shells / soul wisps / smoke) drawn
     from pre-baked sprites inside ONE additive pass; juice is the camera +
     time feel controller (trauma shake, kill zoom-punch, flash, slow-mo,
     hitstop re-trigger guard). */
  private vfx = new Vfx();
  private juice = new Juice();
  /* V1.3 — adaptive quality: EMA frame-time monitor steps the effect
     density down under sustained load and back up with hysteresis. */
  private frameEma = 16.7; private lowFrames = 0; private hiFrames = 0; private qualityAuto = 1;
  /* V1.3 — per-element ribbon-trail fill styles + widths (precomposed
     strings; zero per-frame allocation in the additive trail pass). */
  private trailFills = new Map<string, string>();

  /* player */
  private px = 400; private py = 300; private pvx = 0; private pvy = 0;
  private hp: number; private maxHp: number; private mana: number; private maxMana: number;
  private cd = new Array(N_SPELLS).fill(0) as number[];     // per-element cooldown (keyed by SPELL_ORDER idx)
  private dashCd = 0; private dashT = 0; private iframes = 0;
  private selected = 0;                                    // slot index 0..EQUIP_SLOTS-1
  private ghosts: { x: number; y: number; life: number }[] = [];
  private boltCd = 0;

  /* Patch 5.0 — Hadesian inventory reworked: equipped is an array of
     EquippedSlot. Single-spell slots have spells:[idx]; merged slots have
     spells:[a,b,...] (cast fires all in sequence). Empty slots have spells:[].
     The player starts with 3 single spells. Drops refill empty slots (or
     replace any single slot via the offer overlay). Merge intermission
     fuses two single slots into one merged slot, freeing the second.
     spellDrops are SCHEDULED (dropWave field) every 3-5 waves — no per-kill
     % rolls. bossShuffle is a seed-permuted copy of BOSS_DEFS so each run
     sees a different tyrant order through the 5 acts. */
  private equipped: EquippedSlot[] = STARTER_SPELLS.map((id) => ({ spells: [SPELL_ORDER.indexOf(id)] }));
  private spellDrops: SpellDrop[] = [];
  /* V1.0 final — FAIR-CYCLING SPELL BAG: a seeded shuffle-bag over the
     spells the player does NOT hold. Every eligible element is drawn exactly
     once per cycle before any repeats, so tears rotate the whole roster
     fairly instead of a blind cursor. Refilled whenever it runs dry (or the
     loadout changes and the remainder is stale). */
  private spellBag: ElementId[] = [];
  private pendingOffer: SpellOffer | null = null;
  private bossShuffle: BossDef[] = [];
  private runMerges: string[] = [];              // merge names woven this run
  private nextDropWave = 0;                       // wave on which the next scheduled drop will appear
  /* Patch 11.0 — STRICT DROP ECONOMY: each wave resolves exactly ONE drop
     type (spell / heart / resonance / tribute / none). Tribute waves pay out
     through the end-of-wave gate; the other three spawn a single orb that
     DISSOLVES at wave end if unclaimed, so no wave ever carries two types. */
  private waveDrop: DropKind = "none";
  /* Patch 10.0 — ENDLESS MODE: set the moment the player chooses FIGHT at
     the end-credit gate. From then on waves 51+ roll forever with compounding
     escalation (budget/HP/boss multipliers in content.ts), tyrants return as
     ECHOES every 10th wave, and death still banks the triumph (the rift was
     sealed — the echo claimed the mage afterwards). */
  private endless = false;
  /* lean angle (render-only) — smoothed velocity tilt for fluid movement */
  private leanA = 0;
  private stepDust = 0;

  private mods: Mods = {
    power: 1, cdr: 1, crit: 0, critDmg: 2, pierce: 0, speed: 1, manaRegen: 1, maxManaB: 0, maxHpB: 0,
    comboWindow: 1.5, comboDmg: 1, dashCdM: 1, dashDmg: 0,
    spread: 0, homing: 0, range: 1, bolts: 1, dr: 1,
  };
  private rewardTiers: Record<string, number> = {};
  /* V1.0 final — FAIR-CYCLING RNG LEDGERS: rewardOffered counts how often a
     boon card has been DRAFTED into a tribute (weight ∝ 1/(1+n), so every
     eligible boon surfaces); evoOffered does the same for evolution cards.
     Strict drop RATES are untouched — this only fair-cycles WHAT drafts. */
  private rewardOffered: Record<string, number> = {};
  private evoOffered: Record<string, number> = {};
  private bonusShards = 0;               // Aether Cache glyphs banked mid-run
  /* V1.0 — THE GLYPH LEDGER: slain foes shed aether glyphs (the gold motes).
     Every pickup registers here, feeds the live HUD counter, and is paid
     out post-game through buildStats(). */
  private runGlyphs = 0;
  /* V1.0 — attunement(wave), cached per wave (the mage's growing power; see
     content.ts for the curve rationale). */
  private att = 1;

  /* resonance + weave */
  private lastCast: { id: ElementId; t: number } | null = null;
  private runFound = new Set<string>();
  private weave = 0;
  private surgeT = 0;
  private weaveFullCued = false;

  /* Patch 7.0 — acts, evolutions, shrine, mercy, bestiary */
  private act: ActDef;
  private evolutions: (EvolutionDef | null)[] = new Array(N_SPELLS).fill(null);
  private shrine: { x: number; y: number; life: number; grad: CanvasGradient | null } | null = null;
  private pendingAfter: "nextWave" | "resume" = "nextWave";
  /* Patch 6.0: Rift Mercy — Patch 9.0 reworks it into a per-death ladder
     (tier from accumulated deaths, growing slightly within a run). All the
     concrete effects (defense/attack/spawn/HP/speed) hang off this fraction. */
  private mercyDr = 0;
  private mercyTier = 0;
  /* Patch 9.0 — flow-field pathfinding grid (cell 64px → 40×25 cells on the
     Patch 10.2 world). flowDist holds BFS distance-to-player per cell;
     rebuilt whenever the player crosses a cell boundary or half a second
     elapses. Ground enemies without line of sight steer along it so pillars
     can never trap them. */
  private flowDist: Uint16Array = new Uint16Array(FLOW_GW * FLOW_GH);
  private flowClock = 0;
  private flowCell = -1;
  /* V1.3 — broadphase buckets (arrays reused; cleared via length=0, so the
     steady state allocates nothing). */
  private gridCells: Enemy[][] = [];
  /* Patch 7.0: run-scoped bestiary dedupe — onBestiary fires once per kind. */
  private seenKinds = new Set<string>();
  /* Patch 10.2 — seed-driven enemy ecology: per-type spawn weight multipliers
     derived from the Rift Seed (see poolBias in content.ts). Applied to the
     wave-composition rolls and the boss-wave adds so each seed fields a
     genuinely different monster mix. */
  private typeBias: Record<EnemyType, number>;
  /* Patch 10.2 — boss steering scratch: updateBoss writes the desired
     velocity here (avoids per-frame allocation); the shared enemy update
     applies it after the per-type dispatch. */
  private bossTv = { x: 0, y: 0 };
  /* Patch 10.2 — Fateweaver surge discipline: timestamp of when the weave
     meter filled (0 = not full). The disciplined pilot holds a full surge
     until it matters — boss up, a pack closing, or ~5s held. */
  private weaveFullT = 0;

  /* Patch 6.0 — graphics quality budget */
  private particleCap = 420;
  private gfxDprCap = 2;
  private ambientTarget = 42;

  /* waves */
  private wave = 0; private spawnQueue: { type: EnemyType; t: number }[] = [];
  private sqHead = 0; private spawnClock = 0;

  /* entities — compacted in place; dead entries are skipped everywhere */
  private enemies: Enemy[] = [];
  private projs: Proj[] = [];
  private eBolts: EBolt[] = [];
  private rocks: Rock[] = [];
  private bubbles: Bubble[] = [];
  private clouds: Cloud[] = [];
  private motes: Mote[] = [];
  private particles: Particle[] = [];
  /* Task 2-b — free list: dead particles are recycled here instead of being
     handed to the GC. Every spawn site overwrites ALL fields, so a reused
     particle is indistinguishable from a fresh literal. */
  private particlePool: Particle[] = [];
  private floaters: Floater[] = [];
  private beams: Beam[] = [];
  private zaps: Zap[] = [];
  private ambient: { x: number; y: number; s: number; sp: number; ph: number }[] = [];

  /* attunement (rift shift) */
  private attune: { id: ElementId; t: number; total: number } | null = null;

  /* run stats */
  private score = 0; private kills = 0; private runDamage = 0;

  /* input
     - keys/mouse are the desktop path (window listeners)
     - moveAxis, aim, castHeld, volleyHeld are the touch path (public setters
       called by TouchControls). Both feed the same simulation; the touch axis
       takes precedence so a virtual joystick overrides an idle keyboard. */
  private keys = new Set<string>();
  private mx = 400; private my = 200; private mDown = false; private rDown = false;
  private moveAxisX = 0; private moveAxisY = 0;          // virtual joystick -1..1
  private reducedMotion = false;                         // dampens shake / red flash
  /* Patch 8.0 — Archmage Mode autopilot state. The pilot writes moveAxis /
     aim directly every frame; a short "manual grace" timer pauses the pilot
     whenever the player drives a stick (setMoveAxis / setAim / setCastHeld)
     so human input always wins while it is active. */
  private auto = false;
  private autoManualT = 0;
  private autoTick = 0;
  private autoStrafeDir: 1 | -1 = 1;
  private autoStrafeT = 0;
  private autoWander = Math.random() * TAU;
  /* Patch 9.0 — FIRE button auto-targeting mode (setFireHeld). */
  private fireAuto = false;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;
  private onWheel: (e: WheelEvent) => void;
  private onResize: () => void;
  private onCtx: (e: Event) => void;
  private onBlur: () => void;
  private onVisChange: () => void;

  /* cached gradients (origin-relative where drawn via translate) */
  private bgGrad: CanvasGradient | null = null;
  private vigGrad: CanvasGradient | null = null;
  private surgeGrad: CanvasGradient | null = null;
  private lowHpGrad: CanvasGradient | null = null;
  private playerAura: CanvasGradient | null = null;
  private playerAuraSurge: CanvasGradient | null = null;
  private playerBody: CanvasGradient | null = null;
  private projGrads = new Map<string, CanvasGradient>();
  private boltGrads = new Map<string, CanvasGradient>();
  /* V1.1 AUDIT (perf) — render caches: the pre-baked mote sprite (blit
     replaces per-mote shadowBlur) and the per-size floater font strings. */
  private moteSprite: HTMLCanvasElement | null = null;
  private floaterFonts = new Map<number, string>();
  /* V1.3 MAPS — the act's floor is baked once into this offscreen canvas
     (2560×1600) and blitted with a single drawImage per frame. floorNodes /
     twinkles are the runtime accent node lists baked alongside; ambientRGB
     is the act's precomposed weather color; veinSpr is the shared ember /
     vein glow sprite for node pulses. */
  private floorCv: HTMLCanvasElement | null = null;
  private floorAct = -1;
  private floorNodes: { x: number; y: number; r: number; ph: number }[] = [];
  private twinkles: { x: number; y: number; s: number; ph: number }[] = [];
  private ambientRGB = "200,180,255";
  private veinSpr: HTMLCanvasElement | null = null;

  /* reusable HUD payload (mutated in place, pushed at ~30 Hz) */
  private hudTick = 0;
  private hud: HudData = {
    hp: 0, maxHp: 0, mana: 0, maxMana: 0, wave: 0, enemiesLeft: 0, score: 0, kills: 0,
    actName: "",
    spells: SPELL_ORDER.map(() => ({ cdFrac: 0, cost: 0, affordable: true, hpCost: false, evolved: false, id: "fire" as ElementId })),
    selected: 0, dashFrac: 0,
    attune: null, resonance: null, boss: null,
    timeSec: 0, weave: 0, surge: null, mercy: null, mercyTier: 0, threat: 0,
    glyphs: 0,
  };
  /* Task 2-b — reused mutable payloads for the nullable HUD fields. The
     GameShell consumer reads fields synchronously and its hudRef mirror is
     already live-read tolerant (HudData itself is reused in place), so the
     only thing eliminated here is the per-flush object allocation. */
  private hudAttune: { id: ElementId; frac: number } = { id: "fire", frac: 0 };
  private hudRes: { id: ElementId; frac: number } = { id: "fire", frac: 0 };
  private hudBoss: { name: string; frac: number } = { name: "", frac: 0 };
  /* Task 2-b — per-slot reusable merged-icon buffers. Reused in place while
     a slot's spell count is stable; a composition change flips the shell's
     content-based signature, which refreshes its React state, so retention
     of the buffer reference (setEquippedIds) stays consistent. */
  private hudMerged: ElementId[][] = [];

  constructor(o: EngineOpts) {
    this.o = o;
    this.rng = mulberry32(hashSeed(o.seed));
    /* Patch 10.2 — the seed's ecology stream is read BEFORE anything else so
       the main rng sequence is identical to pre-10.2 for the same seed. */
    this.typeBias = poolBias(o.seed);
    const ctx = o.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;

    /* Patch 9.0: mercy — tier comes from the meta ladder (effectiveMercyTier
     in content.ts); the fraction grows a little as rounds are survived. */
    this.mercyTier = Math.max(0, o.mercyTier | 0);
    this.mercyDr = mercyForRound(1, this.mercyTier);
    this.act = actForWave(1);

    /* Patch 4.0: maxHp drops the +vitality bonus path (no defensive boons
       anymore). maxMana keeps its focus-bonus path since mana boons remain. */
    this.maxHp = o.bonuses.maxHp;
    this.hp = this.maxHp;
    this.maxMana = o.bonuses.maxMana + this.mods.maxManaB;
    this.mana = this.maxMana;

    /* Patch 6.0: apply the graphics preset before the first resize so the
       render resolution + particle budget are correct from frame one. */
    this.applyGfx(o.settings);

    /* Patch 5.0: shuffle the 5 unique bosses via the seed so each restart
       sees a different tyrant order through the 5 acts (e.g. Mordrax at
       wave 10 of one run, wave 50 of another). Also schedule the first
       spell drop (every 3-5 waves, strict — no per-kill % rolls). */
    /* V1.3 — floor cache canvas (baked lazily per act on first draw). */
    this.floorCv = document.createElement("canvas");

    this.reshuffleBosses();
    this.scheduleNextDrop(1);

    this.arena = generateArena(this.rng, 1);
    this.rebuildFlowField();
    for (let i = 0; i < this.ambientTarget; i++) {
      this.ambient.push({ x: Math.random(), y: Math.random(), s: 1 + Math.random() * 2.2, sp: 6 + Math.random() * 14, ph: Math.random() * TAU });
    }

    this.onResize = () => this.resize();
    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => { this.keys.delete(e.code); };
    this.onMouseMove = (e) => {
      const r = o.canvas.getBoundingClientRect();
      this.mx = this.screenToWorldX(e.clientX - r.left);
      this.my = this.screenToWorldY(e.clientY - r.top);
    };
    this.onMouseDown = (e) => { if (e.button === 0) this.mDown = true; if (e.button === 2) this.rDown = true; };
    this.onMouseUp = (e) => { if (e.button === 0) this.mDown = false; if (e.button === 2) this.rDown = false; };
    this.onWheel = (e) => {
      if (this.phase !== "running") return;
      this.selected = ((this.selected + (e.deltaY > 0 ? 1 : -1)) % this.equipped.length + this.equipped.length) % this.equipped.length;
    };
    this.onCtx = (e) => e.preventDefault();
    this.onBlur = () => { this.mDown = false; this.rDown = false; this.keys.clear(); };
    this.onVisChange = () => {
      /* auto-pause when the tab is hidden mid-run so the player doesn't die
         while alt-tabbed; mirrors the React-side visibility handler. */
      if (document.hidden && this.phase === "running") {
        this.phase = "paused";
        this.o.onPhase("paused");
      }
    };

    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("visibilitychange", this.onVisChange);
    o.canvas.addEventListener("contextmenu", this.onCtx);

    this.resize();
    this.px = WORLD_W / 2; this.py = WORLD_H / 2;
    this.camX = this.px; this.camY = this.py;
    this.mx = WORLD_W / 2; this.my = WORLD_H / 2 - 140;

    this.last = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.033, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);

    this.startWave(1);
  }

  destroy() {
    this.destroyed = true;
    if (this.goTimer !== undefined) { window.clearTimeout(this.goTimer); this.goTimer = undefined; }
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("visibilitychange", this.onVisChange);
    this.o.canvas.removeEventListener("contextmenu", this.onCtx);
  }

  /* ------------------------------- lifecycle ------------------------------- */

  private resize() {
    const c = this.o.canvas;
    const prevDpr = this.dpr;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.gfxDprCap);
    this.w = Math.max(320, c.clientWidth || window.innerWidth);
    this.h = Math.max(320, c.clientHeight || window.innerHeight);
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    this.reducedMotion = typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.computeDeviceClass();
    this.computeFov();
    this.clampCamera();
    this.buildStaticGradients();
    /* V1.1 — the mote sprite is baked at device resolution: rebuild it if
       the DPR cap changed (monitor move / gfx preset switch). */
    if (prevDpr !== this.dpr) this.moteSprite = null;
  }

  /* Patch 9.0 — device class drives the FOV target. Coarse pointers on small
     screens are phones; larger touch screens are tablets; everything else is
     a desktop. Phones see the widest slice of the world (maximum combat
     legibility on a small display), tablets slightly less, desktops the
     tightest framing. */
  private computeDeviceClass() {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const short = Math.min(this.w, this.h);
    this.deviceClass = coarse && short <= 500 ? "phone" : coarse && short <= 1024 ? "tablet" : "desktop";
    this.applyVfxQuality();
  }

  /** Patch 9.0 — FOV: guarantee a minimum visible world slice per device,
      clamped so the camera never reveals space beyond the world bounds.
      Patch 10.1 — the slice is WIDENED per device class for maximum map
      visibility (phones see ~78% of world width, desktops ~75%): threats
      telegraph earlier and the arena reads as the true 2560×1600 rift it
      is, not a keyhole. */
  private computeFov() {
    const minH = this.deviceClass === "phone" ? 700 : this.deviceClass === "tablet" ? 780 : 840;
    const minW = this.deviceClass === "phone" ? 1180 : this.deviceClass === "tablet" ? 1320 : 1440;
    let z = Math.min(this.w / minW, this.h / minH);
    z = Math.max(z, this.w / WORLD_W, this.h / WORLD_H);
    z = Math.min(z, 1.6);
    this.zoom = z;
  }

  /** Keep the camera inside the world so the border walls always bound the view. */
  private clampCamera() {
    const vw = this.w / this.zoomCur;
    const vh = this.h / this.zoomCur;
    this.camX = vw >= WORLD_W ? WORLD_W / 2 : Math.max(vw / 2, Math.min(WORLD_W - vw / 2, this.camX));
    this.camY = vh >= WORLD_H ? WORLD_H / 2 : Math.max(vh / 2, Math.min(WORLD_H - vh / 2, this.camY));
  }

  /** Patch 9.0 — smooth follow-camera: lerps toward the player plus a small
      look-ahead in the aim direction, clamped to the world. Combat pressure
      (crowds or a live boss) eases the FOV out slightly. Called per update. */
  private updateCamera(dt: number) {
    let alive = 0;
    for (const e of this.enemies) { if (!e.dead) alive++; }
    let pressure = Math.max(0, Math.min(1, (alive - 12) / 14)) * 0.08;
    for (const e of this.enemies) { if (!e.dead && e.type === "boss") { pressure += 0.04; break; } }
    const zTarget = this.zoom * (1 - pressure);
    this.zoomCur += (zTarget - this.zoomCur) * Math.min(1, 2.6 * dt);

    /* look-ahead toward the aim point */
    let tx = this.px, ty = this.py;
    const adx = this.mx - this.px, ady = this.my - this.py;
    /* perf: Math.hypot(a,b) → Math.sqrt(a²+b²) everywhere below — identical
       result for finite game coordinates; hypot's overflow-safe scaling is
       only needed near ±1e154 and costs ~3× the plain sqrt. */
    const al = Math.sqrt(adx * adx + ady * ady);
    if (al > 30) {
      const k = Math.min(96, al * 0.3) / al;
      tx += adx * k; ty += ady * k;
    }
    const vw = this.w / this.zoomCur;
    const vh = this.h / this.zoomCur;
    if (vw < WORLD_W) tx = Math.max(vw / 2, Math.min(WORLD_W - vw / 2, tx)); else tx = WORLD_W / 2;
    if (vh < WORLD_H) ty = Math.max(vh / 2, Math.min(WORLD_H - vh / 2, ty)); else ty = WORLD_H / 2;
    const f = Math.min(1, 6 * dt);
    this.camX += (tx - this.camX) * f;
    this.camY += (ty - this.camY) * f;
    /* keep the culling rect fresh for render */
    this.vx0 = this.camX - vw / 2 - 90; this.vx1 = this.camX + vw / 2 + 90;
    this.vy0 = this.camY - vh / 2 - 90; this.vy1 = this.camY + vh / 2 + 90;
  }

  /** Screen (canvas CSS px) → world coordinates. */
  private screenToWorldX(sx: number): number { return this.camX + (sx - this.w / 2) / this.zoomCur; }
  private screenToWorldY(sy: number): number { return this.camY + (sy - this.h / 2) / this.zoomCur; }

  private buildStaticGradients() {
    const c = this.ctx;
    const { w, h } = this;
    const pal = this.act.palette;
    const bg = c.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, Math.max(w, h) * 0.72);
    bg.addColorStop(0, `rgba(${pal.sky},0.18)`);
    bg.addColorStop(0.55, `rgba(${pal.sky},0.07)`);
    bg.addColorStop(1, "rgba(6,4,14,0.5)");
    this.bgGrad = bg;

    const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.74);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(4,2,10,0.62)");
    this.vigGrad = vg;

    const sg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
    sg.addColorStop(0, "rgba(245,201,107,0)");
    sg.addColorStop(1, "rgba(245,201,107,0.16)");
    this.surgeGrad = sg;

    const lg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    lg.addColorStop(0, "rgba(255,40,70,0)");
    lg.addColorStop(1, "rgba(255,40,70,1)");
    this.lowHpGrad = lg;

    const aura = c.createRadialGradient(0, 0, 4, 0, 0, 34);
    aura.addColorStop(0, "rgba(154,123,255,0.30)");
    aura.addColorStop(1, "rgba(154,123,255,0)");
    this.playerAura = aura;

    const auraS = c.createRadialGradient(0, 0, 4, 0, 0, 46);
    auraS.addColorStop(0, "rgba(245,201,107,0.42)");
    auraS.addColorStop(1, "rgba(245,201,107,0)");
    this.playerAuraSurge = auraS;

    const body = c.createRadialGradient(-4, -5, 2, 0, 0, 14);
    body.addColorStop(0, "#8f7bff");
    body.addColorStop(0.55, "#4a3585");
    body.addColorStop(1, "#241743");
    this.playerBody = body;
  }

  togglePause() {
    if (this.phase === "running") {
      this.phase = "paused";
      this.o.sfx.duck(true);
      this.o.onPhase("paused");
    } else if (this.phase === "paused") {
      this.phase = "running";
      this.o.sfx.duck(false);
      this.last = performance.now();
      this.o.onPhase("running");
    }
  }

  get waveNumber(): number { return this.wave; }

  /* --------------------- evolution flow (Patch 7.0) --------------------- */

  /* Patch 7.0: finishStory is gone — after a boss clear the engine offers
     evolutions directly. If nothing is left to transmute, roll on.
     V1.0 final — STATE B: in a max-tier loadout (≥2 resonances bound) spell
     upgrades are REMOVED from the pool; the boss wave rolls straight on. */
  private offerEvolutionsOrNext() {
    if (this.maxTierLoadout()) {
      this.o.onBanner("APEX LOADOUT", "Two resonances bound — nothing left to transmute", "#43e8d8");
      this.startNextWave();
      return;
    }
    /* evolution offers reference the player's EQUIPPED spells — no upgrades
       for spells the player doesn't hold (Patch 6.0 rule, kept). */
    const choices = offerEvolutions(this.rng, this.evolutions, this.equippedSet(), this.evoOffered);
    for (const c of choices) this.evoOffered[c.id] = (this.evoOffered[c.id] ?? 0) + 1;
    if (choices.length === 0) {
      this.o.onBanner("NOTHING LEFT TO TRANSMUTE", "Every spell you hold is already evolved", "#43e8d8");
      this.startNextWave();
      return;
    }
    this.pendingAfter = "nextWave";
    this.phase = "evolution";
    this.o.onPhase("evolution");
    this.o.onEvolution(choices);
  }

  /** Player picked a spell transmutation from the overlay. */
  chooseEvolution(id: string) {
    if (this.phase !== "evolution") return;
    const def = EVOLUTIONS.find((e) => e.id === id);
    if (!def) return;
    this.evolutions[SPELL_ORDER.indexOf(def.base)] = def;
    this.o.sfx.levelup();
    this.o.onBanner("SPELL TRANSMUTED", `${SPELLS[def.base].name} → ${def.name}`, "#ffe9ad");
    this.floater(this.px, this.py - 44, def.name.toUpperCase(), "#ffe9ad", 18);
    this.ring(this.px, this.py, 120, "#ffe9ad", 4);
    for (let i = 0; i < 24; i++) this.puff(this.px, this.py, i % 2 ? "#ffe9ad" : "#f5c96b", 260, 4);
    if (this.pendingAfter === "resume") {
      this.pendingAfter = "nextWave";
      this.phase = "running";
      this.last = performance.now();
      this.o.onPhase("running");
    } else {
      this.startNextWave();
    }
  }

  private startNextWave() {
    this.phase = "running";
    this.last = performance.now();
    this.o.onPhase("running");
    this.startWave(this.wave + 1);
  }

  /* Wave-clear router (Patch 10.0 — "The Sealed Rift" endgame):
       - wave 50 boss (not endless)   → EPILOGUE: end-credit sequence + the
                                         RETURN / FIGHT choice (endless mode)
       - endless boss waves (60, 70…)  → act banner + evolution offer (echo cycle)
       - boss wave (every 10th)        → act banner + spell evolution offer
       - every TRIBUTE_INTERVAL-th non-boss wave → tribute gate (3 scalable
                                          stat rewards — one MUST be taken)
       - any other wave                → brief "wave cleared" banner, then next wave
     HP is no longer auto-healed on clear — only HEART drops heal (Patch 11.0).
     Patch 11.0: the merge intermission is GONE from the router — merges now
     happen mid-wave through RESONANCE ORB pickups (the wave's single drop),
     and every unclaimed orb dissolves here so no drop type ever bleeds into
     the next wave (strict economy). */
  private completeWave() {
    const bonus = 40 + this.wave * 12;
    this.score += bonus;
    this.o.sfx.waveClear();
    this.shrine = null;
    /* Patch 11.0 — STRICT ECONOMY enforcement: dissolve any unclaimed orb of
       this wave (the mage's loss — reach the drop before the wave ends). If
       the unclaimed orb was the scheduled SPELL drop, the cadence re-rolls so
       the next tear still comes 3-5 waves later. */
    if (this.spellDrops.length > 0) {
      for (const d of this.spellDrops) {
        if (d.life > 0) {
          this.ring(d.x, d.y, 46, d.kind === "heart" ? "#ff4d6b" : d.kind === "resonance" ? "#ffe9ad" : SPELLS[d.id].color, 2.5);
          for (let i = 0; i < 10; i++) this.puff(d.x, d.y, d.kind === "spell" ? SPELLS[d.id].glow : "#a99bd8", 120, 2.6);
        }
      }
      if (this.waveDrop === "spell") this.scheduleNextDrop(this.wave);
      this.spellDrops.length = 0;
    }
    if (this.wave > 0 && this.wave % 10 === 0) {
      if (this.wave === VICTORY_WAVE && !this.endless) {
        this.startEpilogue();
        return;
      }
      const nextAct = actForWave(this.wave + 1);
      this.o.onBanner(`ACT ${nextAct.id} — ${nextAct.name.toUpperCase()}`, nextAct.flavor, "#f5c96b");
      this.offerEvolutionsOrNext();
      return;
    }
    /* Patch 6.0: tribute gate every TRIBUTE_INTERVAL waves (skipping boss
       waves which are % 10). e.g. waves 5, 15, 25, 35, 45. Mandatory — the
       overlay has no skip; one reward must be claimed. (Patch 11.0: this
       gate IS the wave's single drop type — no orb spawns on tribute waves.) */
    if (this.wave > 0 && this.wave % TRIBUTE_INTERVAL === 0 && this.wave % 10 !== 0) {
      this.phase = "intermission";
      this.o.sfx.fanfare();
      this.o.onPhase("intermission", { rewards: this.pickRewards(), tiers: { ...this.rewardTiers } });
      return;
    }
    /* every other wave: small banner, no intermission, next wave starts */
    this.o.onBanner(`WAVE ${this.wave} CLEARED`, "+" + bonus + " score — brace for the next", "#f5c96b");
    this.startNextWave();
  }

  /* Patch 11.0 — fires the SACRIFICE merge overlay from a resonance-orb
      pickup (mid-wave). The player must sacrifice exactly two bound single
      spells; they fuse into one merged slot and the wave resumes. Only
      reachable when mergeableSlots() ≥ 2 — the orb never spawns otherwise. */
  private openResonanceMerge() {
    const mergeable = this.mergeableSlots();
    if (mergeable.length < 2) return;
    this.phase = "mergeoffer";
    const offer: MergeOffer = {
      slots: mergeable,
      equipped: this.equipped.map((s, i) => ({ id: s.spells.length === 1 ? SPELL_ORDER[s.spells[0]] : (s.spells.length === 0 ? "fire" : SPELL_ORDER[s.spells[0]]), slot: i })),
    };
    this.o.onPhase("mergeoffer", { merge: offer });
    this.o.onMerge(offer);
  }

  /* ========================================================================
     Patch 10.0 — THE EPILOGUE ("you closed the rift").
     ------------------------------------------------------------------------
     Clearing wave 50 freezes the arena and rolls an end-credit sequence
     (React overlay — EndCreditsOverlay). The player then chooses:
       RETURN → finishRun(): the classic triumph game-over, stats banked.
       FIGHT  → continueEndless(): wave 51+ forever, escalating pressure,
                tyrants return as ECHOES; death still banks the triumph. */
  private startEpilogue() {
    this.phase = "epilogue";
    this.o.sfx.setIntensity(0);
    this.o.sfx.credits();
    this.o.sfx.waveClear();
    this.o.onBanner("THE RIFT IS SEALED", "All five tyrants have fallen — the rift is yours", "#ffe9ad");
    this.shakeIt(18);
    this.ring(this.px, this.py, 260, "#ffe9ad", 6);
    for (let i = 0; i < 60; i++) this.puff(this.px, this.py, i % 2 ? "#ffe9ad" : "#f5c96b", 380, 4.6);
    this.o.onPhase("epilogue", { stats: this.buildStats(true) });
  }

  /** RETURN — bank the triumph and show the classic game-over eulogy. */
  finishRun() {
    if (this.phase !== "epilogue") return;
    this.victory();
  }

  /** FIGHT — the rift reopens: endless survival from wave 51. */
  continueEndless() {
    if (this.phase !== "epilogue") return;
    this.endless = true;
    this.phase = "running";
    this.o.sfx.reopen();
    this.o.onBanner("THE RIFT REOPENS", "Endless echo — survive as long as the weave holds you", "#ff8ba0");
    this.o.onPhase("running");
    this.last = performance.now();
    this.startNextWave();
  }

  get endlessMode(): boolean { return this.endless; }

  /** Shared run-stats snapshot (victory + epilogue credits use the same math).
      V1.0 — the GLYPH PAYOUT: every aether glyph collected mid-run (motes)
      converts at 25% into the post-game award, ON TOP of the classic
      score/wave/kill formula — collecting visibly pays. */
  private buildStats(triumph: boolean, endless = false): RunStats {
    const shards = Math.max(1, Math.round((this.score / 100 + this.wave * 3 + this.kills * 0.15) * (triumph ? 1.5 : 1)))
      + this.bonusShards + Math.round(this.runGlyphs * 0.25);
    return {
      wave: this.wave, score: Math.round(this.score), kills: this.kills,
      damage: Math.round(this.runDamage), shards, timeSec: this.t,
      newCombos: [...this.runFound], best: this.wave > 0,
      triumph, endless,
      evolutions: this.evolutions.filter(Boolean).map((e) => e!.name),
      merges: [...this.runMerges],
    };
  }

  private victory() {
    this.phase = "gameover";
    this.o.sfx.surge();
    this.o.sfx.waveClear();
    this.o.sfx.setIntensity(0);
    this.shakeIt(18);
    this.ring(this.px, this.py, 260, "#ffe9ad", 6);
    for (let i = 0; i < 60; i++) this.puff(this.px, this.py, i % 2 ? "#ffe9ad" : "#f5c96b", 380, 4.6);
    const stats = this.buildStats(true);
    this.goTimer = window.setTimeout(() => {
      this.goTimer = undefined;
      if (!this.destroyed) this.o.onPhase("gameover", { stats });
    }, 900);
  }

  select(slot: number) { this.selected = Math.max(0, Math.min(this.equipped.length - 1, slot)); }

  /** Patch 5.0: snapshot of currently-equipped elements (slot → ElementId or
      a merged pair). Empty slots are returned as null so the React layer can
      render a ghosted "empty" slot UI. */
  equippedSnapshot(): (ElementId | { merged: ElementId[] } | null)[] {
    return this.equipped.map((s) => {
      if (s.spells.length === 0) return null;
      if (s.spells.length === 1) return SPELL_ORDER[s.spells[0]];
      return { merged: s.spells.map((i) => SPELL_ORDER[i]) };
    });
  }

  /** Indices of single-spell slots (length === 1) — these are the only slots
      eligible for the merge intermission. Merged slots (length ≥ 2) and empty
      slots are excluded. */
  private mergeableSlots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.equipped.length; i++) {
      if (this.equipped[i].spells.length === 1) out.push(i);
    }
    return out;
  }

  /* V1.0 final — STATE-BASED DROP ECONOMY. The loot pool reads the live
     loadout:
       STATE A (standard loadout — fewer than two resonance slots):
         resonances + boons + new spells + spell upgrades all stay in the
         pool (each gated by its own eligibility rule: a resonance orb needs
         ≥2 single spells to sacrifice; an evolution needs an un-transmuted
         held base).
       STATE B (max-tier loadout — two or more RESONANCE spells, i.e. merged
         slots, are bound): resonances and spell upgrades are REMOVED from
         the pool immediately — a third resonance is impossible (only one
         single remains) and further transmutations are beneath an apex
         loadout. Only new base spells (spell tears), boons (tribute gates)
         and hearts (when wounded) may spawn. */
  private resonanceCount(): number {
    let n = 0;
    for (const slot of this.equipped) if (slot.spells.length >= 2) n++;
    return n;
  }

  /** True when the loadout has reached the resonance apex (State B). */
  private maxTierLoadout(): boolean {
    return this.resonanceCount() >= 2;
  }

  /** Patch 5.0 — seed-permuted boss order. On every restart, this reshuffles
      BOSS_DEFS so each of the 5 acts sees a different tyrant. The boss's
      native act is preserved as backstory context only; their stats carry
      over to whichever act the shuffle places them in. */
  private reshuffleBosses() {
    const scratch = [...BOSS_DEFS];
    const out: BossDef[] = [];
    while (scratch.length) {
      const i = Math.floor(this.rng.next() * scratch.length);
      out.push(scratch.splice(i, 1)[0]);
    }
    this.bossShuffle = out;
  }

  /** The boss slated for the current 10-round act (wave 10 → idx 0, wave 20 →
      idx 1, etc.). Falls back to BOSS_DEFS[0] if out of range.
      Patch 10.0 — ENDLESS ECHO: past wave 50 the tyrants CYCLE through the
      shuffled roster (wave 60 → idx 0 again, 70 → idx 1, …) and every echo
      cycle escalates via endlessBossMult() in spawnEnemy. */
  private currentBoss(): BossDef {
    let idx = Math.floor(this.wave / 10) - 1;
    if (idx < 0) return BOSS_DEFS[0];
    if (this.wave > VICTORY_WAVE) idx = idx % this.bossShuffle.length;
    return this.bossShuffle[Math.min(idx, this.bossShuffle.length - 1)] ?? BOSS_DEFS[0];
  }

  /** Patch 5.0 — schedule the next spell drop. Strict cadence: every
      SPELL_DROP_WAVE_MIN..MAX waves, rolled fresh after each drop. Skips
      boon waves (% 5 === 0) and boss waves (% 10 === 0) so drops land on
      fair, single-spawn waves. The user's directive is explicit: NO per-kill
      % rolls — drops are scheduled. */
  private scheduleNextDrop(fromWave: number) {
    this.nextDropWave = this.rollDropWave(fromWave);
  }

  /** Shared cadence roll: skip tribute waves (5,15,25…) and boss waves (10,20…). */
  private rollDropWave(fromWave: number): number {
    let n = fromWave + this.rng.int(SPELL_DROP_WAVE_MIN, SPELL_DROP_WAVE_MAX);
    while (n % 5 === 0 || n % 10 === 0) n++;
    return n;
  }

  /** Patch 11.0 — THE STRICT DROP ECONOMY. Resolve exactly ONE drop type for
      wave n, in priority order:
        1. tribute waves (every 5th non-boss wave) — the end-of-wave gate IS
           the drop; nothing else spawns.
        2. resonance waves (one wave before each boss, 9/19/29/…) — a
           resonance orb spawns (if ≥2 single spells can be sacrificed);
           otherwise a heart when wounded.
        3. the scheduled spell drop (every 3–5 waves, −19% global nerf) —
           if the rift reabsorbs the tear, the wave fields NO drop.
        4. a heart when the mage bleeds (HP < 70%).
      No other pickup may spawn during the wave, and any unclaimed orb
      dissolves at wave end — one type, strictly enforced.
      V1.0 final — STATE-BASED POOLS: in a max-tier loadout (≥2 resonance
      spells bound) the resonance branch is hard-removed — State B fields
      only spell tears, tribute boons and wounded hearts. Strict rates for
      everything else are untouched. */
  private resolveWaveDrop(n: number): DropKind {
    if (n > 0 && n % TRIBUTE_INTERVAL === 0 && n % 10 !== 0) return "tribute";
    if (n > 0 && n % MERGE_INTERVAL === 9 && !this.maxTierLoadout()) {
      if (this.mergeableSlots().length >= 2) return "resonance";
      return this.hp < this.maxHp * 0.7 ? "heart" : "none";
    }
    if (n === this.nextDropWave) {
      /* Patch 11.0: the −10% global spell-drop nerf compounds (10.0 + 11.0 →
         a flat 19% reabsorption chance). On a reabsorb the cadence re-rolls
         and this wave fields no drop at all. */
      if (this.rng.chance(SPELL_DROP_NERF)) {
        this.scheduleNextDrop(n);
        return "none";
      }
      return "spell";
    }
    if (this.hp < this.maxHp * 0.7) return "heart";
    return "none";
  }

  /** Live settings update — aim assist / graphics toggles mid-run. Patch 9.0:
      Rift Mercy is tier-driven; the shell pushes tiers through setMercyTier. */
  updateSettings(s: GameSettings) {
    const prevGfx = this.o.settings.gfx;
    this.o.settings = s;
    if (prevGfx !== s.gfx) {
      this.applyGfx(s);
      this.resize();
    }
  }

  /** Patch 9.0 — live Rift Mercy tier switch (Settings tier selector). The
      effective fraction recomputes for the CURRENT wave immediately. */
  setMercyTier(tier: number) {
    this.mercyTier = Math.max(0, tier | 0);
    this.mercyDr = mercyForRound(this.wave || 1, this.mercyTier);
  }

  /* Patch 6.0 — apply the graphics quality preset:
     Low    → DPR 1, 140 particles, no ambient motes
     Medium → DPR 1.5, 260 particles, 20 motes
     High   → DPR 2, 420 particles, 42 motes (previous default) */
  private applyGfx(s: GameSettings) {
    if (s.gfx === 0) { this.gfxDprCap = 1; this.particleCap = 140; this.ambientTarget = 0; }
    else if (s.gfx === 1) { this.gfxDprCap = 1.5; this.particleCap = 260; this.ambientTarget = 20; }
    else { this.gfxDprCap = 2; this.particleCap = 420; this.ambientTarget = 42; }
    /* resize the ambient mote field in place */
    while (this.ambient.length > this.ambientTarget) this.ambient.pop();
    while (this.ambient.length < this.ambientTarget) {
      this.ambient.push({ x: Math.random(), y: Math.random(), s: 1 + Math.random() * 2.2, sp: 6 + Math.random() * 14, ph: Math.random() * TAU });
    }
  }

  cast(slot: number) {
    if (this.phase !== "running") return;
    this.select(slot);
    this.castSpell(this.selected);
  }

  dash() { this.tryDash(); }

  surge() { this.trySurge(); }

  /* ------------------------- touch input API -------------------------
     Called by TouchControls (mobile/tablet). All values are in
     canvas-pixel coordinates already scaled to the CSS box, matching the
     way onMouseMove maps clientX/Y → mx/my. */

  /** Virtual movement joystick axis, range -1..1 each. (0,0) = idle.
      Patch 8.0: non-zero input bumps the autopilot's manual-grace timer so
      Archmage Mode yields while the player is actively steering. */
  setMoveAxis(x: number, y: number) {
    this.moveAxisX = x;
    this.moveAxisY = y;
    if (x !== 0 || y !== 0) this.autoManualT = 0.8;
  }

  /** Patch 9.0 — aim setter takes CANVAS-space (CSS px) coordinates and maps
      them through the live camera transform into world space. */
  setAim(x: number, y: number) {
    this.mx = this.screenToWorldX(x);
    this.my = this.screenToWorldY(y);
    this.autoManualT = 0.8;   // manual aim overrides the autopilot briefly
  }

  /** Holds the chosen spell's cast (mirrors LMB held). */
  setCastHeld(b: boolean) { this.mDown = b; if (b) this.autoManualT = 0.8; }

  /** Patch 9.0 — FIRE button (hold-to-attack with auto-targeting). While
      held the engine keeps the aim point glued to the best available target
      (with travel-time lead), so the button plays like an aim-assisted LMB. */
  setFireHeld(b: boolean) {
    this.mDown = b;
    this.fireAuto = b;
    if (b) this.autoManualT = 0.8;
  }

  /** Patch 9.0 — SPELL cycle button: advance to the next non-empty slot. */
  cycleSlot() {
    const n = this.equipped.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.selected + k) % n;
      if (this.equipped[i].spells.length > 0) { this.selected = i; return; }
    }
  }

  /** Patch 9.0 — best-target aim for the FIRE button. Bosses and ranged
      shooters take priority (distance-weighted), with a short travel-time
      lead so projectiles connect. */
  private autoTargetAim() {
    let target: Enemy | null = null;
    let tScore = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.px, dy = e.y - this.py;
      const d2 = dx * dx + dy * dy;
      const s = d2 / (e.type === "boss" ? 8 : e.ranged ? 2.2 : 1);
      if (s < tScore) { tScore = s; target = e; }
    }
    if (!target) return;
    const lead = Math.min(0.4, Math.sqrt((target.x - this.px) ** 2 + (target.y - this.py) ** 2) / 620);
    this.mx = Math.max(8, Math.min(WORLD_W - 8, target.x + target.vx * lead));
    this.my = Math.max(8, Math.min(WORLD_H - 8, target.y + target.vy * lead));
  }

  /** Patch 8.0 — Archmage Mode: toggle the in-engine autopilot. Disabling
      clears any auto-driven movement so the mage stops immediately. */
  setAutopilot(b: boolean) {
    this.auto = b;
    if (!b) {
      this.moveAxisX = 0;
      this.moveAxisY = 0;
      this.autoManualT = 0;
    }
  }

  /** Patch 8.0 — read-only autopilot flag (for HUD/dev probes). */
  get autopilotOn() { return this.auto; }

  /** Holds the arcane volley (mirrors RMB held). */
  setVolleyHeld(b: boolean) { this.rDown = b; }

  private keyDown(e: KeyboardEvent) {
    if (e.repeat) { if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault(); return; }
    this.keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    /* dev-only QA cheats: Backquote clears the wave, Shift+Backquote / F9 jumps to the final act */
    if (process.env.NODE_ENV === "development" && (e.code === "Backquote" || e.code === "F9")) {
      if (e.shiftKey || e.code === "F9") this.devJumpToFinalAct();
      else this.devSkipWave();
      return;
    }
    if (e.code === "KeyP" || e.code === "Escape") { this.togglePause(); return; }
    if (this.phase !== "running") return;
    const slot = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus"].indexOf(e.code);
    if (slot >= 0 && slot < this.equipped.length) { this.selected = slot; this.castSpell(slot); }
    if (e.code === "KeyQ") this.selected = (this.selected + this.equipped.length - 1) % this.equipped.length;
    if (e.code === "KeyE") this.selected = (this.selected + 1) % this.equipped.length;
    if (e.code === "KeyF") this.trySurge();
    if (e.code === "Space") this.tryDash();
  }

  /* dev-only helpers for browser QA (excluded from production builds) */
  private devSkipWave() {
    if (this.phase !== "running") return;
    for (const e of this.enemies) { if (!e.dead) this.killEnemy(e); }
    this.sqHead = this.spawnQueue.length;
  }

  private devJumpToFinalAct() {
    if (this.phase !== "running") return;
    for (const e of this.enemies) { if (!e.dead) this.killEnemy(e); }
    this.sqHead = this.spawnQueue.length;
    this.wave = 49;
    this.startWave(50);
  }

  /* -------------------------------- waves --------------------------------- */

  private startWave(n: number) {
    this.wave = n;
    /* V1.0 — the attunement curve rides with the wave: every spell the mage
       casts this wave hits attunement(n)× harder, matched against the
       softened enemy curve (see content.ts). Cached once per wave. */
    this.att = attunement(n);
    this.spawnClock = 0;
    this.spawnQueue = [];
    this.sqHead = 0;

    /* act tracking — rebuild tinted gradients when the biome changes.
       Patch 6.0: the ambient score follows the act (root note shift). */
    const nextAct = actForWave(n);
    if (nextAct.id !== this.act.id) {
      this.act = nextAct;
      this.buildStaticGradients();
      /* V1.1 — the act palette changed: drop the cached pillar body
         gradients (drawPillars rebuilds them lazily with the new palette). */
      for (const p of this.arena.pillars) p.grad = null;
      this.o.sfx.setMusicAct(nextAct.id);
    }

    /* Patch 9.0: Rift Mercy — per-death ladder tier, growing a little
       within the run (+0.5% per round, capped +2% over base). Recomputed
       here so the HUD readout and the damage math stay in lockstep. */
    this.mercyDr = mercyForRound(n, this.mercyTier);

    const shift = n > 1 && (n - 1) % 5 === 0;
    if (shift) {
      /* Patch 9.0: every Rift Shift can swap the whole floor plan — the
         archetype rotates with seed + wave across the five layouts. */
      this.arena = generateArena(this.rng, n);
      this.rebuildFlowField();
      this.projGrads.clear(); this.boltGrads.clear();
      const id = this.rng.pick(SPELL_ORDER);
      this.attune = { id, t: 14, total: 14 };
      this.o.sfx.shift();
      this.o.onBanner("RIFT SHIFT", `${SPELLS[id].name} attuned — free casts, +50% power for 14s`, SPELLS[id].color);
    }

    /* Patch 7.0: combat-intensity score on every non-boss wave. */
    this.o.sfx.setIntensity(1);

    if (n % 10 === 0) {
      /* Patch 5.0: use the seed-shuffled boss for this act. Patch 10.2: the
         spawn cutscene layer is fully GONE — no title card, no message box,
         nothing blocks the arena. V1.0 final: the tyrant's arrival carries
         one COMPACT, CENTERED alert banner (name + title) alongside the
         audio roar + sting + shake — every attack still telegraphs itself
         in the arena. Boss HP/damage are eased by DIFFICULTY_MULT like every
         other foe. Patch 10.2: the adds follow the seed's ecology too
         (pickBiased). */
      const boss = this.currentBoss();
      this.spawnQueue.push({ type: "boss", t: 1.2 });
      /* Patch 9.0: adds thinned by Rift Mercy; skitter joins the mob pool. */
      const adds = Math.max(2, Math.round(Math.min(4 + Math.floor(n / 10) * 2, 12) * (1 - this.mercyDr * MERCY_SPAWNS)));
      for (let i = 0; i < adds; i++) {
        this.spawnQueue.push({ type: this.pickBiased(["goblin", "imp", "swarm", "archer", "skitter"] as EnemyType[]), t: 3 + i * 2.2 });
      }
      this.o.sfx.bossRoar();
      this.o.sfx.sting();
      this.o.sfx.setIntensity(2);
      this.shakeIt(14);
      this.o.onBanner(
        this.endless && n > VICTORY_WAVE ? `ECHO OF ${boss.name.toUpperCase()}` : "A TYRANT RISES",
        `${boss.name}, ${boss.title}`,
        "#ff8ba0",
      );
    } else {
      const types = availableTypes(n);
      /* Patch 9.0: Rift Mercy trims the wave budget — fewer foes per wave. */
      const budget = waveBudget(n) * (1 - this.mercyDr * MERCY_SPAWNS);
      /* hoisted weight table — later unlocks are weighted higher. Patch
         10.2: the seed's ecology multipliers bend the mix (featured types
         surge, faded types thin) so each Rift Seed fields a different
         roster for the same wave curve. */
      const weights = types.map((t, i) => (1 + i * 0.85) * (this.typeBias[t] ?? 1));
      let total = 0;
      for (const w of weights) total += w;
      let spent = 0;
      const list: EnemyType[] = [];
      let guard = 0;
      while (spent < budget && guard++ < 90) {
        let r = this.rng.next() * total;
        let pick = types[0];
        for (let i = 0; i < types.length; i++) { r -= weights[i]; if (r <= 0) { pick = types[i]; break; } }
        const c = ENEMY_DEFS[pick].cost;
        if (spent + c > budget + 0.6) break;
        spent += c; list.push(pick);
      }
      const dur = spawnWindow(n);
      for (let i = 0; i < list.length; i++) {
        this.spawnQueue.push({ type: list[i], t: (i / Math.max(1, list.length)) * dur + this.rng.range(0, 0.55) });
      }
      this.o.sfx.waveStart();
      this.o.onBanner(`WAVE ${n}`, shift ? null : this.waveFlavor(n), "#f5c96b");
    }

    /* rift shrine — surprise transmutation entrance.
       Patch 11.0 — strict economy: no shrine on tribute or resonance waves
       (those waves already field their one drop type; a second reward source
       would break the "exactly one" rule).
       V1.0 final — STATE B: no shrines in a max-tier loadout either — the
       shrine transmutes spells (a spell upgrade), which is removed from
       State B's pool. */
    this.shrine = null;
    this.waveDrop = this.resolveWaveDrop(n);
    if (n >= 3 && n % 10 !== 0 && !this.maxTierLoadout() && this.waveDrop !== "tribute" && this.waveDrop !== "resonance" && this.rng.chance(SHRINE_CHANCE)) {
      let sx = 0, sy = 0, ok = false;
      for (let attempt = 0; attempt < 12 && !ok; attempt++) {
        sx = this.rng.range(0.14, 0.86) * WORLD_W;
        sy = this.rng.range(0.16, 0.84) * WORLD_H;
        const dx = sx - this.px, dy = sy - this.py;
        ok = dx * dx + dy * dy > 150 * 150 && !this.circleRectHit(sx, sy, 30);
      }
      this.shrine = { x: sx, y: sy, life: SHRINE_LIFE, grad: null };
      this.o.onBanner("A RIFT SHRINE TEARS OPEN", "Touch it to transmute a spell", "#43e8d8");
    }

    /* Patch 11.0 — THE STRICT DROP ECONOMY: resolve this wave's ONE drop
       type (computed once above, before the shrine gate — resolveWaveDrop
       rolls rng and must never run twice) and spawn its orb (tribute waves
       pay out through the end-of-wave gate instead — no orb). Hearts mend
       25% max HP; resonance orbs demand the sacrifice of exactly two bound
       spells; spell tears no longer heal. Unclaimed orbs dissolve when the
       wave clears (completeWave), so no drop type ever bleeds into the
       next wave. */
    if (this.waveDrop === "spell" || this.waveDrop === "heart" || this.waveDrop === "resonance") {
      const dx = this.rng.range(0.16, 0.84) * WORLD_W;
      const dy = this.rng.range(0.18, 0.82) * WORLD_H;
      this.spawnSpellDrop(dx, dy, this.waveDrop);
      if (this.waveDrop === "spell") {
        this.o.onBanner("A SPELL TEAR FORMS", "Walk over it to bind a new spell — no heal, the rift is strict", "#7ed957");
      } else if (this.waveDrop === "heart") {
        this.o.onBanner("A HEART OF THE FALLEN FORMS", "Walk over it to mend your wounds", "#ff4d6b");
      } else {
        this.o.onBanner("A RESONANCE ORB FORMS", "Touch it to sacrifice two bound spells and fuse them", "#ffe9ad");
      }
    }
  }

  private waveFlavor(n: number): string {
    const act = actForWave(n);
    if (act.waves[0] === n) return act.flavor;
    const flavors = [
      "The gutters of the rift empty into your arena.",
      "Something is counting your breaths.",
      "The dark between pillars leans closer.",
      "Steel rusts. Bones remember.",
      "The arena rearranges itself when you blink.",
      "They come from every direction at once.",
      "Marked ones walk among them now.",
      "The rift has learned your name.",
    ];
    return flavors[(n - 1) % flavors.length];
  }

  /** Patch 10.2 — seed-ecology weighted pick: rolls a type from the pool,
      each entry weighted by this run's per-seed typeBias multipliers. */
  private pickBiased(pool: EnemyType[]): EnemyType {
    let total = 0;
    for (const t of pool) total += this.typeBias[t] ?? 1;
    let r = this.rng.next() * total;
    for (const t of pool) { r -= this.typeBias[t] ?? 1; if (r <= 0) return t; }
    return pool[0];
  }

  private spawnEnemy(type: EnemyType, ox?: number, oy?: number) {
    const def = ENEMY_DEFS[type];
    const s = scaleEnemy(def, this.wave);
    /* Patch 10.0 — endless escalation: past wave 50 every foe's HP compounds
       +2.5%/wave past the standard curve cap (budget pressure scales in
       waveBudget). Damage follows the standard curve — the echo outlasts you,
       it doesn't one-shot you. */
    const hpEndless = this.wave > VICTORY_WAVE ? endlessHpMult(this.wave) : 1;
    const dmgEndless = this.wave > VICTORY_WAVE ? 1 + (endlessHpMult(this.wave) - 1) * 0.5 : 1;
    /* Spawn position — Patch 10.2 adds an optional anchored origin (used by
       Ashgorim's imp-shedding); the default is the Patch 9.0 player ring. */
    let x = 0, y = 0;
    if (ox !== undefined && oy !== undefined) {
      /* Patch 10.2 — anchored spawn: scatter in a small ring around the
       * anchor, clear of pillars. */
      for (let attempt = 0; attempt < 14; attempt++) {
        const a = this.rng.next() * TAU;
        const rr = this.rng.range(60, 170);
        x = Math.max(70, Math.min(WORLD_W - 70, ox + Math.cos(a) * rr));
        y = Math.max(70, Math.min(WORLD_H - 70, oy + Math.sin(a) * rr));
        if (!this.circleRectHit(x, y, def.radius + 6)) break;
      }
    } else {
      /* Patch 9.0 — ring spawns: foes materialize on a circle around the
         PLAYER just past the camera's reach (clamped inside the world), so
         they never pop inside view and never have to squeeze through walls. */
      const viewR = Math.max(this.w, this.h) / this.zoomCur;
      const spawnDist = type === "boss" ? Math.min(560, Math.max(360, viewR * 0.5)) : Math.max(430, viewR * 0.66 + 60);
      for (let attempt = 0; attempt < 14; attempt++) {
        const a = this.rng.next() * TAU;
        x = this.px + Math.cos(a) * spawnDist;
        y = this.py + Math.sin(a) * spawnDist;
        x = Math.max(70, Math.min(WORLD_W - 70, x));
        y = Math.max(70, Math.min(WORLD_H - 70, y));
        const dx = x - this.px, dy = y - this.py;
        const minD = type === "boss" ? 300 : 240;
        if (dx * dx + dy * dy >= minD * minD && !this.circleRectHit(x, y, def.radius + 6)) break;
      }
    }

    /* elite roll — never on swarms or the tyrant */
    let affix: EliteAffix | null = null;
    let hp = s.hp * hpEndless, speed = s.speed, r = def.radius, score = s.score, resist = 0;
    let name = def.name, color = def.color, glow = def.glow, damage = s.damage * dmgEndless;
    /* mercy: the opening waves move a touch slower while players learn */
    if (this.wave <= 4) speed *= 0.92;
    if (type !== "swarm" && type !== "boss" && this.rng.chance(eliteChance(this.wave))) {
      affix = this.rng.pick(ELITE_ORDER);
      const ed = ELITE_DEFS[affix];
      hp *= ed.hpMult; speed *= ed.spdMult; resist = ed.resist;
      /* V1.1 AUDIT FIX — swift's ×1.65 on top of the wave speed curve let
         late elites reach ~1.7× the mage's sprint (443 vs 252 px/s): contact
         chips became unavoidable. Chase speed now caps at a hair above the
         mage's LIVE movement speed, so swiftness investment always wins
         while swift elites still outpace every other foe. */
      const chaseCap = 252 * this.o.bonuses.moveSpeed * this.mods.speed * 1.05;
      if (speed > chaseCap) speed = chaseCap;
      r *= 1.12; score *= 3;
      this.o.sfx.elite();
    }
    /* Patch 5.0: bosses pull their stats from the seed-shuffled BossDef
       (BOSS_DEFS) rather than the static ENEMY_DEFS.boss entry. This way
       each boss has unique HP, damage, speed, color, name, and glow — and
       whichever boss the shuffle placed at this act shows up here. Patch
       6.0: DIFFICULTY_MULT eases boss HP + damage by 10% like every foe. */
    if (type === "boss") {
      const boss = this.currentBoss();
      /* Patch 10.0 — ENDLESS ECHO: past wave 50 the returning tyrants wear
         an "Echo of" prefix and escalate +22% per endless cycle.
         V1.0 — tyrant HP/damage now scale with the wave (bossHpMult /
         bossDmgMult, anchored to the attunement curve) so every act's
         climax duel holds its hit-count wherever the shuffle places it. */
      const em = this.wave > VICTORY_WAVE ? endlessBossMult(this.wave) : 1;
      const echo = this.wave > VICTORY_WAVE;
      name = echo ? `Echo of ${boss.name}, ${boss.title}` : `${boss.name}, ${boss.title}`;
      color = boss.color;
      glow = boss.glow;
      hp = boss.hp * DIFFICULTY_MULT * bossHpMult(this.wave) * em;
      damage = boss.damage * DIFFICULTY_MULT * bossDmgMult(this.wave) * em;
      speed = boss.speed * (echo ? 1 + (em - 1) * 0.35 : 1);
      r = boss.radius;
      score = echo ? Math.round(500 * em) : 500;
      /* Patch 10.0 — the boss theme fires the INSTANT the tyrant enters the
         arena (redundant with the wave-start call by design: this covers
         every spawn path and is fully idempotent). */
      this.o.sfx.setIntensity(2);
    }
    /* Patch 9.0 — Rift Mercy softens the foes themselves: fewer hit points
       and slower pursuit as the ladder climbs (a victory resets it). */
    hp *= 1 - this.mercyDr * MERCY_HP;
    speed *= 1 - this.mercyDr * MERCY_SPD;

    this.enemies.push({
      type, name, color, glow,
      x, y, vx: 0, vy: 0, hp, maxHp: hp, speed, damage,
      r, score, ranged: !!def.ranged, shootsEvery: def.shootsEvery ?? 3,
      flying: !!def.flying, hitFlash: 0, burnT: 0, burnDps: 0, chillT: 0, poisonT: 0,
      shootT: this.rng.range(0.6, 1.8), strafeDir: this.rng.chance(0.5) ? 1 : -1,
      actT: this.rng.range(1.5, 3.5), actState: 0, cx: 0, cy: 0, contactCd: 0,
      wob: type === "boss" ? 0 : this.rng.range(0, TAU),
      subT: 0, armAng: this.rng.next() * TAU, count: 0,
      affix, resist, auraT: 0, enraged: false,
      dead: false, grad: null, sq: 0, sqA: 0, gspr: null,
      lastX: x, lastY: y, stuckT: 0, stuckN: 0,
    });
    /* V1.3 — RIFT-IN: foes materialize behind an expanding aura shell + a
       crisp shockwave (bosses arrive with the big ring); the spawn now
       reads as an arrival, never a pop. */
    this.vfx.aura(x, y, glow, type === "boss" ? 210 : def.radius * 4.4);
    this.vfx.shock(x, y, type === "boss" ? 120 : def.radius * 3.4, color, type === "boss" ? 4 : 1.6, 0);
  }

  /* Seeded reward draft — the run seed governs every tribute offer.
     Patch 6.0: pool = uncapped rewards + the always-available cache; picks
     already taken to their REWARD_MAX cap are filtered out.
     V1.0 final — FAIR-CYCLING WEIGHTS: each card drafts with weight
     1/(1 + timesDrafted), so every eligible boon surfaces across a run
     instead of one lucky card dominating. Still 3 distinct cards, still
     strict tribute cadence (every 5th wave) — only the DRAFT is weighted. */
  private pickRewards(): UpgradeChoice[] {
    const pool = REWARD_POOL.filter((r) => (this.rewardTiers[r.id] ?? 0) < (REWARD_MAX[r.id] ?? Infinity));
    const out: UpgradeChoice[] = [];
    const scratch = [...pool];
    while (out.length < 3 && scratch.length) {
      let total = 0;
      for (const r of scratch) total += 1 / (1 + (this.rewardOffered[r.id] ?? 0));
      let roll = this.rng.next() * total;
      let pick = scratch[scratch.length - 1];
      for (const r of scratch) {
        roll -= 1 / (1 + (this.rewardOffered[r.id] ?? 0));
        if (roll <= 0) { pick = r; break; }
      }
      out.push(pick);
      this.rewardOffered[pick.id] = (this.rewardOffered[pick.id] ?? 0) + 1;
      scratch.splice(scratch.indexOf(pick), 1);
    }
    return out;
  }

  /* Patch 6.0 — MANDATORY tribute pick: the overlay has no skip, so this
     always transitions to the next wave once a card is chosen. */
  chooseReward(id: string) {
    if (this.phase !== "intermission") return;
    this.applyReward(id);
    this.rewardTiers[id] = (this.rewardTiers[id] ?? 0) + 1;
    this.o.sfx.levelup();
    this.startNextWave();
  }

  private applyReward(id: string) {
    const m = this.mods;
    switch (id) {
      case "hp":
        m.maxHpB += 10; this.maxHp += 10;
        this.healPlayer(10);
        this.floater(this.px, this.py - 30, "+10 MAX HP", "#ff4d6b", 15);
        break;
      case "armor": m.dr *= 0.92; break;
      case "critdmg": m.critDmg *= 1.25; break;
      case "crit": m.crit += 0.06; break;
      case "power": m.power *= 1.08; break;
      case "cdr": m.cdr *= 0.92; break;
      case "pierce": m.pierce += 1; break;
      case "combo": m.comboWindow += 0.5; m.comboDmg *= 1.15; break;
      case "mana": m.maxManaB += 20; this.maxMana += 20; this.mana = Math.min(this.maxMana, this.mana + 20); break;
      case "manaregen": m.manaRegen *= 1.12; break;
      case "speed": m.speed *= 1.06; break;
      case "dash": m.dashCdM *= 0.85; break;
      case "cache": this.score += 400; this.bonusShards += 2; break;
    }
  }

  /* ------------------------------ aim assist ------------------------------- */

  /* Weave-lock: snaps the cast direction onto the most deserving foe near the
     cursor ray. Generous cone, lead compensation — the "aimbot" layer.
     Patch 3.0: three levels — off (raw aim), standard, strong (wider cone,
     longer lead, extended reach). */
  private aimAssist(baseAng: number, range: number, cone: number): number {
    const lvl = this.o.settings.aimAssist;
    if (lvl === 0) return baseAng;
    if (lvl === 2) { range *= 1.15; cone = 0.85; }
    let best: Enemy | null = null;
    let bestScore = Infinity;
    const bx = Math.cos(baseAng), by = Math.sin(baseAng);
    const maxD2 = range * range;
    const minDot = Math.cos(cone);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.px, dy = e.y - this.py;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2 || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const dot = (dx / d) * bx + (dy / d) * by;
      if (dot < minDot) continue;
      const score = d * (1.6 - dot);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (!best) return baseAng;
    const leadCap = lvl === 2 ? 0.55 : 0.35;
    const lead = Math.min(leadCap, Math.sqrt((best.x - this.px) ** 2 + (best.y - this.py) ** 2) / 700) * 0.5;
    return Math.atan2(best.y + best.vy * lead * 0.6 - this.py, best.x + best.vx * lead * 0.6 - this.px);
  }

  /** Homing strength multiplier from the aim-assist setting. */
  private homingMult(): number {
    const lvl = this.o.settings.aimAssist;
    return lvl === 0 ? 0.4 : lvl === 2 ? 1.25 : 1;
  }

  /** Evolution mods for a given element (null when not evolved). */
  private evoModFor(id: ElementId) {
    const evo = this.evolutions[SPELL_ORDER.indexOf(id)];
    return evo ? evo.mod : null;
  }

  /* enemy nearest the cursor (for the lock bracket + RMB fallback) */
  private enemyNearCursor(maxD: number): Enemy | null {
    let best: Enemy | null = null, bd2 = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.mx, dy = e.y - this.my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) { bd2 = d2; best = e; }
    }
    return best;
  }

  /* -------------------------------- casting -------------------------------- */

  private freeCasting(id: ElementId): boolean {
    return this.surgeT > 0 || this.attune?.id === id;
  }
  private powerMult(id: ElementId): number {
    /* Patch 9.0: Rift Mercy's attack component — the assist ladder makes
       every weave hit harder as it climbs. V1.0: the attunement curve keeps
       pace with the rift itself, so magic never loses its bite. */
    return this.mods.power * this.att * (this.attune?.id === id ? 1.5 : 1) * (this.surgeT > 0 ? 1.25 : 1)
      * (1 + this.mercyDr * MERCY_ATTACK);
  }
  private cdMult(): number {
    return this.mods.cdr * (this.surgeT > 0 ? 0.55 : 1);
  }
  private graze(): number {
    return 4 + (this.mods.range - 1) * 16;
  }

  private castSpell(slot: number) {
    if (slot < 0 || slot >= this.equipped.length) return;
    const spells = this.equipped[slot].spells;
    if (spells.length === 0) return;                  // empty slot — no-op
    /* Patch 5.0: iterate over every spell in the slot. Single slots cast one
       spell; merged slots cast every spell in the list in close succession.
       Each spell respects its own cooldown + mana cost — a merged slot fires
       whatever subset is currently affordable + off-cooldown. */
    for (const idx of spells) this.castSingleSpell(idx);
  }

  private castSingleSpell(idx: number) {
    const id = SPELL_ORDER[idx];
    const sp = SPELLS[id];
    const evo = this.evolutions[idx];
    const m = evo ? evo.mod : null;
    if (this.cd[idx] > 0) return;
    const free = this.freeCasting(id);
    if (sp.hpCost) {
      /* Patch 4.0: no spell is hpCost anymore (blood Lance reworked) —
         keep the branch for legacy safety. */
      if (!free) {
        if (this.hp <= 14) return;
        this.hp -= 12;
      }
    } else {
      const cost = free ? 0 : Math.round(sp.manaCost * (m?.cost ?? 1));
      if (this.mana < cost) return;
      this.mana -= cost;
    }
    this.cd[idx] = sp.cooldown * this.cdMult() * (m?.cooldown ?? 1);

    /* Patch 4.0: brief cast-anticipation pulse at the player's hand. V1.3 —
       now a proper MUZZLE FLASH: crisp staff-tip bloom + short spark cone in
       the spell's color (baked sprites, one call). */
    const handAng = Math.atan2(this.my - this.py, this.mx - this.px);
    const hx = this.px + Math.cos(handAng) * 16;
    const hy = this.py + Math.sin(handAng) * 16;
    this.vfx.muzzle(hx, hy, handAng, sp.color);

    const cursorAng = Math.atan2(this.my - this.py, this.mx - this.px);
    const dist = Math.sqrt((this.mx - this.px) ** 2 + (this.my - this.py) ** 2);
    const ang = this.aimAssist(cursorAng, 640 * this.mods.range, 0.62);
    const power = this.powerMult(id);
    const dmg = sp.baseDamage * power * this.o.bonuses.spellPower * (m?.dmg ?? 1);
    const sfx = this.o.sfx;
    const homing = (1.6 + this.mods.homing * 1.6 + (this.surgeT > 0 ? 2 : 0)) * this.homingMult();

    switch (id) {
      case "fire": {
        sfx.castFire();
        const count = 1 + (m?.count ?? 0);
        const spd = 440 * (m?.speed ?? 1);
        for (let i = 0; i < count; i++) {
          const off = count === 1 ? 0 : (i - (count - 1) / 2) * 0.24;
          this.projs.push({
            kind: "fire", x: this.px, y: this.py,
            vx: Math.cos(ang + off) * spd, vy: Math.sin(ang + off) * spd,
            r: m?.special === "cataclysm" ? 12 : 9,
            dmg: count === 1 ? dmg : dmg,
            life: 1.5 * this.mods.range, pierce: 0, hit: new Set(),
            homing: homing * 0.5, special: m?.special,
          });
        }
        this.recoil(ang, 30);
        break;
      }
      case "ice": {
        sfx.castIce();
        const shards = 1 + this.mods.spread;
        for (let i = 0; i < shards; i++) {
          const off = shards === 1 ? 0 : (i - (shards - 1) / 2) * 0.14;
          this.projs.push({
            kind: "ice", x: this.px, y: this.py,
            vx: Math.cos(ang + off) * 680 * (m?.speed ?? 1), vy: Math.sin(ang + off) * 680 * (m?.speed ?? 1),
            r: m?.special === "glacial" ? 8 : 6,
            dmg: i === 0 || shards === 1 ? dmg : dmg * 0.7,
            life: 1.15 * this.mods.range, pierce: 2 + this.mods.pierce + (m?.pierce ?? 0),
            hit: new Set(), homing: homing * 0.3, special: m?.special,
          });
        }
        break;
      }
      case "lightning": {
        sfx.castLightning();
        if (m?.special === "skyfall") {
          /* strike up to three marked foes directly, wherever they stand */
          const alive = this.enemies.filter(this.aliveEnemy);  // event-path; Task 2-b: reuse the hoisted predicate
          const n = Math.min(3, alive.length);
          if (n > 0) {
            for (let i = 0; i < n; i++) {
              const pick = Math.floor(this.rng.next() * alive.length);
              const e = alive.splice(pick, 1)[0];
              this.zaps.push({ pts: [{ x: e.x, y: e.y - 260 }, { x: e.x, y: e.y }], life: 0.2, maxLife: 0.2, color: sp.color });
              this.damageEnemy(e, dmg, "lightning", true);
              this.ring(e.x, e.y, 44, sp.color, 2);
            }
          } else {
            this.zaps.push({
              pts: [{ x: this.px, y: this.py }, { x: this.px + Math.cos(ang) * 280, y: this.py + Math.sin(ang) * 280 }],
              life: 0.12, maxLife: 0.12, color: sp.color,
            });
          }
          this.ring(this.px, this.py, 46, sp.color, 2);
          break;
        }
        const first = this.nearestEnemy(this.px, this.py, 520 * this.mods.range);
        const hops = Math.min(4 + this.mods.spread + (m?.count ?? 0), 11);
        if (first) {
          const pts = [{ x: this.px, y: this.py }];
          let cur: Enemy | null = first;
          const chained = new Set<Enemy>();
          for (let hop = 0; hop < hops && cur; hop++) {
            chained.add(cur);
            pts.push({ x: cur.x, y: cur.y });
            this.damageEnemy(cur, dmg * (hop === 0 ? 1 : 0.82), "lightning", true);
            cur = this.nearestEnemyExcept(cur.x, cur.y, 200, chained);
          }
          this.zaps.push({ pts, life: 0.16, maxLife: 0.16, color: sp.color });
        } else {
          this.zaps.push({
            pts: [{ x: this.px, y: this.py }, { x: this.px + Math.cos(ang) * 280, y: this.py + Math.sin(ang) * 280 }],
            life: 0.12, maxLife: 0.12, color: sp.color,
          });
        }
        this.ring(this.px, this.py, 46, sp.color, 2);
        break;
      }
      case "earth": {
        sfx.castEarth();
        const d = Math.min(150, Math.max(56, dist));
        let rx = this.px + Math.cos(cursorAng) * d;
        let ry = this.py + Math.sin(cursorAng) * d;
        rx = Math.max(30, Math.min(WORLD_W - 30, rx));
        ry = Math.max(30, Math.min(WORLD_H - 30, ry));
        const eR = 26 * (m?.radius ?? 1);
        const eHp = 130 * this.mods.power * this.att * (m?.special === "bastion" ? 2.2 : 1);
        const eLife = 7 * (m?.life ?? 1);
        this.rocks.push({ x: rx, y: ry, r: eR, hp: eHp, maxHp: eHp, life: eLife, maxLife: eLife, grad: null, tick: 1 });
        this.shakeIt(3);
        for (let i = 0; i < 10; i++) this.puff(rx, ry, "#c9955a", 90, 3);
        break;
      }
      case "shadow": {
        sfx.castShadow();
        const longNight = m?.special === "longnight";
        const d = Math.min(longNight ? 260 : 180, Math.max(40, dist));
        const ox = this.px, oy = this.py;
        this.px = Math.max(18, Math.min(WORLD_W - 18, this.px + Math.cos(cursorAng) * d));
        this.py = Math.max(18, Math.min(WORLD_H - 18, this.py + Math.sin(cursorAng) * d));
        this.resolvePlayerPillars();
        for (let i = 0; i < 14; i++) { this.puff(ox, oy, "#b06bff", 120, 3); this.puff(this.px, this.py, "#b06bff", 120, 3); }
        this.ring(ox, oy, 40, sp.color, 2);
        this.ring(this.px, this.py, longNight ? 84 : 60, sp.color, 3);
        this.iframes = Math.max(this.iframes, longNight ? 0.35 : 0.2);
        const ax = longNight ? 96 : 74;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.x - this.px, dy = e.y - this.py;
          if (dx * dx + dy * dy < (ax + e.r) * (ax + e.r)) this.damageEnemy(e, dmg, "shadow", true);
        }
        if (m?.special === "pocket") {
          this.spawnCloud(ox, oy, dmg * 0.45, { rMult: 0.9, lifeMult: 0.85, dark: true });
        }
        break;
      }
      case "light": {
        sfx.castLight();
        const len = 640 * this.mods.range;
        const rays = 1 + (m?.count ?? 0);
        /* Patch 4.0: light no longer heals per foe (no healing spells). The
           Dawnbreaker evolution now hits harder instead. */
        const lightDmgMult = m?.special === "dawnbreaker" ? 1.35 : 1;
        for (let ri = 0; ri < rays; ri++) {
          const ra = ang + (rays === 1 ? 0 : (ri - (rays - 1) / 2) * 0.3);
          const x2 = this.px + Math.cos(ra) * len;
          const y2 = this.py + Math.sin(ra) * len;
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (this.segDist(e.x, e.y, this.px, this.py, x2, y2) < 26 + e.r + this.graze()) {
              this.damageEnemy(e, dmg * lightDmgMult, "light", true);
            }
          }
          this.beams.push({ x1: this.px, y1: this.py, x2, y2, life: 0.22, maxLife: 0.22, color: sp.color, w: 9 });
          this.beams.push({ x1: this.px, y1: this.py, x2, y2, life: 0.1, maxLife: 0.1, color: "#ffffff", w: 3 });
        }
        this.recoil(ang, 40);
        break;
      }
      case "time": {
        sfx.castTime(); sfx.freeze();
        const d = Math.min(240, Math.max(60, dist));
        const bx = Math.max(60, Math.min(WORLD_W - 60, this.px + Math.cos(cursorAng) * d));
        const by = Math.max(60, Math.min(WORLD_H - 60, this.py + Math.sin(cursorAng) * d));
        const tR = 95 * (m?.radius ?? 1);
        const tLife = 3.2 * (m?.life ?? 1);
        const rewind = m?.special === "rewind";
        this.bubbles.push({ x: bx, y: by, r: tR, life: tLife, maxLife: tLife, grad: null, rewind });
        if (rewind) this.healPlayer(6);
        this.ring(bx, by, tR, sp.color, 2);
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.x - bx, dy = e.y - by;
          if (dx * dx + dy * dy < (tR + e.r) * (tR + e.r)) this.damageEnemy(e, dmg, "time", false);
        }
        break;
      }
      case "void": {
        sfx.castVoid();
        this.projs.push({ kind: "void", x: this.px, y: this.py, vx: Math.cos(ang) * 200, vy: Math.sin(ang) * 200, r: m?.special === "collapse" ? 16 : 13, dmg, life: 1.5 * this.mods.range, pierce: 999, hit: new Set(), homing: 0, special: m?.special });
        break;
      }
      case "arcane": {
        sfx.castArcane();
        const n = 5 + this.mods.spread + (m?.count ?? 0);
        const coneW = ((m?.special === "prism" ? 66 : 44) + this.mods.spread * 6) * Math.PI / 180;
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * coneW;
          this.projs.push({ kind: "arcane", x: this.px, y: this.py, vx: Math.cos(ang + off) * 470, vy: Math.sin(ang + off) * 470, r: 5.5, dmg, life: 1.35 * this.mods.range * (m?.life ?? 1), pierce: 0, hit: new Set(), homing: homing * 1.5 * (m?.special === "snakes" ? 2.5 : 1), special: m?.special });
        }
        this.ring(this.px, this.py, 34, sp.color, 2);
        this.recoil(ang, 22);
        break;
      }
      case "blood": {
        sfx.castBlood();
        this.projs.push({ kind: "blood", x: this.px, y: this.py, vx: Math.cos(ang) * 840 * (m?.speed ?? 1), vy: Math.sin(ang) * 840 * (m?.speed ?? 1), r: 7, dmg, life: 1.0 * this.mods.range, pierce: 999, hit: new Set(), homing: 0, special: m?.special });
        for (let i = 0; i < 6; i++) this.puff(this.px, this.py, "#ff4d6b", 120, 2.6);
        this.recoil(ang, 60);
        this.shakeIt(2);
        break;
      }
      case "nature": {
        sfx.castNature();
        const d = Math.min(520, Math.max(90, dist));
        this.projs.push({ kind: "nature", x: this.px, y: this.py, vx: Math.cos(cursorAng) * 250, vy: Math.sin(cursorAng) * 250, r: 9, dmg, life: (d / 250) * 1.0, pierce: 0, hit: new Set(), homing: 0, special: m?.special });
        break;
      }
      /* Patch 9.0 — wind & sonic. */
      case "wind": {
        sfx.castWind();
        const blades = 3 + (m?.count ?? 0);
        const spd = 520 * (m?.speed ?? 1);
        for (let i = 0; i < blades; i++) {
          const off = (i - (blades - 1) / 2) * (m?.special === "cyclone" ? 0.34 : 0.24);
          this.projs.push({
            kind: "wind", x: this.px, y: this.py,
            vx: Math.cos(ang + off) * spd, vy: Math.sin(ang + off) * spd,
            r: 8, dmg: dmg * (m?.special === "cyclone" ? 0.72 : 1),
            life: 1.15 * this.mods.range, pierce: 3 + this.mods.pierce + (m?.pierce ?? 0),
            hit: new Set(), homing: homing * 0.4, special: m?.special,
          });
        }
        for (let i = 0; i < 6; i++) this.puff(this.px + Math.cos(ang) * 18, this.py + Math.sin(ang) * 18, "#d2fff8", 90, 2);
        this.recoil(ang, 24);
        break;
      }
      case "sonic": {
        /* self-centered nova — no aim needed, the panic button */
        sfx.castSonic();
        const silence = m?.special === "silence";
        const R = 150 * (m?.radius ?? 1);
        this.ring(this.px, this.py, R, sp.color, 4);
        this.ring(this.px, this.py, R * 0.62, "#ffd6f2", 2.5);
        this.shakeIt(5);
        for (let i = 0; i < 20; i++) this.puff(this.px, this.py, i % 2 ? "#ff9ede" : "#ffd6f2", 260, 3.2);
        for (const e of this.enemies) {
          if (e.dead) continue;
          const ex = e.x - this.px, ey = e.y - this.py;
          const rr = R + e.r;
          if (ex * ex + ey * ey < rr * rr) {
            this.damageEnemy(e, dmg, "sonic", true);
            /* the concussive shove — flings foes off the mage */
            const el = Math.sqrt(ex * ex + ey * ey) || 1;
            const shove = (silence ? 460 : 300) * (e.type === "boss" ? 0.25 : 1);
            e.vx += (ex / el) * shove;
            e.vy += (ey / el) * shove;
            e.chillT = Math.max(e.chillT, silence ? 3 : 1.5);
          }
        }
        break;
      }
    }

    /* weave charge + resonance check */
    if (this.surgeT <= 0) {
      this.weave = Math.min(1, this.weave + 0.045);
      if (this.weave >= 1 && !this.weaveFullCued) {
        this.weaveFullCued = true;
        this.floater(this.px, this.py - 40, "WEAVE FULL — PRESS F", "#ffe9ad", 16);
        this.ring(this.px, this.py, 52, "#f5c96b", 2.5);
        this.o.sfx.pickup();
      }
    }
    const now = this.t;
    if (this.lastCast && this.lastCast.id !== id && now - this.lastCast.t < this.mods.comboWindow) {
      this.triggerResonance(this.lastCast.id, id);
      this.lastCast = null;
    } else {
      this.lastCast = { id, t: now };
    }
  }

  /* Right-click: arcane volley — free-targeting bolts at the nearest foe. */
  private weaveBolt() {
    if (this.boltCd > 0) return;
    const cost = this.surgeT > 0 ? 0 : 3;
    if (this.mana < cost) return;
    this.mana -= cost;
    this.boltCd = 0.16 * this.mods.cdr * (this.surgeT > 0 ? 0.6 : 1);
    const dmg = 9 * this.powerMult("arcane") * this.o.bonuses.spellPower;
    const target = this.nearestEnemy(this.px, this.py, 1200);
    const base = target
      ? Math.atan2(target.y - this.py, target.x - this.px)
      : Math.atan2(this.my - this.py, this.mx - this.px);
    const n = this.mods.bolts;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.15;
      this.projs.push({
        kind: "arcane", x: this.px, y: this.py,
        vx: Math.cos(base + off) * 560, vy: Math.sin(base + off) * 560,
        r: 4.5, dmg: i === 0 ? dmg : dmg * 0.8, life: 1.5 * this.mods.range,
        pierce: 0, hit: new Set(), homing: 6 + this.mods.homing * 1.4,
      });
    }
    if (this.surgeT <= 0) {
      this.weave = Math.min(1, this.weave + 0.006);
      if (this.weave >= 1 && !this.weaveFullCued) {
        this.weaveFullCued = true;
        this.floater(this.px, this.py - 40, "WEAVE FULL — PRESS F", "#ffe9ad", 16);
        this.o.sfx.pickup();
      }
    }
    this.o.sfx.bolt();
  }

  private trySurge() {
    if (this.phase !== "running" || this.weave < 1 || this.surgeT > 0) return;
    this.weave = 0;
    this.weaveFullCued = false;
    this.surgeT = SURGE_DUR;
    this.o.sfx.surge();
    this.o.onBanner("WEAVE SURGE", "The rift pours through you — free casts, faster weaves", "#f5c96b");
    this.shakeIt(10);
    this.ring(this.px, this.py, 190, "#f5c96b", 4);
    this.ring(this.px, this.py, 120, "#ffe9ad", 3);
    for (let i = 0; i < 30; i++) this.puff(this.px, this.py, i % 2 ? "#f5c96b" : "#9a7bff", 300, 4);
  }

  private triggerResonance(a: ElementId, b: ElementId) {
    const key = comboKey(a, b);
    const def = COMBOS[key];
    if (!def) return;
    const dmg = (SPELLS[a].baseDamage + SPELLS[b].baseDamage) * 1.75 * this.mods.power * this.att * this.mods.comboDmg * this.o.bonuses.spellPower;
    const ca = SPELLS[a].color, cb = SPELLS[b].color;
    /* Patch 11.0 — RESONANCE DETONATION JUICE: a triple expanding ring
       (both element colors + the white seam between them), a swirling
       two-color particle storm with white-hot sparks, and a heavier hit-stop
       — the weave SINGS when two elements kiss. */
    this.ring(this.px, this.py, 150, ca, 4);
    this.ring(this.px, this.py, 110, cb, 3);
    this.ring(this.px, this.py, 74, "#ffffff", 2);
    for (let i = 0; i < 34; i++) {
      const col = i % 3 === 0 ? "#ffffff" : i % 2 ? ca : cb;
      this.puff(this.px, this.py, col, 280, 4.2);
    }
    this.shakeIt(11);
    this.hitStop = Math.max(this.hitStop, 0.1);
    this.mana = Math.min(this.maxMana, this.mana + 8);
    this.o.sfx.combo();
    this.floater(this.px, this.py - 44, def.name.toUpperCase(), "#ffe9ad", 20);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.px, dy = e.y - this.py;
      if (dx * dx + dy * dy < (150 + e.r) * (150 + e.r)) this.damageEnemy(e, dmg, b, true);
    }
    if (this.surgeT <= 0) this.weave = Math.min(1, this.weave + 0.2);
    const isNew = !this.o.knownCombos.includes(key) && !this.runFound.has(key);
    this.runFound.add(key);
    if (isNew) {
      this.o.onComboFound(key, a, b);
      this.o.onBanner("RESONANCE DISCOVERED", `${def.name} — ${SPELLS[a].name} × ${SPELLS[b].name}`, "#ffe9ad");
    }
  }

  private tryDash() {
    if (this.dashCd > 0 || this.phase !== "running") return;
    let dx = 0, dy = 0;
    /* virtual joystick overrides keyboard for dash direction */
    if (this.moveAxisX !== 0 || this.moveAxisY !== 0) {
      dx = this.moveAxisX;
      dy = this.moveAxisY;
    } else {
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
    }
    if (dx === 0 && dy === 0) {
      /* no explicit direction → dash toward aim (mouse or touch) */
      const ang = Math.atan2(this.my - this.py, this.mx - this.px);
      dx = Math.cos(ang); dy = Math.sin(ang);
    }
    const n = Math.sqrt(dx * dx + dy * dy) || 1;
    this.pvx = (dx / n) * 880; this.pvy = (dy / n) * 880;
    this.dashT = 0.14; this.dashCd = 2.2 * this.mods.dashCdM; this.iframes = Math.max(this.iframes, 0.3);
    this.o.sfx.castShadow();
    /* V1.3 — dash launch: spark burst kicks back off the launch point and a
       soft aura shell snaps open — the dash now READS even before the ghosts. */
    const dAng = Math.atan2(this.pvy, this.pvx);
    this.vfx.impact(this.px, this.py, dAng + Math.PI, "#b06bff", 2);
    this.vfx.aura(this.px, this.py, "#b06bff", 46);
    if (this.mods.dashDmg > 0) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const ex = e.x - this.px, ey = e.y - this.py;
        const rr = 60 + e.r;
        if (ex * ex + ey * ey < rr * rr) this.damageEnemy(e, this.mods.dashDmg * this.mods.power * this.att, "shadow", true);
      }
    }
  }

  private recoil(ang: number, f: number) {
    this.pvx -= Math.cos(ang) * f;
    this.pvy -= Math.sin(ang) * f;
  }

  /* ========================================================================
     Patch 8.0 — ARCHMAGE MODE AUTOPILOT
     ------------------------------------------------------------------------
     A full self-playing brain that runs once per frame while enabled:
       • steering  — kites at a preferred range, orbits/strafes, repels from
                     enemies / incoming bolts / hazards, attracts to drops,
                     shrines and fountains, avoids walls
       • targeting  — picks the juiciest enemy (boss > ranged > melee,
                     distance-weighted) and leads its velocity for aim
       • casting    — scores every equipped slot per situation and fires the
                     best (crowds favour chains/AoE, lone tough foes favour
                     lances/beams, pressure favours blink/pillar escapes)
       • weaving    — free arcane bolts to charge the Weave meter, then pops
                     Weave Surge the instant it fills
       • dodging    — blink-steps out of point-blank danger bolts / swarms
     Human input always wins: touching a stick pauses the pilot for 0.8s.
     ======================================================================== */

  /** Per-frame situational snapshot shared by steering + casting decisions. */
  private autopilot(dt: number) {
    if (this.phase !== "running" || this.hp <= 0) return;

    /* manual grace — a live human is driving; only keep passive safety nets */
    if (this.autoManualT > 0) {
      this.autoManualT -= dt;
      this.autoWeaveAndSurge();
      return;
    }

    const px = this.px, py = this.py;

    /* ---------- context gathering ---------- */
    let target: Enemy | null = null;        // primary attack focus
    let tScore = Infinity;
    let nearest: Enemy | null = null;       // nearest live enemy
    let nd2 = Infinity;
    let threatX = 0, threatY = 0;           // danger centroid (repulsion base)
    let closeCount = 0;                     // enemies within 140px of player
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - px, dy = e.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < nd2) { nd2 = d2; nearest = e; }
      if (d2 < 140 * 140) closeCount++;
      /* threat weight: bosses and elites dominate the centroid */
      const w = (e.type === "boss" ? 3 : e.affix ? 1.6 : 1) / Math.max(100 * 100, d2);
      threatX += dx * w; threatY += dy * w;
      /* targeting: bosses and ranged shooters first, distance-scaled.
         Patch 10.2 — LINE OF SIGHT is REQUIRED: the Fateweaver never fires
         at foes behind walls. The raycast only runs for candidates that
         beat the current best (cheap early-out); if nothing is visible the
         pilot simply repositions instead of casting. */
      const s = d2 / (e.type === "boss" ? 8 : e.ranged ? 2.2 : 1);
      if (s < tScore && this.lineClear(px, py, e.x, e.y)) { tScore = s; target = e; }
    }
    const nd = nearest ? Math.sqrt(nd2) : Infinity;
    const manaFrac = this.mana / this.maxMana;

    /* ---------- steering (boids-style: sum of weighted urges) ---------- */
    let sx = 0, sy = 0;

    /* kite the nearest threat around a preferred engagement range.
       Patch 10.2 — wounded caution: the lower the HP, the wider the kite. */
    if (nearest) {
      const ux = (nearest.x - px) / nd, uy = (nearest.y - py) / nd;
      const hpFrac = this.hp / this.maxHp;
      const caution = hpFrac < 0.7 ? 1 + (0.7 - hpFrac) * 1.2 : 1;
      const pref = (nearest.type === "boss" ? 330 : nearest.ranged ? 270 : 240) * caution;
      if (nd < pref * 0.8) {
        const push = (pref * 0.8 - nd) / (pref * 0.8);
        sx -= ux * push * 1.8; sy -= uy * push * 1.8;      // too close → back off
      } else if (nd > pref * 1.3) {
        sx += ux * 0.85; sy += uy * 0.85;                  // too far → close in
      } else {
        /* in the pocket → strafe perpendicular, flipping every ~1.5s */
        this.autoStrafeT -= dt;
        if (this.autoStrafeT <= 0) {
          this.autoStrafeT = 1.2 + this.rng.next() * 0.9;
          this.autoStrafeDir = this.rng.next() < 0.5 ? 1 : -1;
        }
        sx += -uy * 0.6 * this.autoStrafeDir;
        sy += ux * 0.6 * this.autoStrafeDir;
      }
    }

    /* repulsion from enemies inside the danger bubble */
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = px - e.x, dy = py - e.y;
      const rr = e.type === "boss" ? 200 : 160;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 1) {
        const d = Math.sqrt(d2);
        const w = ((rr - d) / rr) * (e.type === "boss" ? 2.6 : 2.0);
        sx += (dx / d) * w; sy += (dy / d) * w;
      }
    }

    /* dodge incoming bolts — strong repulsion from any bolt closing on us */
    let boltDanger = false;
    let bandDanger = false;   // Patch 10.2 — boss shockwave band closing in
    for (const b of this.eBolts) {
      const dx = px - b.x, dy = py - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 150 * 150 || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const closing = (b.vx * dx + b.vy * dy) / d;   // >0 → heading at player
      if (closing <= 40) continue;                    // slow/away bolts ignore
      const w = Math.min(4, closing / 120) * ((150 - d) / 150 + 0.35);
      sx += (dx / d) * w; sy += (dy / d) * w;
      if (d < 105 && closing > 120) boltDanger = true;
    }
    /* Patch 9.0 — boss-volley anticipation (Patch 10.2: the tyrants' volley
       cadences still ride shootT — Malgrym's fan, Sylthara's tempo, Mordrax's
       spiral — so the pilot keeps threading the gaps whenever one is due). */
    for (const e of this.enemies) {
      if (e.dead || e.type !== "boss") continue;
      const bx = e.x - px, by = e.y - py;
      const bl = Math.sqrt(bx * bx + by * by) || 1;
      /* volley due → keep kiting distance while sliding sideways */
      if (e.shootT <= 0.5) {
        sx += (bx / bl) * 0.8 - (by / bl) * this.autoStrafeDir * 1.6;
        sy += (by / bl) * 0.8 + (bx / bl) * this.autoStrafeDir * 1.6;
      }
      /* Patch 10.2 — WINDUP AWARENESS: every tyrant's bespoke pattern roots
         or rears in state 1 before it strikes (Malgrym's charge, Ashgorim's
         slam, Sylthara's lunge, Mordrax's stampede). The Fateweaver reads
         that tell and opens distance while sliding — pre-dodging instead of
         reacting to the hit. */
      if (e.actState === 1) {
        const push = 1.9;
        sx += (bx / bl) * push - (by / bl) * this.autoStrafeDir * 1.2;
        sy += (by / bl) * push + (bx / bl) * this.autoStrafeDir * 1.2;
      }
      /* Patch 10.2 — SHOCKWAVE BAND: Ashgorim's traveling slam ring (radius
         rides e.wob) cannot be outrun — the calculated answer is to blink
         THROUGH it with dash invulnerability the instant it arrives. */
      if (e.wob > 0) {
        const bandDelta = bl - e.wob;
        if (Math.abs(bandDelta) < 90 && e.wob < 470) bandDanger = true;
      }
      break;
    }

    /* hazards are lava */
    for (const hz of this.arena.hazards) {
      const hx = hz.x, hy = hz.y;
      const dx = px - hx, dy = py - hy;
      const rr = hz.r + 70;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 1) {
        const d = Math.sqrt(d2);
        const w = ((rr - d) / rr) * 2.2;
        sx += (dx / d) * w; sy += (dy / d) * w;
      }
    }

    /* Patch 9.0 — pillar avoidance: the pilot never grinds a wall. Repulsion
       from the nearest point of every nearby pillar, strong when close. */
    for (const p of this.arena.pillars) {
      const nxp = Math.max(p.x, Math.min(px, p.x + p.w));
      const nyp = Math.max(p.y, Math.min(py, p.y + p.h));
      const dx = px - nxp, dy = py - nyp;
      const d2 = dx * dx + dy * dy;
      const rr = 96;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1;
        const w = ((rr - d) / rr) * 2.6;
        sx += (dx / d) * w; sy += (dy / d) * w;
      }
    }

    /* magnets — Patch 11.0 strict-economy pickups: resonance orbs first (a
       free fusion), hearts only while bleeding, spell tears otherwise.
       Shrines and thirsty fountains come next. */
    const hpNow = this.hp / this.maxHp;
    for (const d of this.spellDrops) {
      if (d.life <= 0) continue;
      if (d.kind === "heart" && hpNow > 0.72) continue;
      const dx = d.x - px, dy = d.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < 460 * 460 && d2 > 1) {
        const d1 = Math.sqrt(d2);
        const w = d.kind === "resonance" ? 3.6 : d.kind === "heart" ? 3.0 : 3.2;
        sx += (dx / d1) * w; sy += (dy / d1) * w;
      }
    }
    if (this.shrine) {
      const dx = this.shrine.x - px, dy = this.shrine.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < 340 * 340 && d2 > 1) {
        const d1 = Math.sqrt(d2);
        sx += (dx / d1) * 1.4; sy += (dy / d1) * 1.4;
      }
    }
    for (const f of this.arena.fountains) {
      if (f.used || f.kind !== "mana" || manaFrac > 0.55) continue;
      const fx = f.x, fy = f.y;
      const dx = fx - px, dy = fy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < 420 * 420 && d2 > 1) {
        const d1 = Math.sqrt(d2);
        sx += (dx / d1) * 1.2; sy += (dy / d1) * 1.2;
      }
    }

    /* wall cushion — never let the kite corner us against the world walls */
    const m = 100;
    if (px < m) sx += (1 - px / m) * 1.6;
    if (px > WORLD_W - m) sx -= (1 - (WORLD_W - px) / m) * 1.6;
    if (py < m) sy += (1 - py / m) * 1.6;
    if (py > WORLD_H - m) sy -= (1 - (WORLD_H - py) / m) * 1.6;

    /* gentle wander so idle states never look frozen */
    this.autoWander += dt * 0.9;
    sx += Math.cos(this.autoWander) * 0.1;
    sy += Math.sin(this.autoWander * 0.83) * 0.1;

    /* commit the steering vector (clamped to unit disc) */
    const sl = Math.sqrt(sx * sx + sy * sy);
    if (sl > 1) { sx /= sl; sy /= sl; }
    this.moveAxisX = sl > 0.06 ? sx : 0;
    this.moveAxisY = sl > 0.06 ? sy : 0;

    /* ---------- emergency blink-step ----------
       A bolt is about to land or a mob is inside point-blank range and the
       dash is ready → dash along the current escape vector (away from the
       threat centroid). Patch 10.2: the trigger fires earlier when hurt. */
    const swarmDanger = nearest !== null && nd < 90 + (1 - this.hp / this.maxHp) * 60;
    if (this.dashCd <= 0 && (boltDanger || swarmDanger || bandDanger)) {
      let ex = px - (nearest ? nearest.x : px), ey = py - (nearest ? nearest.y : py);
      if (boltDanger && threatX !== 0 && threatY !== 0) { ex = -threatX; ey = -threatY; }
      if (!boltDanger && bandDanger) {
        /* Patch 10.2 — crossing INWARD under dash invulnerability beats
           fleeing a 560px/s ring: the safe pocket is behind the band, right
           beside the tyrant. */
        for (const e of this.enemies) {
          if (!e.dead && e.type === "boss" && e.wob > 0) {
            ex = e.x - px; ey = e.y - py;
            break;
          }
        }
      }
      const el = Math.sqrt(ex * ex + ey * ey);
      if (el > 1) {
        this.moveAxisX = ex / el;
        this.moveAxisY = ey / el;
        this.tryDash();
      }
    }

    /* ---------- aiming + casting ---------- */
    if (target) {
      /* lead the target so travel-time projectiles connect */
      const lead = Math.min(0.4, Math.sqrt((target.x - px) ** 2 + (target.y - py) ** 2) / 620);
      this.mx = Math.max(8, Math.min(WORLD_W - 8, target.x + target.vx * lead));
      this.my = Math.max(8, Math.min(WORLD_H - 8, target.y + target.vy * lead));

      this.autoTick -= dt;
      if (this.autoTick <= 0) {
        /* Patch 10.2 — intensity scaleback: the Fateweaver casts at a
           deliberate pace (0.30s decisions, was 0.14s) and only when the
           situation scores above a strict threshold — no ability spam. */
        this.autoTick = 0.3;
        const slot = this.autoPickSlot(target, closeCount);
        if (slot >= 0) this.castSpell(slot);
      }
    } else if (this.shrine || this.spellDrops.some(this.dropLive)) {
      /* nothing to fight — drift toward the nearest pickup */
      let gx = this.shrine?.x ?? px, gy = this.shrine?.y ?? py;
      let gd = Math.sqrt((gx - px) ** 2 + (gy - py) ** 2);
      for (const d of this.spellDrops) {
        if (d.life <= 0) continue;
        const dd = Math.sqrt((d.x - px) ** 2 + (d.y - py) ** 2);
        if (dd < gd) { gd = dd; gx = d.x; gy = d.y; }
      }
      if (gd > 30) {
        this.mx = gx; this.my = gy;
        this.moveAxisX = (gx - px) / gd;
        this.moveAxisY = (gy - py) / gd;
      }
    }

    this.autoWeaveAndSurge(true);
  }

  /** Free arcane bolts (Weave builder) + instant Weave Surge when full.
      Shared by the piloted and manual-grace paths.
      Patch 10.2 — FATEWEAVER discipline: in full-auto the surge is HELD
      until it matters (a boss is up, a pack is closing, or the meter has
      been full for ~5s), and weave bolts are only spent on targets in line
      of sight. The manual-grace path stays trigger-happy — surge is never
      wasted while a human is steering. */
  private autoWeaveAndSurge(disciplined = false) {
    if (this.weave >= 1) {
      if (this.weaveFullT === 0) this.weaveFullT = this.t;
      let go = true;
      if (disciplined) {
        let closeCount = 0;
        let bossUp = false;
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (e.type === "boss") { bossUp = true; break; }
          const dx = e.x - this.px, dy = e.y - this.py;
          if (dx * dx + dy * dy < 260 * 260) closeCount++;
        }
        go = bossUp || closeCount >= 4 || this.t - this.weaveFullT > 5;
      }
      if (go) { this.trySurge(); this.weaveFullT = 0; }
    } else {
      this.weaveFullT = 0;
    }
    if (this.surgeT > 0 || this.mana > this.maxMana * 0.5) {
      if (!disciplined || this.hasLosTarget()) this.weaveBolt();
    }
  }

  /** Patch 10.2 — is any enemy visible (LoS) within weave-bolt range? The
      disciplined pilot never lobs bolts into a wall. */
  private hasLosTarget(): boolean {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.px, dy = e.y - this.py;
      if (dx * dx + dy * dy > 1200 * 1200) continue;
      if (this.lineClear(this.px, this.py, e.x, e.y)) return true;
    }
    return false;
  }

  /** Patch 10.2 — FATEWEAVER context snapshot: the live run state the
      auto-pickers (autopick.ts) reason over while Archmage Mode resolves an
      overlay choice. Pure read — safe to call from React at any moment. */
  getFateContext(): FateContext {
    const equipped = this.equipped.map((slot): ElementId | { merged: ElementId[] } | null => {
      if (slot.spells.length === 0) return null;
      if (slot.spells.length === 1) return SPELL_ORDER[slot.spells[0]];
      return { merged: slot.spells.map((idx) => SPELL_ORDER[idx]) };
    });
    let alive = 0;
    for (const e of this.enemies) if (!e.dead) alive++;
    return {
      hpFrac: this.hp / this.maxHp,
      manaFrac: this.mana / this.maxMana,
      wave: this.wave,
      bossSoon: (this.wave + 1) % 10 === 0,
      enemiesAlive: alive,
      power: this.mods.power * this.att,
      armor: 1 - this.mods.dr,
      crit: this.mods.crit,
      cdr: 1 - this.mods.cdr,
      equipped,
    };
  }

  /** Situation-aware spell choice — Patch 10.2: the FATEWEAVER brain.
      Returns the equipped slot index to fire, or −1 when nothing is worth
      casting right now. No spam: a strict value threshold, a mana reserve
      for panic tools, resonance-aware pairing (a primed element is worth
      detonating), and the per-element range bands. */
  private autoPickSlot(target: Enemy, closeCount: number): number {
    const px = this.px, py = this.py;
    const manaFrac = this.mana / this.maxMana;
    const td = Math.sqrt((target.x - px) ** 2 + (target.y - py) ** 2);

    /* mana reserve — never cast below 12% unless something is crawling up
       the robe (panic tools may empty the well) */
    if (manaFrac < 0.12 && closeCount < 3) return -1;

    /* cluster size around the target (AoE value) */
    let cluster = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - target.x, dy = e.y - target.y;
      if (dx * dx + dy * dy < 130 * 130) cluster++;
    }

    /* Patch 10.2 — resonance awareness: when an element is primed and the
       window is still open, casting a DIFFERENT element detonates the
       resonance (large AoE + weave charge). The Fateweaver hunts those
       pairs instead of mashing whatever is off cooldown. */
    const prime = this.lastCast && this.t - this.lastCast.t < this.mods.comboWindow ? this.lastCast.id : null;

    let bestSlot = -1, bestScore = 46;  // Patch 10.2: stricter floor — no waste
    if (manaFrac > 0.95) bestScore = 18; // …unless the well is truly overflowing

    for (let i = 0; i < this.equipped.length; i++) {
      const slotSpells = this.equipped[i].spells;
      if (slotSpells.length === 0) continue;
      let slotBest = -1;
      for (const idx of slotSpells) {
        if (this.cd[idx] > 0) continue;
        const id = SPELL_ORDER[idx];
        const sp = SPELLS[id];
        if (this.mana < sp.manaCost) continue;
        let s: number;
        switch (id) {
          case "fire":      s = 50 + cluster * 7; break;
          case "ice":       s = 46 + cluster * 8; break;
          case "lightning": s = td < 560 ? 58 + cluster * 9 : -1; break;
          case "earth":     s = closeCount > 0 ? 38 + closeCount * 7 : 6; break;
          case "shadow":    s = closeCount >= 2 ? 74 : -1; break;   // escape blink
          case "light":     s = td < 620 ? 62 + cluster * 3 : -1; break;
          case "time":      s = cluster >= 3 ? 50 : 10; break;
          case "void":      s = td < 250 ? 55 + closeCount * 8 : -1; break;
          case "arcane":    s = 44 + cluster * 5; break;
          case "blood":     s = manaFrac > 0.45 && td < 560 ? 72 : -1; break;
          case "nature":    s = cluster >= 2 ? 52 + cluster * 7 : 14; break;
          /* Patch 9.0 — wind pierces lines and shoves; sonic is the panic
             nova when foes are crawling up the robe. */
          case "wind":      s = 54 + cluster * 4; break;
          case "sonic":     s = 46 + closeCount * 9; break;
          default:          s = 30; break;
        }
        /* Patch 10.2 — the resonance hunt: a primed pair is worth reaching for */
        if (prime && id !== prime) s += 26;
        s -= sp.manaCost * 0.22;   // efficiency pressure
        if (s > slotBest) slotBest = s;
      }
      if (slotBest > bestScore) {
        bestScore = slotBest;
        bestSlot = i;
      }
    }

    /* shadow-blink special case: it teleports TOWARD the aim point, so when
       firing it as an escape, aim away from the danger centroid first. */
    if (bestSlot >= 0) {
      const spells = this.equipped[bestSlot].spells;
      const first = spells.find((idx) => this.cd[idx] <= 0);
      if (first !== undefined && SPELL_ORDER[first] === "shadow" && closeCount >= 2) {
        let ex = 0, ey = 0;
        for (const e of this.enemies) {
          if (e.dead) continue;
          ex += px - e.x; ey += py - e.y;
        }
        const el = Math.sqrt(ex * ex + ey * ey) || 1;
        this.mx = Math.max(8, Math.min(WORLD_W - 8, px + (ex / el) * 170));
        this.my = Math.max(8, Math.min(WORLD_H - 8, py + (ey / el) * 170));
      }
    }

    return bestSlot;
  }

  /* ------------------------------ combat utils ----------------------------- */

  private nearestEnemy(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null, bd2 = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) { bd2 = d2; best = e; }
    }
    return best;
  }

  private nearestEnemyExcept(x: number, y: number, range: number, except: Set<Enemy>): Enemy | null {
    let best: Enemy | null = null, bd2 = range * range;
    for (const e of this.enemies) {
      if (e.dead || except.has(e)) continue;
      const dx = e.x - x, dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) { bd2 = d2; best = e; }
    }
    return best;
  }

  private segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
  }

  private damageEnemy(e: Enemy, dmg: number, elem: ElementId, canCrit: boolean) {
    if (e.dead || e.hp <= 0) return;
    /* V1.0 — THE WEAVE HUNTS THE MARKED: elite foes take +35% spell damage
       (ELITE_BONUS), so the golden-ringed ones read as prey, not walls. */
    let final = dmg * (e.affix ? ELITE_BONUS : 1) * (1 - e.resist);
    let crit = false;
    if (canCrit && Math.random() < this.mods.crit) { final *= this.mods.critDmg; crit = true; }
    e.hp -= final;
    this.runDamage += final;
    e.hitFlash = 0.12;
    const ang = Math.atan2(e.y - this.py, e.x - this.px);
    const sp = SPELLS[elem];
    /* V1.3 — THE HIT-FEEL STACK: impact-axial squash (springs back below),
       directional spark cone off the wound surface + micro hitstop (150 ms
       guard) + crit trauma. Replaces the old four-puff burst. */
    e.sq = 0.18; e.sqA = ang;
    const kb = e.type === "boss" ? 14 : 110;
    e.vx += Math.cos(ang) * kb; e.vy += Math.sin(ang) * kb;
    if (elem === "ice") e.chillT = this.evoModFor("ice")?.special === "glacial" ? 3.5 : 2;
    if (elem === "fire") { e.burnT = 3; e.burnDps = 12 * this.mods.power * this.att; }
    /* Patch 4.0: blood no longer heals on hit (no healing spells). */
    const hx = e.x - Math.cos(ang) * e.r * 0.5;
    const hy = e.y - Math.sin(ang) * e.r * 0.5;
    this.vfx.impact(hx, hy, ang, crit ? "#ffe9ad" : sp.glow, crit ? 2 : 1);
    /* Patch 7.0: damage numbers are a setting (accessibility + perf — skips
       floater allocations entirely when off). V1.0: elite-marked hits read
       gold and larger — the power spike is legible at a glance. */
    if (this.o.settings.dmgNumbers) {
      const col = crit ? "#ffe9ad" : e.affix ? "#f5c96b" : "rgba(242,233,255,0.75)";
      this.floater(e.x + (Math.random() * 16 - 8), e.y - e.r - 6, String(Math.round(final)), col, crit ? 19 : e.affix ? 15 : 12.5);
    }
    if (crit) {
      this.o.sfx.crit();
      this.hitStop = Math.max(this.hitStop, this.juice.requestHitStop(0.045));
    } else {
      this.o.sfx.hit();
      const hs = this.juice.requestHitStop(0.024);
      if (hs > 0) this.hitStop = Math.max(this.hitStop, hs);
    }
    /* Patch 4.0: vamp boon removed — spells no longer heal on damage. */

    /* boss enrage — Patch 7.0: phase 2 gains a NEW attack instead of just
       speed (Dead Cells rule). Patch 10.2: the shared text banner and the
       generic spiral burst are GONE — no boss message boxes. The moment
       reads purely through audio + visuals (roar, shake, flare rings), and
       every tyrant's OWN pattern densifies from here: Malgrym chains a third
       re-aimed charge and tightens his fan, Ashgorim slams harder and sheds
       more imps, Sylthara doubles her tempo and adds a third lunge, Ysolth
       blinks faster behind a triple arm, Mordrax's storm gains a fourth
       arm and a wider nova. */
    if (e.type === "boss" && !e.enraged && e.hp > 0 && e.hp < e.maxHp * 0.5) {
      e.enraged = true;
      e.speed *= 1.35;
      e.shootT = Math.min(e.shootT, 0.8);
      this.o.sfx.bossRoar();
      /* Patch 11.0 — the ENRAGE musical trigger: the ostinato accelerates
         and the tritone war-drone rises under the fight. */
      this.o.sfx.bossEnrage();
      this.shakeIt(16);
      this.hitStop = Math.max(this.hitStop, 0.12);
      this.ring(e.x, e.y, 150, e.color, 5);
      this.ring(e.x, e.y, 230, e.glow, 3);
      for (let i = 0; i < 26; i++) this.puff(e.x, e.y, i % 2 ? e.color : e.glow, 300, 4.4);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  /* Flag-and-honor removal: sets dead, does death juice once; the array is
     compacted at the start of the next frame. Patch 5.0: removed the per-kill
     spell-drop roll — drops are SCHEDULED by the strict Patch-11.0 wave
     economy (resolveWaveDrop in startWave). Patch 7.0: fires the bestiary
     discovery callback (once per kind per run) for the Arcanum. */
  private killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.score += e.score;
    this.o.sfx.enemyDie();
    /* bestiary discovery — first kill of this kind THIS RUN */
    const kind = e.type === "boss" ? this.currentBoss().id : e.type;
    if (!this.seenKinds.has(kind)) {
      this.seenKinds.add(kind);
      this.o.onBestiary(kind);
    }
    const bossKill = e.type === "boss";
    /* V1.3 — DEATH JUICE: every kill detonates a layered blast (core flash
       + chromatic fringe + double shockwave + debris streaks + smoke),
       bursts an aura shell and releases rising soul wisps; trauma scales
       with the foe's weight. */
    const blastR = bossKill ? 150 : e.affix ? 64 : 34 + e.r * 0.4;
    this.vfx.blast(e.x, e.y, e.color, e.glow, blastR, bossKill ? 3 : e.affix ? 2 : 1);
    this.vfx.aura(e.x, e.y, e.glow, bossKill ? 170 : e.affix ? 84 : 46);
    const wisps = bossKill ? 6 : e.affix ? 3 : 1;
    for (let i = 0; i < wisps; i++) this.vfx.wisp(e.x, e.y, e.glow);
    if (!this.reducedMotion && this.o.settings.screenShake) {
      this.juice.addTrauma(bossKill ? 0.85 : e.affix ? 0.42 : 0.22);
    }
    if (e.affix) this.juice.punch(0.035);

    /* blazing elites detonate */
    if (e.affix === "blazing") {
      this.vfx.blast(e.x, e.y, "#ff7847", "#ffe86b", 84, 2);
      this.shakeIt(8);
      const dx = this.px - e.x, dy = this.py - e.y;
      if (dx * dx + dy * dy < 100 * 100) this.damagePlayer(e.damage * 1.1, e.x, e.y);
    }

    const n = e.type === "boss" ? 14 : e.affix ? 3 : 1 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.motes.push({ x: e.x + (Math.random() * 20 - 10), y: e.y + (Math.random() * 20 - 10), vx: Math.random() * 80 - 40, vy: Math.random() * 80 - 40, val: Math.round((2 + this.wave * 0.6) * (e.affix ? 2 : 1)), life: 9 });
    }

    /* Patch 7.0: boss felled — score + shake + hit-stop; the Arcanum
       bestiary entry unlocks via the onBestiary callback above. Patch
       10.2: no message banner — the kill reads through the massive visual
       burst + a floating +250 score at the kill site. */
    if (e.type === "boss") {
      this.score += 250;
      this.shakeIt(22);
      this.hitStop = Math.max(this.hitStop, 0.22);
      /* V1.3 — tyrant punctuation: slow-mo dip + warm white flash + zoom
       punch (accessibility settings respected). */
      this.juice.punch(0.07);
      this.juice.slowmo(0.3, 0.35);
      if (!this.o.settings.reduceFlash) this.juice.flash(255, 240, 214, 0.2);
      this.floater(e.x, e.y - e.r - 14, "+250", "#ffe9ad", 22);
      this.floater(this.px, this.py - 46, "TYRANT FELLED", "#ffe9ad", 18);
      /* Patch 11.0 — the boss theme collapses the instant the tyrant falls
         (no waiting for the next wave): the war-drone and ostinato tear down
         and the score drops back to combat intensity. */
      this.o.sfx.setIntensity(1);
    }
  }

  /* --------------------------- Patch 5.0 drops --------------------------- */

  /** Draw the next spell-tear element: pops from the seeded bag, refilling
      (excluding everything currently equipped) whenever it runs dry. Falls
      back to any non-equipped element when the bag holds only stale picks
      (can't happen with 13 elements and ≤6 held, but the game never breaks).
      V1.0 final — FAIR-CYCLING RNG: a Fisher-Yates shuffle-bag over the
      eligible roster guarantees every not-held element tears exactly once
      per cycle before any repeat. */
  private drawSpellTear(): ElementId {
    const equipped = this.equippedSet();
    while (this.spellBag.length) {
      const id = this.spellBag.pop()!;
      if (!equipped.has(id)) return id;
    }
    /* refill: seeded Fisher-Yates over every eligible element */
    const bag = SPELL_ORDER.filter((s) => !equipped.has(s));
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.spellBag = bag;
    return this.spellBag.pop() ?? SPELL_ORDER.find((s) => !equipped.has(s)) ?? SPELL_ORDER[0];
  }

  /** Flatten the equipped list into a Set of element ids currently in any
      slot (single or merged). Used by the offer pool to avoid offering
      back something the player is already holding. */
  private equippedSet(): Set<ElementId> {
    const out = new Set<ElementId>();
    for (const slot of this.equipped) for (const idx of slot.spells) out.add(SPELL_ORDER[idx]);
    return out;
  }

  /** Spawn a floating spell-drop glyph at (x, y) — Patch 11.0: the orb's
      kind is set by the strict wave economy (startWave); spell orbs carry
      the element they represent.
      V1.0 final: the element comes from the fair-cycling bag (never a
      duplicate of something already held — the tear is always a real
      choice, in every loadout state). */
  private spawnSpellDrop(x: number, y: number, kind: "spell" | "heart" | "resonance") {
    const id = kind === "spell" ? this.drawSpellTear() : "blood";
    this.spellDrops.push({
      kind, x, y, vx: 0, vy: -40, life: 14, id, grad: null,
      wob: this.rng.range(0, TAU),
    });
  }

  /** Patch 11.0 — the player touched the wave's ONE drop. Three kinds:
      heart  → mend HEART_DROP_HEAL_FRAC of max HP (no overlay, wave flows on)
      spell  → open the spell-offer overlay (NO heal — hearts are their own
               drop type now) and re-roll the spell cadence
      resonance → THE SACRIFICE: open the merge prompt — exactly two bound
               spells fuse into one merged slot, the wave resumes after. */
  private pickUpDrop(d: SpellDrop) {
    this.o.sfx.pickup();
    if (d.kind === "heart") {
      const heal = this.maxHp * HEART_DROP_HEAL_FRAC;
      this.healPlayer(heal);
      this.floater(this.px, this.py - 32, "+" + Math.round(heal) + " HP", "#ff8ba0", 17);
      this.ring(this.px, this.py, 74, "#ff4d6b", 3);
      for (let i = 0; i < 18; i++) this.puff(this.px, this.py, i % 2 ? "#ff4d6b" : "#ffa3b5", 210, 3);
      this.o.onBanner("THE HEART IS CLAIMED", "+" + Math.round(heal) + " vitality restored", "#ff4d6b");
      return;
    }
    if (d.kind === "resonance") {
      this.ring(this.px, this.py, 84, "#ffe9ad", 3.5);
      this.ring(this.px, this.py, 56, "#b06bff", 2.5);
      for (let i = 0; i < 22; i++) this.puff(this.px, this.py, i % 2 ? "#ffe9ad" : "#b06bff", 230, 3.4);
      this.openResonanceMerge();
      return;
    }
    /* spell tear — no heal (Patch 11.0 strict economy) */
    this.ring(this.px, this.py, 70, SPELLS[d.id].color, 3);
    for (let i = 0; i < 18; i++) this.puff(this.px, this.py, i % 2 ? SPELLS[d.id].color : SPELLS[d.id].glow, 200, 3);
    /* Build the offer pool: the dropped element + 2 random others not equipped. */
    const equipped = this.equippedSet();
    const others: ElementId[] = [];
    const scratch = [...SPELL_ORDER].filter((s) => s !== d.id && !equipped.has(s));
    while (others.length < SPELL_OFFER_COUNT - 1 && scratch.length) {
      const i = Math.floor(this.rng.next() * scratch.length);
      others.push(scratch.splice(i, 1)[0]);
    }
    const pool: ElementId[] = [d.id, ...others];
    while (pool.length < SPELL_OFFER_COUNT) pool.push(this.drawSpellTear());
    this.pendingOffer = { pool };
    this.phase = "spelloffer";
    this.o.onPhase("spelloffer", { offer: this.pendingOffer });
    this.o.onSpellOffer(this.pendingOffer);
    /* Patch 5.0: schedule the next scheduled drop (every 3-5 waves). */
    this.scheduleNextDrop(this.wave);
  }

  /** Public callback for the React overlay — pick the spell to equip + the
      slot to replace. Called as chooseSpellDrop(slot, spellId). Patch 5.0:
      the slot may be a single or merged slot — replacing it overwrites the
      whole slot with the new single spell. */
  chooseSpellDrop(slot: number, spellId: ElementId) {
    if (this.phase !== "spelloffer" || !this.pendingOffer) return;
    if (slot < 0 || slot >= this.equipped.length) return;
    if (!this.pendingOffer.pool.includes(spellId)) return;
    const newIdx = SPELL_ORDER.indexOf(spellId);
    this.equipped[slot] = { spells: [newIdx] };
    this.cd[newIdx] = 0;                     // fresh spell — no carryover cooldown
    this.selected = slot;                    // keep the new spell active
    this.o.sfx.levelup();
    this.o.onBanner("SPELL EQUIPPED", `${SPELLS[spellId].name} bound to slot ${slot + 1}`, SPELLS[spellId].color);
    this.floater(this.px, this.py - 44, SPELLS[spellId].name.toUpperCase(), SPELLS[spellId].color, 18);
    this.ring(this.px, this.py, 110, SPELLS[spellId].color, 4);
    for (let i = 0; i < 20; i++) this.puff(this.px, this.py, i % 2 ? SPELLS[spellId].color : SPELLS[spellId].glow, 240, 4);
    this.pendingOffer = null;
    this.phase = "running";
    this.last = performance.now();
    this.o.onPhase("running");
  }

  /* Patch 6.0 — "Back to Game" on the spell-offer overlay: the player may
     skip the swap entirely. Patch 11.0: no heal rides the tear anymore
     (hearts are their own drop type) — skipping is purely a loadout choice.
     The scheduled next drop is unaffected — it was rolled at pickup. */
  skipSpellOffer() {
    if (this.phase !== "spelloffer") return;
    this.pendingOffer = null;
    this.phase = "running";
    this.last = performance.now();
    this.o.onPhase("running");
    this.o.onBanner("THE TEAR FADES", "You keep the spells you carry", "#7ed957");
  }

  /* --------------------------- Patch 5.0 merge --------------------------- */

  /** Public callback for the React MergeOverlay — fuse two single slots
      into one merged slot. The first slot becomes the merged slot (length-2
      spells array); the second slot is emptied (spells: []). The merge name
      is derived from the existing COMBOS dictionary (e.g. fire+ice →
      "Steam Cloud") and recorded in runMerges for the run-stats screen. */
  chooseMerge(slotA: number, slotB: number) {
    if (this.phase !== "mergeoffer") return;
    if (slotA < 0 || slotA >= this.equipped.length) return;
    if (slotB < 0 || slotB >= this.equipped.length) return;
    if (slotA === slotB) return;
    const a = this.equipped[slotA], b = this.equipped[slotB];
    /* both slots must be single spells (length === 1) — already-merged or
       empty slots cannot be merged again */
    if (a.spells.length !== 1 || b.spells.length !== 1) return;
    const aIdx = a.spells[0], bIdx = b.spells[0];
    const aId = SPELL_ORDER[aIdx], bId = SPELL_ORDER[bIdx];
    /* fuse: slotA becomes the merged slot; slotB is emptied */
    a.spells.push(bIdx);
    b.spells = [];
    /* keep slotA active so the new merged spell is the cast default */
    this.selected = slotA;
    /* record the merge name for run-stats */
    const mergeKey = comboKey(aId, bId);
    const mergeName = COMBOS[mergeKey]?.name ?? `${SPELLS[aId].name}+${SPELLS[bId].name}`;
    this.runMerges.push(mergeName);
    this.o.sfx.levelup();
    this.o.onBanner("SPELLS MERGED", `${mergeName} — casts both in succession`, "#ffe9ad");
    this.floater(this.px, this.py - 44, mergeName.toUpperCase(), "#ffe9ad", 18);
    this.ring(this.px, this.py, 120, "#ffe9ad", 4);
    for (let i = 0; i < 26; i++) this.puff(this.px, this.py, i % 2 ? SPELLS[aId].color : SPELLS[bId].color, 260, 4);
    /* Patch 11.0: merges are now MID-WAVE events (resonance-orb pickups),
       so the sacrifice resolves and the SAME wave resumes — enemies were
       frozen behind the overlay and carry on exactly where they stood. */
    this.phase = "running";
    this.last = performance.now();
    this.o.onPhase("running");
  }

  private healPlayer(n: number) {
    if (n <= 0 || this.hp <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  private damagePlayer(dmg: number, sx: number, sy: number) {
    if (this.iframes > 0 || this.hp <= 0) return;
    /* Patch 6.0: Riftward Hide (armor tribute) multiplies ALL incoming damage
       down; Rift Mercy then shaves its per-round percentage off what's left. */
    let final = dmg * this.mods.dr;
    if (this.mercyDr > 0) final *= 1 - this.mercyDr;
    this.hp -= final;
    this.iframes = 0.75;
    /* V1.0 final — reduceFlash accessibility setting softens the red
       damage vignette alongside the OS reduced-motion preference. */
    if (!this.reducedMotion && !this.o.settings.reduceFlash) this.redFlash = 0.55;
    this.shakeIt(11);
    this.o.sfx.hurt();
    const ang = Math.atan2(this.py - sy, this.px - sx);
    this.pvx += Math.cos(ang) * 300; this.pvy += Math.sin(ang) * 300;
    for (let i = 0; i < 8; i++) this.puff(this.px, this.py, "#ff4d6b", 160, 3);
    this.floater(this.px, this.py - 26, "-" + Math.round(final), "#ff4d6b", 16);
    if (this.hp <= 0) this.die();
  }

  private die() {
    this.hp = 0;
    this.phase = "gameover";
    this.o.sfx.death();
    this.o.sfx.setIntensity(0);
    this.shakeIt(26);
    /* V1.0 final — reduceFlash accessibility setting softens the red
       vignette alongside the OS reduced-motion preference. */
    if (!this.reducedMotion && !this.o.settings.reduceFlash) this.redFlash = 1;
    for (let i = 0; i < 50; i++) this.puff(this.px, this.py, i % 2 ? "#b06bff" : "#f5c96b", 380, 4.6);
    /* V1.3 — the mage's fall: layered blast + soul wisps rising from the
       robes + a wide aura shell as the rift claims the light. */
    this.vfx.blast(this.px, this.py, "#b06bff", "#f5c96b", 120, 2);
    for (let i = 0; i < 5; i++) this.vfx.wisp(this.px, this.py, "#f5c96b");
    this.vfx.aura(this.px, this.py, "#b06bff", 190);
    /* Patch 10.0 — a death inside the endless echo still counts as a triumph
       (the rift WAS sealed); stats.endless flags the deeper run on the
       game-over screen. */
    const stats = this.buildStats(this.endless, this.endless);
    this.goTimer = window.setTimeout(() => {
      this.goTimer = undefined;
      if (!this.destroyed) this.o.onPhase("gameover", { stats });
    }, 900);
  }

  /* --------------------------------- juice --------------------------------- */

  private puff(x: number, y: number, color: string, spd: number, size: number) {
    if (this.particles.length > this.particleCap) return;
    const a = Math.random() * TAU;
    const v = Math.random() * spd;
    const p = this.takeParticle();
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
    p.life = 0.4 + Math.random() * 0.45; p.maxLife = 0.85;
    p.size = size * (0.6 + Math.random() * 0.8);
    p.color = color; p.drag = 3.2; p.glow = true; p.grav = 0;
    this.particles.push(p);
  }

  /** Task 2-b — pop a particle from the free list (or allocate on first fill).
      Field order in callers preserves the exact Math.random() call sequence. */
  private takeParticle(): Particle {
    const p = this.particlePool.pop();
    if (p) return p;
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, color: "", drag: 0, glow: false, grav: 0 };
  }

  private ring(x: number, y: number, maxR: number, color: string, w: number) {
    /* V1.3 — routed through the vfx shockwave pool: dual eased stroke with
     a segmented variant for the big ones (same call signature as always). */
    this.vfx.shock(x, y, maxR, color, w, maxR > 44 ? 5 : 0);
  }

  private floater(x: number, y: number, text: string, color: string, size: number) {
    if (this.floaters.length > 70) this.floaters.shift();
    this.floaters.push({ x, y, text, color, life: 0.85, maxLife: 0.85, size });
  }

  private shakeIt(n: number) {
    if (this.reducedMotion || !this.o.settings.screenShake) return;  // accessibility + settings
    /* V1.3 — trauma shake: the old linear amplitude becomes trauma (n/26 of
     the 0..1 range), squared inside juice → punchy start, smooth stop. */
    this.juice.addTrauma(n / 26);
  }

  /* -------------------- V1.3 trail / sprite / quality helpers ------------------- */

  /** Ribbon trail factory — every traveling bolt gets a tapered comet tail;
   *  void rifts carry the longest, fastest-healing ribbon. */
  private mkTrail(kind: ElementId): Trail | null {
    switch (kind) {
      case "fire": case "ice": case "arcane": case "blood": case "nature": case "wind":
        return new Trail(9);
      case "void":
        return new Trail(12);
      default:
        return null;      // earth/lightning never travel as bolts
    }
  }

  /** Precomposed trail fill (hex is a valid fillStyle — no per-frame strings). */
  private trailFill(kind: ElementId): string {
    let s = this.trailFills.get(kind);
    if (!s) { s = SPELLS[kind].color; this.trailFills.set(kind, s); }
    return s;
  }

  /** Per-element trail ribbon width (world px at the head). */
  private trailW(kind: ElementId): number {
    switch (kind) {
      case "fire": return 17;
      case "void": return 24;
      case "blood": return 13;
      case "nature": return 12;
      case "arcane": return 10;
      default: return 8;    // ice / wind read best thin
    }
  }

  /** Cached under-glow sprite for an enemy (affix tint for elites). */
  private enemyGlow(e: Enemy): HTMLCanvasElement {
    if (!e.gspr) e.gspr = this.vfx.glowSpr(e.affix ? ELITE_DEFS[e.affix].color : e.glow);
    return e.gspr;
  }

  /** V1.3 — ADAPTIVE QUALITY: EMA frame-time monitor with hysteresis.
     >21 ms sustained (~45 frames) steps effect density down 0.2; ~4 s back
     under 15.5 ms steps it up. The device class caps the ceiling. */
  private adaptQuality(rawDt: number): void {
    this.frameEma = this.frameEma * 0.92 + rawDt * 1000 * 0.08;
    if (this.frameEma > 21) { this.lowFrames++; this.hiFrames = 0; }
    else if (this.frameEma < 15.5) { this.hiFrames++; this.lowFrames = 0; }
    else { this.lowFrames = Math.max(0, this.lowFrames - 1); this.hiFrames = Math.max(0, this.hiFrames - 1); }
    if (this.lowFrames >= 45 && this.qualityAuto > 0.4) {
      this.qualityAuto = Math.max(0.4, this.qualityAuto - 0.2);
      this.lowFrames = 0;
      this.applyVfxQuality();
    } else if (this.hiFrames >= 240 && this.qualityAuto < 1) {
      this.qualityAuto = Math.min(1, this.qualityAuto + 0.2);
      this.hiFrames = 0;
      this.applyVfxQuality();
    }
  }

  private applyVfxQuality(): void {
    const base = this.deviceClass === "phone" ? 0.7 : this.deviceClass === "tablet" ? 0.85 : 1;
    this.vfx.quality = Math.min(base, this.qualityAuto);
  }

  /* --------------------------------- frame --------------------------------- */

  private frame(rawDt: number) {
    let dt = rawDt;
    if (this.hitStop > 0) { this.hitStop -= rawDt; dt *= 0.06; }
    /* V1.3 — boss-kill slow motion: gameplay time dilates while the effects
     (blasts, wisps, smoke) keep breathing at full rate. */
    dt *= this.juice.timeScale;
    /* Patch 5.0: spelloffer + mergeoffer freeze the arena (like intermission)
       so the player isn't fighting while reading the cards. Render still
       ticks so the overlay can fade in smoothly.
       Patch 10.0: the EPILOGUE runs the same frozen-arena update at 0.4× —
       enemies stand still (updateEnemy gates on running) but the celebration
       rings/puffs keep breathing behind the credit roll. */
    if (this.phase === "running" || this.phase === "gameover" || this.phase === "intermission" || this.phase === "epilogue") {
      this.t += this.phase === "running" ? dt : dt * 0.4;
      this.update(dt);
    }
    this.juice.update(rawDt);
    this.vfx.update(this.phase === "running" ? dt : rawDt);
    this.redFlash = Math.max(0, this.redFlash - rawDt * 1.4);
    this.render();
    this.hudTick ^= 1;
    if (this.hudTick === 0) this.pushHud();
    this.adaptQuality(rawDt);
  }

  private update(dt: number) {
    const running = this.phase === "running";

    /* compact dead entities from last frame (in place, no allocation) */
    this.compactAll();

    /* Patch 9.0 — camera + pathfinding services tick first so everything
       downstream (steering, aim transform) sees the current frame's state. */
    this.updateCamera(dt);
    this.flowClock += dt;
    const pcx = Math.max(0, Math.min(FLOW_GW - 1, Math.floor(this.px / FLOW_CELL)));
    const pcy = Math.max(0, Math.min(FLOW_GH - 1, Math.floor(this.py / FLOW_CELL)));
    const cell = pcy * FLOW_GW + pcx;
    if (cell !== this.flowCell || this.flowClock > 0.5) {
      this.flowClock = 0;
      this.rebuildFlowField();
    }

    /* --- player --- */
    if (running && this.hp > 0) {
      /* Patch 8.0 — Archmage Mode autopilot ticks before movement so its
         steering vector is what the movement code below consumes. */
      if (this.auto) this.autopilot(dt);
      let ax = 0, ay = 0;
      /* touch movement axis takes precedence when active; keyboard otherwise */
      if (this.moveAxisX !== 0 || this.moveAxisY !== 0) {
        ax = this.moveAxisX;
        ay = this.moveAxisY;
      } else {
        if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) ax -= 1;
        if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) ax += 1;
        if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) ay -= 1;
        if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) ay += 1;
      }
      const n = Math.sqrt(ax * ax + ay * ay);
      const mag = Math.min(1, n);  // analog magnitude preserved for touchpads
      if (n > 0.001) { ax /= n; ay /= n; }
      const spd = 252 * this.o.bonuses.moveSpeed * this.mods.speed;
      /* Patch 10.0 — FLUID MOVEMENT:
         • faster ramp (×13) with a softer drag floor (6.4) — the mage
           reaches stride in ~0.12s but coasts a breath when you let go,
           reading as weight instead of ice.
         • TURN-ASSIST — when the input opposes the current velocity, an
           extra braking impulse kills the old vector first, so direction
           changes bite immediately (skid-to-turn, no sliding wide).
         • the dash keeps its low-drag glide untouched. */
      const turn = this.dashT <= 0 && (ax !== 0 || ay !== 0)
        ? (this.pvx * ax + this.pvy * ay) / (Math.sqrt(this.pvx * this.pvx + this.pvy * this.pvy) + 1e-6)
        : 1;
      const turnBrake = turn < -0.25 ? 2.6 : 1;   // input fights velocity → brake hard
      this.pvx += ax * spd * 13 * dt * mag;
      this.pvy += ay * spd * 13 * dt * mag;
      const drag = this.dashT > 0 ? 0.6 : 6.4 * turnBrake;
      this.pvx -= this.pvx * Math.min(1, drag * dt);
      this.pvy -= this.pvy * Math.min(1, drag * dt);
      const vmax = this.dashT > 0 ? 900 : spd;
      const v = Math.sqrt(this.pvx * this.pvx + this.pvy * this.pvy);
      if (v > vmax) { this.pvx = (this.pvx / v) * vmax; this.pvy = (this.pvy / v) * vmax; }
      this.px += this.pvx * dt; this.py += this.pvy * dt;
      /* Patch 10.0 — smoothed lean angle for the render pass (velocity tilt)
         + occasional step dust while striding. */
      const targetLean = Math.atan2(this.pvy, this.pvx);
      if (v > 30) {
        let d = targetLean - this.leanA;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        this.leanA += d * Math.min(1, 9 * dt);
      } else {
        this.leanA += (0 - this.leanA) * Math.min(1, 5 * dt);
      }
      this.stepDust -= dt;
      if (v > spd * 0.62 && this.stepDust <= 0 && this.particles.length < 40) {
        this.stepDust = 0.16;
        const p = this.takeParticle();
        p.x = this.px - Math.cos(this.leanA) * 10; p.y = this.py - Math.sin(this.leanA) * 10 + 8;
        p.vx = -this.pvx * 0.06 + (Math.random() - 0.5) * 18;
        p.vy = -this.pvy * 0.06 + (Math.random() - 0.5) * 18;
        p.life = 0.3 + Math.random() * 0.2; p.maxLife = 0.5;
        p.size = 2 + Math.random() * 1.6;
        p.color = "rgba(154,123,255,0.5)"; p.drag = 2.4; p.glow = false; p.grav = 0;
        this.particles.push(p);
      }
      this.px = Math.max(16, Math.min(WORLD_W - 16, this.px));
      this.py = Math.max(16, Math.min(WORLD_H - 16, this.py));
      this.resolvePlayerPillars();
      if (this.dashT > 0) {
        this.dashT -= dt;
        this.ghosts.push({ x: this.px, y: this.py, life: 0.3 });
      }
      this.mana = Math.min(this.maxMana, this.mana + 7 * this.o.bonuses.manaRegen * this.mods.manaRegen * dt);
      /* Patch 4.0: regen boon removed — no passive HP regen. */
      /* Patch 9.0 — the FIRE button aims for you: while held, keep the aim
         point locked onto the best target (boss/ranged-weighted, led). */
      if (this.mDown && this.fireAuto) this.autoTargetAim();
      if (this.mDown) this.castSpell(this.selected);
      if (this.rDown) this.weaveBolt();

      /* hazards — Patch 6.0: eased by DIFFICULTY_MULT and armor like all damage */
      for (const hz of this.arena.hazards) {
        const hx = hz.x, hy = hz.y;
        const dx = this.px - hx, dy = this.py - hy;
        if (dx * dx + dy * dy < hz.r * hz.r) {
          this.hp -= (8 + this.wave) * DIFFICULTY_MULT * this.mods.dr * (this.mercyDr > 0 ? 1 - this.mercyDr : 1) * dt;
          if (Math.random() < dt * 8) this.puff(this.px, this.py, "#b06bff", 60, 2);
          if (this.hp <= 0) { this.hp = 0; this.die(); break; }
        }
      }
      /* fountains */
      for (const f of this.arena.fountains) {
        if (f.used) continue;
        const fx = f.x, fy = f.y;
        const dx = this.px - fx, dy = this.py - fy;
        if (dx * dx + dy * dy < 30 * 30) {
          f.used = true;
          this.o.sfx.pickup();
          if (f.kind === "health") { this.healPlayer(this.maxHp * 0.4); this.floater(fx, fy - 20, "+" + Math.round(this.maxHp * 0.4), "#7ed957", 17); }
          else { this.mana = this.maxMana; this.floater(fx, fy - 20, "MANA RESTORED", "#43e8d8", 15); }
          this.ring(fx, fy, 60, f.kind === "health" ? "#ff4d6b" : "#43e8d8", 3);
        }
      }

      /* Patch 4.0: removed HP-fountain (no health fountain anymore); the
         mana fountain stays. (The loop above still iterates the fountains
         array but generateArena now only ever emits the mana kind.) */

      /* rift shrine — transmutation on touch. Patch 6.0: offers reference
         the player's EQUIPPED spells only. V1.0 final: fair-cycling weights
         rotate the transmutation draft; shrines can't spawn in State B, but
         a live merge inside the shrine's lifetime still resolves safely. */
      if (this.shrine) {
        const s = this.shrine;
        const dx = this.px - s.x, dy = this.py - s.y;
        if (dx * dx + dy * dy < 34 * 34) {
          this.shrine = null;
          if (!this.maxTierLoadout()) {
            const choices = offerEvolutions(this.rng, this.evolutions, this.equippedSet(), this.evoOffered);
            for (const c of choices) this.evoOffered[c.id] = (this.evoOffered[c.id] ?? 0) + 1;
            if (choices.length > 0) {
              this.pendingAfter = "resume";
              this.phase = "evolution";
              this.o.onPhase("evolution");
              this.o.onEvolution(choices);
            } else {
              this.score += 150;
              this.o.onBanner("THE SHRINE COLLAPSES", "+150 score — nothing left to transmute", "#43e8d8");
            }
          } else {
            this.score += 150;
            this.o.onBanner("THE SHRINE COLLAPSES", "+150 score — nothing left to transmute", "#43e8d8");
          }
        }
      }

      /* Patch 4.0 — spell-drop glyph pickup (heal + open offer overlay). */
      for (const d of this.spellDrops) {
        if (d.life <= 0) continue;
        const dx = this.px - d.x, dy = this.py - d.y;
        if (dx * dx + dy * dy < 30 * 30) {
          d.life = 0;
          this.pickUpDrop(d);
          break;
        }
      }
    }

    /* timers */
    for (let i = 0; i < N_SPELLS; i++) this.cd[i] = Math.max(0, this.cd[i] - dt);
    this.boltCd = Math.max(0, this.boltCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    if (this.shrine) {
      this.shrine.life -= dt;
      if (Math.random() < dt * 12) this.puff(this.shrine.x + (Math.random() * 36 - 18), this.shrine.y + (Math.random() * 36 - 18), "#43e8d8", 40, 2.2);
      if (this.shrine.life <= 0) {
        this.ring(this.shrine.x, this.shrine.y, 60, "#43e8d8", 2);
        this.shrine = null;
      }
    }
    if (this.surgeT > 0) {
      this.surgeT -= dt;
      if (Math.random() < dt * 26) this.puff(this.px + (Math.random() * 30 - 15), this.py + (Math.random() * 30 - 15), Math.random() < 0.5 ? "#f5c96b" : "#ffe9ad", 60, 2.4);
      if (this.surgeT <= 0) { this.surgeT = 0; this.weaveFullCued = false; }
    }
    if (this.attune) { this.attune.t -= dt; if (this.attune.t <= 0) this.attune = null; }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) { this.ghosts[i] = this.ghosts[this.ghosts.length - 1]; this.ghosts.pop(); }
    }

    /* --- waves: capped spawn director (head-indexed queue) --- */
    let anyAlive = false;
    if (running) {
      this.spawnClock += dt;
      /* Patch 9.0: Rift Mercy thins the live crowd (fewer simultaneous foes). */
      const cap = Math.max(6, Math.round(spawnCap(this.wave) * (1 - this.mercyDr * MERCY_CAPLIVE)));
      while (this.sqHead < this.spawnQueue.length && this.spawnQueue[this.sqHead].t <= this.spawnClock) {
        if (this.spawnQueue[this.sqHead].type !== "boss" && this.enemies.length >= cap) break;
        this.spawnEnemy(this.spawnQueue[this.sqHead].type);
        this.sqHead++;
      }
      if (this.sqHead >= this.spawnQueue.length) {
        for (let i = 0; i < this.enemies.length; i++) {
          if (!this.enemies[i].dead) { anyAlive = true; break; }
        }
        if (!anyAlive && this.wave > 0) {
          this.completeWave();
        }
      }
    }

    /* --- enemies --- */
    for (const e of this.enemies) {
      if (!e.dead) this.updateEnemy(e, dt, running);
    }

    /* separation */
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) / 2;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }

    /* --- projectiles --- */
    /* V1.3 — rebuild the enemy broadphase AFTER all movement this tick so
       the projectile loop queries live positions. */
    this.rebuildEnemyGrid();
    for (const p of this.projs) this.updateProj(p, dt);
    this.compact(this.projs, this.aliveProj);

    /* enemy bolts — rewind bubbles crawl them to a tenth speed */
    for (const b of this.eBolts) {
      let boltSlow = 1;
      for (let bi = 0; bi < this.bubbles.length; bi++) {
        const bb = this.bubbles[bi];
        if (!bb.rewind) continue;
        const dx = b.x - bb.x, dy = b.y - bb.y;
        if (dx * dx + dy * dy < bb.r * bb.r) { boltSlow = 0.12; break; }
      }
      b.x += b.vx * dt * boltSlow; b.y += b.vy * dt * boltSlow; b.life -= dt * boltSlow;
      /* V1.3 — enemy bolts drag a short violet ribbon. */
      if (!b.tr) b.tr = new Trail(7);
      b.tr.push(b.x, b.y);
      if (b.x < -30 || b.x > WORLD_W + 30 || b.y < -30 || b.y > WORLD_H + 30) b.life = 0;
      for (const r of this.rocks) {
        const dx = b.x - r.x, dy = b.y - r.y;
        const rr = r.r + b.r;
        if (dx * dx + dy * dy < rr * rr) { r.hp -= 12; b.life = 0; this.puff(b.x, b.y, "#c9955a", 60, 2); break; }
      }
      if (b.life > 0 && this.circleRectHit(b.x, b.y, b.r)) b.life = 0;
      if (b.life > 0) {
        const dx = b.x - this.px, dy = b.y - this.py;
        const rr = 13 + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          this.damagePlayer(b.dmg, b.x - b.vx * 0.02, b.y - b.vy * 0.02);
          b.life = 0;
        }
      }
    }
    this.compact(this.eBolts, this.aliveBolt);

    /* rocks / bubbles — tremor wards pulse damage every second */
    const tremor = this.evoModFor("earth")?.special === "tremor";
    for (const r of this.rocks) {
      r.life -= dt;
      r.tick -= dt;
      if (tremor && r.tick <= 0) {
        r.tick = 1;
        const tr = r.r + 46;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.x - r.x, dy = e.y - r.y;
          if (dx * dx + dy * dy < tr * tr) this.damageEnemy(e, 14 * this.mods.power * this.att, "earth", false);
        }
        this.ring(r.x, r.y, tr, "#c9955a", 2);
      }
      if (r.life < 1 && Math.random() < dt * 6) this.puff(r.x + (Math.random() * 20 - 10), r.y + (Math.random() * 20 - 10), "#8a6f5a", 30, 2);
    }
    this.compact(this.rocks, this.aliveRock);
    for (const b of this.bubbles) {
      b.life -= dt;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        const rr = b.r + e.r;
        if (dx * dx + dy * dy < rr * rr && Math.random() < dt * 3) this.puff(e.x, e.y, "#6bf0c2", 40, 2);
      }
    }
    this.compact(this.bubbles, this.aliveBubble);

    /* poison clouds */
    for (const cl of this.clouds) {
      cl.life -= dt;
      cl.tick -= dt;
      if (cl.tick <= 0) {
        cl.tick = 0.5;
        let any = false;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.x - cl.x, dy = e.y - cl.y;
          const rr = cl.r + e.r;
          if (dx * dx + dy * dy < rr * rr) {
            this.damageEnemy(e, cl.dps * 0.5, "nature", false);
            e.poisonT = 1.0;
            any = true;
          }
        }
        if (any) this.o.sfx.poison();
      }
      if (Math.random() < dt * 10) this.puff(cl.x + (Math.random() * cl.r * 1.6 - cl.r * 0.8), cl.y + (Math.random() * cl.r * 1.6 - cl.r * 0.8), "#7ed957", 26, 2.2);
    }
    this.compact(this.clouds, this.aliveCloud);

    /* motes */
    for (const m of this.motes) {
      m.life -= dt;
      const dx = this.px - m.x, dy = this.py - m.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 110 && d > 0.01) { m.vx += (dx / d) * 900 * dt; m.vy += (dy / d) * 900 * dt; }
      m.vx -= m.vx * Math.min(1, 2.4 * dt); m.vy -= m.vy * Math.min(1, 2.4 * dt);
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (d < 20) {
        m.life = 0;
        this.score += m.val;
        /* V1.0 — THE GLYPH LEDGER: every mote is one aether glyph. The pickup
           registers live (HUD counter) and is paid out post-game. */
        this.runGlyphs++;
        this.o.sfx.pickup();
        this.floater(m.x, m.y - 10, "+" + m.val, "#ffe9ad", 12);
      }
    }
    this.compact(this.motes, this.aliveMote);
    if (this.motes.length > 130) this.motes.splice(0, this.motes.length - 130);

    /* Patch 4.0 — spell-drop glyphs: float upward, bob in place, and
       gently drift toward the player when nearby so they're easy to grab. */
    for (const d of this.spellDrops) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.wob += dt * 4;
      const dx = this.px - d.x, dy = this.py - d.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 220 * 220 && dist2 > 1) {
        const dist = Math.sqrt(dist2);
        d.vx += (dx / dist) * 220 * dt;
        d.vy += (dy / dist) * 220 * dt;
      }
      d.vx -= d.vx * Math.min(1, 2.2 * dt);
      d.vy -= d.vy * Math.min(1, 2.2 * dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt + Math.sin(d.wob) * 6 * dt;
      d.x = Math.max(16, Math.min(WORLD_W - 16, d.x));
      d.y = Math.max(16, Math.min(WORLD_H - 16, d.y));
      /* Patch 11.0 — kind-aware idle sparkle: element glow for spell tears,
         crimson motes for hearts, prismatic gold/violet for resonance orbs. */
      if (Math.random() < dt * 14) {
        const col = d.kind === "heart" ? "#ffa3b5" : d.kind === "resonance" ? (Math.random() < 0.5 ? "#ffe9ad" : "#b06bff") : SPELLS[d.id].glow;
        this.puff(d.x, d.y, col, 30, 1.8);
      }
    }
    this.compact(this.spellDrops, this.aliveDrop);
    if (this.spellDrops.length > 12) this.spellDrops.splice(0, this.spellDrops.length - 12);

    /* fx */
    for (const p of this.particles) {
      p.life -= dt;
      p.vx -= p.vx * Math.min(1, p.drag * dt);
      p.vy -= p.vy * Math.min(1, p.drag * dt);
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.compactParticles();
    for (const f of this.floaters) { f.life -= dt; f.y -= 34 * dt; }
    this.compact(this.floaters, this.aliveFloater);
    for (const b of this.beams) b.life -= dt;
    this.compact(this.beams, this.aliveBeam);
    for (const z of this.zaps) z.life -= dt;
    this.compact(this.zaps, this.aliveZap);
  }

  /* In-place compaction helper — keeps surviving entries, zeroes allocation. */
  private compact<T>(arr: T[], alive: (v: T) => boolean) {
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (alive(v)) arr[w++] = v;
    }
    arr.length = w;
  }

  /* Task 2-b — particle compaction with free-list recycling: dead entries
     return to the pool (capped) instead of leaking to the GC. Survivor order
     is identical to the generic compact(). */
  private compactParticles() {
    const arr = this.particles, pool = this.particlePool;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (p.life > 0) { arr[w++] = p; continue; }
      if (pool.length < PARTICLE_POOL_MAX) {
        /* reset so the pooled particle holds no stale references */
        p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.life = 0; p.maxLife = 0;
        p.size = 0; p.color = ""; p.drag = 0; p.glow = false; p.grav = 0;
        pool.push(p);
      }
    }
    arr.length = w;
  }

  private compactAll() {
    this.compact(this.enemies, this.aliveEnemy);
  }

  /* Task 2-b — hoisted compaction predicates: the inline arrow at each call
     site allocated a fresh closure every tick (12+/frame). Pure parameter
     reads, results identical. */
  private aliveProj(p: Proj) { return p.life > 0; }
  private aliveBolt(b: EBolt) { return b.life > 0; }
  private aliveRock(r: Rock) { return r.life > 0 && r.hp > 0; }
  private aliveBubble(b: Bubble) { return b.life > 0; }
  private aliveCloud(c: Cloud) { return c.life > 0; }
  private aliveMote(m: Mote) { return m.life > 0; }
  private aliveDrop(d: SpellDrop) { return d.life > 0; }
  private aliveFloater(f: Floater) { return f.life > 0; }
  private aliveBeam(b: Beam) { return b.life > 0; }
  private aliveZap(z: Zap) { return z.life > 0; }
  private aliveEnemy(e: Enemy) { return !e.dead; }
  /* Task 2-b — same hoist for the autopilot's live-drop probe (was a fresh
     closure every frame while Archmage Mode idles). */
  private dropLive(d: SpellDrop) { return d.life > 0; }

  private updateEnemy(e: Enemy, dt: number, running: boolean) {
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    /* V1.3 — hit-squash timer drains in the same place (drawEnemy springs
       the body back as it decays). */
    if (e.sq > 0) e.sq = Math.max(0, e.sq - dt);
    e.contactCd = Math.max(0, e.contactCd - dt);
    /* Patch 10.2 — the generic wobble is for rendering bobbing/flap; bosses
       are exempt because Ashgorim OWNS wob as his shockwave radius now. */
    if (e.type !== "boss") e.wob += dt * 6;
    if (e.poisonT > 0) e.poisonT -= dt;
    if (e.burnT > 0) {
      e.burnT -= dt;
      e.hp -= e.burnDps * dt;
      this.runDamage += e.burnDps * dt;
      if (Math.random() < dt * 10) this.puff(e.x, e.y - e.r * 0.4, "#ff7847", 50, 2.2);
      if (e.hp <= 0) { this.killEnemy(e); return; }
    }
    if (e.chillT > 0) e.chillT -= dt;

    /* leech elites pulse-heal their pack */
    if (e.affix === "leech" && running) {
      e.auraT -= dt;
      if (e.auraT <= 0) {
        e.auraT = 0.7;
        for (const o of this.enemies) {
          if (o === e || o.dead || o.hp >= o.maxHp) continue;
          const dx = o.x - e.x, dy = o.y - e.y;
          if (dx * dx + dy * dy < 130 * 130) {
            o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.03);
            if (Math.random() < 0.4) this.puff(o.x, o.y, "#d05bff", 40, 2);
          }
        }
      }
    }

    /* chrono bubbles freeze */
    let slow = 1;
    if (e.chillT > 0) slow *= 0.55;
    if (e.poisonT > 0) slow *= 0.72;
    for (const b of this.bubbles) {
      const dx = e.x - b.x, dy = e.y - b.y;
      if (dx * dx + dy * dy < b.r * b.r) { slow *= 0.1; break; }
    }
    /* strangling spores drag foes to half speed inside the cloud */
    for (let ci = 0; ci < this.clouds.length; ci++) {
      const cl = this.clouds[ci];
      if (!cl.slow) continue;
      const dx = e.x - cl.x, dy = e.y - cl.y;
      if (dx * dx + dy * dy < cl.r * cl.r) { slow *= 0.55; break; }
    }

    if (!running) { e.vx *= 0.9; e.vy *= 0.9; return; }

    const dx = this.px - e.x, dy = this.py - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    let tvx = nx * e.speed, tvy = ny * e.speed;

    /* Patch 9.0 — PATHFINDING. When a pillar blocks the direct line to the
       player, ground enemies steer along the flow field (BFS distance map)
       instead of grinding against the wall. The blend keeps a little direct
       pull so the approach still feels like pursuit. Flying foes skip this —
       they float over everything. */
    if (!e.flying) {
      if (!this.lineClear(e.x, e.y, this.px, this.py)) {
        const fd = ArchmageEngine.DIR;
        if (this.flowDir(e.x, e.y, fd)) {
          tvx = (fd.x * 0.85 + nx * 0.15) * e.speed;
          tvy = (fd.y * 0.85 + ny * 0.15) * e.speed;
        }
      }
      /* stuck safety net — Patch 10.2 hardening: a 0.6s window with a 14px
         moved floor, escalating velocity kicks along the flow field, and a
         last-resort RIFT HOP (a tiny relocation to the open spawn ring) so
         terrain can never weld a foe in place. (Bosses are exempt; their
         bespoke states handle walls.) */
      e.stuckT += dt;
      if (e.stuckT >= 0.6) {
        const moved = Math.sqrt((e.x - e.lastX) ** 2 + (e.y - e.lastY) ** 2);
        if (moved < 14 && e.type !== "boss") {
          e.stuckN++;
          const fd = ArchmageEngine.DIR;
          if (this.flowDir(e.x, e.y, fd)) {
            const kick = e.stuckN >= 2 ? 2.8 : 1.6;
            e.vx += fd.x * e.speed * kick;
            e.vy += fd.y * e.speed * kick;
          } else {
            /* unreached (walled pocket) — alternate perpendicular shuffles */
            e.strafeDir = -e.strafeDir;
            e.vx += -ny * e.speed * 1.4 * e.strafeDir;
            e.vy += nx * e.speed * 1.4 * e.strafeDir;
          }
          if (e.stuckN >= 4) this.riftHop(e);
        } else {
          e.stuckN = 0;
        }
        e.lastX = e.x; e.lastY = e.y; e.stuckT = 0;
      }
    }

    /* per-type behavior */
    if (e.type === "assassin") {
      e.actT -= dt;
      if (e.actState === 0 && e.actT <= 0 && dist < 260) { e.actState = 1; e.actT = 0.3; e.cx = nx; e.cy = ny; }
      if (e.actState === 1) {
        tvx = e.cx * e.speed * 3.6; tvy = e.cy * e.speed * 3.6;
        if (e.actT <= 0) { e.actState = 0; e.actT = 2.6; }
      }
    } else if (e.type === "timewalker") {
      e.actT -= dt;
      if (e.actT <= 0 && dist > 90) {
        e.actT = 3.2;
        for (let i = 0; i < 8; i++) this.puff(e.x, e.y, "#6bf0c2", 90, 2.6);
        /* blink along the flow field when the direct hop would cross a
           pillar, so the walker never teleports INTO the scenery */
        const hop = Math.min(70, dist - 40);
        let hx = nx, hy = ny;
        if (!this.lineClear(e.x, e.y, e.x + nx * hop, e.y + ny * hop)) {
          const fd = ArchmageEngine.DIR;
          if (this.flowDir(e.x, e.y, fd)) { hx = fd.x; hy = fd.y; }
        }
        e.x += hx * hop;
        e.y += hy * hop;
        this.ring(e.x, e.y, 30, "#6bf0c2", 2);
      }
    } else if (e.type === "skitter") {
      /* Patch 9.0 — Gloom Skitter: fast, cheap, jittery pursuit. Darts in a
         weaving path so lone skitters are hard to kite in a straight line. */
      const weave = Math.sin(e.wob * 2.6) * 0.55;
      tvx = (nx - ny * weave) * e.speed;
      tvy = (ny + nx * weave) * e.speed;
    } else if (e.type === "bomber") {
      /* Patch 9.0 — Pyrehusk: kamikaze. Closes in, then lights a
         0.75s fuse (flashing ring) and detonates in a heavy AoE. Killing it
         before the fuse burns out cancels the blast. */
      e.actT -= dt;
      if (e.actState === 0) {
        if (dist < 130) { e.actState = 1; e.actT = 0.75; this.o.sfx.elite(); }
      } else if (e.actState === 1) {
        tvx *= 0.22; tvy *= 0.22;
        if (Math.random() < dt * 30) this.puff(e.x, e.y, Math.random() < 0.5 ? "#ff6b3d" : "#ffe86b", 70, 2.6);
        if (e.actT <= 0) {
          /* detonate */
          const R = 115;
          this.ring(e.x, e.y, R, "#ff6b3d", 5);
          this.ring(e.x, e.y, R * 0.6, "#ffe86b", 3);
          this.shakeIt(9);
          this.o.sfx.castVoid();
          for (let i = 0; i < 22; i++) this.puff(e.x, e.y, i % 2 ? "#ff6b3d" : "#ffe86b", 300, 4);
          const pdx = this.px - e.x, pdy = this.py - e.y;
          if (pdx * pdx + pdy * pdy < R * R) this.damagePlayer(e.damage * 2.2, e.x, e.y);
          e.hp = 0;
          this.killEnemy(e);
          return;
        }
      }
    } else if (e.type === "lancer") {
      /* Patch 9.0 — Abyssal Lancer: telegraphed skewer charge. Holds a medium
         band, flashes a lane telegraph, then dashes through the player's
         position at 4× speed. */
      e.actT -= dt;
      if (e.actState === 0) {
        const want = 300;
        if (dist < want - 70) { tvx = -nx * e.speed; tvy = -ny * e.speed; }
        else if (dist > want + 80) { tvx = nx * e.speed; tvy = ny * e.speed; }
        else { tvx = -ny * e.speed * 0.5 * e.strafeDir; tvy = nx * e.speed * 0.5 * e.strafeDir; }
        if (e.actT <= 0 && dist < 560) { e.actState = 1; e.actT = 0.55; }
      } else if (e.actState === 1) {
        tvx *= 0.08; tvy *= 0.08;
        if (e.actT <= 0) {
          e.actState = 2; e.actT = 0.5;
          e.cx = nx; e.cy = ny;
          this.o.sfx.castShadow();
        }
      } else {
        tvx = e.cx * e.speed * 4.4; tvy = e.cy * e.speed * 4.4;
        if (Math.random() < dt * 26) this.puff(e.x, e.y, "#43e8d8", 120, 3);
        if (e.actT <= 0) { e.actState = 0; e.actT = 2.4 + Math.random() * 1.2; }
      }
    } else if (e.type === "warden") {
      /* Patch 9.0 — Tempest Herald: orbits at bolt range and fires 3-way
       spreads. Never stops strafing — its dance is the tell. */
      const want = 280;
      if (dist < want - 60) { tvx = -nx * e.speed; tvy = -ny * e.speed; }
      else if (dist > want + 80) { tvx = nx * e.speed; tvy = ny * e.speed; }
      else { tvx = -ny * e.speed * 1.05 * e.strafeDir; tvy = nx * e.speed * 1.05 * e.strafeDir; }
      e.shootT -= dt;
      if (e.shootT <= 0 && dist < 620) {
        e.shootT = e.shootsEvery * (0.85 + Math.random() * 0.3);
        const base = Math.atan2(this.py - e.y, this.px - e.x);
        const sp = 236;
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.22;
          this.eBolts.push({ x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, dmg: e.damage * 0.7, life: 3.4, color: e.glow });
        }
        this.o.sfx.hit();
      }
    } else if (e.type === "mender") {
      /* Patch 9.0 — Corpseweaver: field medic. Keeps its distance and lances
         healing light into the most wounded ally (elites and bosses first).
         If everyone is healthy it plinks a bolt at the player instead —
         kill it early or the pack never dies. */
      const want = 340;
      if (dist < want - 60) { tvx = -nx * e.speed; tvy = -ny * e.speed; }
      else if (dist > want + 90) { tvx = nx * e.speed; tvy = ny * e.speed; }
      else { tvx = -ny * e.speed * 0.6 * e.strafeDir; tvy = nx * e.speed * 0.6 * e.strafeDir; }
      e.shootT -= dt;
      if (e.shootT <= 0) {
        let patient: Enemy | null = null;
        let worst = 0.12;                     // only meaningfully-wounded allies
        for (const o of this.enemies) {
          if (o === e || o.dead) continue;
          const odx = o.x - e.x, ody = o.y - e.y;
          if (odx * odx + ody * ody > 360 * 360) continue;
          const missing = 1 - o.hp / o.maxHp;
          const weight = missing + (o.type === "boss" ? 0.35 : o.affix ? 0.2 : 0);
          if (missing > worst && weight > worst) { worst = weight; patient = o; }
        }
        if (patient) {
          e.shootT = e.shootsEvery;
          const healed = patient.maxHp * 0.08;
          patient.hp = Math.min(patient.maxHp, patient.hp + healed);
          this.beams.push({ x1: e.x, y1: e.y, x2: patient.x, y2: patient.y, life: 0.3, maxLife: 0.3, color: "#f2a6ff", w: 4 });
          this.floater(patient.x, patient.y - patient.r - 8, "+" + Math.round(healed), "#f2a6ff", 12);
          for (let i = 0; i < 5; i++) this.puff(patient.x, patient.y, "#ffd6f6", 60, 2.2);
          this.o.sfx.pickup();
        } else {
          /* nothing to mend — hostile plink (V1.1 AUDIT FIX: range-gated like
             every other shooter — the old unlimited range sniped the mage
             from entirely off-screen) */
          if (dist < 560) {
            e.shootT = e.shootsEvery * 1.4;
            const sp = 220;
            this.eBolts.push({ x: e.x + nx * e.r, y: e.y + ny * e.r, vx: nx * sp, vy: ny * sp, r: 5, dmg: e.damage * 0.8, life: 3, color: e.glow });
            this.o.sfx.hit();
          } else {
            e.shootT = 0.5;   // out of range: re-close before plinking
          }
        }
      }
    } else if (e.ranged) {
      const want = 230;
      if (dist < want - 50) { tvx = -nx * e.speed; tvy = -ny * e.speed; }
      else if (dist > want + 60) { tvx = nx * e.speed; tvy = ny * e.speed; }
      else { tvx = -ny * e.speed * 0.7 * e.strafeDir; tvy = nx * e.speed * 0.7 * e.strafeDir; }
      e.shootT -= dt;
      if (e.shootT <= 0 && dist < 560) {
        e.shootT = e.shootsEvery * (0.85 + Math.random() * 0.3);
        const sp = 232;
        this.eBolts.push({ x: e.x + nx * e.r, y: e.y + ny * e.r, vx: nx * sp, vy: ny * sp, r: 6, dmg: e.damage * 0.75, life: 3.4, color: e.glow });
        this.o.sfx.hit();
      }
    } else if (e.type === "boss") {
      /* Patch 10.2 — every tyrant runs its own bespoke behavior set (see the
         boss brains below). The pattern writes its desired velocity into the
         bossTv scratch; telegraphs are purely visual + audio — no message
         boxes anywhere in a boss fight. */
      this.updateBoss(e, dt, nx, ny, dist);
      tvx = this.bossTv.x;
      tvy = this.bossTv.y;
    }

    const lerp = Math.min(1, (e.type === "boss" ? 2.2 : 5) * dt);
    e.vx += (tvx * slow - e.vx) * lerp;
    e.vy += (tvy * slow - e.vy) * lerp;
    e.x += e.vx * dt; e.y += e.vy * dt;

    if (!e.flying) {
      this.resolvePillar(e);
      for (const r of this.rocks) {
        const dx = e.x - r.x, dy = e.y - r.y;
        const min = e.r + r.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          e.x = r.x + (dx / d) * min;
          e.y = r.y + (dy / d) * min;
        }
      }
    }
    e.x = Math.max(e.r * 0.4, Math.min(WORLD_W - e.r * 0.4, e.x));
    e.y = Math.max(e.r * 0.4, Math.min(WORLD_H - e.r * 0.4, e.y));

    /* contact */
    const cr = e.r + 13;
    if (dist < cr && e.contactCd <= 0) {
      e.contactCd = 0.9;
      this.damagePlayer(e.damage * (e.actState === 2 && e.type === "boss" ? 1.45 : 1), e.x, e.y);
    }
  }

  /* ==========================================================================
     Patch 10.2 — BOSS BRAINS. The single shared charge/volley loop is gone:
     every tyrant is now a fully distinct encounter.
       vorrac   — Stampede Charger: stalks, then chains 2–3 re-aimed charges
                  with a short windup between each; aimed fan volleys.
       korrath  — Immovable Juggernaut: never charges, never strafes — walks
                  you down, slams expanding shockwave rings, sheds cinder imps.
       solenne  — Blade Dancer: orbits at fencing range on a metronome tempo
                  (3-bolt fans that accelerate as she bleeds), then chains
                  lunges THROUGH the mage.
       ysed     — Blink Fortress: anchors and channels rotating twin-arm
                  spiral barrages, then blinks to a fresh anchor around the
                  mage with a landing pulse. Massive soak, positioning puzzle.
       maelthar — The Apex Storm: cycles all three signatures — stampede
                  charges, a multi-arm spiral, and a gravity rift that drags
                  the mage in before the nova release.
     Shared conventions:
       • actState 2 is ALWAYS a dashing/charging state, so the shared
         contact-damage ×1.45 rule keeps working unchanged.
       • subT doubles as a sub-timer/flag, count as a repeat/phase counter,
         armAng as the spiral arm angle, wob as Ashgorim's shockwave radius.
       • Enrage (below half HP) never just speeds old attacks up — each
         pattern densifies or adds (Dead Cells rule).
     ========================================================================== */

  private updateBoss(e: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const tv = this.bossTv;
    tv.x = nx * e.speed; tv.y = ny * e.speed;
    switch (this.currentBoss().id) {
      case "korrath": this.bossAshgorim(e, dt, nx, ny, dist); return;
      case "solenne": this.bossSylthara(e, dt, nx, ny, dist); return;
      case "ysed": this.bossYsolth(e, dt, nx, ny, dist); return;
      case "maelthar": this.bossMordrax(e, dt, nx, ny, dist); return;
      default: this.bossMalgrym(e, dt, nx, ny, dist); return;
    }
  }

  /* VORRAC, the Gate-Sorrow — the Stampede Charger. */
  private bossMalgrym(e: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const tv = this.bossTv;
    e.actT -= dt;
    if (e.actState === 0) {
      /* stalk — a slow drift toward the mage, waiting for the next run */
      tv.x = nx * e.speed * 0.5; tv.y = ny * e.speed * 0.5;
      if (e.actT <= 0 && dist < 640) {
        e.actState = 1; e.actT = 0.55; e.count = e.enraged ? 3 : 2;
        this.o.sfx.bossRoar();
      }
    } else if (e.actState === 1) {
      /* windup — roots and paws the ground; locks on late */
      tv.x = nx * e.speed * 0.08; tv.y = ny * e.speed * 0.08;
      if (Math.random() < dt * 26) this.puff(e.x + (Math.random() * 44 - 22), e.y + e.r * 0.6, "#ffa3b5", 90, 3);
      if (e.actT <= 0) {
        const a = Math.atan2(this.py - e.y, this.px - e.x);
        e.cx = Math.cos(a); e.cy = Math.sin(a);
        e.actState = 2; e.actT = 0.5;
        this.ring(e.x, e.y, 72, e.color, 3);
      }
    } else if (e.actState === 2) {
      /* the charge — a committed lane dash through the mage's position */
      tv.x = e.cx * 470; tv.y = e.cy * 470;
      if (Math.random() < dt * 30) this.puff(e.x, e.y, "#ff4d6b", 120, 4);
      if (e.actT <= 0) {
        e.count--;
        if (e.count > 0) { e.actState = 1; e.actT = 0.26; }   // re-aimed follow-up
        else { e.actState = 0; e.actT = (e.enraged ? 2.6 : 3.6) + Math.random() * 1.4; this.shakeIt(8); }
      }
    }
    /* aimed fan volley — a wide sweep across the mage's lane */
    e.shootT -= dt;
    if (e.shootT <= 0 && e.actState !== 1) {
      e.shootT = e.enraged ? 2.6 : 3.6;
      const base = Math.atan2(this.py - e.y, this.px - e.x);
      const nB = e.enraged ? 7 : 5;
      for (let i = 0; i < nB; i++) {
        const a = base + (i - (nB - 1) / 2) * 0.16;
        this.eBolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 232, vy: Math.sin(a) * 232, r: 6, dmg: e.damage * 0.55, life: 3.6, color: e.glow });
      }
      this.o.sfx.hit();
      this.ring(e.x, e.y, 56, e.color, 2.5);
    }
  }

  /* KORRATH, the Ash-Eaten — the Immovable Juggernaut. */
  private bossAshgorim(e: Enemy, dt: number, nx: number, _ny: number, dist: number) {
    const tv = this.bossTv;
    e.actT -= dt;
    /* relentless walk — no strafe, no charge, no mercy */
    tv.x = nx * e.speed; tv.y = _ny * e.speed;
    /* slam cadence: a swelling telegraph, then the shockwave */
    if (e.actState === 0 && e.actT <= 0) {
      e.actState = 1; e.actT = 0.6; e.subT = 0; e.armAng = 0;
      this.ring(e.x, e.y, 96, e.color, 3);
    } else if (e.actState === 1) {
      /* windup — slows and hunches while the ring swells */
      tv.x *= 0.25; tv.y *= 0.25;
      if (Math.random() < dt * 20) this.puff(e.x + (Math.random() * 64 - 32), e.y + e.r, "#ffb08a", 80, 3);
      if (e.actT <= 0) {
        e.actState = 0; e.actT = e.enraged ? 3.2 : 4.6;
        e.wob = 40; e.subT = 0;                      // shockwave goes live
        this.o.sfx.castEarth();
        this.shakeIt(12);
        this.ring(e.x, e.y, 120, "#ff7847", 5);
      }
    }
    /* the expanding shockwave — a traveling damage band */
    if (e.wob > 0) {
      e.wob += (e.enraged ? 700 : 560) * dt;
      e.armAng -= dt;
      if (e.armAng <= 0) { e.armAng = 0.07; this.ring(e.x, e.y, e.wob, "#ff7847", 3); }
      if (e.subT === 0 && Math.abs(dist - e.wob) < 30) {
        e.subT = 1;
        this.damagePlayer(e.damage, e.x, e.y);
      }
      if (e.wob > 520) e.wob = 0;
    }
    /* sheds cinder imps — the fire follows him */
    e.shootT -= dt;
    if (e.shootT <= 0) {
      e.shootT = e.enraged ? 8 : 12;
      let imps = 0;
      for (const o of this.enemies) if (!o.dead && o.type === "imp") imps++;
      if (imps < (e.enraged ? 6 : 4)) {
        this.spawnEnemy("imp", e.x, e.y);
        this.spawnEnemy("imp", e.x, e.y);
        for (let i = 0; i < 10; i++) this.puff(e.x, e.y, "#ff8a5c", 140, 3);
      }
    }
  }

  /* SOLENNE, the Last Note — the Blade Dancer. */
  private bossSylthara(e: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const tv = this.bossTv;
    e.actT -= dt;
    if (e.actState === 0) {
      /* the dance — tight orbit at fencing range */
      const tX = -ny * e.strafeDir, tY = nx * e.strafeDir;
      const radial = dist > 290 ? 1 : dist < 210 ? -1 : 0;
      tv.x = (tX + nx * radial * 0.9) * e.speed;
      tv.y = (tY + ny * radial * 0.9) * e.speed;
      /* tempo bursts — the metronome accelerates as she bleeds */
      e.shootT -= dt;
      if (e.shootT <= 0) {
        const tempo = 1 - 0.45 * (1 - e.hp / e.maxHp);
        e.shootT = (e.enraged ? 1.5 : 2.2) * tempo * 0.75;
        const base = Math.atan2(this.py - e.y, this.px - e.x);
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.13;
          this.eBolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 5, dmg: e.damage * 0.5, life: 3.2, color: e.glow });
        }
        this.o.sfx.hit();
        this.ring(e.x, e.y, 40, e.color, 2);
      }
      if (e.actT <= 0) { e.actState = 1; e.actT = 0.4; e.count = e.enraged ? 3 : 2; this.o.sfx.bossRoar(); }
    } else if (e.actState === 1) {
      /* lunge telegraph — she lifts the blade along the dash line */
      const tX = -ny * e.strafeDir, tY = nx * e.strafeDir;
      tv.x = tX * e.speed * 0.25; tv.y = tY * e.speed * 0.25;
      if (Math.random() < dt * 30) {
        const a = Math.atan2(this.py - e.y, this.px - e.x);
        const rr = 30 + Math.random() * 220;
        this.puff(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, "#aeeaf5", 60, 2.4);
      }
      if (e.actT <= 0) {
        const a = Math.atan2(this.py - e.y, this.px - e.x);
        e.cx = Math.cos(a); e.cy = Math.sin(a);
        e.actState = 2; e.actT = 0.42;
        this.o.sfx.castShadow();
      }
    } else if (e.actState === 2) {
      /* the lunge — a fencing dash THROUGH the mage's position */
      tv.x = e.cx * 560; tv.y = e.cy * 560;
      if (Math.random() < dt * 34) this.puff(e.x, e.y, "#43e8d8", 130, 3.4);
      if (e.actT <= 0) {
        e.count--;
        if (e.count > 0) { e.actState = 1; e.actT = 0.3; e.strafeDir = Math.random() < 0.5 ? 1 : -1; }
        else { e.actState = 0; e.actT = e.enraged ? 4.5 : 6.5; this.shakeIt(8); }
      }
    }
  }

  /* YSED, the Hour-Cradled — the Blink Fortress. */
  private bossYsolth(e: Enemy, dt: number, nx: number, ny: number, _dist: number) {
    const tv = this.bossTv;
    e.actT -= dt;
    if (e.actState === 0) {
      /* anchored — barely drifts while the spiral turns */
      tv.x = nx * e.speed * 0.12; tv.y = ny * e.speed * 0.12;
      const arms = e.enraged ? 3 : 2;
      e.armAng += (e.enraged ? 2.9 : 2.2) * dt;
      e.subT -= dt;
      if (e.subT <= 0) {
        e.subT = 0.12;
        for (let arm = 0; arm < arms; arm++) {
          const a = e.armAng + (arm / arms) * TAU;
          this.eBolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 205, vy: Math.sin(a) * 205, r: 6, dmg: e.damage * 0.5, life: 4.2, color: e.glow });
        }
        this.o.sfx.hit();
      }
      if (e.actT <= 0) { e.actState = 1; e.actT = 0.45; this.o.sfx.castVoid(); }
    } else if (e.actState === 1) {
      /* folding — implodes before the blink */
      tv.x = 0; tv.y = 0;
      if (Math.random() < dt * 36) {
        const a = Math.random() * TAU;
        this.puff(e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 40, "#e0fff5", 70, 2.6);
      }
      if (e.actT <= 0) {
        /* blink to a fresh anchor 300–380px off the mage, clear of pillars */
        let bx = e.x, by = e.y, ok = false;
        for (let attempt = 0; attempt < 14 && !ok; attempt++) {
          const a = this.rng.next() * TAU;
          const rr = this.rng.range(300, 380);
          bx = Math.max(90, Math.min(WORLD_W - 90, this.px + Math.cos(a) * rr));
          by = Math.max(90, Math.min(WORLD_H - 90, this.py + Math.sin(a) * rr));
          ok = !this.circleRectHit(bx, by, e.r + 10);
        }
        for (let i = 0; i < 14; i++) this.puff(e.x, e.y, "#c0ffeb", 160, 3);
        e.x = bx; e.y = by; e.vx = 0; e.vy = 0;
        e.actState = 2; e.actT = 0.5;
        this.ring(e.x, e.y, 110, e.color, 4);
        this.ring(e.x, e.y, 60, e.glow, 2.5);
        /* landing pulse — a short radial ring punctuates the arrival */
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + this.rng.next() * 0.3;
          this.eBolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 6, dmg: e.damage * 0.5, life: 3.4, color: e.glow });
        }
        this.o.sfx.bossRoar();
      }
    } else if (e.actState === 2) {
      /* recover — one breath, then the spiral resumes (V1.1 AUDIT FIX: the
         spiral's first burst now has a real windup — subT grace + the
         standard charge-glow shootT cue — instead of firing ~0.12s after
         the recover frame with zero warning) */
      tv.x = 0; tv.y = 0;
      if (e.actT <= 0) { e.actState = 0; e.actT = (e.enraged ? 2.6 : 3.6) + this.rng.range(0, 1); e.subT = 0.4; e.shootT = 0.45; }
    }
  }

  /* MAELTHAR, the First Sundering — the Apex Storm. */
  private bossMordrax(e: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const tv = this.bossTv;
    e.actT -= dt;
    if (e.actState === 0) {
      /* hover-strafe — fast orbit, reading the mage */
      const tX = -ny * e.strafeDir, tY = nx * e.strafeDir;
      const radial = dist > 330 ? 1 : dist < 240 ? -1 : 0;
      tv.x = (tX * 1.15 + nx * radial * 0.8) * e.speed;
      tv.y = (tY * 1.15 + ny * radial * 0.8) * e.speed;
      if (e.actT <= 0) {
        e.count = (e.count + 1) % 3;
        if (e.count === 0) { e.actState = 1; e.actT = 0.45; e.subT = e.enraged ? 3 : 2; this.o.sfx.bossRoar(); }
        else if (e.count === 1) { e.actState = 3; e.actT = 2.3; e.subT = 0.4; e.armAng = this.rng.next() * TAU; e.shootT = 0.45; this.o.sfx.castVoid(); }
        else { e.actState = 5; e.actT = 1.7; this.o.sfx.castVoid(); }
      }
    } else if (e.actState === 1) {
      /* stampede windup */
      tv.x = nx * e.speed * 0.1; tv.y = ny * e.speed * 0.1;
      if (e.actT <= 0) {
        const a = Math.atan2(this.py - e.y, this.px - e.x);
        e.cx = Math.cos(a); e.cy = Math.sin(a);
        e.actState = 2; e.actT = 0.42;
        this.ring(e.x, e.y, 80, e.color, 3);
      }
    } else if (e.actState === 2) {
      /* stampede dash — subT counts the remaining charges */
      tv.x = e.cx * 500; tv.y = e.cy * 500;
      if (Math.random() < dt * 32) this.puff(e.x, e.y, "#ff4d6b", 130, 4);
      if (e.actT <= 0) {
        e.subT--;
        if (e.subT > 0) { e.actState = 1; e.actT = 0.22; }
        else { e.actState = 0; e.actT = 2.2 + Math.random(); this.shakeIt(9); }
      }
    } else if (e.actState === 3) {
      /* multi-arm spiral storm while hovering slowly */
      tv.x = nx * e.speed * 0.15; tv.y = ny * e.speed * 0.15;
      const arms = e.enraged ? 4 : 3;
      e.armAng += 2.6 * dt;
      e.subT -= dt;
      if (e.subT <= 0) {
        e.subT = 0.13;
        for (let arm = 0; arm < arms; arm++) {
          const a = e.armAng + (arm / arms) * TAU;
          this.eBolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 6, dmg: e.damage * 0.5, life: 4, color: "#ffe9ad" });
        }
        this.o.sfx.hit();
      }
      if (e.actT <= 0) { e.actState = 0; e.actT = 2 + Math.random(); this.shakeIt(7); }
    } else if (e.actState === 5) {
      /* gravity rift — drags the mage in while the vortex builds */
      tv.x = 0; tv.y = 0;
      const dx = e.x - this.px, dy = e.y - this.py;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d < 700) {
        const pull = 230;
        this.px = Math.max(20, Math.min(WORLD_W - 20, this.px + (dx / d) * pull * dt));
        this.py = Math.max(20, Math.min(WORLD_H - 20, this.py + (dy / d) * pull * dt));
      }
      if (Math.random() < dt * 40) {
        const a = Math.random() * TAU, rr = this.rng.range(60, 260);
        this.puff(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, "#ffe9ad", 60, 2.6);
      }
      if (e.actT <= 0) {
        /* the nova release */
        const nB = e.enraged ? 22 : 16;
        for (let i = 0; i < nB; i++) {
          const a = (i / nB) * TAU + this.rng.next() * 0.2;
          this.eBolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 7, dmg: e.damage * 0.6, life: 4, color: "#ff8ba0" });
        }
        this.ring(e.x, e.y, 200, "#ffe9ad", 5);
        this.ring(e.x, e.y, 120, "#ff4d6b", 3);
        this.o.sfx.castVoid();
        this.shakeIt(14);
        e.actState = 0; e.actT = 2.4 + Math.random();
      }
    }
  }

  private spawnCloud(x: number, y: number, dps: number, opts?: { rMult?: number; lifeMult?: number; dark?: boolean }) {
    const m = this.evoModFor("nature");
    const dark = !!opts?.dark;
    const r = 82 * (opts?.rMult ?? (m?.radius ?? 1));
    const life = 3.6 * (opts?.lifeMult ?? (m?.life ?? 1));
    const slow = !dark && m?.special === "strangling";
    this.clouds.push({ x, y, r, life, maxLife: life, dps: dps * (m?.dmg ?? 1), tick: 0.12, grad: null, slow, dark });
    this.ring(x, y, r, dark ? "#b06bff" : "#7ed957", 3);
    for (let i = 0; i < 12; i++) this.puff(x, y, dark ? (i % 2 ? "#b06bff" : "#6e3fd9") : (i % 2 ? "#7ed957" : "#b9f29a"), 130, 3);
  }

  /** V1.3 — SPATIAL HASH REBUILD: buckets every live enemy into the 96px
   *  broadphase grid (arrays reused, cleared via length=0 — no steady-state
   *  allocation). Runs once per tick after all enemy movement, before the
   *  projectile pass. */
  private rebuildEnemyGrid() {
    const cells = this.gridCells;
    if (cells.length === 0) { for (let i = 0; i < GRID_W * GRID_H; i++) cells.push([]); }
    for (let i = 0; i < cells.length; i++) cells[i].length = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const gx = Math.max(0, Math.min(GRID_W - 1, (e.x / GRID_CELL) | 0));
      const gy = Math.max(0, Math.min(GRID_H - 1, (e.y / GRID_CELL) | 0));
      cells[gy * GRID_W + gx].push(e);
    }
  }

  private updateProj(p: Proj, dt: number) {
    p.life -= dt;
    /* V1.3 — ribbon trail: first frame lazily creates it, then every sim
       step appends the position (frame-rate sampled — never gaps). */
    if (!p.tr) p.tr = this.mkTrail(p.kind);
    if (p.tr) p.tr.push(p.x, p.y);

    /* Patch 9.0 — hurricane blades boomerang home: halfway through their
       flight they swing around, re-arm their hit set, and sweep back through
       everything a second time on the return leg. */
    if (p.kind === "wind" && p.special === "hurricane" && !p.back && p.life < 0.55) {
      p.back = true;
      const dx = this.px - p.x, dy = this.py - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 520;
      p.vx = (dx / d) * sp;
      p.vy = (dy / d) * sp;
      p.hit.clear();
    }

    if (p.kind === "void") {
      const vm = this.evoModFor("void");
      const maw = p.special === "maw";
      const pull = maw ? 1220 : 760;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = p.x - e.x, dy = p.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 140 * 140 && d2 > 1) {
          const d = Math.sqrt(d2);
          e.vx += (dx / d) * pull * dt;
          e.vy += (dy / d) * pull * dt;
          const hr = p.r + e.r + this.graze();
          if (d < hr && !p.hit.has(e)) { p.hit.add(e); this.damageEnemy(e, p.dmg * 0.25, "void", true); }
          /* hungering maw devours continuously (juice-free dot, like burn) */
          if (maw) {
            const dot = p.dmg * 0.5 * dt;
            e.hp -= dot;
            this.runDamage += dot;
            e.hitFlash = Math.max(e.hitFlash, 0.05);
            if (e.hp <= 0) this.killEnemy(e);
          }
        }
      }
      if (Math.random() < dt * 40) this.puff(p.x + (Math.random() * 30 - 15), p.y + (Math.random() * 30 - 15), "#d05bff", 40, 2.6);
      if (p.life <= 0) {
        const R = 120 * (vm?.radius ?? 1);
        this.ring(p.x, p.y, R, "#d05bff", 4);
        this.o.sfx.castVoid();
        this.shakeIt(5);
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.x - p.x, dy = e.y - p.y;
          const rr = R + e.r;
          if (dx * dx + dy * dy < rr * rr) this.damageEnemy(e, p.dmg, "void", true);
        }
      }
      return;
    }

    /* homing — seekers curve toward the nearest foe ahead of them */
    if (p.homing > 0) {
      const tgt = this.nearestEnemy(p.x, p.y, 260);
      if (tgt) {
        const want = Math.atan2(tgt.y - p.y, tgt.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        let d = want - cur;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const turn = Math.max(-p.homing * dt, Math.min(p.homing * dt, d));
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const na = cur + turn;
        p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
      }
    }

    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === "fire" && Math.random() < dt * 40) this.puff(p.x, p.y, "#ff7847", 30, 2.4);
    if (p.kind === "ice" && Math.random() < dt * 30) this.puff(p.x, p.y, "#7fd8ff", 20, 1.8);
    if (p.kind === "arcane" && Math.random() < dt * 30) this.puff(p.x, p.y, "#9a7bff", 24, 1.8);
    if (p.kind === "blood" && Math.random() < dt * 36) this.puff(p.x, p.y, "#ff4d6b", 26, 2);
    if (p.kind === "nature" && Math.random() < dt * 20) this.puff(p.x, p.y, "#7ed957", 18, 2);
    if (p.kind === "wind" && Math.random() < dt * 34) this.puff(p.x, p.y, "#d2fff8", 22, 1.9);
    if (p.x < -30 || p.x > WORLD_W + 30 || p.y < -30 || p.y > WORLD_H + 30) { p.life = 0; return; }

    /* pillars */
    if (this.circleRectHit(p.x, p.y, p.r)) {
      if (p.kind === "fire") this.explodeFire(p);
      else if (p.kind === "nature") { this.spawnCloud(p.x, p.y, p.dmg); this.o.sfx.castNature(); }
      else for (let i = 0; i < 4; i++) this.puff(p.x, p.y, SPELLS[p.kind].color, 80, 2);
      p.life = 0;
      return;
    }

    const graze = this.graze();
    /* V1.3 — BROADPHASE QUERY: test only the 3×3 cell neighborhood (the
       96px cell dwarfs the worst interaction radius, so no hit can straddle
       the margin). With 150+ bolts × 60 foes this turns ~9,000 checks into
       a few hundred. */
    const gx = Math.max(0, Math.min(GRID_W - 1, (p.x / GRID_CELL) | 0));
    const gy = Math.max(0, Math.min(GRID_H - 1, (p.y / GRID_CELL) | 0));
    const gx0 = Math.max(0, gx - 1), gx1 = Math.min(GRID_W - 1, gx + 1);
    const gy0 = Math.max(0, gy - 1), gy1 = Math.min(GRID_H - 1, gy + 1);
    for (let cy = gy0; cy <= gy1; cy++) {
      for (let cx = gx0; cx <= gx1; cx++) {
    for (const e of this.gridCells[cy * GRID_W + cx]) {
      if (e.dead || p.hit.has(e)) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = e.r + p.r + graze;
      if (dx * dx + dy * dy < rr * rr) {
        if (p.kind === "fire") { this.explodeFire(p); p.life = 0; return; }
        if (p.kind === "nature") {
          this.damageEnemy(e, p.dmg * 0.6, "nature", true);
          this.spawnCloud(p.x, p.y, p.dmg);
          p.life = 0;
          return;
        }
        p.hit.add(e);
        /* Patch 9.0 — wind shoves: gale cutters knock foes back along the
           blade's travel direction (bosses resist). */
        if (p.kind === "wind") {
          const vl = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
          const kb = e.type === "boss" ? 40 : 240;
          e.vx += (p.vx / vl) * kb;
          e.vy += (p.vy / vl) * kb;
        }
        /* shatter bloom — ice splinters burst from the wound */
        if (p.kind === "ice" && p.special === "shatter") {
          for (let s = 0; s < 6; s++) {
            const sa = (s / 6) * TAU + Math.random() * 0.4;
            this.projs.push({
              kind: "ice", x: e.x, y: e.y,
              vx: Math.cos(sa) * 420, vy: Math.sin(sa) * 420,
              r: 4, dmg: p.dmg * 0.5, life: 0.4, pierce: 1,
              hit: new Set([e]), homing: 0,
            });
          }
          this.ring(e.x, e.y, 34, "#7fd8ff", 2);
        }
        /* crimson comet — pierce detonations */
        if (p.kind === "blood" && p.special === "comet") {
          this.ring(e.x, e.y, 50, "#ff4d6b", 2);
          for (const o of this.enemies) {
            if (o === e || o.dead || p.hit.has(o)) continue;
            const ox = o.x - e.x, oy = o.y - e.y;
            const orr = 50 + o.r;
            if (ox * ox + oy * oy < orr * orr) this.damageEnemy(o, p.dmg * 0.4, "blood", false);
          }
        }
        this.damageEnemy(e, p.dmg, p.kind, true);
        if (p.pierce > 0) p.pierce--;
        else { p.life = 0; return; }
      }
    }
      }
    }

    /* nature pod expires into a cloud at its destination */
    if (p.kind === "nature" && p.life <= 0) {
      this.spawnCloud(p.x, p.y, p.dmg);
      this.o.sfx.castNature();
    }
  }

  private explodeFire(p: Proj) {
    this.o.sfx.castFire();
    const m = this.evoModFor("fire");
    const cataclysm = m?.special === "cataclysm";
    const R = (62 + this.mods.spread * 5) * (m?.radius ?? 1);
    /* V1.3 — the detonation is a full LAYERED BLAST: chromatic core flash,
       double shockwave, directional debris streaks with gravity + smoke.
       One call replaces the triple ring + 22-puff burst. */
    this.vfx.blast(p.x, p.y, "#ff7847", cataclysm ? "#fff6c0" : "#ffe86b", R, cataclysm ? 2.5 : 1.6);
    this.shakeIt(4);
    this.hitStop = Math.max(this.hitStop, 0.03);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = R + e.r;
      if (dx * dx + dy * dy < rr * rr) {
        this.damageEnemy(e, p.dmg, "fire", true);
        /* cataclysm burns leap deeper */
        if (cataclysm) { e.burnT = 5; e.burnDps = Math.max(e.burnDps, 20 * this.mods.power); }
      }
    }
  }

  /* ------------------------------ collisions ------------------------------- */

  /* ------------------- Patch 9.0 — pathfinding & LOS ---------------------- */

  /** Is a flow cell blocked by a pillar (inflated so bodies never clip)?
      Patch 10.2: inflation 10 → 14px so mid-size bodies hug walls less and
      the no-corner-cut descent below never pinches them into a corner. */
  private flowBlocked(gx: number, gy: number): boolean {
    const x0 = gx * FLOW_CELL, y0 = gy * FLOW_CELL;
    const x1 = x0 + FLOW_CELL, y1 = y0 + FLOW_CELL;
    for (const p of this.arena.pillars) {
      if (p.x < x1 + 14 && p.x + p.w > x0 - 14 && p.y < y1 + 14 && p.y + p.h > y0 - 14) return true;
    }
    return false;
  }

  /** Rebuild the BFS distance field toward the player. 1000 cells (40×25 on
      the Patch 10.2 world), flat arrays — a few microseconds. Re-run when the
      player crosses a cell or twice a second at most. */
  private rebuildFlowField() {
    const dist = this.flowDist;
    dist.fill(FLOW_UNREACHED);
    const pcx = Math.max(0, Math.min(FLOW_GW - 1, Math.floor(this.px / FLOW_CELL)));
    const pcy = Math.max(0, Math.min(FLOW_GH - 1, Math.floor(this.py / FLOW_CELL)));
    this.flowCell = pcy * FLOW_GW + pcx;
    if (this.flowBlocked(pcx, pcy)) {
      /* player standing in a blocked cell (hugging a pillar) — unblock it so
         the field still floods outward from their position */
      dist[this.flowCell] = 0;
    }
    /* BFS with a preallocated static queue (worst case: every cell) */
    const queue = ArchmageEngine.Q;
    let qh = 0, qt = 0;
    dist[this.flowCell] = 0;
    queue[qt++] = this.flowCell;
    while (qh < qt) {
      const cell = queue[qh++];
      const d = dist[cell] + 1;
      const gx = cell % FLOW_GW;
      const gy = (cell / FLOW_GW) | 0;
      /* 4-neighbourhood — smoother diagonals come from steering blending */
      if (gx > 0) { const n = cell - 1; if (dist[n] === FLOW_UNREACHED && !this.flowBlocked(gx - 1, gy)) { dist[n] = d; queue[qt++] = n; } }
      if (gx < FLOW_GW - 1) { const n = cell + 1; if (dist[n] === FLOW_UNREACHED && !this.flowBlocked(gx + 1, gy)) { dist[n] = d; queue[qt++] = n; } }
      if (gy > 0) { const n = cell - FLOW_GW; if (dist[n] === FLOW_UNREACHED && !this.flowBlocked(gx, gy - 1)) { dist[n] = d; queue[qt++] = n; } }
      if (gy < FLOW_GH - 1) { const n = cell + FLOW_GW; if (dist[n] === FLOW_UNREACHED && !this.flowBlocked(gx, gy + 1)) { dist[n] = d; queue[qt++] = n; } }
    }
  }
  private static readonly Q = new Int32Array(FLOW_GW * FLOW_GH);
  /* scratch vector for flow steering (avoids per-enemy allocation) */
  private static readonly DIR = { x: 0, y: 0 };

  /** Sample the flow direction at a world position (unit vector toward the
      player through open space). Returns false when unreached. */
  private flowDir(x: number, y: number, out: { x: number; y: number }): boolean {
    const gx = Math.max(0, Math.min(FLOW_GW - 1, Math.floor(x / FLOW_CELL)));
    const gy = Math.max(0, Math.min(FLOW_GH - 1, Math.floor(y / FLOW_CELL)));
    const d0 = this.flowDist[gy * FLOW_GW + gx];
    if (d0 === FLOW_UNREACHED) return false;
    let bx = 0, by = 0, best = d0;
    /* 8-neighbourhood descent — pick the neighbour closest to the player.
       Patch 10.2 — NO CORNER-CUTTING: a diagonal step is only taken when
       BOTH orthogonal neighbours are open, so the descent never steers a
       body straight across a pillar corner (the classic wedge-jam). */
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= FLOW_GW || ny >= FLOW_GH) continue;
        if (dx !== 0 && dy !== 0) {
          if (this.flowDist[gy * FLOW_GW + nx] === FLOW_UNREACHED) continue;
          if (this.flowDist[ny * FLOW_GW + gx] === FLOW_UNREACHED) continue;
        }
        const d = this.flowDist[ny * FLOW_GW + nx];
        if (d < best) { best = d; bx = dx; by = dy; }
      }
    }
    if (bx === 0 && by === 0) return false;
    /* aim at the far edge of the chosen neighbour so long cells don't pinch */
    const tx = (gx + bx * 0.5 + 0.5) * FLOW_CELL;
    const ty = (gy + by * 0.5 + 0.5) * FLOW_CELL;
    const dx = tx - x, dy = ty - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    out.x = dx / len; out.y = dy / len;
    return true;
  }

  /** Patch 10.2 — last-resort unstick: relocate a hopelessly wedged foe to
      a fresh open ring point around the player (with rift-blink puffs at
      both ends). Guarantees no enemy is ever permanently stuck on terrain —
      if four consecutive stuck windows (≈2.4s of true weld) fire, the foe
      blinks out of the jam and re-approaches through open space. */
  private riftHop(e: Enemy) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const a = this.rng.next() * TAU;
      const rr = this.rng.range(380, 520);
      const x = Math.max(70, Math.min(WORLD_W - 70, this.px + Math.cos(a) * rr));
      const y = Math.max(70, Math.min(WORLD_H - 70, this.py + Math.sin(a) * rr));
      if (this.circleRectHit(x, y, e.r + 8)) continue;
      for (let i = 0; i < 6; i++) this.puff(e.x, e.y, e.glow, 90, 2.6);
      e.x = x; e.y = y;
      e.vx = 0; e.vy = 0;
      e.lastX = x; e.lastY = y;
      e.stuckN = 0;
      for (let i = 0; i < 6; i++) this.puff(x, y, e.glow, 90, 2.6);
      return;
    }
  }

  /** Cheap line-of-sight raycast against the (inflated) pillars — 30px steps. */
  private lineClear(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / 30));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t, y = y1 + dy * t;
      for (const p of this.arena.pillars) {
        if (x > p.x - 12 && x < p.x + p.w + 12 && y > p.y - 12 && y < p.y + p.h + 12) return false;
      }
    }
    return true;
  }

  private circleRectHit(cx: number, cy: number, r: number): boolean {
    for (const p of this.arena.pillars) {
      const rx = p.x, ry = p.y, rw = p.w, rh = p.h;
      const nx = Math.max(rx, Math.min(cx, rx + rw));
      const ny = Math.max(ry, Math.min(cy, ry + rh));
      const dx = cx - nx, dy = cy - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  private resolvePillar(e: Enemy) {
    for (const p of this.arena.pillars) {
      const rx = p.x, ry = p.y, rw = p.w, rh = p.h;
      const nx = Math.max(rx, Math.min(e.x, rx + rw));
      const ny = Math.max(ry, Math.min(e.y, ry + rh));
      const dx = e.x - nx, dy = e.y - ny;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < e.r) {
        if (d > 0.01) { e.x = nx + (dx / d) * e.r; e.y = ny + (dy / d) * e.r; }
        else { e.y = ry - e.r; }
      }
    }
  }

  private resolvePlayerPillars() {
    for (const p of this.arena.pillars) {
      const rx = p.x, ry = p.y, rw = p.w, rh = p.h;
      const nx = Math.max(rx, Math.min(this.px, rx + rw));
      const ny = Math.max(ry, Math.min(this.py, ry + rh));
      const dx = this.px - nx, dy = this.py - ny;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 13) {
        if (d > 0.01) { this.px = nx + (dx / d) * 13; this.py = ny + (dy / d) * 13; }
        else { this.py = ry - 13; }
      }
    }
  }

  /* --------------------------------- HUD ----------------------------------- */

  /* Task 2-b — view-culling test as a method (was a closure rebuilt every
     render call; identical comparisons). V1.3: inViewFn is the BOUND variant
     handed to the vfx pools (drawAdditive/drawNormal receive it as a bare
     callback — an unbound method reference would lose `this`). */
  private inView(x: number, y: number, pad: number): boolean {
    return x > this.vx0 - pad && x < this.vx1 + pad && y > this.vy0 - pad && y < this.vy1 + pad;
  }
  private inViewFn = this.inView.bind(this);

  private pushHud() {
    const h = this.hud;
    h.hp = Math.max(0, this.hp); h.maxHp = this.maxHp;
    h.mana = this.mana; h.maxMana = this.maxMana;
    h.wave = this.wave;
    h.actName = this.act.name;
    h.enemiesLeft = (this.spawnQueue.length - this.sqHead) + this.enemies.length;
    h.score = Math.round(this.score); h.kills = this.kills;
    h.glyphs = this.runGlyphs;
    /* Patch 5.0: HUD mirrors the equipped spell slots (length = equipped.length),
       not the full 11-element pool. Each slot's id is the live element so the
       UI can render the correct icon. Merged slots include a `merged` array
       listing every spell in the slot — the spell bar shows stacked icons. */
    if (h.spells.length !== this.equipped.length) {
      /* Task 2-b — resize the reused array in place instead of reallocating:
         the per-slot loop below overwrites every field (incl. merged/empty),
         so surviving objects carry no stale state into the flush. */
      if (h.spells.length > this.equipped.length) h.spells.length = this.equipped.length;
      else while (h.spells.length < this.equipped.length) {
        h.spells.push({ cdFrac: 0, cost: 0, affordable: true, hpCost: false, evolved: false, id: "fire" as ElementId });
      }
      this.hudMerged.length = this.equipped.length;
    }
    for (let i = 0; i < this.equipped.length; i++) {
      const slot = this.equipped[i];
      const hs = h.spells[i];
      if (slot.spells.length === 0) {
        /* empty slot — UI renders a ghosted placeholder */
        hs.id = "fire" as ElementId; hs.merged = undefined; hs.empty = true;
        hs.cdFrac = 0; hs.cost = 0; hs.affordable = false; hs.hpCost = false; hs.evolved = false;
        continue;
      }
      const idx = slot.spells[0];              // primary spell for HUD purposes
      const id = SPELL_ORDER[idx];
      const sp = SPELLS[id];
      const evo = this.evolutions[idx];
      const free = this.freeCasting(id);
      /* merged slot cost = sum of all spells in the slot */
      let cost = 0;
      for (const j of slot.spells) {
        const sj = SPELLS[SPELL_ORDER[j]];
        cost += free ? 0 : sj.manaCost;
      }
      hs.id = id;
      /* Task 2-b — merged icon list from the per-slot reusable buffer (same
         content, same order as the old per-flush map allocation). */
      if (slot.spells.length >= 2) {
        let buf = this.hudMerged[i];
        if (!buf || buf.length !== slot.spells.length) {
          buf = slot.spells.map((j) => SPELL_ORDER[j]);
          this.hudMerged[i] = buf;
        } else {
          for (let k = 0; k < slot.spells.length; k++) buf[k] = SPELL_ORDER[slot.spells[k]];
        }
        hs.merged = buf;
      } else hs.merged = undefined;
      hs.empty = false;
      hs.cdFrac = sp.cooldown > 0 ? this.cd[idx] / (sp.cooldown * this.cdMult() * (evo?.mod.cooldown ?? 1)) : 0;
      hs.cost = cost;
      hs.affordable = this.mana >= cost;
      hs.hpCost = false;
      hs.evolved = !!evo;
    }
    h.selected = this.selected;
    h.dashFrac = this.dashCd / (2.2 * this.mods.dashCdM);
    if (this.attune) {
      this.hudAttune.id = this.attune.id;
      this.hudAttune.frac = this.attune.t / this.attune.total;
      h.attune = this.hudAttune;
    } else h.attune = null;
    if (this.lastCast && this.t - this.lastCast.t < this.mods.comboWindow) {
      this.hudRes.id = this.lastCast.id;
      this.hudRes.frac = 1 - (this.t - this.lastCast.t) / this.mods.comboWindow;
      h.resonance = this.hudRes;
    } else h.resonance = null;
    let boss: Enemy | null = null;
    for (const e of this.enemies) { if (!e.dead && e.type === "boss") { boss = e; break; } }
    if (boss) {
      this.hudBoss.name = boss.name;
      this.hudBoss.frac = Math.max(0, boss.hp / boss.maxHp);
      h.boss = this.hudBoss;
    } else h.boss = null;
    h.timeSec = this.t;
    h.weave = this.weave;
    h.surge = this.surgeT > 0 ? this.surgeT / SURGE_DUR : null;
    h.mercy = this.mercyDr > 0 ? this.mercyDr : null;
    h.mercyTier = this.mercyTier;
    /* Patch 7.0 — act threat meter: fills across the act's 10 waves toward
       the tyrant (RoR2-style visible scaling pressure). */
    h.threat = Math.max(0, Math.min(1, (this.wave - this.act.waves[0]) / 9));
    this.o.onHud(h);
  }

  /* -------------------------------- render --------------------------------- */

  private render() {
    const c = this.ctx;
    const { w, h } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    /* base — screen-space fills */
    c.fillStyle = "#0d0919";
    c.fillRect(0, 0, w, h);
    c.fillStyle = this.bgGrad!;
    c.fillRect(0, 0, w, h);

    /* V1.3 — TRAUMA SHAKE: translational + rotational offsets sampled from
       the juice controller's smooth noise, applied around the world transform
       (render-only — aim math is untouched). The kill zoom-punch rides the
       same transform as a small render-time multiplier. */
    const sx = this.juice.shakeX;
    const sy = this.juice.shakeY;
    const zEff = this.zoomCur * (1 + this.juice.punchK);
    c.save();

    /* Patch 9.0 — world camera transform: screen center → cam, scaled by
       the live FOV zoom. Everything inside this save/restore is world-space. */
    c.translate(w / 2 + sx, h / 2 + sy);
    c.rotate(this.juice.shakeRot);
    c.scale(zEff, zEff);
    c.translate(-this.camX, -this.camY);

    this.drawFloor(c);
    this.drawWorldBorder(c);
    this.drawRuneCircle(c);
    this.drawAmbient(c);
    this.drawHazards(c);
    this.drawFountains(c);
    this.drawShrine(c);
    this.drawPillars(c);

    for (const cl of this.clouds) { if (this.inView(cl.x, cl.y, cl.r)) this.drawCloud(c, cl); }
    for (const b of this.bubbles) { if (this.inView(b.x, b.y, b.r)) this.drawBubble(c, b); }
    for (const r of this.rocks) { if (this.inView(r.x, r.y, r.r)) this.drawRock(c, r); }
    for (const m of this.motes) { if (this.inView(m.x, m.y, 20)) this.drawMote(c, m); }
    /* Patch 4.0 — spell drops are drawn above motes / below enemies so they
       read clearly as pickup-able glyphs even during heavy combat. */
    for (const d of this.spellDrops) { if (d.life > 0 && this.inView(d.x, d.y, 40)) this.drawDrop(c, d); }
    for (const e of this.enemies) { if (!e.dead && this.inView(e.x, e.y, e.r + 20)) this.drawEnemy(c, e); }
    this.drawPlayer(c);
    for (const p of this.projs) { if (this.inView(p.x, p.y, 30)) this.drawProj(c, p); }
    for (const b of this.eBolts) { if (this.inView(b.x, b.y, 20)) this.drawEBolt(c, b); }
    this.drawLockBracket(c);

    /* additive fx — ONE lighter pass, batched: enemy under-auras → ribbon
       trails → zaps → beams → vfx (blasts/shocks/auras/sparks/wisps) → dust */
    c.globalCompositeOperation = "lighter";
    /* V1.3 — enemy under-glow: every foe carries its colored light on the
       ground (baked sprite, one blit each; elites pulse brighter). */
    for (const e of this.enemies) {
      if (e.dead || !this.inView(e.x, e.y, e.r + 60)) continue;
      const d = e.r * (e.affix ? 5.6 : 4.6);
      c.globalAlpha = e.affix ? 0.26 + Math.sin(this.t * 5 + e.wob) * 0.08 : 0.16;
      c.drawImage(this.enemyGlow(e), e.x - d / 2, e.y - d / 2, d, d);
    }
    /* V1.3 — projectile / bolt ribbon trails (one tapered fill each). */
    for (const p of this.projs) {
      if (!p.tr || !this.inView(p.x, p.y, 60)) continue;
      c.fillStyle = this.trailFill(p.kind);
      p.tr.draw(c, this.trailW(p.kind), 0.85);
    }
    for (const b of this.eBolts) {
      if (!b.tr || !this.inView(b.x, b.y, 40)) continue;
      c.fillStyle = "rgba(208,91,255,1)";
      b.tr.draw(c, 9, 0.7);
    }
    c.globalAlpha = 1;
    for (const z of this.zaps) this.drawZap(c, z);
    for (const b of this.beams) {
      if (!this.inView((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, Math.max(Math.abs(b.x2 - b.x1), Math.abs(b.y2 - b.y1)) / 2 + 20)) continue;
      const a = b.life / b.maxLife;
      /* Patch 11.0 — WRATHLIGHT beams: soft glow halo + bright core + an
         animated dash pass that travels down the shaft (the light MOVES). */
      c.strokeStyle = b.color; c.globalAlpha = a * 0.45; c.lineWidth = b.w * 2.1;
      c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke();
      c.globalAlpha = a * 0.95; c.lineWidth = b.w;
      c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke();
      c.globalAlpha = a * 0.85; c.lineWidth = Math.max(1.2, b.w * 0.4);
      c.setLineDash([16, 22]);
      c.lineDashOffset = -this.t * 340;
      c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke();
      c.setLineDash([]);
    }
    for (const p of this.particles) {
      if (!this.inView(p.x, p.y, 8)) continue;
      const a = Math.max(0, p.life / p.maxLife);
      c.globalAlpha = a * (p.glow ? 0.9 : 0.7);
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU); c.fill();
    }
    /* V1.3 — the full combat pool: blast cores, shockwaves, aura shells,
       debris streaks and soul wisps join the additive batch. */
    this.vfx.drawAdditive(c, this.inViewFn);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    /* V1.3 — smoke AFTER the additive block: the soot softly occludes the
       glow edges (the layered-explosion stack, not a flat pop). */
    this.vfx.drawNormal(c, this.inViewFn);

    for (const f of this.floaters) { if (this.inView(f.x, f.y, 30)) this.drawFloater(c, f); }
    c.restore();

    /* vignette + flashes — screen space, above the world */
    c.fillStyle = this.vigGrad!;
    c.fillRect(0, 0, w, h);

    /* V1.3 — the juice flash overlay (kill punctuation / boss death). */
    if (this.juice.flashA > 0.003) {
      c.fillStyle = `rgba(${this.juice.flashR},${this.juice.flashG},${this.juice.flashB},${this.juice.flashA})`;
      c.fillRect(0, 0, w, h);
    }
    if (this.redFlash > 0) {
      c.fillStyle = `rgba(255,45,80,${Math.min(0.4, this.redFlash * 0.4)})`;
      c.fillRect(0, 0, w, h);
    }
    if (this.surgeT > 0) {
      const k = Math.min(1, this.surgeT / 0.5) * (0.75 + Math.sin(this.t * 9) * 0.25);
      c.globalAlpha = k;
      c.fillStyle = this.surgeGrad!;
      c.fillRect(0, 0, w, h);
      c.globalAlpha = 1;
    }
    if (this.hp > 0 && this.hp / this.maxHp < 0.3) {
      const pulse = 0.12 + Math.sin(this.t * 6) * 0.07;
      c.globalAlpha = pulse;
      c.fillStyle = this.lowHpGrad!;
      c.fillRect(0, 0, w, h);
      c.globalAlpha = 1;
    }
    if (this.phase === "intermission") {
      c.fillStyle = "rgba(8,5,18,0.45)";
      c.fillRect(0, 0, w, h);
    }
  }

  /** Patch 9.0 — rune-etched border walls bounding the fixed world, so the
      arena's edge reads as a real place the moment the camera approaches it. */
  /* ================================ V1.3 MAPS ================================
     THE RADIANT REWORK rebuilds the arena's sense of place. Every act now
     owns a DISTINCT floor baked ONCE into an offscreen 2560×1600 canvas
     (per-act, per-seed deterministic — the gameplay rng stream is never
     touched): starfield void / magma veins / drowned caustics / frost
     fractures / abyss veins / starfall spiral. Runtime adds cheap animated
     accents (twinkles, vein pulses) and per-act ambient weather. One blit
     per frame replaces per-frame floor work entirely. */

  private drawFloor(c: CanvasRenderingContext2D) {
    if (!this.floorCv || this.floorAct !== this.act.id) this.bakeFloor();
    c.drawImage(this.floorCv!, 0, 0);
    /* animated accents — per-act, node lists baked with the floor */
    const aid = this.act.id;
    const t = this.t;
    if (aid === 1 || aid === 6) {
      /* twinkling stars (void acts) */
      for (const tw of this.twinkles) {
        if (!this.inView(tw.x, tw.y, 8)) continue;
        const al = 0.18 + Math.sin(t * tw.s * 2 + tw.ph) * 0.16;
        if (al <= 0.03) continue;
        c.fillStyle = `rgba(${this.ambientRGB},${al})`;
        c.beginPath(); c.arc(tw.x, tw.y, tw.s, 0, TAU); c.fill();
      }
    } else if (aid === 2 || aid === 5) {
      /* breathing glow at the magma / vein nodes */
      if (!this.veinSpr) this.veinSpr = this.vfx.glowSpr(aid === 2 ? "#ff7847" : "#ff5a78");
      const spr = this.veinSpr;
      for (const nd of this.floorNodes) {
        if (!this.inView(nd.x, nd.y, 40)) continue;
        const al = 0.10 + Math.sin(t * 1.8 + nd.ph) * 0.08;
        if (al <= 0.02) continue;
        const d = nd.r * 2;
        c.globalAlpha = al;
        c.drawImage(spr, nd.x - d / 2, nd.y - d / 2, d, d);
      }
      c.globalAlpha = 1;
    }
  }

  /** Bake the act's floor into the offscreen cache. Deterministic per
   *  (seed, act) — the RNG here is a FRESH stream; the gameplay rng is
   *  never consumed, so wave composition stays identical run-to-run. */
  private bakeFloor() {
    const cv = this.floorCv;
    cv!.width = WORLD_W;
    cv!.height = WORLD_H;
    const c = cv!.getContext("2d")!;
    this.floorAct = this.act.id;
    this.floorNodes.length = 0;
    this.twinkles.length = 0;
    const aid = this.act.id;
    const pal = this.act.palette;
    const rng = mulberry32(hashSeed(this.o.seed + "|floor|" + aid));
    this.ambientRGB = pal.mote;

    /* base — deep floor under everything */
    c.fillStyle = "#0c081a";
    c.fillRect(0, 0, WORLD_W, WORLD_H);
    const g = c.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 180, WORLD_W / 2, WORLD_H / 2, 1480);
    g.addColorStop(0, `rgba(${pal.sky},0.22)`);
    g.addColorStop(0.55, `rgba(${pal.sky},0.09)`);
    g.addColorStop(1, "rgba(5,3,12,0.55)");
    c.fillStyle = g;
    c.fillRect(0, 0, WORLD_W, WORLD_H);

    /* shared stone tiling — act-tinted, wave-warped for organic acts */
    c.strokeStyle = `rgba(${pal.rune},0.05)`;
    c.lineWidth = 1;
    const tile = aid === 3 || aid === 4 ? 128 : 160;
    for (let ty = tile; ty < WORLD_H; ty += tile) {
      c.beginPath();
      for (let sx = 0; sx <= WORLD_W; sx += 64) {
        const warp = Math.sin(sx * 0.004 + ty * 0.01) * 6;
        if (sx === 0) c.moveTo(0, ty + warp);
        else c.lineTo(sx, ty + warp);
      }
      c.stroke();
    }
    for (let tx = tile; tx < WORLD_W; tx += tile) {
      c.beginPath();
      for (let sy = 0; sy <= WORLD_H; sy += 64) {
        const warp = Math.sin(sy * 0.005 + tx * 0.008) * 6;
        if (sy === 0) c.moveTo(tx + warp, 0);
        else c.lineTo(tx + warp, sy);
      }
      c.stroke();
    }

    if (aid === 1) {
      /* ACT 1 — THE SUNLESS VESTIBULE: a starfield void. Dim stars, faint
         arcane circles, scattered rune scratches, soft fog banks. */
      for (let i = 0; i < 160; i++) {
        const sx = rng.next() * WORLD_W, sy = rng.next() * WORLD_H;
        const s = 0.5 + rng.next() * 1.4;
        c.fillStyle = `rgba(200,180,255,${0.05 + rng.next() * 0.12})`;
        c.beginPath(); c.arc(sx, sy, s, 0, TAU); c.fill();
        if (i < 44) this.twinkles.push({ x: sx, y: sy, s: 1 + rng.next() * 1.4, ph: rng.next() * TAU });
      }
      c.strokeStyle = "rgba(154,123,255,0.07)";
      c.lineWidth = 2;
      for (const rr of [420, 700, 980]) {
        c.beginPath(); c.arc(WORLD_W / 2, WORLD_H / 2, rr, 0, TAU); c.stroke();
      }
      c.strokeStyle = "rgba(154,123,255,0.1)";
      c.lineWidth = 1.4;
      for (let i = 0; i < 26; i++) {
        const gx = rng.next() * WORLD_W, gy = rng.next() * WORLD_H;
        const ga = rng.next() * TAU, gl = 4 + rng.next() * 9;
        c.beginPath();
        c.moveTo(gx - Math.cos(ga) * gl, gy - Math.sin(ga) * gl);
        c.lineTo(gx + Math.cos(ga) * gl, gy + Math.sin(ga) * gl);
        c.moveTo(gx + Math.sin(ga) * gl * 0.5, gy - Math.cos(ga) * gl * 0.5);
        c.lineTo(gx - Math.sin(ga) * gl * 0.5, gy + Math.cos(ga) * gl * 0.5);
        c.stroke();
      }
      for (let i = 0; i < 9; i++) {
        const fx2 = rng.next() * WORLD_W, fy2 = rng.next() * WORLD_H;
        const fg = c.createRadialGradient(fx2, fy2, 4, fx2, fy2, 260);
        fg.addColorStop(0, "rgba(88,58,160,0.10)");
        fg.addColorStop(1, "rgba(88,58,160,0)");
        c.fillStyle = fg;
        c.beginPath(); c.ellipse(fx2, fy2, 260, 140, rng.next() * TAU, 0, TAU); c.fill();
      }
    } else if (aid === 2) {
      /* ACT 2 — THE CINDER LABYRINTH: magma crack network + ember glow
         patches + ash fall soot. */
      c.lineCap = "round";
      for (let wkr = 0; wkr < 13; wkr++) {
        let wx = 80 + rng.next() * (WORLD_W - 160);
        let wy = 80 + rng.next() * (WORLD_H - 160);
        const segs = 5 + Math.floor(rng.next() * 6);
        c.strokeStyle = "rgba(60,22,14,0.85)";
        c.lineWidth = 3.4;
        c.beginPath(); c.moveTo(wx, wy);
        const pts: number[] = [wx, wy];
        for (let s = 0; s < segs; s++) {
          wx += (rng.next() * 2 - 1) * 180;
          wy += (rng.next() * 2 - 1) * 150;
          wx = Math.max(40, Math.min(WORLD_W - 40, wx));
          wy = Math.max(40, Math.min(WORLD_H - 40, wy));
          c.lineTo(wx, wy);
          pts.push(wx, wy);
        }
        c.stroke();
        c.strokeStyle = "rgba(255,120,60,0.35)";
        c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(pts[0], pts[1]);
        for (let s = 2; s < pts.length; s += 2) c.lineTo(pts[s], pts[s + 1]);
        c.stroke();
        if (wkr % 2 === 0) this.floorNodes.push({ x: pts[0], y: pts[1], r: 26 + rng.next() * 22, ph: rng.next() * TAU });
      }
      c.lineCap = "butt";
      for (let i = 0; i < 10; i++) {
        const ex = rng.next() * WORLD_W, ey = rng.next() * WORLD_H;
        const eg = c.createRadialGradient(ex, ey, 2, ex, ey, 150);
        eg.addColorStop(0, "rgba(140,74,44,0.22)");
        eg.addColorStop(1, "rgba(140,74,44,0)");
        c.fillStyle = eg;
        c.beginPath(); c.arc(ex, ey, 150, 0, TAU); c.fill();
      }
      c.fillStyle = "rgba(20,12,10,0.5)";
      for (let i = 0; i < 90; i++) {
        c.beginPath();
        c.arc(rng.next() * WORLD_W, rng.next() * WORLD_H, 0.8 + rng.next() * 2, 0, TAU);
        c.fill();
      }
    } else if (aid === 3) {
      /* ACT 3 — THE DROWNED NECROPOLIS: sunken caustic webs, wavy tiles
         (already shared), rune circles and silt drifts. */
      c.lineWidth = 1.6;
      for (let i = 0; i < 34; i++) {
        const ax = rng.next() * WORLD_W, ay = rng.next() * WORLD_H;
        const ar = 60 + rng.next() * 200;
        const aa = rng.next() * TAU;
        c.strokeStyle = `rgba(120,240,226,${0.03 + rng.next() * 0.05})`;
        c.beginPath(); c.arc(ax, ay, ar, aa, aa + 1.2 + rng.next() * 2.2); c.stroke();
      }
      c.strokeStyle = "rgba(150,235,225,0.08)";
      c.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const rx = rng.next() * WORLD_W, ry = rng.next() * WORLD_H, rr = 34 + rng.next() * 60;
        c.beginPath(); c.arc(rx, ry, rr, 0, TAU); c.stroke();
        c.beginPath(); c.arc(rx, ry, rr * 0.66, 0, TAU); c.stroke();
      }
      for (let i = 0; i < 26; i++) {
        const sx = rng.next() * WORLD_W, sy = rng.next() * WORLD_H;
        const sg = c.createRadialGradient(sx, sy, 2, sx, sy, 90);
        sg.addColorStop(0, "rgba(18,58,66,0.35)");
        sg.addColorStop(1, "rgba(18,58,66,0)");
        c.fillStyle = sg;
        c.beginPath(); c.ellipse(sx, sy, 90, 40, rng.next() * TAU, 0, TAU); c.fill();
      }
    } else if (aid === 4) {
      /* ACT 4 — THE SILENT SEPULCHER: frost fracture polylines, pale ice
         patches, crystalline glints. */
      c.lineCap = "round";
      for (let root = 0; root < 14; root++) {
        let fx2 = rng.next() * WORLD_W, fy2 = rng.next() * WORLD_H;
        let dir = rng.next() * TAU;
        const branches = 2 + Math.floor(rng.next() * 3);
        for (let b = 0; b < branches; b++) {
          let bx = fx2, by = fy2;
          let bdir = dir + (rng.next() - 0.5) * 1.2;
          c.strokeStyle = `rgba(200,255,235,${0.10 + rng.next() * 0.10})`;
          c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(bx, by);
          const segs = 3 + Math.floor(rng.next() * 4);
          for (let s = 0; s < segs; s++) {
            bdir += (rng.next() - 0.5) * 0.9;
            const len = 60 + rng.next() * 130;
            bx += Math.cos(bdir) * len;
            by += Math.sin(bdir) * len;
            c.lineTo(bx, by);
          }
          c.stroke();
        }
      }
      c.lineCap = "butt";
      for (let i = 0; i < 12; i++) {
        const px2 = rng.next() * WORLD_W, py2 = rng.next() * WORLD_H;
        const pg = c.createRadialGradient(px2, py2, 4, px2, py2, 170);
        pg.addColorStop(0, "rgba(190,255,238,0.10)");
        pg.addColorStop(1, "rgba(190,255,238,0)");
        c.fillStyle = pg;
        c.beginPath(); c.ellipse(px2, py2, 170, 100, rng.next() * TAU, 0, TAU); c.fill();
      }
      for (let i = 0; i < 30; i++) {
        const gx = rng.next() * WORLD_W, gy = rng.next() * WORLD_H;
        const gl2 = 3 + rng.next() * 6;
        c.strokeStyle = `rgba(220,255,245,${0.12 + rng.next() * 0.14})`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(gx - gl2, gy); c.lineTo(gx + gl2, gy);
        c.moveTo(gx, gy - gl2); c.lineTo(gx, gy + gl2);
        c.stroke();
      }
    } else if (aid === 5) {
      /* ACT 5 — THE HEART OF THE ABYSS: a pulsing vein network + rib arcs
         + dark flesh patches. */
      c.lineCap = "round";
      for (let v = 0; v < 15; v++) {
        let vx = 100 + rng.next() * (WORLD_W - 200);
        let vy = 100 + rng.next() * (WORLD_H - 200);
        const segs = 4 + Math.floor(rng.next() * 5);
        this.floorNodes.push({ x: vx, y: vy, r: 30 + rng.next() * 26, ph: rng.next() * TAU });
        for (let s = 0; s < segs; s++) {
          const nx = Math.max(60, Math.min(WORLD_W - 60, vx + (rng.next() * 2 - 1) * 210));
          const ny = Math.max(60, Math.min(WORLD_H - 60, vy + (rng.next() * 2 - 1) * 180));
          const mx = (vx + nx) / 2 + (rng.next() - 0.5) * 90;
          const my2 = (vy + ny) / 2 + (rng.next() - 0.5) * 90;
          c.strokeStyle = "rgba(74,16,40,0.8)";
          c.lineWidth = 5.5;
          c.beginPath(); c.moveTo(vx, vy); c.quadraticCurveTo(mx, my2, nx, ny); c.stroke();
          c.strokeStyle = "rgba(255,90,120,0.22)";
          c.lineWidth = 1.6;
          c.beginPath(); c.moveTo(vx, vy); c.quadraticCurveTo(mx, my2, nx, ny); c.stroke();
          if (s === segs - 1 && v % 3 === 0) this.floorNodes.push({ x: nx, y: ny, r: 26 + rng.next() * 20, ph: rng.next() * TAU });
          vx = nx; vy = ny;
        }
      }
      c.lineCap = "butt";
      c.strokeStyle = "rgba(96,40,110,0.10)";
      c.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const rx = rng.next() * WORLD_W, ry = rng.next() * WORLD_H, rr = 140 + rng.next() * 260;
        c.beginPath(); c.arc(rx, ry, rr, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      }
      for (let i = 0; i < 16; i++) {
        const px2 = rng.next() * WORLD_W, py2 = rng.next() * WORLD_H;
        const pg = c.createRadialGradient(px2, py2, 3, px2, py2, 120);
        pg.addColorStop(0, "rgba(58,18,48,0.4)");
        pg.addColorStop(1, "rgba(58,18,48,0)");
        c.fillStyle = pg;
        c.beginPath(); c.ellipse(px2, py2, 120, 70, rng.next() * TAU, 0, TAU); c.fill();
      }
    } else {
      /* ACT 6+ — THE ENDLESS DIRGE: a slow spiral galaxy + dense starfall. */
      for (let i = 0; i < 200; i++) {
        const sx = rng.next() * WORLD_W, sy = rng.next() * WORLD_H;
        const s = 0.4 + rng.next() * 1.3;
        c.fillStyle = `rgba(190,170,255,${0.04 + rng.next() * 0.11})`;
        c.beginPath(); c.arc(sx, sy, s, 0, TAU); c.fill();
        if (i < 40) this.twinkles.push({ x: sx, y: sy, s: 0.8 + rng.next() * 1.3, ph: rng.next() * TAU });
      }
      c.save();
      c.translate(WORLD_W / 2, WORLD_H / 2);
      for (let arm = 0; arm < 3; arm++) {
        c.rotate(TAU / 3);
        for (let i = 0; i < 30; i++) {
          const rr = 120 + i * 34;
          const aoff = i * 0.16;
          c.save();
          c.translate(Math.cos(aoff) * rr, Math.sin(aoff) * rr * 0.42);
          c.rotate(aoff + Math.PI / 2);
          const sg = c.createRadialGradient(0, 0, 2, 0, 0, 90);
          sg.addColorStop(0, "rgba(170,140,255,0.07)");
          sg.addColorStop(1, "rgba(170,140,255,0)");
          c.fillStyle = sg;
          c.beginPath(); c.ellipse(0, 0, 90, 30, 0, 0, TAU); c.fill();
          c.restore();
        }
      }
      c.restore();
    }

    /* shared edge shading — the floor sinks into the rune walls */
    const edges: [number, number, number, number, number, number][] = [
      [0, 0, 0, WORLD_H, 90, 0], [WORLD_W, 0, WORLD_W, WORLD_H, -90, 0],
      [0, 0, WORLD_W, 0, 0, 90], [0, WORLD_H, WORLD_W, WORLD_H, 0, -90],
    ];
    for (const [x1, y1, x2, y2, dx, dy] of edges) {
      const eg = c.createLinearGradient(x1, y1, x1 + dx, y1 + dy);
      eg.addColorStop(0, "rgba(4,2,10,0.7)");
      eg.addColorStop(1, "rgba(4,2,10,0)");
      c.fillStyle = eg;
      c.fillRect(Math.min(x1, x1 + dx), Math.min(y1, y1 + dy), Math.abs(dx) || WORLD_W, Math.abs(dy) || WORLD_H);
    }
  }

  private drawWorldBorder(c: CanvasRenderingContext2D) {
    const rune = this.act.palette.rune;
    c.save();
    /* outer glow band */
    c.strokeStyle = `rgba(${rune},0.30)`;
    c.lineWidth = 10;
    c.strokeRect(-6, -6, WORLD_W + 12, WORLD_H + 12);
    /* crisp inner line */
    c.strokeStyle = `rgba(${rune},0.55)`;
    c.lineWidth = 2.5;
    c.strokeRect(0, 0, WORLD_W, WORLD_H);
    /* corner glyphs */
    c.strokeStyle = `rgba(${rune},${0.35 + Math.sin(this.t * 1.6) * 0.12})`;
    c.lineWidth = 2;
    const L = 34;
    for (const [kx, ky, dx, dy] of WORLD_CORNERS) {
      c.beginPath();
      c.moveTo(kx + dx * L, ky + dy * 14);
      c.lineTo(kx + dx * 14, ky + dy * 14);
      c.lineTo(kx + dx * 14, ky + dy * L);
      c.stroke();
    }
    /* halfway rune ticks along each wall */
    c.strokeStyle = `rgba(${rune},0.22)`;
    c.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      const x = (WORLD_W * i) / 4;
      const y = (WORLD_H * i) / 4;
      c.beginPath(); c.moveTo(x, 4); c.lineTo(x, 18); c.stroke();
      c.beginPath(); c.moveTo(x, WORLD_H - 4); c.lineTo(x, WORLD_H - 18); c.stroke();
      c.beginPath(); c.moveTo(4, y); c.lineTo(18, y); c.stroke();
      c.beginPath(); c.moveTo(WORLD_W - 4, y); c.lineTo(WORLD_W - 18, y); c.stroke();
    }
    c.restore();
  }

  private drawRuneCircle(c: CanvasRenderingContext2D) {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const R = Math.min(WORLD_W, WORLD_H) * 0.34;
    c.save();
    c.translate(cx, cy);
    c.rotate(this.t * 0.05);
    c.strokeStyle = `rgba(${this.act.palette.rune},0.10)`;
    c.lineWidth = 1.4;
    c.setLineDash([14, 10]);
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
    c.setLineDash([4, 18]);
    c.beginPath(); c.arc(0, 0, R * 0.82, 0, TAU); c.stroke();
    c.setLineDash([]);
    c.rotate(-this.t * 0.12);
    c.strokeStyle = "rgba(154,123,255,0.10)";
    c.beginPath(); c.arc(0, 0, R * 0.6, 0, TAU); c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      c.save();
      c.rotate(a);
      c.translate(R * 0.91, 0);
      c.rotate(Math.PI / 4);
      c.strokeRect(-5, -5, 10, 10);
      c.restore();
    }
    c.restore();
  }

  private drawAmbient(c: CanvasRenderingContext2D) {
    /* V1.3 — PER-ACT WEATHER: each biome fields its own ambient particle
       behavior, all stateless (derived from t — zero per-frame mutation or
       allocation): act 1 drifting void motes, act 2 rising flickering embers,
       act 3 swaying bubbles, act 4 falling snow, act 5 sinking spores,
       act 6 starfall streaks. */
    const aid = this.act.id;
    const col = this.ambientRGB;
    const t = this.t;
    for (const a of this.ambient) {
      let fx = a.x, fy = a.y, alphaMul = 1;
      if (aid === 2) {
        fy = ((a.y - (t * a.sp) / 1500) % 1 + 1) % 1;
        fx = a.x + Math.sin(t * 0.8 + a.ph) * 0.012;
        alphaMul = 0.75 + Math.sin(t * 6 + a.ph) * 0.25;
      } else if (aid === 3) {
        fy = ((a.y - (t * a.sp) / 2000) % 1 + 1) % 1;
        fx = a.x + Math.sin(t * 1.1 + a.ph) * 0.008;
      } else if (aid === 4) {
        fy = ((a.y + (t * a.sp) / 2600) % 1 + 1) % 1;
        fx = a.x + Math.sin(t * 0.5 + a.ph) * 0.02;
      } else if (aid === 5) {
        fy = ((a.y + (t * a.sp) / 3400) % 1 + 1) % 1;
        fx = a.x + Math.sin(t * 0.4 + a.ph) * 0.015;
      } else if (aid === 6) {
        fy = ((a.y + (t * a.sp) / 1300) % 1 + 1) % 1;
        fx = ((a.x + (t * a.sp) / 2600) % 1 + 1) % 1;
      } else {
        fy = ((a.y - (t * a.sp) / 4000) % 1 + 1) % 1;
        fx = a.x + Math.sin(t * 0.4 + a.ph) * 0.01;
      }
      const wx = fx * WORLD_W, wy = fy * WORLD_H;
      if (!this.inView(wx, wy, 14)) continue;
      const al = (0.10 + Math.sin(t * 1.4 + a.ph) * 0.07) * alphaMul;
      if (al <= 0.02) continue;
      if (aid === 3) {
        /* bubble — ring + inner dot */
        c.strokeStyle = `rgba(${col},${al * 1.1})`;
        c.lineWidth = 1;
        c.beginPath(); c.arc(wx, wy, a.s * 1.7, 0, TAU); c.stroke();
        c.fillStyle = `rgba(${col},${al * 0.5})`;
        c.beginPath(); c.arc(wx - a.s * 0.5, wy - a.s * 0.5, a.s * 0.45, 0, TAU); c.fill();
      } else if (aid === 6) {
        /* starfall streak */
        c.strokeStyle = `rgba(${col},${al})`;
        c.lineWidth = a.s * 0.8;
        c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx - a.s * 3.2, wy - a.s * 1.6); c.stroke();
      } else {
        c.fillStyle = `rgba(${col},${al})`;
        c.beginPath(); c.arc(wx, wy, aid === 2 ? a.s * 0.8 : a.s, 0, TAU); c.fill();
      }
    }
  }

  private drawHazards(c: CanvasRenderingContext2D) {
    for (const hz of this.arena.hazards) {
      const x = hz.x, y = hz.y;
      const pulse = 0.75 + Math.sin(this.t * 3 + x) * 0.25;
      if (!hz.grad) {
        const g = c.createRadialGradient(0, 0, 4, 0, 0, hz.r);
        g.addColorStop(0, "rgba(150,60,220,0.34)");
        g.addColorStop(0.7, "rgba(110,40,190,0.16)");
        g.addColorStop(1, "rgba(110,40,190,0)");
        hz.grad = g;
      }
      c.save();
      c.translate(x, y);
      c.fillStyle = hz.grad;
      c.beginPath(); c.arc(0, 0, hz.r, 0, TAU); c.fill();
      c.strokeStyle = `rgba(208,91,255,${0.25 * pulse})`;
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, 0, hz.r * (0.72 + pulse * 0.1), 0, TAU); c.stroke();
      c.strokeStyle = "rgba(208,91,255,0.3)";
      c.setLineDash([6, 8]);
      c.beginPath(); c.arc(0, 0, hz.r, this.t * 0.6, this.t * 0.6 + TAU); c.stroke();
      c.setLineDash([]);
      c.restore();
    }
  }

  private drawFountains(c: CanvasRenderingContext2D) {
    for (const f of this.arena.fountains) {
      const x = f.x, y = f.y;
      const col = f.kind === "health" ? "#ff4d6b" : "#43e8d8";
      if (f.used) {
        c.strokeStyle = "rgba(150,140,170,0.25)";
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, 14, 0, TAU); c.stroke();
        continue;
      }
      const pulse = 0.7 + Math.sin(this.t * 4) * 0.3;
      c.save();
      c.translate(x, y);
      if (!f.grad) {
        const g = c.createRadialGradient(0, 0, 2, 0, 0, 34);
        g.addColorStop(0, f.kind === "health" ? "rgba(255,77,107,0.5)" : "rgba(67,232,216,0.5)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        f.grad = g;
      }
      c.fillStyle = f.grad;
      c.beginPath(); c.arc(0, 0, 34, 0, TAU); c.fill();
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, 13 + pulse * 2, 0, TAU); c.stroke();
      c.fillStyle = col;
      if (f.kind === "health") {
        c.fillRect(-5, -1.5, 10, 3);
        c.fillRect(-1.5, -5, 3, 10);
      } else {
        c.beginPath();
        c.moveTo(0, -6);
        c.quadraticCurveTo(5.5, 1, 0, 5.5);
        c.quadraticCurveTo(-5.5, 1, 0, -6);
        c.fill();
      }
      c.restore();
    }
  }

  private drawShrine(c: CanvasRenderingContext2D) {
    const s = this.shrine;
    if (!s) return;
    const fade = Math.min(1, s.life / 1.5);
    c.save();
    c.translate(s.x, s.y);
    c.globalAlpha = fade;
    if (!s.grad) {
      const g = c.createRadialGradient(0, 0, 4, 0, 0, 46);
      g.addColorStop(0, "rgba(67,232,216,0.5)");
      g.addColorStop(1, "rgba(67,232,216,0)");
      s.grad = g;
    }
    c.fillStyle = s.grad;
    c.beginPath(); c.arc(0, 0, 46, 0, TAU); c.fill();
    /* twin rotating transmutation squares */
    c.strokeStyle = "#43e8d8";
    c.lineWidth = 2;
    c.save();
    c.rotate(this.t * 0.8);
    c.strokeRect(-13, -13, 26, 26);
    c.restore();
    c.save();
    c.rotate(Math.PI / 4 + this.t * 1.4);
    c.strokeStyle = "rgba(255,233,173,0.9)";
    c.strokeRect(-8, -8, 16, 16);
    c.restore();
    /* core diamond */
    c.fillStyle = "#aef7ef";
    c.save();
    c.rotate(this.t * 1.1);
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 0); c.lineTo(0, 7); c.lineTo(-5, 0);
    c.closePath(); c.fill();
    c.restore();
    c.restore();
    c.globalAlpha = 1;
    /* life countdown ring */
    const frac = Math.max(0, s.life / SHRINE_LIFE);
    c.strokeStyle = "rgba(67,232,216,0.75)";
    c.lineWidth = 2.4;
    c.beginPath(); c.arc(s.x, s.y, 24, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke();
    c.font = "700 10px 'Alegreya Sans'";
    c.fillStyle = "rgba(160,245,235,0.9)";
    c.textAlign = "center";
    c.fillText("TRANSMUTE", s.x, s.y + 40);
  }

  private drawPillars(c: CanvasRenderingContext2D) {
    /* V1.3 — PILLARS ARE ACT-SET DRESSED. The shared body stays (cached
       gradient + shadow) but each act carves its own architecture:
       obsidian monoliths / basalt with magma seams / coral columns /
       fractured ice / flesh-veined obelisks / void crystal. All accents are
       cheap strokes drawn once per pillar per frame; gradients remain
       cached on the pillar geometry. */
    const [pcol0, pcol1] = this.act.palette.pillar;
    const rune = this.act.palette.rune;
    const aid = this.act.id;
    for (const p of this.arena.pillars) {
      const x = p.x, y = p.y, pw = p.w, ph = p.h;
      c.fillStyle = "rgba(0,0,0,0.4)";
      c.beginPath();
      c.ellipse(x + pw / 2 + 5, y + ph + 4, pw * 0.55, 9, 0, 0, TAU);
      c.fill();
      if (!p.grad) {
        const g = c.createLinearGradient(x, y, x + pw, y + ph);
        g.addColorStop(0, pcol0);
        g.addColorStop(1, pcol1);
        p.grad = g;
      }
      c.fillStyle = p.grad;
      c.fillRect(x, y, pw, ph);
      /* shared: rim light along the top-left + base contact ring */
      c.strokeStyle = "rgba(215,225,255,0.16)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + 1.5, y + ph - 6); c.lineTo(x + 1.5, y + 5);
      c.moveTo(x + 5, y + 1.5); c.lineTo(x + pw - 12, y + 1.5);
      c.stroke();
      c.strokeStyle = `rgba(${rune},0.22)`;
      c.lineWidth = 1.4;
      c.beginPath(); c.ellipse(x + pw / 2, y + ph + 2, pw * 0.52, 5, 0, 0, TAU); c.stroke();

      if (aid === 1) {
        /* OBSIDIAN MONOLITH — rune glyph + chipped corner */
        c.save();
        c.translate(x + pw / 2, y + ph / 2);
        c.rotate(Math.PI / 4);
        c.strokeStyle = `rgba(${rune},${0.22 + Math.sin(this.t * 2 + x) * 0.1})`;
        c.lineWidth = 1.6;
        c.strokeRect(-7, -7, 14, 14);
        c.strokeRect(-3, -3, 6, 6);
        c.restore();
        c.fillStyle = "rgba(5,3,12,0.55)";
        c.beginPath(); c.moveTo(x + pw, y + ph); c.lineTo(x + pw - 10, y + ph); c.lineTo(x + pw, y + ph - 12); c.closePath(); c.fill();
      } else if (aid === 2) {
        /* BASALT COLUMN — magma seams + soot top */
        c.strokeStyle = `rgba(255,120,60,${0.25 + Math.sin(this.t * 2.4 + x) * 0.12})`;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x + pw * 0.3, y + 8);
        c.lineTo(x + pw * 0.42, y + ph * 0.4);
        c.lineTo(x + pw * 0.28, y + ph * 0.66);
        c.moveTo(x + pw * 0.7, y + ph * 0.3);
        c.lineTo(x + pw * 0.62, y + ph * 0.62);
        c.lineTo(x + pw * 0.78, y + ph - 10);
        c.stroke();
        c.fillStyle = "rgba(18,10,8,0.6)";
        c.fillRect(x, y, pw, 5);
      } else if (aid === 3) {
        /* CORAL COLUMN — barnacle clusters + swaying anemone tips */
        c.fillStyle = "rgba(150,235,225,0.35)";
        for (let i = 0; i < 4; i++) {
          const bx2 = x + ((i * 53) % Math.max(8, pw - 12)) + 6;
          const by2 = y + 14 + ((i * 91) % Math.max(10, ph - 28));
          c.beginPath(); c.arc(bx2, by2, 2.4 + (i % 2), 0, TAU); c.fill();
        }
        c.strokeStyle = "rgba(120,240,226,0.45)";
        c.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const tx2 = x + pw * (0.3 + i * 0.2);
          const sway = Math.sin(this.t * 1.6 + i * 1.7 + x) * 2.4;
          c.beginPath();
          c.moveTo(tx2, y + 2);
          c.quadraticCurveTo(tx2 + sway, y - 7, tx2 + sway * 1.4, y - 12 - i * 2);
          c.stroke();
        }
      } else if (aid === 4) {
        /* ICE SHARD — translucent sheen + inner fracture + sharp cap */
        c.fillStyle = "rgba(200,255,238,0.10)";
        c.fillRect(x + 3, y + 3, 6, ph - 6);
        c.strokeStyle = "rgba(200,255,235,0.28)";
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(x + pw * 0.5, y + 6);
        c.lineTo(x + pw * 0.34, y + ph * 0.4);
        c.lineTo(x + pw * 0.58, y + ph * 0.68);
        c.lineTo(x + pw * 0.44, y + ph - 8);
        c.stroke();
        c.fillStyle = "rgba(190,255,238,0.22)";
        c.beginPath(); c.moveTo(x + pw * 0.2, y); c.lineTo(x + pw * 0.8, y); c.lineTo(x + pw * 0.5, y - 9); c.closePath(); c.fill();
      } else if (aid === 5) {
        /* FLESH OBELISK — pulsing vein + rib band */
        c.strokeStyle = `rgba(255,90,120,${0.3 + Math.sin(this.t * 3 + x) * 0.15})`;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(x + pw * 0.36, y + 10);
        c.quadraticCurveTo(x + pw * 0.6, y + ph * 0.35, x + pw * 0.4, y + ph * 0.6);
        c.quadraticCurveTo(x + pw * 0.26, y + ph * 0.8, x + pw * 0.5, y + ph - 12);
        c.stroke();
        c.strokeStyle = "rgba(196,140,160,0.25)";
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(x + 2, y + ph * 0.3); c.lineTo(x + pw - 2, y + ph * 0.3); c.stroke();
      } else {
        /* VOID CRYSTAL — floating rune band + crackled sheen */
        c.strokeStyle = `rgba(170,140,255,${0.3 + Math.sin(this.t * 1.8 + y) * 0.12})`;
        c.lineWidth = 1.4;
        c.setLineDash([5, 7]);
        c.lineDashOffset = -this.t * 10;
        c.beginPath(); c.moveTo(x + 4, y + ph * 0.36); c.lineTo(x + pw - 4, y + ph * 0.36); c.stroke();
        c.lineDashOffset = this.t * 12;
        c.beginPath(); c.moveTo(x + 4, y + ph * 0.64); c.lineTo(x + pw - 4, y + ph * 0.64); c.stroke();
        c.setLineDash([]);
        c.fillStyle = "rgba(170,140,255,0.12)";
        c.beginPath(); c.moveTo(x + pw * 0.3, y); c.lineTo(x + pw * 0.75, y); c.lineTo(x + pw * 0.5, y - 7); c.closePath(); c.fill();
      }
      /* shared inner frame lines + rune edge (kept from V1.2) */
      c.strokeStyle = `rgba(${rune},0.3)`;
      c.lineWidth = 1.4;
      c.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
    }
  }

  private drawCloud(c: CanvasRenderingContext2D, cl: Cloud) {
    const a = Math.min(1, cl.life / 0.5) * 0.9;
    const dark = cl.dark;
    if (!cl.grad) {
      const g = c.createRadialGradient(0, 0, 6, 0, 0, cl.r);
      if (dark) {
        g.addColorStop(0, "rgba(110,63,217,0.26)");
        g.addColorStop(0.7, "rgba(110,63,217,0.12)");
        g.addColorStop(1, "rgba(110,63,217,0)");
      } else {
        g.addColorStop(0, "rgba(126,217,87,0.20)");
        g.addColorStop(0.7, "rgba(126,217,87,0.10)");
        g.addColorStop(1, "rgba(126,217,87,0)");
      }
      cl.grad = g;
    }
    c.save();
    c.translate(cl.x, cl.y);
    c.globalAlpha = a;
    c.fillStyle = cl.grad;
    c.beginPath(); c.arc(0, 0, cl.r, 0, TAU); c.fill();
    c.strokeStyle = dark ? "rgba(208,150,255,0.55)" : "rgba(185,242,154,0.5)";
    c.lineWidth = 1.6;
    c.setLineDash([7, 9]);
    c.lineDashOffset = -this.t * 26;
    c.beginPath(); c.arc(0, 0, cl.r * 0.92, 0, TAU); c.stroke();
    c.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const a2 = this.t * 0.8 + i * 2.1 + cl.x * 0.01;
      c.fillStyle = dark ? "rgba(208,150,255,0.45)" : "rgba(185,242,154,0.4)";
      c.beginPath();
      c.arc(Math.cos(a2) * cl.r * 0.5, Math.sin(a2) * cl.r * 0.42, 3, 0, TAU);
      c.fill();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  private drawBubble(c: CanvasRenderingContext2D, b: Bubble) {
    const a = Math.min(1, b.life / 0.4);
    if (!b.grad) {
      const g = c.createRadialGradient(0, 0, 10, 0, 0, b.r);
      g.addColorStop(0, "rgba(107,240,194,0.10)");
      g.addColorStop(1, "rgba(107,240,194,0.02)");
      b.grad = g;
    }
    c.save();
    c.translate(b.x, b.y);
    c.globalAlpha = a;
    c.fillStyle = b.grad;
    c.beginPath(); c.arc(0, 0, b.r, 0, TAU); c.fill();
    c.strokeStyle = "rgba(107,240,194,0.6)";
    c.lineWidth = 2;
    c.setLineDash([10, 12]);
    c.lineDashOffset = -this.t * 40;
    c.beginPath(); c.arc(0, 0, b.r, 0, TAU); c.stroke();
    c.setLineDash([]);
    c.font = "700 11px 'Alegreya Sans'";
    c.fillStyle = "rgba(192,255,230,0.8)";
    c.textAlign = "center";
    c.fillText("CHRONO LOCK", 0, -b.r - 8);
    c.restore();
    c.globalAlpha = 1;
  }

  private drawRock(c: CanvasRenderingContext2D, r: Rock) {
    const fade = Math.min(1, r.life / 0.8);
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.beginPath(); c.ellipse(r.x + 3, r.y + r.r * 0.8, r.r * 0.95, r.r * 0.4, 0, 0, TAU); c.fill();
    if (!r.grad) {
      const g = c.createRadialGradient(-r.r * 0.3, -r.r * 0.3, 3, 0, 0, r.r);
      g.addColorStop(0, "#8d7355");
      g.addColorStop(1, "#4a3826");
      r.grad = g;
    }
    c.save();
    c.translate(r.x, r.y);
    c.globalAlpha = fade;
    c.fillStyle = r.grad;
    c.beginPath(); c.arc(0, 0, r.r, 0, TAU); c.fill();
    c.strokeStyle = "rgba(238,195,144,0.5)";
    c.lineWidth = 1.6;
    c.stroke();
    c.strokeStyle = "rgba(30,20,10,0.5)";
    c.beginPath();
    c.moveTo(-r.r * 0.5, -r.r * 0.2);
    c.lineTo(0, r.r * 0.1);
    c.lineTo(r.r * 0.4, -r.r * 0.3);
    c.stroke();
    if (r.hp < r.maxHp * 0.6) {
      c.beginPath();
      c.moveTo(-r.r * 0.2, -r.r * 0.6);
      c.lineTo(r.r * 0.15, 0);
      c.lineTo(-r.r * 0.1, r.r * 0.5);
      c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  private drawMote(c: CanvasRenderingContext2D, m: Mote) {
    const a = Math.min(1, m.life / 1.2);
    /* V1.1 AUDIT FIX (perf) — the glowing diamond is pre-rendered ONCE to an
       offscreen sprite (glow baked in at device resolution) and blitted with
       drawImage. The old path set shadowBlur=8 per mote — the classic
       Canvas2D software-blur killer — for up to 130 motes/frame, dominating
       the p95 frame-time tail during mote vacuums at DPR 2. */
    const spr = this.ensureMoteSprite();
    c.save();
    c.translate(m.x, m.y);
    c.rotate(this.t * 3 + m.x);
    c.globalAlpha = a;
    c.drawImage(spr, -MOTE_SPRITE / 2, -MOTE_SPRITE / 2, MOTE_SPRITE, MOTE_SPRITE);
    c.restore();
  }

  /** V1.1 — builds (once) the offscreen mote sprite: the 9px gold diamond
      with its #f5c96b halo baked at 2× device resolution so the blit stays
      crisp at every gfx preset's DPR cap. */
  private ensureMoteSprite(): HTMLCanvasElement {
    if (this.moteSprite) return this.moteSprite;
    const dpr = Math.max(1, Math.min(2, this.dpr * 2));
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(MOTE_SPRITE * dpr);
    cv.height = Math.ceil(MOTE_SPRITE * dpr);
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    g.translate(MOTE_SPRITE / 2, MOTE_SPRITE / 2);
    g.fillStyle = "#ffe9ad";
    g.shadowColor = "#f5c96b";
    g.shadowBlur = 8;
    g.beginPath();
    g.moveTo(0, -4.5); g.lineTo(3.4, 0); g.lineTo(0, 4.5); g.lineTo(-3.4, 0);
    g.closePath(); g.fill();
    this.moteSprite = cv;
    return cv;
  }

  /* Patch 11.0 — DROP ORBS, one distinct silhouette per drop type:
     • SPELL TEAR — the element-tinted diamond rune with its rotating sigil
       ring (the classic glyph, now with an additive outer bloom).
     • HEART OF THE FALLEN — a pulsing crimson heart inside a slow triquetra
       halo; trailing vitality motes rise off it.
     • RESONANCE ORB — twin interlocked diamonds (gold × violet) rotating
       against each other inside a prismatic ring — it reads as MERGE before
       you ever read the banner. */
  private drawDrop(c: CanvasRenderingContext2D, d: SpellDrop) {
    if (d.life <= 0) return;
    const a = Math.min(1, d.life / 1.5);
    c.save();
    c.translate(d.x, d.y);

    if (d.kind === "heart") {
      const pulse = 1 + Math.sin(this.t * 4.6 + d.wob) * 0.1;
      /* Task 2-b — halo gradient cached on the drop (kind/id are immutable;
         the old path built a fresh radial gradient per drop per frame). */
      if (!d.grad) {
        const halo = c.createRadialGradient(0, 0, 4, 0, 0, 30);
        halo.addColorStop(0, "rgba(255,77,107,0.75)");
        halo.addColorStop(1, "rgba(255,77,107,0)");
        d.grad = halo;
      }
      c.globalAlpha = a * 0.9;
      c.fillStyle = d.grad;
      c.beginPath(); c.arc(0, 0, 30, 0, TAU); c.fill();
      /* slow triquetra halo — three sweeping arcs */
      c.strokeStyle = "rgba(255,163,181,0.75)";
      c.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const ph = this.t * 0.9 + (i / 3) * TAU;
        c.beginPath();
        c.arc(Math.cos(ph) * 7, Math.sin(ph) * 7, 15, ph + 0.6, ph + 2.6);
        c.stroke();
      }
      /* the heart itself (two lobes + tip), beating */
      c.globalAlpha = a;
      c.fillStyle = "#ff4d6b";
      c.shadowColor = "#ffa3b5";
      c.shadowBlur = 16;
      const hr = 8.5 * pulse;
      c.beginPath();
      c.moveTo(0, hr * 0.95);
      c.bezierCurveTo(-hr * 1.35, -hr * 0.15, -hr * 0.62, -hr * 1.25, 0, -hr * 0.42);
      c.bezierCurveTo(hr * 0.62, -hr * 1.25, hr * 1.35, -hr * 0.15, 0, hr * 0.95);
      c.closePath(); c.fill();
      c.shadowBlur = 0;
      /* gleam */
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.globalAlpha = a * 0.85;
      c.beginPath(); c.arc(-2.4, -3.4, 2, 0, TAU); c.fill();
      c.restore();
      c.globalAlpha = 1;
      return;
    }

    if (d.kind === "resonance") {
      /* prismatic twin diamonds — gold and violet rotating against each other */
      if (!d.grad) {
        const halo = c.createRadialGradient(0, 0, 4, 0, 0, 32);
        halo.addColorStop(0, "rgba(255,233,173,0.7)");
        halo.addColorStop(0.55, "rgba(176,107,255,0.35)");
        halo.addColorStop(1, "rgba(176,107,255,0)");
        d.grad = halo;
      }
      c.globalAlpha = a * 0.9;
      c.fillStyle = d.grad;
      c.beginPath(); c.arc(0, 0, 32, 0, TAU); c.fill();
      /* counter-rotating sigil ticks — reads as "fusion" at a glance */
      c.strokeStyle = "#ffe9ad";
      c.lineWidth = 1.5;
      c.save();
      c.rotate(this.t * 1.1);
      for (let i = 0; i < 8; i++) {
        c.rotate(TAU / 8);
        c.beginPath(); c.moveTo(14, 0); c.lineTo(18, 0); c.stroke();
      }
      c.restore();
      c.strokeStyle = "rgba(176,107,255,0.9)";
      c.save();
      c.rotate(-this.t * 0.8);
      for (let i = 0; i < 6; i++) {
        c.rotate(TAU / 6);
        c.beginPath(); c.moveTo(11, 0); c.lineTo(14, 0); c.stroke();
      }
      c.restore();
      /* the twin diamonds */
      const rr = 9 + Math.sin(this.t * 3.4 + d.wob) * 0.9;
      c.globalAlpha = a;
      c.shadowBlur = 14;
      c.fillStyle = "#ffe9ad";
      c.shadowColor = "#ffe9ad";
      c.save();
      c.rotate(this.t * 1.6);
      c.beginPath();
      c.moveTo(0, -rr); c.lineTo(rr * 0.62, 0); c.lineTo(0, rr); c.lineTo(-rr * 0.62, 0);
      c.closePath(); c.fill();
      c.restore();
      c.fillStyle = "#b06bff";
      c.shadowColor = "#b06bff";
      c.save();
      c.rotate(-this.t * 1.1 + Math.PI / 4);
      const r2 = rr * 0.78;
      c.beginPath();
      c.moveTo(0, -r2); c.lineTo(r2 * 0.62, 0); c.lineTo(0, r2); c.lineTo(-r2 * 0.62, 0);
      c.closePath(); c.fill();
      c.restore();
      c.shadowBlur = 0;
      /* white-hot seam where the two runes kiss */
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.globalAlpha = a * 0.9;
      c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fill();
      c.restore();
      c.globalAlpha = 1;
      return;
    }

    /* ——— SPELL TEAR — the classic element glyph, now with an additive bloom ——— */
    const sp = SPELLS[d.id];
    const pulse = 1 + Math.sin(this.t * 4 + d.wob) * 0.08;
    if (!d.grad) {
      const halo = c.createRadialGradient(0, 0, 4, 0, 0, 28);
      halo.addColorStop(0, sp.color + "cc");
      halo.addColorStop(1, sp.color + "00");
      d.grad = halo;
    }
    c.globalAlpha = a * 0.85;
    c.fillStyle = d.grad;
    c.beginPath(); c.arc(0, 0, 28, 0, TAU); c.fill();
    /* rotating sigil ring */
    c.rotate(this.t * 1.4);
    c.globalAlpha = a * 0.9;
    c.strokeStyle = sp.color;
    c.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) {
      c.rotate(TAU / 6);
      c.beginPath();
      c.moveTo(13, 0);
      c.lineTo(17, 0);
      c.stroke();
    }
    c.rotate(-this.t * 1.4);
    /* core diamond */
    c.globalAlpha = a;
    c.fillStyle = sp.color;
    c.shadowColor = sp.glow;
    c.shadowBlur = 18;
    const r = 8 * pulse;
    c.beginPath();
    c.moveTo(0, -r); c.lineTo(r * 0.7, 0); c.lineTo(0, r); c.lineTo(-r * 0.7, 0);
    c.closePath(); c.fill();
    /* inner highlight */
    c.shadowBlur = 0;
    c.fillStyle = sp.glow;
    c.globalAlpha = a * 0.8;
    c.beginPath();
    c.arc(-1.5, -1.5, 2.4, 0, TAU); c.fill();
    c.restore();
    c.globalAlpha = 1;
  }

  private drawLockBracket(c: CanvasRenderingContext2D) {
    if (this.phase !== "running") return;
    const e = this.enemyNearCursor(85);
    if (!e) return;
    const s = e.r + 10 + Math.sin(this.t * 8) * 2;
    c.save();
    c.translate(e.x, e.y);
    c.rotate(this.t * 1.6);
    c.strokeStyle = "rgba(245,201,107,0.85)";
    c.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.beginPath();
      c.moveTo(s, s * 0.45); c.lineTo(s, s); c.lineTo(s * 0.45, s);
      c.stroke();
    }
    c.restore();
  }

  private drawEnemy(c: CanvasRenderingContext2D, e: Enemy) {
    const ang = Math.atan2(this.py - e.y, this.px - e.x);
    /* V1.3 — grounded foes get a stride bounce (feet-planted walk feel);
       flyers keep their hover sine. */
    const bob = e.flying ? Math.sin(e.wob) * 3.5 : -Math.abs(Math.sin(e.wob * 1.7)) * 2.2;
    const x = e.x, y = e.y + bob;

    /* grounded shadow — unsquashed, subtly breathing with airtime */
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.beginPath();
    c.ellipse(e.x, e.y + e.r * 0.85, e.r * 0.85, e.r * 0.34, 0, 0, TAU);
    c.fill();

    /* V1.3 — elite aura: twin counter-rotating dashed rings + a breathing
       outer halo; marked prey reads as REWARD from across the arena. */
    if (e.affix) {
      const col = ELITE_DEFS[e.affix].color;
      c.strokeStyle = col;
      c.globalAlpha = 0.85;
      c.lineWidth = 2;
      c.setLineDash([7, 5]);
      c.lineDashOffset = -this.t * 42;
      c.beginPath(); c.arc(x, y, e.r + 7, 0, TAU); c.stroke();
      c.setLineDash([2, 11]);
      c.lineDashOffset = this.t * 30;
      c.globalAlpha = 0.4 + Math.sin(this.t * 5) * 0.15;
      c.beginPath(); c.arc(x, y, e.r + 13, 0, TAU); c.stroke();
      c.setLineDash([]);
      c.globalAlpha = 1;
    }
    if (e.enraged) {
      /* V1.3 — enrage: pulsing dual ring (the outer one breathes faster) */
      const pl = Math.sin(this.t * 10) * 0.3;
      c.strokeStyle = `rgba(255,77,107,${0.5 + pl})`;
      c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, e.r + 9, 0, TAU); c.stroke();
      c.strokeStyle = `rgba(255,120,140,${0.25 + pl * 0.5})`;
      c.lineWidth = 1.6;
      c.beginPath(); c.arc(x, y, e.r + 15 + Math.sin(this.t * 10) * 2, 0, TAU); c.stroke();
    }

    c.save();
    c.translate(x, y);
    /* V1.3 — IMPACT SQUASH: volume-preserving squeeze along the impact axis
       with an eased spring-back as the timer drains (crisp bite → soft
       settle). The whole model — body, gear, eyes — deforms as one. */
    if (e.sq > 0) {
      const k = e.sq / 0.18;
      const q = 1 - (1 - k) * (1 - k);
      const s = q * q;
      c.rotate(e.sqA);
      c.scale(1 - 0.30 * s, 1 + 0.26 * s);
      c.rotate(-e.sqA);
    }

    if (e.flying) {
      /* V1.3 — wings beat in the glow color, brighter + faster flap */
      const flap = Math.sin(e.wob * 2.4) * 0.55;
      c.strokeStyle = e.glow;
      c.globalAlpha = 0.6;
      c.lineWidth = 2.2;
      c.beginPath();
      c.arc(-e.r, -2, e.r * 0.95, -1.05 - flap, 0.5 + flap * 0.4);
      c.stroke();
      c.beginPath();
      c.arc(e.r, -2, e.r * 0.95, Math.PI - 0.5 - flap * 0.4, Math.PI + 1.05 + flap);
      c.stroke();
      c.globalAlpha = 1;
    }

    /* body — gradient cached per enemy, origin-relative */
    if (!e.grad) {
      const g = c.createRadialGradient(-e.r * 0.3, -e.r * 0.35, e.r * 0.15, 0, 0, e.r);
      g.addColorStop(0, e.glow);
      g.addColorStop(0.35, e.color);
      g.addColorStop(1, "#120b24");
      e.grad = g;
    }
    c.fillStyle = e.grad;
    c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.fill();
    /* V1.3 — LIGHT MODEL: cool rim light along the top-left + an under-shade
       chord along the bottom — every foe now reads as a lit, grounded form
       instead of a flat disc. */
    c.strokeStyle = "rgba(235,240,255,0.22)";
    c.lineWidth = Math.max(1.5, e.r * 0.12);
    c.beginPath(); c.arc(0, 0, e.r - 0.9, -2.35, -0.85); c.stroke();
    c.fillStyle = "rgba(8,5,18,0.22)";
    c.beginPath(); c.arc(0, 0, e.r - 0.7, 0.55, Math.PI - 0.55); c.closePath(); c.fill();
    c.strokeStyle = "rgba(10,6,20,0.8)";
    c.lineWidth = 1.6;
    c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.stroke();

    /* per-type layered detail — drawn in the SAME local/squash space */
    this.drawEnemyDetail(c, e, ang);

    /* eyes — local space; pupils track the mage (white while dashing) */
    const ex = Math.cos(ang) * e.r * 0.34, ey = Math.sin(ang) * e.r * 0.34;
    const pr = Math.max(1.6, e.r * 0.11);
    c.fillStyle = e.actState === 2 ? "#ffffff" : e.glow;
    c.beginPath();
    c.arc(ex - Math.sin(ang) * e.r * 0.24, ey + Math.cos(ang) * e.r * 0.24, pr, 0, TAU);
    c.arc(ex + Math.sin(ang) * e.r * 0.24, ey - Math.cos(ang) * e.r * 0.24, pr, 0, TAU);
    c.fill();
    /* V1.3 — dark pupils aimed at the mage (glow-only for dash state) */
    if (e.actState !== 2) {
      c.fillStyle = "rgba(10,6,20,0.9)";
      const pxp = ex + Math.cos(ang) * pr * 0.42, pyp = ey + Math.sin(ang) * pr * 0.42;
      c.beginPath();
      c.arc(pxp - Math.sin(ang) * e.r * 0.24, pyp + Math.cos(ang) * e.r * 0.24, pr * 0.42, 0, TAU);
      c.arc(pxp + Math.sin(ang) * e.r * 0.24, pyp - Math.cos(ang) * e.r * 0.24, pr * 0.42, 0, TAU);
      c.fill();
    }

    if (e.hitFlash > 0) {
      c.globalAlpha = (e.hitFlash / 0.12) * 0.85;
      c.fillStyle = "#ffffff";
      c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.fill();
      c.globalAlpha = 1;
    }
    c.restore();

    /* status overlays + readability UI stay in unsquashed world space */
    if (e.chillT > 0) {
      c.strokeStyle = "rgba(127,216,255,0.85)";
      c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, e.r + 3, 0, TAU); c.stroke();
      c.strokeStyle = "rgba(127,216,255,0.4)";
      c.lineWidth = 1;
      c.setLineDash([4, 6]);
      c.lineDashOffset = this.t * 18;
      c.beginPath(); c.arc(x, y, e.r + 7, 0, TAU); c.stroke();
      c.setLineDash([]);
    }
    if (e.poisonT > 0) {
      c.strokeStyle = "rgba(126,217,87,0.8)";
      c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, e.r + 3.5, 0, TAU); c.stroke();
    }

    /* Patch 7.0 — elite HP bar (Dead-Cells-style readability): affix bearers
       and heavyweight foes show a slim bar once damaged. Two fillRects, no
       allocations — negligible cost even at the spawn cap. */
    if (e.hp < e.maxHp && (e.affix || e.r >= 19)) {
      const bw = Math.max(26, e.r * 2.2);
      const bx = x - bw / 2;
      const by = y - e.r - (e.affix ? 16 : 10);
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      c.fillStyle = "rgba(6,4,14,0.72)";
      c.fillRect(bx - 1, by - 1, bw + 2, 5);
      c.fillStyle = e.affix ? ELITE_DEFS[e.affix].color : "#ff8ba0";
      c.fillRect(bx, by, bw * frac, 3);
    }

    /* shot telegraph — ranged foes glow while charging (kept: it reads well) */
    if ((e.ranged || e.type === "boss") && e.shootT < 0.45 && e.shootT > 0) {
      const k = 1 - e.shootT / 0.45;
      c.strokeStyle = `rgba(255,180,110,${0.3 + k * 0.55})`;
      c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, e.r + 5 + (1 - k) * 8, 0, TAU); c.stroke();
      const mx = Math.cos(ang) * e.r * 0.7, my = Math.sin(ang) * e.r * 0.7;
      c.fillStyle = `rgba(255,225,170,${k * 0.85})`;
      c.beginPath(); c.arc(x + mx, y + my, 2.4 + k * 3.2, 0, TAU); c.fill();
    }

    /* hp arc */
    if (e.hp < e.maxHp && e.type !== "boss") {
      const frac = Math.max(0, e.hp / e.maxHp);
      c.strokeStyle = "rgba(0,0,0,0.55)";
      c.lineWidth = 3.4;
      c.beginPath(); c.arc(x, y, e.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU); c.stroke();
      c.strokeStyle = frac > 0.4 ? e.glow : "#ff4d6b";
      c.beginPath(); c.arc(x, y, e.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke();
    }
  }

  /* V1.3 — PER-TYPE MODELS, fully remodeled. Every silhouette is drawn in
     local space (origin = body center; the caller's squash transform rides
     along). Light sources are consistent (top-left key, cool rim, warm glow
     accents) and each foe has at least one ANIMATED element — ears, plumes,
     flames, blades — so the bestiary reads alive at combat speed.
     All cheap path work; no allocations; ang points toward the mage. */
  private drawEnemyDetail(c: CanvasRenderingContext2D, e: Enemy, ang: number) {
    const r = e.r;
    const t = this.t;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    switch (e.type) {
      case "goblin": {
        /* GUTTER GHOUL — twitching ears, notched cleaver, belly patch */
        const twitch = Math.sin(t * 9 + e.wob) * 0.18;
        c.fillStyle = e.glow;
        c.beginPath();
        c.moveTo(-r * 0.7, -r * 0.32); c.lineTo(-r * 1.5, -r * (0.78 + twitch)); c.lineTo(-r * 0.55, -r * 0.85); c.closePath(); c.fill();
        c.beginPath();
        c.moveTo(r * 0.7, -r * 0.32); c.lineTo(r * 1.5, -r * (0.78 + twitch)); c.lineTo(r * 0.55, -r * 0.85); c.closePath(); c.fill();
        /* notched cleaver aimed at the mage — steel blade + edge light */
        const bl = r * 1.5;
        c.save();
        c.rotate(ang);
        c.fillStyle = "#3a3348";
        c.fillRect(r * 0.35, -r * 0.16, bl * 0.22, r * 0.34);
        c.fillStyle = "#d8d8e8";
        c.beginPath();
        c.moveTo(r * 0.55, -r * 0.2); c.lineTo(r * 0.55 + bl * 0.55, -r * 0.34);
        c.lineTo(r * 0.55 + bl * 0.55, r * 0.1); c.lineTo(r * 0.75 + bl * 0.4, r * 0.2);
        c.lineTo(r * 0.55, r * 0.24); c.closePath(); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.5)";
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(r * 0.55, -r * 0.2); c.lineTo(r * 0.55 + bl * 0.55, -r * 0.34); c.stroke();
        c.restore();
        /* belly patch + tuft */
        c.fillStyle = "rgba(10,8,20,0.28)";
        c.beginPath(); c.ellipse(0, r * 0.34, r * 0.5, r * 0.3, 0, 0, TAU); c.fill();
        c.strokeStyle = e.glow;
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(-r * 0.15, -r * 0.95); c.lineTo(-r * 0.22, -r * 1.2);
        c.moveTo(r * 0.05, -r * 0.98); c.lineTo(r * 0.1, -r * 1.24);
        c.stroke();
        break;
      }
      case "archer": {
        /* OSSUARY ARCHER — hood, cape, strung bow; the arrow nocks as the
           draw charges (shootT) — the telegraph IS the weapon. */
        c.fillStyle = "rgba(48,30,18,0.92)";
        c.beginPath(); c.arc(0, -r * 0.42, r * 0.66, Math.PI * 0.95, Math.PI * 2.05); c.fill();
        c.fillStyle = "rgba(30,19,11,0.85)";
        c.beginPath();
        c.moveTo(-r * 0.62, -r * 0.3);
        c.quadraticCurveTo(-r * 1.05, r * 0.5, -r * 0.5, r * 0.72);
        c.lineTo(-r * 0.3, r * 0.1); c.closePath(); c.fill();
        c.strokeStyle = "#a97b45"; c.lineWidth = 2.2;
        const bx = ca * r * 0.6, by = sa * r * 0.6;
        c.beginPath(); c.arc(bx, by, r * 0.92, ang - 1.15, ang + 1.15); c.stroke();
        const s1x = bx + Math.cos(ang - 1.15) * r * 0.92, s1y = by + Math.sin(ang - 1.15) * r * 0.92;
        const s2x = bx + Math.cos(ang + 1.15) * r * 0.92, s2y = by + Math.sin(ang + 1.15) * r * 0.92;
        const drawPull = e.shootT < 0.45 ? 1 - e.shootT / 0.45 : 0;
        c.strokeStyle = "rgba(240,230,210,0.75)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(s1x, s1y); c.lineTo(bx - ca * r * 0.5 * drawPull, by - sa * r * 0.5 * drawPull); c.lineTo(s2x, s2y); c.stroke();
        if (drawPull > 0.05) {
          /* the nocked arrow, sliding back with the draw */
          c.strokeStyle = "#e8d9b0"; c.lineWidth = 1.6;
          c.beginPath();
          c.moveTo(bx - ca * r * 0.5 * drawPull, by - sa * r * 0.5 * drawPull);
          c.lineTo(bx + ca * r * 0.85, by + sa * r * 0.85);
          c.stroke();
          c.fillStyle = "#f2c99a";
          c.beginPath();
          c.moveTo(bx + ca * r * 0.85 + Math.cos(ang) * 4, by + sa * r * 0.85 + Math.sin(ang) * 4);
          c.lineTo(bx + ca * r * 0.85 + Math.cos(ang - 1.5) * 3.4, by + sa * r * 0.85 + Math.sin(ang - 1.5) * 3.4);
          c.lineTo(bx + ca * r * 0.85 + Math.cos(ang + 1.5) * 3.4, by + sa * r * 0.85 + Math.sin(ang + 1.5) * 3.4);
          c.closePath(); c.fill();
        }
        break;
      }
      case "swarm": {
        /* GRAVEMOTE — velocity ghosting: the mote drags three fading
           afterimages of itself, plus a bright inner spark. */
        for (let i = 1; i <= 3; i++) {
          c.globalAlpha = 0.42 - i * 0.11;
          c.fillStyle = e.color;
          c.beginPath(); c.arc(-e.vx * 0.028 * i, -e.vy * 0.028 * i, r * (1 - i * 0.2), 0, TAU); c.fill();
        }
        c.globalAlpha = 1;
        c.fillStyle = "#ffffff";
        c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill();
        c.strokeStyle = e.glow;
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(0, 0, r * 0.68, t * 3, t * 3 + 2.2); c.stroke();
        break;
      }
      case "imp": {
        /* ASHFIEND — curved horns + pulsing ember heart + grin */
        c.strokeStyle = "#ffb36b"; c.lineWidth = 2.4; c.lineCap = "round";
        c.beginPath();
        c.moveTo(-r * 0.42, -r * 0.78);
        c.quadraticCurveTo(-r * 0.95, -r * 1.15, -r * 0.72, -r * 1.5);
        c.stroke();
        c.beginPath();
        c.moveTo(r * 0.42, -r * 0.78);
        c.quadraticCurveTo(r * 0.95, -r * 1.15, r * 0.72, -r * 1.5);
        c.stroke();
        c.lineCap = "butt";
        const pulse = 0.55 + Math.sin(t * 8 + e.wob) * 0.45;
        c.fillStyle = `rgba(255,150,80,${pulse})`;
        c.beginPath(); c.arc(0, r * 0.05, r * 0.34, 0, TAU); c.fill();
        c.strokeStyle = `rgba(255,220,140,${pulse})`;
        c.lineWidth = 1.4;
        c.beginPath(); c.arc(0, r * 0.05, r * (0.46 + pulse * 0.06), 0, TAU); c.stroke();
        /* grin */
        c.strokeStyle = "rgba(20,10,8,0.75)";
        c.lineWidth = 1.4;
        c.beginPath(); c.arc(0, r * 0.42, r * 0.32, 0.35, Math.PI - 0.35); c.stroke();
        break;
      }
      case "skitter": {
        /* GLOOM SKITTER — six jointed legs with knee articulation,
           antennae + barbed tail (all in full twitch). */
        c.strokeStyle = e.glow; c.lineWidth = 1.7; c.lineCap = "round";
        for (let i = 0; i < 3; i++) {
          const lx = -r * 0.5 + i * r * 0.5;
          const kick = Math.sin(t * 17 + i * 2.1 + e.wob) * r * 0.3;
          /* upper leg → knee → foot */
          c.beginPath();
          c.moveTo(lx, -r * 0.35);
          c.lineTo(lx - r * 0.42, -r * 0.95 + kick);
          c.lineTo(lx - r * 0.68, -r * 1.15 + kick * 1.4);
          c.stroke();
          c.beginPath();
          c.moveTo(lx, r * 0.35);
          c.lineTo(lx - r * 0.42, r * 0.95 - kick);
          c.lineTo(lx - r * 0.68, r * 1.15 - kick * 1.4);
          c.stroke();
        }
        c.lineCap = "butt";
        /* antennae with glowing tips */
        c.strokeStyle = e.color; c.lineWidth = 1.3;
        for (const s2 of [-1, 1]) {
          c.beginPath();
          c.moveTo(s2 * r * 0.3, -r * 0.7);
          c.quadraticCurveTo(s2 * r * 0.6, -r * 1.35, s2 * r * 0.95 + Math.sin(t * 11) * r * 0.12, -r * 1.5);
          c.stroke();
          c.fillStyle = e.glow;
          c.beginPath(); c.arc(s2 * r * 0.95 + Math.sin(t * 11) * r * 0.12, -r * 1.5, 1.6, 0, TAU); c.fill();
        }
        /* barbed tail */
        c.strokeStyle = e.color; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-r * 0.25, 0); c.lineTo(-r * 1.45, Math.sin(t * 9 + e.wob) * r * 0.35); c.stroke();
        c.fillStyle = e.glow;
        c.beginPath();
        c.moveTo(-r * 1.45, Math.sin(t * 9 + e.wob) * r * 0.35);
        c.lineTo(-r * 1.75, Math.sin(t * 9 + e.wob) * r * 0.35 - r * 0.14);
        c.lineTo(-r * 1.75, Math.sin(t * 9 + e.wob) * r * 0.35 + r * 0.14);
        c.closePath(); c.fill();
        break;
      }
      case "bomber": {
        /* PYREHUSK — keg with iron bands + skull mark; the fuse spits and
           the whole body flashes crimson as it primes. */
        c.strokeStyle = "rgba(255,217,168,0.95)"; c.lineWidth = 2; c.lineCap = "round";
        c.beginPath(); c.moveTo(-r * 0.7, -r * 0.6); c.quadraticCurveTo(-r * 1.0, -r * 1.1, -r * 1.05, -r * 1.35); c.stroke();
        c.lineCap = "butt";
        const spark = 0.5 + Math.sin(t * 22) * 0.5;
        c.fillStyle = `rgba(255,232,107,${spark})`;
        c.beginPath(); c.arc(-r * 1.05, -r * 1.42, 2.2 + spark * 1.8, 0, TAU); c.fill();
        /* iron bands */
        c.strokeStyle = "rgba(90,70,60,0.9)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-r * 0.62, -r * 0.3); c.lineTo(r * 0.62, -r * 0.3); c.stroke();
        c.beginPath(); c.moveTo(-r * 0.55, r * 0.42); c.lineTo(r * 0.55, r * 0.42); c.stroke();
        /* skull mark */
        c.fillStyle = "rgba(245,240,225,0.85)";
        c.beginPath(); c.arc(0, r * 0.02, r * 0.3, 0, TAU); c.fill();
        c.fillStyle = "rgba(20,14,10,0.9)";
        c.beginPath();
        c.arc(-r * 0.11, r * -0.03, r * 0.075, 0, TAU);
        c.arc(r * 0.11, r * -0.03, r * 0.075, 0, TAU);
        c.fill();
        c.fillRect(-r * 0.05, r * 0.12, r * 0.1, r * 0.1);
        if (e.actState === 1) {
          const k = 1 - Math.max(0, Math.min(1, e.actT / 0.75));
          c.strokeStyle = `rgba(255,77,107,${0.4 + k * 0.6})`;
          c.lineWidth = 2.5;
          c.setLineDash([10, 7]);
          c.lineDashOffset = -t * 60;
          c.beginPath(); c.arc(0, 0, r + 6 + k * 18, 0, TAU); c.stroke();
          c.setLineDash([]);
        }
        break;
      }
      case "lancer": {
        /* ABYSSAL LANCER — great lance with a fluttering pennant, crest
           plume, crossguard; charge lane telegraph kept. */
        c.save();
        c.rotate(ang);
        c.strokeStyle = "#8fe8dc"; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(r * 0.5, 0); c.lineTo(r * 2.35, 0); c.stroke();
        c.fillStyle = e.glow;
        c.beginPath(); c.moveTo(r * 2.35, 0); c.lineTo(r * 1.85, -r * 0.32); c.lineTo(r * 1.85, r * 0.32); c.closePath(); c.fill();
        c.strokeStyle = "rgba(67,232,216,0.85)"; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(r * 0.6, -r * 0.55); c.lineTo(r * 0.6, r * 0.55); c.stroke();
        /* pennant ribbon streaming behind the tip */
        const fl = Math.sin(t * 10 + e.wob) * r * 0.22;
        c.fillStyle = "rgba(67,232,216,0.75)";
        c.beginPath();
        c.moveTo(r * 1.78, 0);
        c.quadraticCurveTo(r * 1.4, -r * 0.4 + fl, r * 1.05, -r * 0.18 + fl);
        c.quadraticCurveTo(r * 1.4, r * 0.12 - fl * 0.6, r * 1.78, 0);
        c.closePath(); c.fill();
        c.restore();
        /* crest plume */
        c.strokeStyle = e.glow; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, -r * 0.85);
        c.quadraticCurveTo(Math.sin(t * 7) * r * 0.3 - r * 0.2, -r * 1.5, Math.sin(t * 7) * r * 0.4 - r * 0.35, -r * 1.7);
        c.stroke();
        if (e.actState === 1) {
          c.strokeStyle = `rgba(255,77,107,${0.35 + Math.sin(t * 18) * 0.25})`;
          c.lineWidth = 3;
          c.setLineDash([12, 8]);
          c.lineDashOffset = -t * 90;
          c.beginPath(); c.moveTo(0, 0); c.lineTo(ca * 620, sa * 620); c.stroke();
          c.setLineDash([]);
        }
        break;
      }
      case "warden": {
        /* TEMPEST HERALD — halo + tri-orbit rings + twin storm orbs with
           crackling arcs between them. */
        c.strokeStyle = "rgba(127,178,255,0.9)"; c.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const a2 = t * 1.8 + (i / 3) * TAU;
          c.beginPath(); c.arc(0, 0, r * 1.35, a2, a2 + 1.5); c.stroke();
        }
        c.strokeStyle = `rgba(201,224,255,${0.6 + Math.sin(t * 4) * 0.25})`;
        c.lineWidth = 1.8;
        c.beginPath(); c.ellipse(0, -r * 1.25, r * 0.55, r * 0.16, 0, 0, TAU); c.stroke();
        /* twin storm orbs + arc between */
        const oa = t * 2.6;
        const o1x = Math.cos(oa) * r * 0.85, o1y = Math.sin(oa) * r * 0.5;
        const o2x = -o1x, o2y = -o1y;
        c.fillStyle = "#c9e0ff";
        c.beginPath(); c.arc(o1x, o1y, r * 0.14, 0, TAU); c.fill();
        c.beginPath(); c.arc(o2x, o2y, r * 0.14, 0, TAU); c.fill();
        c.strokeStyle = `rgba(170,210,255,${0.35 + Math.sin(t * 16) * 0.25})`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(o1x, o1y);
        c.quadraticCurveTo(Math.sin(t * 19) * r * 0.4, Math.cos(t * 17) * r * 0.4, o2x, o2y);
        c.stroke();
        c.fillStyle = `rgba(201,224,255,${0.55 + Math.sin(t * 6) * 0.3})`;
        c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill();
        break;
      }
      case "mender": {
        /* CORPSEWEAVER — healer's cross halo + web-thread focus +
           spider-leg feelers at the hem. */
        c.strokeStyle = e.glow; c.lineWidth = 2;
        c.setLineDash([3, 4]);
        c.lineDashOffset = -t * 22;
        c.beginPath(); c.arc(0, 0, r * 1.3, 0, TAU); c.stroke();
        c.setLineDash([]);
        c.strokeStyle = `rgba(242,166,255,${0.6 + Math.sin(t * 5) * 0.3})`;
        c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(0, -r * 0.7); c.lineTo(0, r * 0.7); c.moveTo(-r * 0.7, 0); c.lineTo(r * 0.7, 0); c.stroke();
        /* feelers */
        c.strokeStyle = "rgba(242,166,255,0.55)"; c.lineWidth = 1.3;
        for (let i = 0; i < 4; i++) {
          const fa = -Math.PI * 0.15 - i * 0.5 + Math.sin(t * 6 + i) * 0.15;
          c.beginPath();
          c.moveTo(Math.cos(fa) * r * 0.6, Math.sin(fa) * r * 0.6);
          c.lineTo(Math.cos(fa) * r * 1.45, Math.sin(fa) * r * 1.45);
          c.stroke();
        }
        break;
      }
      case "knight": {
        /* RUSTBOUND KNIGHT — full helm with a glowing T-visor, riveted
           pauldrons, tower shield with boss + rust scratches. */
        c.fillStyle = "rgba(15,12,30,0.9)";
        c.beginPath(); c.arc(0, -r * 0.18, r * 0.62, Math.PI * 0.9, Math.PI * 2.1); c.fill();
        c.strokeStyle = "#d4ddf2"; c.lineWidth = 2.6;
        c.beginPath(); c.arc(-r * 0.55, -r * 0.25, r * 0.4, Math.PI * 0.85, Math.PI * 1.95); c.stroke();
        c.beginPath(); c.arc(r * 0.55, -r * 0.25, r * 0.4, Math.PI * 1.05, Math.PI * 2.15); c.stroke();
        c.fillStyle = "rgba(242,201,154,0.9)";
        for (let i = 0; i < 2; i++) {
          const pa = Math.PI * (1.1 + i * 0.8);
          c.beginPath(); c.arc(Math.cos(pa) * r * 0.62, -r * 0.25 + Math.sin(pa) * r * 0.36, 1.5, 0, TAU); c.fill();
        }
        /* visor slit aimed at the mage */
        c.save();
        c.rotate(ang);
        c.strokeStyle = `rgba(212,221,242,${0.65 + Math.sin(t * 3) * 0.2})`;
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(r * 0.2, -r * 0.16); c.lineTo(r * 0.62, -r * 0.16); c.stroke();
        c.beginPath(); c.moveTo(r * 0.41, -r * 0.16); c.lineTo(r * 0.41, r * 0.2); c.stroke();
        c.restore();
        /* tower shield */
        c.fillStyle = "rgba(154,167,201,0.92)";
        c.save();
        c.rotate(-0.5);
        c.beginPath();
        c.moveTo(-r * 1.05, -r * 0.52);
        c.lineTo(-r * 0.55, -r * 0.52);
        c.lineTo(-r * 0.55, r * 0.52);
        c.lineTo(-r * 1.05, r * 0.32);
        c.closePath(); c.fill();
        c.strokeStyle = "#f2c99a"; c.lineWidth = 1.4;
        c.stroke();
        c.fillStyle = "#f2c99a";
        c.beginPath(); c.arc(-r * 0.8, -r * 0.05, r * 0.12, 0, TAU); c.fill();
        c.strokeStyle = "rgba(120,80,50,0.5)";
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(-r * 0.95, r * 0.1); c.lineTo(-r * 0.68, r * 0.3); c.stroke();
        c.restore();
        break;
      }
      case "assassin": {
        /* SHROUD STALKER — hood shadow, twin karambit daggers with a
           sweeping glint, scarf tail trailing opposite the mage. */
        c.fillStyle = "rgba(6,22,18,0.85)";
        c.beginPath(); c.arc(0, -r * 0.32, r * 0.72, Math.PI * 0.95, Math.PI * 2.05); c.fill();
        /* scarf */
        const sw = Math.sin(t * 8 + e.wob) * r * 0.3;
        c.strokeStyle = "rgba(110,231,200,0.8)";
        c.lineWidth = 2.4; c.lineCap = "round";
        c.beginPath();
        c.moveTo(-ca * r * 0.4, -sa * r * 0.4 - r * 0.2);
        c.quadraticCurveTo(-ca * r * 1.1 + sw * 0.4, -sa * r * 1.1 - r * 0.5, -ca * r * 1.6 + sw, -sa * r * 1.6 - r * 0.3);
        c.stroke();
        c.lineCap = "butt";
        /* twin curved daggers, glinting on a slow sweep */
        const glint = Math.max(0, Math.sin(t * 5 + e.wob));
        c.strokeStyle = "#eafffa"; c.lineWidth = 2;
        for (const side of [-1, 1]) {
          c.globalAlpha = 0.75 + glint * 0.25;
          c.beginPath();
          c.moveTo(side * r * 0.85, r * 0.15);
          c.quadraticCurveTo(side * r * 1.3, r * 0.3, side * r * 1.2, r * 0.7);
          c.stroke();
        }
        c.globalAlpha = 1;
        break;
      }
      case "mage": {
        /* UMBRA CULTIST — crooked wide-brim hat with rune band, staff with
           a breathing orb, rope belt with dangling charm. */
        c.fillStyle = "#3a2a6e";
        c.beginPath();
        c.moveTo(-r * 0.95, -r * 0.5);
        c.quadraticCurveTo(-r * 0.2, -r * 1.75, r * 0.28, -r * 1.55);
        c.lineTo(r * 0.95, -r * 0.5);
        c.closePath(); c.fill();
        c.strokeStyle = "rgba(198,186,255,0.85)"; c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-r * 0.98, -r * 0.5);
        c.quadraticCurveTo(0, -r * 0.36, r * 0.98, -r * 0.55);
        c.stroke();
        /* rune band */
        c.fillStyle = e.glow;
        for (let i = 0; i < 3; i++) {
          const rx = -r * 0.55 + i * r * 0.55;
          c.fillRect(rx, -r * 0.56, 3, 3.4);
        }
        /* staff + orb */
        c.strokeStyle = "#8a6f5a"; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(ca * r * 0.5, sa * r * 0.5); c.lineTo(ca * r * 1.55, sa * r * 1.55); c.stroke();
        const op = 0.6 + Math.sin(t * 6 + e.wob) * 0.4;
        c.fillStyle = `rgba(198,186,255,${op})`;
        c.beginPath(); c.arc(ca * r * 1.55, sa * r * 1.55, 3.2 + op * 1.4, 0, TAU); c.fill();
        /* belt charm */
        c.strokeStyle = "rgba(198,186,255,0.5)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(-r * 0.3, r * 0.55); c.lineTo(-r * 0.34, r * 0.95 + Math.sin(t * 5) * 2); c.stroke();
        break;
      }
      case "tank": {
        /* BONE COLOSSUS — layered plate arcs with rivets + curving tusks +
           a cracked seam that glows when enraged. */
        c.strokeStyle = "rgba(20,14,10,0.8)"; c.lineWidth = 3;
        c.beginPath(); c.arc(0, 0, r * 0.8, -2.65, -0.45); c.stroke();
        c.beginPath(); c.arc(0, 0, r * 0.52, -2.95, -0.15); c.stroke();
        c.fillStyle = "rgba(196,169,141,0.95)";
        for (let i = 0; i < 4; i++) {
          const a2 = -2.4 + i * 0.6;
          c.beginPath(); c.arc(Math.cos(a2) * r * 0.66, Math.sin(a2) * r * 0.66, 1.8, 0, TAU); c.fill();
        }
        /* tusks */
        c.strokeStyle = "#e8dcc0"; c.lineWidth = 2.6; c.lineCap = "round";
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(side * r * 0.55, r * 0.5);
          c.quadraticCurveTo(side * r * 0.95, r * 0.35, side * r * 0.85, -r * 0.15);
          c.stroke();
        }
        c.lineCap = "butt";
        /* crack seam — glows with fury */
        c.strokeStyle = e.enraged ? `rgba(255,120,90,${0.55 + Math.sin(t * 9) * 0.3})` : "rgba(90,60,45,0.7)";
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-r * 0.1, r * 0.1); c.lineTo(r * 0.12, r * 0.05); c.lineTo(-r * 0.05, r * 0.3);
        c.stroke();
        break;
      }
      case "elemental": {
        /* ERRANT WRAITH — flame-tongue crown + wispy skirt hem + four
           orbiting embers (the wraith has no legs; it drifts). */
        c.strokeStyle = e.glow; c.lineWidth = 1.8; c.lineCap = "round";
        for (let i = 0; i < 4; i++) {
          const fa = -Math.PI / 2 + (i - 1.5) * 0.42;
          const fs = Math.sin(t * 7 + i * 1.9) * r * 0.22;
          c.beginPath();
          c.moveTo(Math.cos(fa) * r * 0.55, Math.sin(fa) * r * 0.55);
          c.quadraticCurveTo(Math.cos(fa) * r * 1.1, Math.sin(fa) * r * 1.1 - r * 0.2, Math.cos(fa) * r * 1.3 + fs * 0.4, Math.sin(fa) * r * 1.3 - r * 0.45 + fs);
          c.stroke();
        }
        c.lineCap = "butt";
        /* hem — three wavy scallops */
        c.strokeStyle = e.color; c.lineWidth = 1.4;
        c.beginPath();
        for (let i = 0; i <= 6; i++) {
          const hx = -r * 0.85 + (i / 6) * r * 1.7;
          const hy = r * (0.85 + Math.sin(t * 5 + i * 1.3) * 0.12);
          if (i === 0) c.moveTo(hx, hy); else c.lineTo(hx, hy);
        }
        c.stroke();
        /* molten core + orbiting embers */
        c.fillStyle = `rgba(255,255,255,${0.5 + Math.sin(t * 5) * 0.3})`;
        c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill();
        c.fillStyle = e.glow;
        for (let i = 0; i < 4; i++) {
          const a2 = t * 2.2 + (i / 4) * TAU;
          const sx2 = Math.cos(a2) * r * 1.15, sy2 = Math.sin(a2) * r * 1.15;
          c.save(); c.translate(sx2, sy2); c.rotate(a2 * 2);
          c.beginPath(); c.moveTo(0, -4.5); c.lineTo(3.2, 2.4); c.lineTo(-3.2, 2.4); c.closePath(); c.fill();
          c.restore();
        }
        break;
      }
      case "necromancer": {
        /* BONESPEAKER — skull face with a glowing gaze + jaw, bone staff
           crowned by a two-tone green flame. */
        c.fillStyle = "rgba(240,235,215,0.92)";
        c.beginPath(); c.arc(0, -r * 0.16, r * 0.56, 0, TAU); c.fill();
        c.fillStyle = "rgba(240,235,215,0.8)";
        c.fillRect(-r * 0.22, r * 0.28, r * 0.44, r * 0.2);
        c.fillStyle = `rgba(185,242,154,${0.75 + Math.sin(t * 5) * 0.25})`;
        c.beginPath(); c.arc(-r * 0.22, -r * 0.24, r * 0.15, 0, TAU); c.fill();
        c.beginPath(); c.arc(r * 0.22, -r * 0.24, r * 0.15, 0, TAU); c.fill();
        c.fillStyle = "rgba(20,16,10,0.9)";
        c.beginPath(); c.moveTo(0, -r * 0.02); c.lineTo(r * 0.12, r * 0.14); c.lineTo(-r * 0.12, r * 0.14); c.closePath(); c.fill();
        /* staff + brazier flame */
        c.strokeStyle = "#ddd6c0"; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(ca * r * 0.6, sa * r * 0.6); c.lineTo(ca * r * 1.6, sa * r * 1.6); c.stroke();
        const fx2 = ca * r * 1.6, fy2 = sa * r * 1.6;
        const flick = Math.sin(t * 9 + e.wob) * 2;
        c.fillStyle = "rgba(126,217,87,0.9)";
        c.beginPath();
        c.moveTo(fx2, fy2 - 7 - flick);
        c.quadraticCurveTo(fx2 + 4, fy2 - 2, fx2, fy2 + 2.5);
        c.quadraticCurveTo(fx2 - 4, fy2 - 2, fx2, fy2 - 7 - flick);
        c.fill();
        c.fillStyle = "rgba(221,242,154,0.9)";
        c.beginPath(); c.arc(fx2, fy2 - 1, 1.8, 0, TAU); c.fill();
        break;
      }
      case "shadow": {
        /* NIGHTMARE SHADE — jagged dissolving hem + curved grasping tendrils
           + a colder, darker core. */
        c.strokeStyle = e.glow; c.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const a2 = t * 2.6 + i * 1.57;
          const ox = Math.cos(a2) * r * 1.55, oy = Math.sin(a2) * r * 1.55;
          const midx = Math.cos(a2 + 0.45) * r * 1.15, midy = Math.sin(a2 + 0.45) * r * 1.15;
          c.beginPath();
          c.moveTo(Math.cos(a2) * r * 0.75, Math.sin(a2) * r * 0.75);
          c.quadraticCurveTo(midx, midy, ox, oy);
          c.stroke();
        }
        /* jagged hem */
        c.fillStyle = "rgba(6,3,14,0.85)";
        c.beginPath();
        c.moveTo(-r * 0.9, r * 0.3);
        for (let i = 0; i <= 6; i++) {
          const hx = -r * 0.9 + (i / 6) * r * 1.8;
          const hy = r * (0.55 + (i % 2 === 0 ? 0.35 : 0) + Math.sin(t * 6 + i * 2) * 0.1);
          c.lineTo(hx, hy);
        }
        c.lineTo(r * 0.9, r * 0.3);
        c.closePath(); c.fill();
        /* cold core */
        c.fillStyle = "rgba(30,16,52,0.95)";
        c.beginPath(); c.arc(0, -r * 0.05, r * 0.42, 0, TAU); c.fill();
        break;
      }
      case "timewalker": {
        /* CHRONOWRAITH — clock ring with hands + an afterimage echo ring
           running backwards + hourglass pendant. */
        c.strokeStyle = "rgba(107,240,194,0.5)";
        c.lineWidth = 1.4;
        c.beginPath(); c.arc(0, 0, r * 1.55, -t * 1.2, -t * 1.2 + 4.4); c.stroke();
        c.strokeStyle = "rgba(107,240,194,0.75)"; c.lineWidth = 1.7;
        c.setLineDash([3, 5]);
        c.lineDashOffset = t * 14;
        c.beginPath(); c.arc(0, 0, r * 1.25, 0, TAU); c.stroke();
        c.setLineDash([]);
        c.strokeStyle = "#c0ffe6"; c.lineWidth = 1.9; c.lineCap = "round";
        const ha = t * 2.4;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(ha) * r * 0.95, Math.sin(ha) * r * 0.95); c.stroke();
        c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(ha * 0.25 - 1.2) * r * 0.55, Math.sin(ha * 0.25 - 1.2) * r * 0.55); c.stroke();
        c.lineCap = "butt";
        /* hourglass pendant */
        c.strokeStyle = "rgba(192,255,230,0.9)"; c.lineWidth = 1.3;
        c.strokeRect(-r * 0.16, r * 0.35, r * 0.32, r * 0.42);
        c.beginPath();
        c.moveTo(-r * 0.14, r * 0.38); c.lineTo(r * 0.14, r * 0.38);
        c.moveTo(-r * 0.14, r * 0.74); c.lineTo(r * 0.14, r * 0.74);
        c.moveTo(-r * 0.12, r * 0.4); c.lineTo(r * 0.12, r * 0.72);
        c.moveTo(r * 0.12, r * 0.4); c.lineTo(-r * 0.12, r * 0.72);
        c.stroke();
        break;
      }
      case "golem": {
        /* VOIDCAGE GOLEM — faceted cage shell with a breathing captive
           light + orbiting rune plates. */
        c.strokeStyle = "rgba(213,244,255,0.8)"; c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-r * 0.75, -r * 0.5); c.lineTo(0, -r * 0.98); c.lineTo(r * 0.75, -r * 0.5);
        c.lineTo(r * 0.6, r * 0.72); c.lineTo(-r * 0.6, r * 0.72);
        c.closePath(); c.stroke();
        c.beginPath();
        c.moveTo(0, -r * 0.98); c.lineTo(0, r * 0.72);
        c.moveTo(-r * 0.75, -r * 0.5); c.lineTo(r * 0.6, r * 0.72);
        c.moveTo(r * 0.75, -r * 0.5); c.lineTo(-r * 0.6, r * 0.72);
        c.stroke();
        const glow = 0.45 + Math.sin(t * 4 + e.wob) * 0.25;
        c.fillStyle = `rgba(127,216,255,${glow})`;
        c.beginPath(); c.arc(0, 0, r * 0.36, 0, TAU); c.fill();
        c.fillStyle = "rgba(213,244,255,0.95)";
        for (let i = 0; i < 3; i++) {
          const a2 = t * 1.5 + (i / 3) * TAU;
          c.save();
          c.translate(Math.cos(a2) * r * 1.35, Math.sin(a2) * r * 1.35);
          c.rotate(a2 * 1.5);
          c.fillRect(-2.6, -2.6, 5.2, 5.2);
          c.restore();
        }
        break;
      }
      case "voidbeast": {
        /* NULLMAW BEAST — a ring of teeth yawns toward the mage, tendrils
         * grasp outward, and a true void darkens the gullet. */
        const mo = 0.35 + Math.sin(t * 6 + e.wob) * 0.18;
        /* gullet — darker than the body */
        c.fillStyle = "#0a0410";
        c.beginPath(); c.arc(ca * r * 0.32, sa * r * 0.32, r * 0.52, ang - 1.05 - mo, ang + 1.05 + mo); c.closePath(); c.fill();
        /* teeth ring */
        c.fillStyle = "rgba(236,179,255,0.95)";
        for (let i = 0; i < 7; i++) {
          const ta = ang - 0.95 - mo + (i / 6) * (1.9 + mo * 2);
          const tx = ca * r * 0.32 + Math.cos(ta) * r * 0.52;
          const ty = sa * r * 0.32 + Math.sin(ta) * r * 0.52;
          c.beginPath();
          c.moveTo(tx + Math.cos(ta + 1.7) * 3, ty + Math.sin(ta + 1.7) * 3);
          c.lineTo(tx + Math.cos(ta) * r * 0.3, ty + Math.sin(ta) * r * 0.3);
          c.lineTo(tx + Math.cos(ta - 1.7) * 3, ty + Math.sin(ta - 1.7) * 3);
          c.closePath(); c.fill();
        }
        /* grasping tendrils */
        c.strokeStyle = "rgba(236,179,255,0.8)"; c.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a2 = -t * 2 + i * 1.57 + 0.4;
          const wig = Math.sin(t * 5 + i * 2) * 0.35;
          c.beginPath();
          c.moveTo(Math.cos(a2) * r * 0.6, Math.sin(a2) * r * 0.6);
          c.quadraticCurveTo(Math.cos(a2 + wig) * r * 1.05, Math.sin(a2 + wig) * r * 1.05, Math.cos(a2) * r * 1.45, Math.sin(a2) * r * 1.45);
          c.stroke();
        }
        /* inner void spark */
        c.fillStyle = "rgba(208,91,255,0.8)";
        c.beginPath(); c.arc(ca * r * 0.32, sa * r * 0.32, 2.2, 0, TAU); c.fill();
        break;
      }
      case "boss": {
        /* UMBRAL TYRANT — obsidian crown with gem points, curved horns, a
           seething core, orbiting rune blades with motion arcs, and (when
           enraged) flame roots at the crown's base. Charge lane telegraph
           tracks the LIVE aim (V1.1 audit fix, kept). */
        c.fillStyle = "#2a0d18";
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.5;
          const gem = (i === 2) ? 1.52 : 1.38;
          c.beginPath();
          c.moveTo(Math.cos(a - 0.16) * r * 0.9, Math.sin(a - 0.16) * r * 0.9);
          c.lineTo(Math.cos(a) * r * gem, Math.sin(a) * r * gem);
          c.lineTo(Math.cos(a + 0.16) * r * 0.9, Math.sin(a + 0.16) * r * 0.9);
          c.closePath(); c.fill();
        }
        /* center gem catches light */
        c.fillStyle = `rgba(255,139,160,${0.5 + Math.sin(t * 3) * 0.2})`;
        c.beginPath(); c.arc(0, -r * 1.38, 4, 0, TAU); c.fill();
        /* horns — curved, tipped brighter */
        c.strokeStyle = "#ff4d6b"; c.lineWidth = 3.4; c.lineCap = "round";
        c.beginPath(); c.moveTo(-r * 0.75, -r * 0.6); c.quadraticCurveTo(-r * 1.35, -r * 1.1, -r * 1.05, -r * 1.55); c.stroke();
        c.beginPath(); c.moveTo(r * 0.75, -r * 0.6); c.quadraticCurveTo(r * 1.35, -r * 1.1, r * 1.05, -r * 1.55); c.stroke();
        c.lineCap = "butt";
        /* seething core — enraged beats twice as fast */
        const core = 0.55 + Math.sin(t * (e.enraged ? 14 : 6)) * 0.3;
        c.fillStyle = `rgba(255,120,140,${core})`;
        c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill();
        c.strokeStyle = `rgba(255,180,190,${core * 0.7})`;
        c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, 0, r * 0.44, 0, TAU); c.stroke();
        /* orbiting rune blades + motion arcs */
        c.strokeStyle = "rgba(255,139,160,0.35)";
        c.lineWidth = 2.4;
        for (let i = 0; i < 4; i++) {
          const a2 = t * 1.4 + (i / 4) * TAU;
          const orx = Math.cos(a2) * (r + 16), ory = Math.sin(a2) * (r + 16);
          c.beginPath(); c.arc(0, 0, r + 16, a2 - 0.5, a2 - 0.08); c.stroke();
          c.save();
          c.translate(orx, ory);
          c.rotate(a2);
          c.fillStyle = "rgba(255,139,160,0.9)";
          c.fillRect(-3.2, -3.2, 6.4, 6.4);
          c.restore();
        }
        if (e.enraged) {
          /* fury flames licking the crown base */
          c.strokeStyle = `rgba(255,110,120,${0.5 + Math.sin(t * 11) * 0.25})`;
          c.lineWidth = 2;
          for (let i = 0; i < 5; i++) {
            const fa = -Math.PI / 2 + (i - 2) * 0.5;
            const fl = Math.sin(t * 9 + i * 2) * r * 0.1;
            c.beginPath();
            c.moveTo(Math.cos(fa - 0.3) * r * 0.8, Math.sin(fa - 0.3) * r * 0.8);
            c.quadraticCurveTo(Math.cos(fa) * r * 1.1, Math.sin(fa) * r * 1.1, Math.cos(fa) * (r * 0.95 + fl), Math.sin(fa) * (r * 0.95 + fl));
            c.stroke();
          }
        }
        if (e.actState === 1) {
          c.strokeStyle = `rgba(255,77,107,${0.3 + Math.sin(t * 20) * 0.25})`;
          c.lineWidth = 3;
          c.setLineDash([14, 9]);
          c.lineDashOffset = -t * 120;
          c.beginPath(); c.moveTo(0, 0); c.lineTo(ca * 600, sa * 600); c.stroke();
          c.setLineDash([]);
        }
        break;
      }
      default: break;
    }
  }


  private drawPlayer(c: CanvasRenderingContext2D) {
    if (this.hp <= 0 && this.phase === "gameover") return;
    const ang = Math.atan2(this.my - this.py, this.mx - this.px);
    /* Patch 5.0: this.selected is a SLOT index now — translate through the
       equipped array. For merged slots, the primary spell (spells[0]) is
       used for the player's tint + evo overlay; the merged spell's other
       projectiles fire through the castSpell loop. */
    const selSlot = this.equipped[this.selected];
    const selIdx = selSlot && selSlot.spells.length > 0 ? selSlot.spells[0] : 0;
    const sel = SPELLS[SPELL_ORDER[selIdx]];
    const evo = this.evolutions[selIdx];
    const surging = this.surgeT > 0;

    for (const g of this.ghosts) {
      /* V1.3 — dash ghosts are baked glow sprites (soft luminous afterimages
         instead of hard violet discs). */
      const ga = g.life * 1.6;
      c.globalAlpha = ga;
      c.drawImage(this.vfx.glowSpr("#9a7bff"), g.x - 21, g.y - 21, 42, 42);
    }
    c.globalAlpha = 1;

    c.fillStyle = "rgba(0,0,0,0.4)";
    c.beginPath(); c.ellipse(this.px, this.py + 13, 12, 5, 0, 0, TAU); c.fill();

    const blink = this.iframes > 0 && Math.sin(this.t * 40) > 0;
    c.globalAlpha = blink ? 0.45 : 1;

    c.save();
    c.translate(this.px, this.py);

    /* aura — V1.3: the selected element now TINTS the mage's light: a baked
       glow sprite breathes under the violet aura (surge keeps its gold). */
    if (!surging) {
      const breath = 62 + Math.sin(this.t * 2.2) * 7;
      c.globalAlpha = (blink ? 0.4 : 0.3) * (this.iframes > 0 ? 0.6 : 1);
      c.drawImage(this.vfx.glowSpr(sel.color), -breath / 2, -breath / 2, breath, breath);
      c.globalAlpha = blink ? 0.45 : 1;
    }
    c.fillStyle = surging ? this.playerAuraSurge! : this.playerAura!;
    c.beginPath(); c.arc(0, 0, surging ? 46 : 34, 0, TAU); c.fill();

    /* orbiting rune ring — gold when the spell is evolved. V1.3: three
       element motes orbit at a second, slower radius. */
    const ringR = 22 + Math.sin(this.t * 2) * 1.5;
    c.strokeStyle = evo ? "rgba(255,233,173,0.8)" : "rgba(245,201,107,0.45)";
    c.lineWidth = 1.4;
    c.setLineDash([4, 7]);
    c.save();
    c.rotate(this.t * 0.9);
    c.beginPath(); c.arc(0, 0, ringR, 0, TAU); c.stroke();
    c.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      c.rotate(TAU / 3);
      c.fillStyle = evo ? "#ffe9ad" : sel.color;
      c.fillRect(ringR - 2, -1.4, 4, 2.8);
    }
    c.restore();
    if (!this.reducedMotion) {
      const motes = this.o.settings.dmgNumbers ? 3 : 2;   // gentle density tie-in
      for (let i = 0; i < motes; i++) {
        const ma = this.t * -1.6 + (i / motes) * TAU;
        const mr = 30 + Math.sin(this.t * 1.3 + i * 2) * 2.5;
        c.fillStyle = sel.color;
        c.globalAlpha = 0.75;
        c.beginPath(); c.arc(Math.cos(ma) * mr, Math.sin(ma) * mr, 1.7, 0, TAU); c.fill();
        c.globalAlpha = blink ? 0.45 : 1;
      }
    }

    /* Patch 10.0 — FLUID LEAN: the mage's body leans into the direction of
       travel (up to ~2.6px at full stride). The rune ring + aura stay
       centered; only the physical body carries the weight, so aim-facing
       reads unchanged while movement feels alive. */
    const vNow = Math.sqrt(this.pvx * this.pvx + this.pvy * this.pvy);
    const leanK = Math.min(1, vNow / 252);
    c.translate(Math.cos(this.leanA) * 2.6 * leanK, Math.sin(this.leanA) * 2.6 * leanK);

    /* cape — V1.3: TWO-LAYER flutter (a dark inner fold under the violet
       outer sweep) so the cloth reads as depth, not a cutout. */
    const ca = ang + Math.PI;
    const flap = Math.sin(this.t * 7) * 3 + leanK * 2;
    c.fillStyle = "rgba(38,26,72,0.9)";
    c.beginPath();
    c.moveTo(Math.cos(ca - 1.5) * 6, Math.sin(ca - 1.5) * 6 - 3);
    c.quadraticCurveTo(Math.cos(ca) * 20 + flap * 0.6, Math.sin(ca) * 20, Math.cos(ca + 1.5) * 6, Math.sin(ca + 1.5) * 6 + 3);
    c.closePath();
    c.fill();
    c.fillStyle = surging ? "rgba(245,201,107,0.45)" : "rgba(74,53,133,0.88)";
    c.beginPath();
    c.moveTo(Math.cos(ca - 1.9) * 6, Math.sin(ca - 1.9) * 6 - 4);
    c.quadraticCurveTo(Math.cos(ca) * 26 + flap, Math.sin(ca) * 26, Math.cos(ca + 1.9) * 6, Math.sin(ca + 1.9) * 6 + 4);
    c.closePath();
    c.fill();

    /* robe body — layered, with rune clasp */
    c.fillStyle = this.playerBody!;
    c.beginPath();
    c.moveTo(0, -10);
    c.quadraticCurveTo(10, -2, 11, 12);
    c.lineTo(-11, 12);
    c.quadraticCurveTo(-10, -2, 0, -10);
    c.closePath();
    c.fill();
    c.strokeStyle = surging ? "#ffe9ad" : "#f5c96b";
    c.lineWidth = 1.4;
    c.stroke();
    /* chest rune follows the selected element (evolved = double diamond) */
    c.strokeStyle = sel.color;
    c.lineWidth = 1.2;
    const bob = Math.sin(this.t * 3) * 0.8;
    c.beginPath();
    c.moveTo(0, -6 + bob); c.lineTo(3.4, 0 + bob); c.lineTo(0, 6 + bob); c.lineTo(-3.4, 0 + bob); c.closePath();
    c.stroke();
    if (evo) {
      c.beginPath();
      c.moveTo(0, -9 + bob); c.lineTo(5, 0 + bob); c.lineTo(0, 9 + bob); c.lineTo(-5, 0 + bob); c.closePath();
      c.strokeStyle = "rgba(255,233,173,0.75)";
      c.stroke();
      c.strokeStyle = sel.color;
    }

    /* hat — wide brim + element-colored band, tilts with aim */
    c.save();
    c.rotate(Math.cos(ang) * 0.12);
    c.fillStyle = "#33225e";
    c.beginPath();
    c.ellipse(0, -9, 14, 4.5, 0, 0, TAU);
    c.fill();
    c.beginPath();
    c.moveTo(-7, -9);
    c.quadraticCurveTo(-2, -22, 2.5, -30);
    c.quadraticCurveTo(4, -24, 7, -9);
    c.closePath();
    c.fill();
    c.strokeStyle = "rgba(245,201,107,0.7)";
    c.lineWidth = 1.2;
    c.stroke();
    c.fillStyle = sel.color;
    c.fillRect(-6.5, -12.5, 13, 2.4);
    if (evo) {
      c.fillStyle = "#ffe9ad";
      c.beginPath(); c.moveTo(2.5, -30); c.lineTo(4, -34); c.lineTo(5.5, -30); c.closePath(); c.fill();
    }
    c.restore();

    /* staff — V1.3: the crystal sits on a baked glow sprite (the per-frame
       shadowBlur is GONE — that was the single most expensive draw in the
       whole render loop) and gains a fine gold ferrule. */
    const stx = Math.cos(ang) * 24, sty = Math.sin(ang) * 24;
    c.strokeStyle = "#c9955a";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(Math.cos(ang) * 6, Math.sin(ang) * 6);
    c.lineTo(stx, sty);
    c.stroke();
    c.strokeStyle = "rgba(245,201,107,0.5)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(Math.cos(ang) * 6, Math.sin(ang) * 6 - 1.4);
    c.lineTo(stx, sty - 1.4);
    c.stroke();
    /* ferrule band near the tip */
    c.strokeStyle = "#f5c96b";
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(Math.cos(ang) * 19 - Math.sin(ang) * 3, Math.sin(ang) * 19 + Math.cos(ang) * 3);
    c.lineTo(Math.cos(ang) * 19 + Math.sin(ang) * 3, Math.sin(ang) * 19 - Math.cos(ang) * 3);
    c.stroke();
    c.save();
    c.translate(stx, sty);
    const orbR = surging ? 8 : 6.5;
    const haloD = orbR * 6.4;
    c.drawImage(this.vfx.glowSpr(sel.color), -haloD / 2, -haloD / 2, haloD, haloD);
    c.rotate(this.t * 2);
    c.fillStyle = sel.color;
    c.beginPath();
    c.moveTo(0, -orbR); c.lineTo(4, 0); c.lineTo(0, orbR); c.lineTo(-4, 0);
    c.closePath(); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.65)";
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.beginPath(); c.moveTo(0, -orbR); c.lineTo(2, -orbR * 0.3); c.lineTo(0, 0); c.closePath(); c.fill();
    if (evo) {
      c.strokeStyle = "rgba(255,233,173,0.9)";
      c.beginPath();
      c.moveTo(0, -orbR - 4); c.lineTo(3, -orbR - 1); c.lineTo(0, -orbR + 2); c.lineTo(-3, -orbR - 1);
      c.closePath();
      c.stroke();
    }
    c.restore();

    c.restore();
    c.globalAlpha = 1;
  }

  private projGrad(kind: ElementId, r: number): CanvasGradient {
    const key = kind + ":" + r;
    let g = this.projGrads.get(key);
    if (!g) {
      g = this.ctx.createRadialGradient(0, 0, 1, 0, 0, r * 2.4);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, SPELLS[kind].color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      this.projGrads.set(key, g);
    }
    return g;
  }

  /* Patch 11.0 — PROJECTILE VFX OVERHAUL. Every element now flies a
     DISTINCT silhouette with an additive (lighter) glow pass, so a
     Pyroclasm comet never reads as a Gravefrost sliver at combat speed:
       fire    — comet: white-hot core + layered flame tail streaming behind
       ice     — grave-ice sliver: faceted shard + refracted core line
       void    — null rift: black heart, rotating accretion arms, devouring ring
       arcane  — hex star: spinning rune knot + orbiting familiar mote
       blood   — the tithe lance: barbed javelin with a trailing blood mist
       nature  — blight pod: pulsing seed sack with orbiting spores
       wind    — soulscythe: twin crescents + a hollow-gale streak
     All cheap path work — no allocations, gradient cache respected. */
  private drawProj(c: CanvasRenderingContext2D, p: Proj) {
    if (p.kind === "void") {
      c.save();
      c.translate(p.x, p.y);
      let g = this.projGrads.get("void:26");
      if (!g) {
        g = c.createRadialGradient(0, 0, 2, 0, 0, 26);
        g.addColorStop(0, "rgba(20,4,30,1)");
        g.addColorStop(0.5, "rgba(208,91,255,0.65)");
        g.addColorStop(1, "rgba(208,91,255,0)");
        this.projGrads.set("void:26", g);
      }
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, 26, 0, TAU); c.fill();
      /* rotating accretion arms — the rift visibly devours */
      c.strokeStyle = "rgba(236,179,255,0.9)";
      c.lineWidth = 2;
      for (let arm = 0; arm < 2; arm++) {
        const a0 = this.t * (arm === 0 ? 2.6 : -2.2) + arm * Math.PI;
        c.beginPath();
        c.arc(0, 0, 15, a0, a0 + 2.2);
        c.stroke();
      }
      c.strokeStyle = "rgba(236,179,255,0.5)";
      c.lineWidth = 1.4;
      c.setLineDash([4, 8]);
      c.lineDashOffset = -this.t * 60;
      c.beginPath(); c.arc(0, 0, 19, 0, TAU); c.stroke();
      c.setLineDash([]);
      /* the black heart */
      c.fillStyle = "#0a0410";
      c.beginPath(); c.arc(0, 0, 6.5, 0, TAU); c.fill();
      c.restore();
      return;
    }
    const ang = Math.atan2(p.vy, p.vx);
    if (p.kind === "blood") {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(ang);
      /* trailing blood mist (additive) */
      c.globalCompositeOperation = "lighter";
      let mist = this.projGrads.get("bloodmist:24");
      if (!mist) {
        mist = c.createRadialGradient(-14, 0, 2, -14, 0, 24);
        mist.addColorStop(0, "rgba(255,77,107,0.5)");
        mist.addColorStop(1, "rgba(255,77,107,0)");
        this.projGrads.set("bloodmist:24", mist);
      }
      c.fillStyle = mist;
      c.beginPath(); c.arc(-14, 0, 24, 0, TAU); c.fill();
      c.globalCompositeOperation = "source-over";
      /* the barbed javelin */
      c.strokeStyle = "rgba(255,77,107,0.55)";
      c.lineWidth = 7;
      c.beginPath(); c.moveTo(-20, 0); c.lineTo(12, 0); c.stroke();
      c.strokeStyle = "#ffa3b5";
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(-18, 0); c.lineTo(16, 0); c.stroke();
      /* barbs */
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-8, -3); c.lineTo(-4, 0); c.lineTo(-8, 3);
      c.moveTo(2, -3); c.lineTo(6, 0); c.lineTo(2, 3);
      c.stroke();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.moveTo(24, 0); c.lineTo(12, -4); c.lineTo(12, 4);
      c.closePath(); c.fill();
      c.restore();
      return;
    }
    c.save();
    c.translate(p.x, p.y);
    c.rotate(ang);

    /* V1.3 — additive bloom pass: baked glow sprite blit (replaces the
       per-projection gradient fill; the sprite's white-hot core reads hotter
       AND costs one drawImage instead of a gradient fill + arc path). */
    c.globalCompositeOperation = "lighter";
    if (!p.gspr) p.gspr = this.vfx.glowSpr(SPELLS[p.kind].color);
    const bd = p.r * 5.2;
    c.globalAlpha = 0.85;
    c.drawImage(p.gspr, -bd / 2, -bd / 2, bd, bd);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    if (p.kind === "fire") {
      /* COMET — layered flame tail streaming behind the white-hot core */
      const fl = 1 + Math.sin(this.t * 22 + p.x * 0.05) * 0.18;
      c.globalAlpha = 0.75;
      c.fillStyle = "rgba(255,120,71,0.65)";
      c.beginPath();
      c.moveTo(p.r * 1.3, 0);
      c.quadraticCurveTo(-p.r * 2.4 * fl, -p.r * 0.95, -p.r * 4.4 * fl, 0);
      c.quadraticCurveTo(-p.r * 2.4 * fl, p.r * 0.95, p.r * 1.3, 0);
      c.closePath(); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = "#ffb08a";
      c.beginPath();
      c.moveTo(p.r * 1.1, 0);
      c.quadraticCurveTo(-p.r * 1.2 * fl, -p.r * 0.5, -p.r * 2.6 * fl, 0);
      c.quadraticCurveTo(-p.r * 1.2 * fl, p.r * 0.5, p.r * 1.1, 0);
      c.closePath(); c.fill();
      c.fillStyle = "#fff6c0";
      c.beginPath(); c.arc(p.r * 0.25, 0, p.r * 0.62, 0, TAU); c.fill();
    }
    if (p.kind === "ice") {
      /* GRAVEFROST sliver — faceted shard with a refracted core line */
      c.fillStyle = SPELLS.ice.color;
      c.beginPath();
      c.moveTo(p.r * 2.2, 0); c.lineTo(-p.r, p.r * 0.8); c.lineTo(-p.r * 0.5, 0); c.lineTo(-p.r, -p.r * 0.8);
      c.closePath(); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.85)";
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(p.r * 1.9, 0); c.lineTo(-p.r * 0.6, 0);
      c.stroke();
      /* side glints */
      c.strokeStyle = "rgba(200,239,255,0.8)";
      c.beginPath();
      c.moveTo(p.r * 0.7, -p.r * 0.34); c.lineTo(p.r * 0.1, -p.r * 0.42);
      c.stroke();
    }
    if (p.kind === "arcane") {
      /* HEX STAR — spinning rune knot + orbiting familiar mote */
      c.rotate(this.t * 9);
      c.fillStyle = SPELLS.arcane.color;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        c.lineTo(Math.cos(a) * p.r * 1.9, Math.sin(a) * p.r * 1.9);
        c.lineTo(Math.cos(a + Math.PI / 4) * p.r * 0.8, Math.sin(a + Math.PI / 4) * p.r * 0.8);
      }
      c.closePath(); c.fill();
      c.fillStyle = "#e9e2ff";
      const oa = this.t * 6;
      c.beginPath(); c.arc(Math.cos(oa) * p.r * 2.2, Math.sin(oa) * p.r * 2.2, 1.8, 0, TAU); c.fill();
    }
    if (p.kind === "nature") {
      /* BLIGHT POD — pulsing seed sack with orbiting spores */
      const throb = 1 + Math.sin(this.t * 8 + p.x * 0.03) * 0.12;
      c.fillStyle = "#4f9c37";
      c.beginPath(); c.arc(0, 0, p.r * throb, 0, TAU); c.fill();
      c.fillStyle = SPELLS.nature.glow;
      for (let i = 0; i < 3; i++) {
        const a = this.t * 5 + i * 2.1;
        c.beginPath(); c.arc(Math.cos(a) * p.r * 1.6, Math.sin(a) * p.r * 1.6, 2.2, 0, TAU); c.fill();
      }
      c.strokeStyle = "rgba(185,242,154,0.7)";
      c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, p.r * throb, 0, TAU); c.stroke();
    }
    /* Patch 11.0 — soulscythe: twin crescents + a hollow-gale streak */
    if (p.kind === "wind") {
      c.strokeStyle = "rgba(210,255,248,0.4)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-p.r * 3.4, -p.r * 0.5); c.lineTo(-p.r * 0.6, -p.r * 0.5);
      c.moveTo(-p.r * 3.4, p.r * 0.5); c.lineTo(-p.r * 0.6, p.r * 0.5);
      c.stroke();
      c.strokeStyle = "#d2fff8";
      c.lineWidth = 2.6;
      for (let i = 0; i < 2; i++) {
        const off = i === 0 ? 3 : -4;
        c.globalAlpha = i === 0 ? 0.95 : 0.5;
        c.beginPath();
        c.arc(off, 0, p.r * 1.7, -1.15, 1.15);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.strokeStyle = SPELLS.wind.color;
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(0, 0, p.r * 2.1, -0.9, 0.9); c.stroke();
    }
    c.restore();
  }

  private drawEBolt(c: CanvasRenderingContext2D, b: EBolt) {
    /* V1.3 — baked glow sprite (cached on the bolt; color/r immutable after
       spawn). One additive blit, no gradient work. */
    c.save();
    c.translate(b.x, b.y);
    if (!b.gspr) b.gspr = this.vfx.glowSpr(b.color);
    const d = b.r * 4.6;
    c.globalCompositeOperation = "lighter";
    c.globalAlpha = 0.95;
    c.drawImage(b.gspr, -d / 2, -d / 2, d, d);
    /* razor core over the glow */
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = "#ffffff";
    c.beginPath(); c.arc(0, 0, b.r * 0.42, 0, TAU); c.fill();
    c.restore();
  }

  private drawZap(c: CanvasRenderingContext2D, z: Zap) {
    const a = z.life / z.maxLife;
    c.strokeStyle = z.color;
    c.globalAlpha = a;
    c.lineWidth = 3;
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (let i = 0; i < z.pts.length; i++) {
        const p = z.pts[i];
        const jx = i > 0 && i < z.pts.length - 1 ? (Math.random() * 14 - 7) : 0;
        const jy = i > 0 && i < z.pts.length - 1 ? (Math.random() * 14 - 7) : 0;
        if (i === 0) c.moveTo(p.x + jx, p.y + jy);
        else c.lineTo(p.x + jx, p.y + jy);
      }
      c.stroke();
      c.lineWidth = 1.2;
      c.strokeStyle = "#ffffff";
    }
    c.globalAlpha = 1;
  }

  private drawFloater(c: CanvasRenderingContext2D, f: Floater) {
    /* V1.3 — DAMAGE-NUMBER POP: the first 30% of the number's life rides an
       easeOutBack overshoot (1 → 1.32 → 1) while it rises; the font cache
       stays untouched (the scale rides a transform, not a font size). */
    const k = f.life / f.maxLife;
    const age = 1 - k;
    let scale = 1;
    if (age < 0.3) scale = 1 + easeOutBack(age / 0.3) * 0.32;
    c.globalAlpha = Math.min(1, k * 1.6);
    /* V1.1 AUDIT FIX (perf) — font strings cached per size (floaters use a
       handful of fixed sizes); the old path rebuilt a template string per
       floater per frame (up to 70/frame with damage numbers on). */
    c.save();
    c.translate(f.x, f.y);
    c.scale(scale, scale);
    c.font = this.floaterFont(f.size);
    c.textAlign = "center";
    c.lineWidth = 3;
    c.strokeStyle = "rgba(10,6,20,0.85)";
    c.strokeText(f.text, 0, 0);
    c.fillStyle = f.color;
    c.fillText(f.text, 0, 0);
    c.restore();
    c.globalAlpha = 1;
  }

  /** V1.1 — cached floater font strings keyed by size. */
  private floaterFont(size: number): string {
    let f = this.floaterFonts.get(size);
    if (!f) {
      f = `800 ${size}px 'Alegreya Sans', sans-serif`;
      this.floaterFonts.set(size, f);
    }
    return f;
  }
}
