import * as THREE from "three";
import { TERRAINS, mulberry32, STARTER_SPELLS, hashSeed, streamRng, poolBias, BOSS_DEFS, SPELL_DROP_WAVE_MIN, SPELL_DROP_WAVE_MAX, actForWave, SPELLS, attunement, mercyForRound, RESONANCE_WINDOW, COMBOS, spawnCap, spawnWindow, waveBudget, availableTypes, eliteChance, ELITE_ORDER, VICTORY_WAVE, endlessBossMult, TRIBUTE_INTERVAL, draftGateChoices, SPELL_DROP_NERF, draftSpellOffer, HEART_DROP_HEAL_FRAC, REWARD_DEFS, ELITE_BONUS, hexNum, terrainForAct, layoutForAct, ENEMY_DEFS, MERCY_CAPLIVE, MERCY_SPAWNS, evolvedSpellDef, draftEvolutionOffer, setActiveElementPalette, elementColor, EVOLUTIONS, type ElementId } from "./content";
import { EnemySystem, MODEL_FIT } from "./entities";
import { AssetSystem } from "./assets";
import { AnimationController } from "./anim";
import { SpellSystem } from "./spells";

/** Minimal Battery Status API surface (v2.2) — event-driven only. */
interface BatteryLike extends EventTarget {
  charging: boolean;
  level: number;
}
import { buildArena } from "./arena";
import { ARENA_RADIUS, PLAYER_MARGIN } from "./arena-config";
import { VfxSystem } from "./vfx";
import { makeInputState } from "./types";

/* ARCHMAGE: RIFTBOUND (3D Edition) — the RiftEngine.
   Scene/camera/player, fixed-timestep simulation, the wave director with the
   strict one-drop-per-wave economy (tribute gates / spell tears / resonance
   orbs / hearts), surge & blink, resonance weave tracking, juice (trauma
   shake, hit-stop, slow-mo, zoom punch) and the 30 Hz HUD snapshot path.
   The engine NEVER imports the store — it speaks only through callbacks. */

/** Shared pickup gem geometry (pooled pickups reuse it; only materials churn).
 *  R-05 (v2.0): the glyph is now a 4-part hierarchy — opaque core, dark
 *  outline shell, emissive rim, ground ring — all sharing module-level
 *  geometries; only per-pickup materials churn (fade + tint independence). */const PICKUP_GEM_GEO = new THREE.OctahedronGeometry(0.3, 0);
/** Dark silhouette shell rendered around the core (BackSide → reads as an
 *  outline on ANY background, including bright particles). */
const PICKUP_SHELL_GEO = new THREE.OctahedronGeometry(0.3, 0);
/** Soft additive rim just outside the shell. */
const PICKUP_RIM_GEO = new THREE.OctahedronGeometry(0.44, 0);
/** Flat ground ring marking the pickup on the floor (the "beacon"). */
const PICKUP_RING_GEO = new THREE.RingGeometry(0.42, 0.58, 24);
/* F-04: the playable radius is the CANONICAL value from arena-config.ts —
   spawns, aim clamps, blink/player clamps and the sim context all derive
   from the same single source of truth as the renderer. */
const SIM_STEP = 1 / 60;
/** Terrain display-name lookup for the auto-mode "New ground:" banner (10-a). */
const TERRAIN_NAME = Object.fromEntries(TERRAINS.map(t => [t.id, t.name]));
/** Tone-mapping base exposure (10-a: lifted 1.1 → 1.25 with the default
    brightness 100 → 130 — user order "the maps are too dark"; exposure =
    this × brightness/100, brightness an integer percent 50..250). */
const TONE_BASE_EXPOSURE = 1.25;
const BLINK_CD = 2.6;
/* R-04 (v2.0 audit): blink reach, in world units. Tuned starting value 9.0
   (was a hard-coded 5.5) — long enough to cross a lane or escape a nova,
   short enough that arena walls still matter. Named so the balance knob is
   discoverable; tune only with playtest evidence. */
export const BLINK_DISTANCE = 9.0;
/** Pointer offsets under this are treated as "cursor resting on the mage" —
 *  the movement vector takes over instead of a jittery micro-hop. */
const BLINK_AIM_DEADZONE = 0.75;
/** Kept between a blink landing and the arena wall. */
const BLINK_ARENA_MARGIN = 0.8;
/** Landing clearance from obstacle surfaces (matches the legacy pushout). */
const BLINK_LAND_CLEAR = 0.55;
const SURGE_DURATION = 6;
const SURGE_BASE_NEED = 520;
/* ----------------------------- camera feel ------------------------------
 * RIG: slightly lower + further back than the original 27/14.5 rig — the
 * pitch drops ~6° so foes read as bodies (profile) instead of tokens seen
 * from directly above, and the whole playfield sits ~5% closer to the eye.
 * SHAKE: trauma is scaled by SHAKE_GAIN at the source, capped at MAX_TRAUMA,
 * rendered as layered sines at SHAKE_AMP world-units peak — a firm rumble
 * that still lands boss slams, minus the per-frame white-noise rattle.
 * 10-a: the rig was lifted (25/15.5 → 26.5/16.5) and FOV became a setting
 * (45..80°, default 62) — a larger, wider view of the field on request. */
const CAM_HEIGHT = 26.5;
const CAM_BACK = 16.5;
const SHAKE_GAIN = 0.55;
const MAX_TRAUMA = 0.8;
const SHAKE_AMP = 0.62;
/* Perf overlay (plan §9 HUD #6 + §4 load telemetry): one engine-owned DOM
   panel, text written at 2 Hz. 12 lines; frame ms EMA time constant ≈ 0.25 s
   (≈0.5 s convergence window). */
const PERF_LINES = 12;
const PERF_EMA_TAU = 0.25;
/** Scratch position for hot-path VFX spawns (VfxSystem copies values
 *  immediately — it never retains the reference — so reuse is safe). */
const _fxPos = new THREE.Vector3();
export class QualityGovernor {
  static EMA_ALPHA = 0.06;
  static SLOW_MS = 18.5;
  static FAST_MS = 13.5;
  static SLOW_HOLD = 1.5;
  static FAST_HOLD = 5;
  static STEP_DOWN = 0.1;
  static STEP_UP = 0.05;
  static MIN_SCALE = 0.55;
  static MAX_SCALE = 1;
  static COOLDOWN = 2;
  static WARMUP = 2;
  /** Current dynamic resolution scale (0.55..1). */
  scale = QualityGovernor.MAX_SCALE;
  ema = 16.7;
  seeded = false;
  slowT = 0;
  fastT = 0;
  cooldown = 0;
  warmup = 0;
  /** Re-arm the post-disturbance grace window. */
  arm(warmup = QualityGovernor.WARMUP) {
    this.warmup = warmup;
    this.slowT = 0;
    this.fastT = 0;
    this.seeded = false;
  }
  /** Feed one frame. `active` = autoQuality enabled AND actually playing AND
  *  the document visible. Returns true when `scale` changed this call. */
  update(frameMs, dt, active) {
    if (!active) {
      const was = this.scale;
      this.scale = QualityGovernor.MAX_SCALE;
      this.slowT = 0;
      this.fastT = 0;
      this.cooldown = 0;
      this.seeded = false;
      return was !== this.scale;
    }
    if (this.warmup > 0) {
      this.warmup -= dt;
      this.slowT = 0;
      this.fastT = 0;
      return false;
    }
    if (!this.seeded) {
      this.ema = frameMs;
      this.seeded = true;
    } else {
      this.ema += (frameMs - this.ema) * QualityGovernor.EMA_ALPHA;
    }
    if (this.ema > QualityGovernor.SLOW_MS) {
      this.slowT += dt;
      this.fastT = 0;
    } else if (this.ema < QualityGovernor.FAST_MS) {
      this.fastT += dt;
      this.slowT = 0;
    } else {
      /* dead band between the thresholds — both holds reset (hysteresis) */this.slowT = 0;
      this.fastT = 0;
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.cooldown > 0) return false;
    if (this.slowT >= QualityGovernor.SLOW_HOLD && this.scale > QualityGovernor.MIN_SCALE) {
      this.scale = Math.max(QualityGovernor.MIN_SCALE, this.scale - QualityGovernor.STEP_DOWN);
      this.slowT = 0;
      this.fastT = 0;
      this.cooldown = QualityGovernor.COOLDOWN;
      return true;
    }
    if (this.fastT >= QualityGovernor.FAST_HOLD && this.scale < QualityGovernor.MAX_SCALE) {
      this.scale = Math.min(QualityGovernor.MAX_SCALE, this.scale + QualityGovernor.STEP_UP);
      this.slowT = 0;
      this.fastT = 0;
      this.cooldown = QualityGovernor.COOLDOWN;
      return true;
    }
    return false;
  }
}
export const PAD_BTN = {
  A: 1 << 0,
  B: 1 << 1,
  X: 1 << 2,
  Y: 1 << 3,
  LB: 1 << 4,
  RB: 1 << 5,
  LT: 1 << 6,
  RT: 1 << 7,
  BACK: 1 << 8,
  START: 1 << 9,
  L3: 1 << 10,
  R3: 1 << 11,
  DU: 1 << 12,
  DD: 1 << 13,
  DL: 1 << 14,
  DR: 1 << 15
};
export const GAMEPAD_DEADZONE = 0.18;
export const GAMEPAD_AIM_DIST = 14;
export function makePadSource() {
  return {
    moveX: 0,
    moveZ: 0,
    moveActive: false,
    aimDX: 0,
    aimDZ: 0,
    aimActive: false,
    castHeld: false,
    volleyHeld: false,
    buttons: 0
  };
}
export function readGamepad(pad, out) {
  out.moveX = 0;
  out.moveZ = 0;
  out.moveActive = false;
  out.aimDX = 0;
  out.aimDZ = 0;
  out.aimActive = false;
  out.castHeld = false;
  out.volleyHeld = false;
  out.buttons = 0;
  const lx = pad.axes[0] ?? 0;
  const ly = pad.axes[1] ?? 0;
  const lm = Math.hypot(lx, ly);
  if (lm >= GAMEPAD_DEADZONE) {
    const k = Math.min(1, (lm - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE)) / lm;
    out.moveX = lx * k;
    out.moveZ = ly * k;
    out.moveActive = true;
  }
  const rx = pad.axes[2] ?? 0;
  const ry = pad.axes[3] ?? 0;
  const rm = Math.hypot(rx, ry);
  if (rm >= GAMEPAD_DEADZONE) {
    const k = Math.min(1, (rm - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE)) / rm;
    out.aimDX = rx * k;
    out.aimDZ = ry * k;
    out.aimActive = true;
  }
  const held = i => {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
  };
  for (let i = 0; i < 16; i++) {
    if (held(i)) out.buttons |= 1 << i;
  }
  out.castHeld = held(7); // RT / R2
  out.volleyHeld = held(6); // LT / L2
}
export function padRising(cur, prev) {
  return cur & ~prev;
}
/** The engine's per-frame gamepad scratch (single-threaded reuse). */
const PAD_SRC = makePadSource();
/** Monotonic per-page-session run counter → RunStats.runId (audit P1-1).
 *  Module scope keeps ids unique even across engine re-creation (remount);
 *  a page reload resets it by design — a reload means a new run anyway. */
let RUN_SEQ = 0;
const SWEEP_ANGLES = 16;
const SWEEP_BANDS = 4;
/** Spawn bands per class — identical to the pre-fix random tries. */
const SPAWN_BANDS = {
  boss: {
    rMin: 9,
    rMax: 16,
    minDist: 11,
    tries: 14
  },
  add: {
    rMin: 20,
    rMax: ARENA_RADIUS - 3,
    minDist: 15,
    tries: 12
  }
};
/** Keep every sweep candidate inside the containment ring. */
const SWEEP_ARENA_MARGIN = 1.5;
export function safeSpawnSweep(playerX, playerZ, boss, obstacleClear, rand, opts: { relax?: number } = {}) {
  const band = boss ? SPAWN_BANDS.boss : SPAWN_BANDS.add;
  const relax = Math.max(0, opts.relax ?? 0);
  const rMin = Math.max(6, band.rMin - relax);
  const rMax = Math.min(ARENA_RADIUS - 3, band.rMax + relax);
  /* distance floors keep a relaxed spawn off the player (bosses coalesce
   under a 0.9 s frozen-AI grace; adds rift-in with a ring telegraph) */
  const minDist = Math.max(boss ? 7 : 9, band.minDist - relax);
  const ok = (x, z) => Math.hypot(x, z) <= ARENA_RADIUS - SWEEP_ARENA_MARGIN && Math.hypot(x - playerX, z - playerZ) > minDist && obstacleClear(x, z);
  /* phase 1 — randomized tries (seeded; same shape as the original code) */
  for (let tries = 0; tries < band.tries; tries++) {
    const a = rand() * Math.PI * 2;
    const r = rMin + rand() * (rMax - rMin);
    const x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (ok(x, z)) return {
      x,
      z
    };
  }
  /* phase 2 — deterministic sweep: 16 evenly-spaced angles × 4 radius bands */
  for (let b = 0; b < SWEEP_BANDS; b++) {
    const r = rMin + (b + 0.5) / SWEEP_BANDS * (rMax - rMin);
    for (let i = 0; i < SWEEP_ANGLES; i++) {
      const a = i / SWEEP_ANGLES * Math.PI * 2;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (ok(x, z)) return {
        x,
        z
      };
    }
  }
  return null;
}
/* --------------------------- blink planning (R-04) ---------------------- */
export interface BlinkPlan {
  x: number;
  z: number;
  dist: number;
}
/** Deterministic, boundary- and obstacle-safe blink landing (v2.0 R-04).
 *  PURE — takes only coordinates + the obstacle list — so the regression
 *  harness can property-test every rule without a renderer.
 *
 *  Targeting priority:
 *    1. POINTER: when the aim offset exceeds BLINK_AIM_DEADZONE the hop runs
 *       along the ground-plane direction to the cursor, clamped to the
 *       cursor's own distance (a cursor 2 units away blinks ~2 units, not 9).
 *    2. MOVEMENT: otherwise the normalized move vector carries the full
 *       BLINK_DISTANCE (keyboard stick / touch stick strafe-blinking).
 *    3. null: no meaningful intent — the caller no-ops WITHOUT spending the
 *       cooldown (a stray Space tap at rest with the cursor on the mage does
 *       nothing, rather than a random-direction escape).
 *
 *  Landing search (first hit wins, fixed order — same inputs, same answer):
 *    a. the exact desired point;
 *    b. shorter hops along the same ray (80→18% of reach);
 *    c. arc samples on both sides at 60% reach (±0.5…±1.5 rad);
 *    d. legacy radial fallback — arena-ring clamp then obstacle pushout,
 *       re-clamped to the ring. Never outside the arena, never inside a
 *       surface, even in the pathological fully-blocked case. */
export function planBlinkLanding(px: number, pz: number, aimX: number, aimZ: number, moveX: number, moveZ: number, obstacles: ReadonlyArray<{ x: number; z: number; r: number }>, arenaRadius: number): BlinkPlan | null {
  const aimDx = aimX - px,
    aimDz = aimZ - pz;
  const aimDist = Math.hypot(aimDx, aimDz);
  let dirX = 0,
    dirZ = 0,
    want = 0;
  if (aimDist > BLINK_AIM_DEADZONE) {
    dirX = aimDx / aimDist;
    dirZ = aimDz / aimDist;
    want = Math.min(BLINK_DISTANCE, aimDist);
  } else if (moveX !== 0 || moveZ !== 0) {
    const m = Math.hypot(moveX, moveZ) || 1;
    dirX = moveX / m;
    dirZ = moveZ / m;
    want = BLINK_DISTANCE;
  } else {
    return null;
  }
  const ring = arenaRadius - BLINK_ARENA_MARGIN;
  const clear = (x: number, z: number) => {
    if (Math.hypot(x, z) > ring) return false;
    for (const o of obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r + BLINK_LAND_CLEAR) return false;
    }
    return true;
  };
  const tx = px + dirX * want,
    tz = pz + dirZ * want;
  if (clear(tx, tz)) return {
    x: tx,
    z: tz,
    dist: want
  };
  for (const f of [0.8, 0.62, 0.45, 0.3, 0.18]) {
    const d = want * f;
    const x = px + dirX * d,
      z = pz + dirZ * d;
    if (clear(x, z)) return {
      x,
      z,
      dist: d
    };
  }
  for (const a of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const rx = dirX * ca - dirZ * sa,
      rz = dirX * sa + dirZ * ca;
    const d = want * 0.6;
    const x = px + rx * d,
      z = pz + rz * d;
    if (clear(x, z)) return {
      x,
      z,
      dist: d
    };
  }
  let fx = tx,
    fz = tz;
  const rd = Math.hypot(fx, fz);
  if (rd > ring) {
    const s = ring / (rd || 1);
    fx *= s;
    fz *= s;
  }
  for (const o of obstacles) {
    const dx = fx - o.x,
      dz = fz - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + BLINK_LAND_CLEAR;
    if (d < min) {
      if (d < 1e-4) {
        fx = o.x + min;
        continue;
      }
      fx = o.x + dx / d * min;
      fz = o.z + dz / d * min;
    }
  }
  const rd2 = Math.hypot(fx, fz);
  if (rd2 > ring) {
    const s = ring / (rd2 || 1);
    fx *= s;
    fz *= s;
  }
  return {
    x: fx,
    z: fz,
    dist: Math.hypot(fx - px, fz - pz)
  };
}
/* ------------------------ spell-offer commit (R-07) -------------------- */
/** The highlighted default destination for a spell offer: the FIRST empty
 *  slot, or -1 when the loadout is full (the UI then requires an explicit
 *  replacement choice). Pure — shared by the engine and the harness. */
export function defaultOfferSlot(equipped: ReadonlyArray<string | { merged: string[] } | null>): number {
  return equipped.findIndex(s => s === null);
}
export interface SpellOfferCommit {
  slot: number;
  equipped: (string | { merged: string[] } | null)[];
  selected: number;
}
/** R-07 (v2.0): pure, explicit-target spell-offer commit. Returns the next
 *  loadout + the newly selected slot, or null when the request is invalid
 *  (non-integer / out-of-range target, wrong loadout shape) — the caller
 *  then changes NOTHING. The player's confirmed target is the ONLY slot
 *  that can change; selection follows the commit. */
export function planSpellOfferCommit(equipped: ReadonlyArray<string | { merged: string[] } | null>, pick: string, targetSlot: unknown): SpellOfferCommit | null {
  if (typeof targetSlot !== "number" || !Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot > 2) return null;
  if (equipped.length !== 3) return null;
  const next = [...equipped];
  next[targetSlot] = pick;
  return {
    slot: targetSlot,
    equipped: next,
    selected: targetSlot
  };
}
export class RiftEngine {
  canvas;
  opts;
  input;
  phase;
  renderer;
  scene;
  camera;
  raycaster;
  groundPlane;
  vfx;
  arena;
  enemies;
  spells;
  /* run state */
  rng;
  /* dedicated seeded RNG streams (audit P2-2): gameplay rolls never share a
   stream with cosmetics, so enabling/disabling effects can't perturb
   combat outcomes. rngCombat — spell crits + glyph drop counts (gameplay);
   rngPickup — pickup ejection angles (movement-affecting); rngCosmetic —
   surge aura bursts (pure looks). VFX emission Math.random in
   spells.ts/entities.ts/vfx.ts is cosmetic-only by design (out of scope). */
  rngCombat;
  rngPickup;
  rngCosmetic;
  runSeed;
  wave;
  waveActive;
  waveQueue;
  spawnTimer;
  waveDelay;
  budgetSpent;
  budgetTotal;
  poolWeights;
  bossOrder;
  attunementMult;
  mercyF;
  mercyTier;
  endless;
  /* deferred boss spawn (audit P2-3): set when no safe spawn point exists
   this tick; retried every update tick (expanding search) until one does.
   A pending boss BLOCKS wave completion — see updateWaveDirector. */
  pendingBoss;
  /* run-lifecycle state (audits P1-1 / P2-1):
   - runId: fresh per startRun, stable across the victory→endless lifetime
     of one run; the store commits each runId:kind exactly once.
   - runGeneration: monotonic token captured by the death timer so a stale
     callback from a previous run can never flip a fresh run to gameover.
   - deathTimer: the 1.3 s slow-mo delay handle, cleared on
     startRun/stopRun/dispose.
   - victorySnapshot: cumulative counters at the wave-50 bank; an endless
     death emits only the post-snapshot DELTA.
   - victoryEmitted / deathEmitted: per-run belt-and-braces emit-once
     flags (the store's idempotency is the authoritative guard). */
  runId;
  runGeneration;
  deathTimer;
  victorySnapshot;
  victoryEmitted;
  deathEmitted;
  /* --- v2.2 approved-scope state (in-memory; runs are never saved mid-flight) ---
   - evolved: elementId → evolutionId for THIS run (one per element).
   - boundWave: elementId → wave the spell was bound (evolution eligibility).
   - countdownT: remaining 3-2-1 resume-countdown seconds (0 = none). While
     > 0 the simulation is frozen exactly like a pause, but the phase stays
     "playing" so overlays/HUD keep their live-run plumbing.
   - lastHits: ring of the last 3 damage events (death-cause log). */
  evolved: Record<string, string> = {};
  boundWave: Record<string, number> = {};
  countdownT = 0;
  lastHits: { cause: string; amount: number; t: number }[] = [];
  /* Screen Wake Lock sentinel (v2.2): held while a run is live so phones
     keep the display on; the browser auto-releases on hide — we re-acquire
     on visible+playing. */
  wakeLockSentinel: unknown = null;
  /* Battery-aware mode (v2.2): event-driven (no polling); engages at ≤20%
     charge while discharging — clamps render quality and caps fps at 30. */
  batteryLow = false;
  /* FPS cap (v2.2): ms between ACCEPTED frames; 0 = uncapped. Effective
     value = min(settings cap, battery override). */
  fpsCapMs = 0;
  /* last time the gamepad was actively used (disconnect auto-pause guard) */
  lastPadActivity = -Infinity;
  onGamepadDisconnected;
  onBatteryEvent;
  /* player */
  player;
  playerGroup;
  staffOrb;
  /* --- acquired itch.io asset layer (docs/AUDITS.md) ---
   Loads async from /assets/*; every consumer falls back to procedural art
   until (or unless) its model/texture arrives. Public so the shell can
   read load progress for the pre-run attunement veil (plan §4 loading). */
  assets;
  /** Player animation stack (plan §5) — null on the procedural fallback body
  *  (no clips → the controller is a no-op there by construction). */
  playerAnim;
  throwAnimCd;
  stepDustT;
  auraRing;
  aimRing;
  /* casting */
  equipped;
  selected;
  cooldowns;
  lastCast;
  pendingCasts;
  volleyTimer;
  castDenyT;
  /* drops */
  heldRewards;
  nextSpellWave;
  /* pickups */
  pickups;
  pickupPool;
  runeShards;
  /* arena obstacles (rune rubble) — gameplay collision circles from
   buildArena (plan §7); projectiles are NEVER blocked (low rubble). */
  obstacles;
  /* stats */
  stats;
  newCombos;
  /* juice — trauma is capped well below 1.0 and every source is scaled by
   SHAKE_GAIN: the camera reads as a firm rumble, never a nauseating rattle. */
  trauma;
  shakeClock;
  hitStopT;
  slowmoT;
  slowmoF;
  zoomPunch;
  time;
  /* loop */
  raf;
  lastFrame;
  accumulator;
  hudTimer;
  intensityTimer;
  lastMouseAim;
  running;
  /* v2.2 render gating: while an OPAQUE React screen (menu / game over /
   *  credits — the keyart backdrop covers the canvas completely) is up,
   * the frame loop skips sim/anim/vfx/render entirely. coverGraceUntil
   * keeps rendering through phase-transition fades (a screen fading IN
   * over a live arena needs the arena behind it until it is opaque). */
  coverGraceUntil = 0;
  /* v2.2: FOV guard — updateProjectionMatrix only when the applied fov
   * actually changed (zoom punch / settings), not every frame. */
  _appliedFov = 62;
  disposed;
  /* adaptive quality + device tier */
  governor;
  dprCap;
  lowEnd;
  lastAppliedPR;
  /* perf overlay (settings.perfOverlay) — engine-owned element, 2 Hz writes */
  perfEl;
  perfLines;
  perfMsEma;
  perfTimer;
  /* compatibility (context loss / visibility / reduced motion) */
  contextLost;
  autoPausedOnContextLoss;
  motionQuery;
  /* gamepad */
  padSeen;
  padPrevButtons;
  lastPad;
  padMoveActive;
  padCastOwned;
  padVolleyOwned;
  /* ctx mirror for systems */
  ctx;
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    this.input = makeInputState();
    this.phase = "menu";
    this.scene = new THREE.Scene();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.arena = null;
    this.rng = mulberry32(1);
    this.rngCombat = mulberry32(1);
    this.rngPickup = mulberry32(1);
    this.rngCosmetic = mulberry32(1);
    this.runSeed = "rune-1000";
    this.wave = 0;
    this.waveActive = false;
    this.waveQueue = [];
    this.spawnTimer = 0;
    this.waveDelay = 0;
    this.budgetSpent = 0;
    this.budgetTotal = 1;
    this.poolWeights = {};
    this.bossOrder = [];
    this.attunementMult = 1;
    this.mercyF = 0;
    this.mercyTier = 0;
    this.endless = false;
    this.pendingBoss = null;
    this.runId = "";
    this.runGeneration = 0;
    this.deathTimer = null;
    this.victorySnapshot = null;
    this.victoryEmitted = false;
    this.deathEmitted = false;
    this.player = makePlayer();
    this.playerGroup = new THREE.Group();
    this.assets = new AssetSystem();
    this.playerAnim = null;
    this.throwAnimCd = 0;
    this.stepDustT = 0;
    this.equipped = [...STARTER_SPELLS];
    this.selected = 0;
    this.cooldowns = [0, 0, 0];
    this.lastCast = null;
    this.pendingCasts = [];
    this.volleyTimer = 0;
    this.castDenyT = 0;
    this.heldRewards = {};
    this.nextSpellWave = 4;
    this.pickups = [];
    this.pickupPool = [];
    this.obstacles = [];
    this.stats = emptyStats();
    this.newCombos = [];
    this.trauma = 0;
    this.shakeClock = 0; // drives smooth layered-sine shake (no white noise)
    this.hitStopT = 0;
    this.slowmoT = 0;
    this.slowmoF = 1;
    this.zoomPunch = 0;
    this.time = 0;
    this.raf = 0;
    this.lastFrame = 0;
    this.accumulator = 0;
    this.hudTimer = 0;
    this.intensityTimer = 0;
    this.lastMouseAim = -10;
    this.running = false;
    this.disposed = false;
    this.governor = new QualityGovernor();
    this.dprCap = 2;
    this.lowEnd = false;
    this.lastAppliedPR = -1;
    this.perfEl = null;
    this.perfLines = [];
    this.perfMsEma = 16.7;
    this.perfTimer = 0;
    this.contextLost = false;
    this.autoPausedOnContextLoss = false;
    this.motionQuery = null;
    this.padSeen = false;
    this.padPrevButtons = 0;
    this.lastPad = null;
    this.padMoveActive = false;
    this.padCastOwned = false;
    this.padVolleyOwned = false;
    this.handleResize = () => {
      /* the effective DPR can change when the window moves across monitors —
      re-apply the pixel ratio when it drifted (cheap early-out otherwise) */
      if (Math.abs(this.effectivePixelRatio() - this.lastAppliedPR) > 1e-4) this.applyQuality();
      const parent = this.canvas.parentElement;
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.placePerfOverlay(); // follow HUD breakpoints when the window resizes
    };
    /* v2.1 cross-device: rotation + mobile-browser viewport quirks. A bare
       `resize` listener misses or races two real-world cases — (1) iOS
       Safari fires orientationchange with layout settling AFTER our handler
       ran, and (2) address-bar show/hide on scroll resizes visualViewport
       without a window resize on some Androids. Re-run the fit immediately
       and twice more on a short schedule; each call is idempotent and cheap
       (early-out unless the box actually changed via setSize/camera). */
    this.onOrientationChange = () => {
      this.handleResize();
      window.setTimeout(() => {
        if (!this.disposed) this.handleResize();
      }, 150);
      window.setTimeout(() => {
        if (!this.disposed) this.handleResize();
      }, 450);
    };
    this.onViewportBoxResize = () => this.handleResize();
    this.onMotionChange = () => {
      this.applyReducedMotion();
    };
    this.onContextLost = ev => {
      /* preventDefault is REQUIRED for webglcontextrestored to fire later */ev.preventDefault();
      if (this.disposed) return;
      this.contextLost = true;
      this.stopLoop();
      if (this.phase === "playing") {
        this.autoPausedOnContextLoss = true;
        this.pause(); // same path as togglePause → onPhase keeps the store/UI in sync
      }
    };
    this.onContextRestored = () => {
      if (this.disposed || !this.contextLost) return;
      this.contextLost = false;
      /* three re-uploads its resources on restore; re-assert size + pixel ratio,
      give the governor a grace window (first frames are shader-compile heavy),
      then restart the loop and unpause if we auto-paused */
      this.handleResize();
      this.governor.arm();
      this.startLoop();
      if (this.autoPausedOnContextLoss) {
        this.autoPausedOnContextLoss = false;
        if (this.phase === "paused") this.resume();
      }
    };
    this.onVisibilityChange = () => {
      if (this.disposed) return;
      if (document.hidden && this.phase === "playing") this.pause();
      /* v2.2: the browser auto-releases wake locks on hide — silently
         re-acquire when the tab returns to a live run. */
      if (!document.hidden && this.phase === "playing") void this.acquireWakeLock();
    };
    this.onGamepadConnected = () => {
      this.padSeen = true;
    };
    /* v2.2: a pad dying mid-run must not leave the mage standing — when the
       pad was RECENTLY the active input, auto-pause the trial (banner says
       why); resume stays an intentional act. A pad that was idle (KB/M
       play) only clears the flag. */
    this.onGamepadDisconnected = () => {
      this.padSeen = false;
      this.lastPad = null;
      const padWasActive = performance.now() - this.lastPadActivity < 5000;
      if (padWasActive && this.phase === "playing") {
        this.pause();
        this.opts.callbacks.onBanner("CONTROLLER LOST", "The trial holds its breath — press Start or P to resume", "#ff4d6b");
      }
    };
    /* v2.2 battery-aware mode: event-driven only (no polling loops). Where
       the Battery API is missing (Safari/iOS), batteryLow simply stays false
       and every manual setting keeps working — the honest fallback. */
    this.onBatteryEvent = () => this.evaluateBattery();
    this._aimNdc = new THREE.Vector2();
    this._aimHit = new THREE.Vector3();
    this.waveTotalCount = 1;
    this.currentActId = 0;
    /** Ground the CURRENT act is playing on (10-a) — resolved in
    *  buildArenaForAct ("auto" → terrainForAct(seed, act.id)); surfaced in the
    *  act banner so the seed-driven shift is visible every 10 waves. */
    this.actTerrain = "rubble";
    /* device-tier heuristics: weak cores / little RAM → no MSAA and a lower
    DPR cap (the runtime governor trims the rest). Absent signals default
    to "capable" — undefined <= 4 is false, matching every browser. */
    const nav = typeof navigator !== "undefined" ? navigator : null;
    this.lowEnd = !!nav && ((nav.hardwareConcurrency || 8) <= 4 || ((nav as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4);
    this.dprCap = this.lowEnd ? 1.5 : 2;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.lowEnd,
      powerPreference: "high-performance"
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.applyQuality(); // sets pixel ratio + tone-mapping exposure (brightness)
    this.camera = new THREE.PerspectiveCamera(this.opts.settings.fov ?? 62, 1, 0.5, 320);
    this.camera.position.set(0, CAM_HEIGHT, CAM_BACK);
    this.camera.lookAt(0, 0, 0);
    this.vfx = new VfxSystem(this.scene, this.camera);
    this.enemies = new EnemySystem(this.scene, this.assets);
    this.spells = new SpellSystem(this.scene);
    this.buildPlayerModel();
    this.buildAimRing();
    /* async pack load — the mage + enemy models hot-swap in when ready;
    until then the procedural bodies carry the game (identical gameplay).
    v2.2 staged loading: the PLAYER's own models (mage/staff/imp) rebuild
    the body the moment each arrives (onModel), instead of waiting for the
    whole manifest; the full-load .then() still re-applies sprites. */
    this.assets.onModel = kind => {
      if (this.disposed) return;
      if (kind !== "mage" && kind !== "staff") return;
      this.disposePlayerModel();
      this.buildPlayerModel();
      this.buildAimRing();
    };
    this.assets.load().then(() => {
      if (this.disposed) return;
      this.disposePlayerModel();
      this.buildPlayerModel();
      this.buildAimRing();
      this.applyVfxSprites();
    }).catch(() => {});
    this.ctx = this.makeContext();
    this.enemies.onFirstSeen = t => this.opts.callbacks.onEnemySeen(t);
    /* compatibility listeners (all removed in dispose()) */
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    if (typeof window.matchMedia === "function") {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.motionQuery.addEventListener("change", this.onMotionChange);
    }
    window.addEventListener("gamepadconnected", this.onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected);
    this.setupBatteryWatch();
    this.syncSettingsDerived();
    this.applyReducedMotion();
    this.syncPerfOverlay();
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("orientationchange", this.onOrientationChange);
    window.visualViewport?.addEventListener("resize", this.onViewportBoxResize);
    this.startLoop();
    /* v2.2: boot grace — the menu's keyart backdrop fades in over ~700 ms;
     * keep rendering the procedural scene behind it until it is opaque. */
    this.coverGraceUntil = performance.now() + 1500;
    /* sync the shell with our initial phase (remount-safe) */
    this.opts.callbacks.onPhase(this.phase);
  }
  /* ------------------------------ lifecycle ------------------------------ */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDeathTimer(); // never emit a phase callback from a dead engine (P2-1)
    this.stopLoop();
    this.destroyPerfOverlay();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("orientationchange", this.onOrientationChange);
    window.visualViewport?.removeEventListener("resize", this.onViewportBoxResize);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    window.removeEventListener("gamepadconnected", this.onGamepadConnected);
    window.removeEventListener("gamepaddisconnected", this.onGamepadDisconnected);
    this.teardownBatteryWatch();
    this.releaseWakeLock();
    this.arena?.dispose();
    this.obstacles = [];
    this.enemies.clear();
    this.spells.dispose();
    this.vfx.dispose();
    for (const p of this.pickups) this.removePickupMesh(p);
    this.pickups.length = 0;
    for (const pooled of this.pickupPool) {
      pooled.traverse(o => {
        if (o instanceof THREE.Mesh) o.material.dispose();
      });
    }
    this.pickupPool.length = 0;
    this.disposePlayerModel();
    this.assets.dispose();
    this.renderer.dispose();
  }
  /** Swap pooled VFX canvas textures for the acquired Kronbits + Kenney
  *  sprite art (docs/AUDITS.md §7) once the async pack load resolves.
  *  10-d: kenney-ripple (concentric-ripple orb → ground shockwave ripples)
  *  and kenney-crescent (curved arc → slash arcs) join the three Kronbits
  *  slots; pools keep procedural canvas fallbacks when a sprite is absent. */
  applyVfxSprites() {
    const s = this.assets.sprites;
    if (s.size === 0) return;
    this.vfx.applySprites({
      particle: s.get("glow-soft") ?? null,
      glint: s.get("flare") ?? null,
      pillar: s.get("lightrays") ?? null,
      ripple: s.get("kenney-ripple") ?? null,
      crescent: s.get("kenney-crescent") ?? null
    });
  }
  handleResize;
  onOrientationChange;
  onViewportBoxResize;
  /** Dynamic resolution scale — 1 whenever autoQuality is off (previous look). */
  dynamicScale() {
    return this.opts.settings.autoQuality ? this.governor.scale : 1;
  }
  /** Effective device pixel ratio: capped by device tier, scaled by the
  *  user quality slider AND the adaptive governor's dynamic scale. */
  effectivePixelRatio() {
    const pr = Math.min(window.devicePixelRatio ?? 1, this.dprCap) * (this.opts.settings.quality ?? 1) * this.dynamicScale();
    return Math.max(0.25, pr);
  }
  applyQuality() {
    const s = this.opts.settings;
    /* v2.2 battery-aware mode: while engaged the render scale eases to ≤70%
       (the governor may trim further); manual quality returns on recharge. */
    const quality = this.batteryLow ? Math.min(s.quality ?? 1, 0.7) : (s.quality ?? 1);
    const dyn = this.dynamicScale();
    const pr = Math.min(window.devicePixelRatio ?? 1, this.dprCap) * quality * dyn;
    const prClamped = Math.max(0.25, pr);
    this.renderer.setPixelRatio(prClamped);
    this.lastAppliedPR = prClamped;
    /* particle/effect density follows the EFFECTIVE quality (slider × dynamic) */
    this.vfx?.setQuality(quality * dyn);
    /* brightness slider → tone-mapping exposure. Stored as an integer percent
    50..250 (10-a); exposure = base 1.25 × percent/100. Default 130. */
    const brightness = THREE.MathUtils.clamp(s.brightness ?? 130, 50, 250);
    this.renderer.toneMappingExposure = TONE_BASE_EXPOSURE * (brightness / 100);
  }
  setSettings(s) {
    this.opts.settings = s;
    this.syncSettingsDerived();
    this.applyReducedMotion();
    this.vfx.setDamageNumbers(s.damageNumbers);
    this.ctx.damageNumbers = s.damageNumbers;
    this.applyQuality();
    this.syncPerfOverlay(); // live create/destroy — no run restart needed
  }
  /** v2.2: settings-derived engine state — the palette (display colors),
   *  the effective fps cap (setting ∨ battery override) and the battery
   *  quality clamp. Called from the constructor and every setSettings. */
  syncSettingsDerived() {
    setActiveElementPalette(this.opts.settings.palette ?? "default");
    const cap = Number(this.opts.settings.fpsCap) || 0;
    this.fpsCapMs = cap > 0 ? Math.max(1000 / cap, this.batteryLow ? 1000 / 30 : 0) : (this.batteryLow ? 1000 / 30 : 0);
  }
  /* ------------------------ v2.2 wake lock ------------------------------- */
  /** Hold the screen awake while a run is live. Best-effort: unsupported
   *  browsers (Safari < 16.4) and refusals resolve silently — the game must
   * never depend on the grant. */
  async acquireWakeLock() {
    if (this.wakeLockSentinel || typeof navigator === "undefined") return;
    const nav = navigator as Navigator & { wakeLock?: { request(t: string): Promise<unknown> } };
    if (!nav.wakeLock) return;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      this.wakeLockSentinel = sentinel;
    } catch {
      /* refused (low power / hidden document) — ignore */
    }
  }
  releaseWakeLock() {
    const s = this.wakeLockSentinel as { release?: () => Promise<void> } | null;
    this.wakeLockSentinel = null;
    try {
      s?.release?.().catch(() => {});
    } catch {
      /* already released */
    }
  }
  /* ------------------------ v2.2 battery watch --------------------------- */
  setupBatteryWatch() {
    if (typeof navigator === "undefined") return;
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return;
    nav.getBattery().then(bat => {
      if (this.disposed) return;
      this.battery = bat;
      bat.addEventListener("levelchange", this.onBatteryEvent);
      bat.addEventListener("chargingchange", this.onBatteryEvent);
      this.evaluateBattery();
    }).catch(() => {});
  }
  teardownBatteryWatch() {
    this.battery?.removeEventListener("levelchange", this.onBatteryEvent);
    this.battery?.removeEventListener("chargingchange", this.onBatteryEvent);
    this.battery = null;
  }
  /** Engage below 20% while discharging; release at >25% or on charge.
   *  Hysteresis prevents flapping at the boundary. One banner per run. */
  evaluateBattery() {
    const bat = this.battery;
    if (!bat) return;
    const low = !bat.charging && bat.level <= 0.2;
    const changed = low !== this.batteryLow;
    this.batteryLow = low && this.opts.settings.batterySaver !== false;
    if (changed) {
      this.syncSettingsDerived();
      this.applyQuality();
      if (this.batteryLow && this.phase === "playing") {
        this.opts.callbacks.onBanner("BATTERY SAVER", "Quality eased and frames capped to hold your charge", "#43e8d8");
      }
    }
  }
  battery: BatteryLike | null = null;
  /* ---------------------------- compatibility ---------------------------- */ /** Effective reduced motion = the user's reduceFlashes setting OR the OS
                                                                                *  prefers-reduced-motion query (re-evaluated on settings + query change). */
  applyReducedMotion() {
    const reduced = !!this.opts.settings.reduceFlashes || !!this.motionQuery?.matches;
    this.vfx?.setReducedMotion(reduced);
  }
  onMotionChange;
  onContextLost;
  onContextRestored;
  onVisibilityChange;
  onGamepadConnected;
  /* ------------------------------ run control ---------------------------- */
  startRun(seed, runOpts) {
    this.runSeed = seed;
    this.rng = mulberry32(hashSeed(seed));
    /* dedicated seeded streams (audit P2-2) — same salt pattern as the act
    arena rng (`${seed}:act${id}`): gameplay and cosmetic randomness are
    independent per-run streams, so the same seed reproduces the same
    logical run and cosmetics never perturb gameplay rolls. */
    this.rngCombat = streamRng(seed, "combat");
    this.rngPickup = streamRng(seed, "pickup");
    this.rngCosmetic = streamRng(seed, "cosmetic");
    this.endless = false;
    /* fresh run lifecycle identity (audits P1-1/P2-1): new runId, new
    generation token (invalidates any stale death timer callback), no
    victory snapshot yet, no milestone emitted yet, no deferred boss. */
    this.runGeneration++;
    this.clearDeathTimer();
    this.runId = `run-${++RUN_SEQ}`;
    this.victorySnapshot = null;
    this.victoryEmitted = false;
    this.deathEmitted = false;
    this.pendingBoss = null;
    this.stats = emptyStats(seed, this.runId);
    this.newCombos = [];
    this.governor.arm(); // ignore the run-start loading spike
    /* mercy ladder */
    const tier = runOpts.mercyTier < 0 ? runOpts.mercyDeaths : Math.min(runOpts.mercyTier, runOpts.mercyDeaths);
    this.mercyTier = tier;
    /* player */
    const b = runOpts.bonuses;
    this.player = makePlayer();
    this.resetPlayerAnim();
    this.player.hpMax = Math.round(100 * b.hpMult);
    this.player.hp = this.player.hpMax;
    this.player.aetherMax = 100 * b.aetherMult;
    this.player.aether = this.player.aetherMax;
    this.player.aetherRegen = 11 * b.aetherMult;
    this.player.speed = 7.4 * b.speedMult;
    this.player.dmgMult = b.dmgMult;
    this.heldRewards = {};
    /* kit */
    this.equipped = [...STARTER_SPELLS];
    /* v2.2 evolutions: fresh per-run state — the starter kit counts as bound
       from wave 0 (eligibility = wave − boundWave ≥ EVOLVE_BOUND_WAVES). */
    this.evolved = {};
    this.boundWave = {};
    for (const id of STARTER_SPELLS) this.boundWave[id] = 0;
    this.countdownT = 0;
    this.lastHits = [];
    /* P2-2 discovery gating: the starter kit counts as the first real bind —
       report each element so the Spellbook reveals them from run one. */
    for (const id of STARTER_SPELLS) this.opts.callbacks.onSpellSeen(id);
    this.selected = 0;
    this.cooldowns = [0, 0, 0];
    this.lastCast = null;
    this.pendingCasts = [];
    /* systems */
    this.enemies.clear();
    this.spells.clear();
    for (const p of this.pickups) this.removePickupMesh(p);
    this.pickups.length = 0;
    this.poolWeights = poolBias(seed);
    this.bossOrder = this.rng.shuffle([...BOSS_DEFS]);
    this.nextSpellWave = this.rng.int(SPELL_DROP_WAVE_MIN, SPELL_DROP_WAVE_MAX);
    /* re-bind ctx to the fresh player & rng */
    this.ctx.player = this.player;
    this.ctx.rng = this.rng;
    this.ctx.time = 0;
    this.time = 0;
    /* arena & first wave */
    this.buildArenaForAct(actForWave(1));
    this.wave = 0;
    this.waveActive = false;
    this.waveDelay = 1.6;
    this.setPhase("playing");
    this.opts.callbacks.onBanner("THE RIFT OPENS", actForWave(1).flavor, "#f5c96b");
    this.opts.sfx.musicCombat();
    this.updateStaffColor();
    /* v2.2: hold the screen awake for the trial (best-effort). */
    void this.acquireWakeLock();
  }
  stopRun() {
    this.clearDeathTimer(); // a stale death callback must not fire post-stop (P2-1)
    this.pendingBoss = null;
    this.releaseWakeLock();
    this.countdownT = 0;
    this.setPhase("menu");
    this.opts.sfx.musicStop();
    this.enemies.clear();
    this.obstacles = [];
    this.spells.clear();
    for (const p of this.pickups) this.removePickupMesh(p);
    this.pickups.length = 0;
  }
  /** Cancel any pending death slow-mo timer (lifecycle-scoped, audit P2-1). */
  clearDeathTimer() {
    if (this.deathTimer !== null) {
      window.clearTimeout(this.deathTimer);
      this.deathTimer = null;
    }
  }
  pause() {
    if (this.phase !== "playing") return;
    this.setPhase("paused");
  }
  /** v2.2: resume with the 3-2-1 countdown (scope report §7) when enabled —
   *  the simulation (and player damage) stays frozen until it ends, so no
   *  one takes a hit on the first frame back. The accessibility override
   *  (settings.resumeCountdown = false) resumes instantly. */
  resume() {
    if (this.phase !== "paused") return;
    this.setPhase("playing");
    this.governor.arm(); // grace window after unpausing (tab-back spikes)
    if (this.opts.settings.resumeCountdown !== false) {
      this.countdownT = 3.2;
    }
    this.haptic(8); // ready cue
  }
  togglePause() {
    if (this.phase === "playing") this.pause();else if (this.phase === "paused") this.resume();
  }
  setPhase(p) {
    /* v2.2 render gating: entering a covered phase keeps the loop alive
     * through the incoming screen's fade (≤900 ms), then the frame body
     * early-returns until the phase changes again. Leaving a covered phase
     * resumes rendering on the very next frame — no grace needed. */
    if (p === "menu" || p === "gameover" || p === "credits") {
      this.coverGraceUntil = performance.now() + 900;
    }
    this.phase = p;
    this.opts.callbacks.onPhase(p);
  }
  /* ------------------------ v2.2 haptics ---------------------------------- */
  /** navigator.vibrate cue, gated by settings.haptics. Guarded — unsupported
   *  platforms (iOS Safari) silently ignore. Gamepad rumble keeps its own
   *  path (rumble(), screenShake-gated). */
  haptic(ms: number | number[]) {
    if (!this.opts.settings.haptics) return;
    try {
      navigator.vibrate?.(ms as number);
    } catch {
      /* not allowed / unsupported — ignore */
    }
  }
  /* ------------------------------- overlays ------------------------------ */
  resolveGate(choiceId) {
    this.applyReward(choiceId);
    this.heldRewards[choiceId] = (this.heldRewards[choiceId] ?? 0) + 1;
    this.opts.callbacks.onGate(null);
    this.continueAfterOverlay();
  }
  resolveSpellOffer(pick, targetSlot) {
    this.opts.callbacks.onSpellOffer(null);
    if (pick) {
      /* R-07: the destination is EXPLICIT — the UI passes the exact slot the
      player confirmed. No first-empty/selected-slot inference happens here;
      an invalid or missing target mutates NOTHING (defensive against a
      stale/double submission racing the overlay close). */
      const commit = planSpellOfferCommit(this.equipped, pick, targetSlot);
      if (commit) {
        this.equipped = commit.equipped;
        this.selected = commit.selected;
        this.boundWave[pick] = this.wave; // v2.2: evolution eligibility clock starts
        this.opts.callbacks.onSpellSeen(pick); // P2-2: first bind reveals the spell
        this.updateStaffColor();
        this.opts.callbacks.onBanner(SPELLS[pick].name.toUpperCase(), "New spell bound", SPELLS[pick].color);
        this.opts.sfx.play("offer", {
          intensity: 1
        });
      }
    }
    this.continueAfterOverlay();
  }
  /* --------------------- v2.2 spell evolutions ---------------------------- */
  /** Apply (or decline) the evolution choice from the evolve overlay.
   *  A null/unknown id simply declines — the base spell is kept and the
   *  element becomes ineligible for the rest of the run (one look per run,
   *  decided either way). */
  resolveEvolution(evoId) {
    this.opts.callbacks.onEvolve(null);
    const el = this.pendingEvolveElement;
    this.pendingEvolveElement = null;
    if (el && evoId) {
      const evo = EVOLUTIONS.find(e => e.id === evoId && e.base === el);
      if (evo) {
        this.evolved[el] = evoId;
        this.updateStaffColor();
        this.opts.callbacks.onBanner(`${evo.name.toUpperCase()}`, `${SPELLS[el].name} evolves`, evo.color);
        this.opts.sfx.play("merge", {
          intensity: 1
        });
        this.haptic([12, 40, 12]);
      }
    }
    this.continueAfterOverlay();
  }
  pendingEvolveElement: string | null = null;
  resolveMerge(a, b) {
    const slotA = this.equipped[a];
    const slotB = this.equipped[b];
    this.opts.callbacks.onMerge(null);
    if (slotA && slotB) {
      const flat = s => typeof s === "string" ? [s] : s.merged;
      this.equipped[a] = {
        merged: [...flat(slotA), ...flat(slotB)]
      };
      this.equipped[b] = null;
      this.selected = a;
      this.updateStaffColor();
      const merged = this.equipped[a];
      this.opts.callbacks.onBanner("THE SACRIFICE MERGE", `${merged.merged.length} spells fused into one slot`, "#9a7bff");
      this.opts.sfx.play("merge", {
        intensity: 1
      });
    }
    this.continueAfterOverlay();
  }
  continueEndless(fight) {
    if (fight) {
      this.endless = true;
      /* The wave-50 victory milestone was already BANKED when the credits
      rolled (kind "victory", full stats, 100% of glyphs). The eventual
      endless death will emit an "endless-death" result that banks ONLY
      the post-victory delta (computeRunCommit policy, audit P1-1) — the
      cumulative counters simply keep accumulating on top of the snapshot.
      triumph flips back purely so the UI's death path shows again. */
      this.stats.triumph = false;
      this.setPhase("playing");
      this.waveDelay = 2;
      this.governor.arm();
      this.opts.sfx.musicCombat();
      this.opts.callbacks.onBanner("THE ENDLESS ECHO", "Waves 51+ — the echo tightens", "#aa8cff");
    } else {
      this.stopRun();
    }
  }
  continueAfterOverlay() {
    this.setPhase("playing");
    this.waveDelay = 1.1;
    this.governor.arm(); // overlay dismiss → fresh grace window
  }
  /* ------------------------------ spell slots ---------------------------- */
  selectSpell(i) {
    if (i >= 0 && i < 3 && this.equipped[i]) {
      this.selected = i;
      this.updateStaffColor();
    }
  }
  cycleSpell(dir) {
    for (let step = 1; step <= 3; step++) {
      const i = (this.selected + dir * step + 9) % 3;
      if (this.equipped[i]) {
        this.selected = i;
        this.updateStaffColor();
        return;
      }
    }
  }
  /* ------------------------------ input utils ---------------------------- */
  noteMouseAim() {
    this.lastMouseAim = this.time;
  }
  /* -------------------------------- gamepad ------------------------------ */ /** Poll the first connected standard-mapping gamepad and merge it into
                                                                                *  `input`. Co-exists with keyboard/mouse: sticks & triggers only write
                                                                                *  while actually engaged (keyboard re-asserts on its own key events),
                                                                                *  edges are one-shot, and pause toggles DIRECTLY — never via input.pause
                                                                                *  (that edge is only consumed while the sim steps; see worklog re: the
                                                                                *  pause deadlock). */
  pollGamepad() {
    if (!this.padSeen || this.disposed) return;
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    let pad: Gamepad | null = null;
    for (const p of navigator.getGamepads()) {
      if (p && p.connected && p.mapping === "standard") {
        pad = p;
        break;
      }
    }
    this.lastPad = pad;
    if (!pad) return;
    readGamepad(pad, PAD_SRC);
    /* v2.2: track genuine pad use (any stick/trigger/button pressure) so a
       disconnect only auto-pauses when the pad was actually driving. */
    if (PAD_SRC.moveActive || PAD_SRC.aimActive || PAD_SRC.castHeld || PAD_SRC.volleyHeld) {
      this.lastPadActivity = performance.now();
    }
    const rising = padRising(PAD_SRC.buttons, this.padPrevButtons);
    this.padPrevButtons = PAD_SRC.buttons;
    /* pause works from any phase the pause overlay is reachable in */
    if (rising & (PAD_BTN.B | PAD_BTN.START)) this.togglePause();
    /* gameplay writes only while playing (no stale edges leaking into a run) */
    if (this.phase !== "playing") return;
    const inp = this.input;
    /* left stick → move (on release zero once; keyboard re-syncs on key events) */
    if (PAD_SRC.moveActive) {
      inp.moveX = PAD_SRC.moveX;
      inp.moveZ = PAD_SRC.moveZ;
    } else if (this.padMoveActive) {
      inp.moveX = 0;
      inp.moveZ = 0;
    }
    this.padMoveActive = PAD_SRC.moveActive;
    /* right stick → ground-plane aim point, the same shape screenToGround
    produces (player + direction × dist, clamped to the arena). Marking
    lastMouseAim makes the auto-target assist stand down — direct aim. */
    if (PAD_SRC.aimActive) {
      const px = this.player.x + PAD_SRC.aimDX * GAMEPAD_AIM_DIST;
      const pz = this.player.z + PAD_SRC.aimDZ * GAMEPAD_AIM_DIST;
      const d = Math.hypot(px, pz);
      if (d > ARENA_RADIUS) {
        inp.aimX = px * (ARENA_RADIUS / d);
        inp.aimZ = pz * (ARENA_RADIUS / d);
      } else {
        inp.aimX = px;
        inp.aimZ = pz;
      }
      this.lastMouseAim = this.time;
    }
    /* triggers (level-triggered, ownership-tracked so mouse presses survive) */
    if (PAD_SRC.castHeld) {
      inp.castHeld = true;
      this.padCastOwned = true;
    } else if (this.padCastOwned) {
      inp.castHeld = false;
      this.padCastOwned = false;
    }
    if (PAD_SRC.volleyHeld) {
      inp.volleyHeld = true;
      this.padVolleyOwned = true;
    } else if (this.padVolleyOwned) {
      inp.volleyHeld = false;
      this.padVolleyOwned = false;
    }
    /* one-shot edges (A blink · X spell · Y surge · LB/RB cycle · D-pad select) */
    if (rising & PAD_BTN.A) inp.blink = true;
    if (rising & PAD_BTN.Y) inp.surge = true;
    if (rising & PAD_BTN.X) inp.cycle = 1;
    if (rising & PAD_BTN.LB) inp.cycle = -1;
    if (rising & PAD_BTN.RB) inp.cycle = 1;
    if (rising & PAD_BTN.DL) inp.select = 0;
    if (rising & PAD_BTN.DU) inp.select = 1;
    if (rising & PAD_BTN.DR) inp.select = 2;
    /* D-down (13) intentionally unbound — there are only 3 spell slots */
  }
  /** Best-effort dual-rumble haptics (guarded by screenShake; silently
  *  ignored on pads/browsers without an actuator). */
  rumble(ms, strong, weak) {
    if (!this.opts.settings.screenShake || !this.lastPad) return;
    const act = this.lastPad.vibrationActuator;
    if (!act?.playEffect) return;
    try {
      act.playEffect("dual-rumble", {
        duration: ms,
        strongMagnitude: strong,
        weakMagnitude: weak
      }).catch(() => {});
    } catch {
      /* haptics are best-effort — never let them break the frame */}
  }
  _aimNdc;
  _aimHit;
  /* v2.2: reusable screenToGround result — the per-mousemove {x,z} literal
   * (up to ~1000 Hz on gaming mice) is gone. */
  _aimOut = { x: 0, z: 0 };
  /* v2.2: scratch direction for computeThreats (was a per-call Vector3 at
   * 30 Hz inside pushHud). */
  _threatDir = new THREE.Vector3();
  screenToGround(clientX, clientY) {
    /* v2.2: the canvas is fixed inset-0 over the whole viewport — its CSS
     * box IS the viewport box. clientWidth/Height avoid the forced-layout
     * getBoundingClientRect() this used to run per mousemove. */
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const ndc = this._aimNdc.set((clientX / w) * 2 - 1, -((clientY / h) * 2) + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this._aimHit;
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      const d = Math.hypot(hit.x, hit.z);
      if (d > ARENA_RADIUS) {
        hit.x *= ARENA_RADIUS / d;
        hit.z *= ARENA_RADIUS / d;
      }
      this._aimOut.x = hit.x;
      this._aimOut.z = hit.z;
      return this._aimOut;
    }
    this._aimOut.x = 0;
    this._aimOut.z = 0;
    return this._aimOut;
  }
  /* ------------------------------ main loop ------------------------------ */
  startLoop() {
    this.running = true;
    this.lastFrame = performance.now();
    const frame = now => {
      if (this.disposed || !this.running) return;
      this.raf = requestAnimationFrame(frame);
      /* v2.2 fps cap (settings ∨ battery override): skip the whole frame
       *  body when we're ahead of the budget — lastFrame stays untouched so
       *  the next accepted frame still measures true elapsed time (the sim
       *  stays wall-clock correct through fixed-step accumulation). */
      if (this.fpsCapMs > 0 && now - this.lastFrame < this.fpsCapMs - 1.5) return;
      /* v2.2 render gating: an opaque React screen (menu / game over /
       *  credits — the keyart backdrop covers the canvas fully) is up and
       *  its entrance fade has finished → skip the entire frame body.
       * Saves 100% of GPU/CPU during every menu visit; the RAF keeps
       * ticking cheaply so a phase change resumes rendering instantly. */
      if ((this.phase === "menu" || this.phase === "gameover" || this.phase === "credits") && now > this.coverGraceUntil) return;
      const rawMs = now - this.lastFrame;
      let dt = rawMs / 1000;
      this.lastFrame = now;
      dt = Math.min(dt, 0.05);
      /* gamepad first, so this frame's sim steps consume fresh input */
      this.pollGamepad();
      /* adaptive quality: EMA of frame time, only while truly playing */
      if (this.governor.update(Math.min(rawMs, 100), dt, this.opts.settings.autoQuality && this.phase === "playing" && !document.hidden)) {
        this.applyQuality();
      }
      /* juice clocks run on real time */
      if (this.hitStopT > 0) this.hitStopT -= dt;
      if (this.slowmoT > 0) {
        this.slowmoT -= dt;
        if (this.slowmoT <= 0) this.slowmoF = 1;
      }
      this.trauma = Math.max(0, this.trauma - dt * 2.6);
      this.zoomPunch = Math.max(0, this.zoomPunch - dt * 4.5);
      if (this.trauma > 0) this.shakeClock += dt;
      const simActive = this.phase === "playing";
      /* v2.2: Time Survived counts REAL wall time in play (wave-intro and
       *  resume countdowns included — the player lived through them), not
       * just stepped sim time. A run that felt like a minute no longer
       * reports 0:17. */
      if (simActive) this.stats.timeSec += dt;
      let simDt = dt * this.slowmoF;
      if (this.hitStopT > 0) simDt = 0;
      /* ============================================================ *
      *  FRAME ORDER (10-d update-order audit — keep this contract)  *
      *                                                              *
      *  1. INPUT      pollGamepad — this frame's sim steps consume  *
      *                fresh input.                                 *
      *  2. SIM        fixed-step step() chain (above): input →      *
      *                player → waves → foes → spells → deaths →    *
      *                pickups. Foe mixers advance INSIDE            *
      *                enemies.update (syncVisual → updateFoeAnim), *
      *                so foe poses are already this frame's.        *
      *  3. ANIM       updatePlayerVisual (player mixer + pose-      *
      *                attached player fx) and updatePickupVisuals  *
      *                BEFORE vfx.update so every effect spawned at *
      *                a pose-attached point (footstep dust, staff   *
      *                trail) aligns with THIS frame's pose.         *
      *  4. VFX        vfx.update + enemies.updateDying — every     *
      *                pool advances against the freshly posed      *
      *                scene; frozen when paused (else branch keeps  *
      *                menu/gameover effects alive).                 *
      *  5. WORLD      arena ambient, then updateCamera (trauma     *
      *                shake + zoom punch write the final view).     *
      *  6. HUD + RENDER hud push @30 Hz, renderer.render.          *
      *                                                              *
      *  Mixers strictly BEFORE vfx: attached effects must never     *
      *  lag a frame behind the poses they ride.                     *
      * ============================================================ */
      if (simActive) {
        this.accumulator += simDt;
        let steps = 0;
        while (this.accumulator >= SIM_STEP && steps < 5) {
          /* a step can change the phase mid-frame (gates / offers / death) —
          never run further banked steps after that */
          if (this.phase !== "playing") {
            this.accumulator = 0;
            break;
          }
          this.step(SIM_STEP);
          this.accumulator -= SIM_STEP;
          steps++;
        }
        if (steps === 5) this.accumulator = 0;
      }
      /* 3. anim — player mixer + player-attached visuals */
      this.updatePlayerVisual(dt);
      this.updatePickupVisuals(dt);
      /* 4. vfx — pools + death-linger corpses (pause-frozen) */
      if (simActive || this.phase !== "paused") {
        this.enemies.updateDying(dt);
        this.vfx.update(dt);
      }
      /* 5. world */
      if (this.arena) this.arena.update(dt, this.time);
      this.updateCamera(dt);
      /* 6. hud push @30 Hz — in-run phases only (v2.2): menus/game-over
       *  consume no HUD snapshots, so the old unconditional 30 Hz push
       * (6 arrays + a snapshot object per push, forever, in every phase)
         stops the moment a covered screen takes over. */
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) {
        this.hudTimer = 1 / 30;
        if (this.phase !== "menu" && this.phase !== "gameover" && this.phase !== "credits") this.pushHud();
      }
      this.renderer.render(this.scene, this.camera);
      /* perf overlay — EMA-smooth the frame time every frame (one multiply
      while visible), build strings + touch the DOM at 2 Hz only. Info is
      read AFTER render so draw calls / tris describe the frame just sent. */
      if (this.perfEl) {
        const emaA = 1 - Math.exp(-dt / PERF_EMA_TAU);
        this.perfMsEma += (Math.min(rawMs, 250) - this.perfMsEma) * emaA;
        this.perfTimer -= dt;
        if (this.perfTimer <= 0) {
          this.perfTimer = 0.5;
          this.updatePerfOverlay();
        }
      }
    };
    this.raf = requestAnimationFrame(frame);
  }
  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  /* ------------------------------ simulation ----------------------------- */
  step(dt) {
    /* v2.2 resume countdown: the world (and player damage) stays frozen
     *  until the 3-2-1 finishes — exactly like a pause, but the phase keeps
     *  its live-run plumbing. The HUD still receives countdown seconds at
     *  30 Hz from the frame loop. */
    if (this.countdownT > 0) {
      this.countdownT = Math.max(0, this.countdownT - dt);
      if (this.countdownT === 0) this.haptic(8); // go cue
      return;
    }
    /* v2.2 cast-ready haptics: snapshot cooldown state before the world
     *  moves; a slot that WAS cooling and is NOW ready cues 8 ms. */
    const cdWas = [this.cooldowns[0] > 0.001, this.cooldowns[1] > 0.001, this.cooldowns[2] > 0.001];
    this.time += dt;
    this.ctx.time = this.time;
    this.ctx.wave = this.wave;
    this.attunementMult = attunement(Math.max(1, this.wave));
    this.ctx.attunementMult = this.attunementMult;
    this.mercyF = mercyForRound(Math.max(1, this.wave), this.mercyTier);
    this.ctx.mercyF = this.mercyF;
    this.processInput(dt);
    this.updatePlayer(dt);
    this.updateWaveDirector(dt);
    this.enemies.update(dt, this.ctx);
    this.enemies.flushSpawns(this.wave, this.ctx);
    this.spells.update(dt, this.ctx);
    /* deaths */
    for (let i = this.enemies.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies.enemies[i];
      if (e.dead) {
        this.enemies.removeEnemy(e);
        continue;
      }
      if (e.hp <= 0) this.killEnemy(e);
    }
    this.updatePickups(dt);
    /* music intensity */
    this.intensityTimer -= dt;
    if (this.intensityTimer <= 0) {
      this.intensityTimer = 2;
      const alive = this.enemies.countAlive();
      const boss = this.enemies.boss;
      let x = Math.min(1, alive / 16);
      if (boss) x = 0.55 + 0.45 * (1 - boss.hp / boss.hpMax);
      this.opts.sfx.setIntensity(x);
    }
    /* v2.2 cast-ready haptics: fire once per slot transition cooling→ready */
    for (let i = 0; i < 3; i++) {
      if (cdWas[i] && this.cooldowns[i] <= 0.001 && this.equipped[i]) this.haptic(8);
    }
  }
  processInput(dt) {
    const inp = this.input;
    if (inp.pause) {
      inp.pause = false;
      this.togglePause();
    }
    if (this.phase !== "playing") return;
    if (inp.select >= 0) {
      this.selectSpell(inp.select);
      inp.select = -1;
    }
    if (inp.cycle !== 0) {
      this.cycleSpell(inp.cycle);
      inp.cycle = 0;
    }
    /* aim: auto-target nearest foe if the mouse hasn't moved (touch play).
    v2.2 one-thumb mode (aimFromMove): the move stick's direction IS the
    aim — a single thumb steers and fires; auto-target covers standing
    still, so the cast never fires into the void. */
    if (this.input.aimFromMove && (Math.abs(inp.moveX) > 0.15 || Math.abs(inp.moveZ) > 0.15)) {
      const len = Math.hypot(inp.moveX, inp.moveZ) || 1;
      inp.aimX = this.player.x + inp.moveX / len * 5;
      inp.aimZ = this.player.z + inp.moveZ / len * 5;
    } else if (this.time - this.lastMouseAim > 1.2) {
      const target = this.enemies.nearest(this.player.x, this.player.z, 30);
      if (target) {
        inp.aimX = target.x;
        inp.aimZ = target.z;
      }
    }
    this.player.aimX = inp.aimX;
    this.player.aimZ = inp.aimZ;
    /* blink (R-04: pointer-directed, BLINK_DISTANCE reach, safe landing) */
    if (inp.blink) {
      inp.blink = false;
      if (this.player.blinkCd <= 0 && !this.player.dead) {
        const plan = planBlinkLanding(this.player.x, this.player.z, inp.aimX, inp.aimZ, inp.moveX, inp.moveZ, this.obstacles, ARENA_RADIUS);
        if (plan) {
          this.player.blinkCd = BLINK_CD;
          const nx = plan.x,
            nz = plan.z;
          const color = 0xf5c96b;
          this.vfx.burst(_fxPos.set(this.player.x, 1, this.player.z), color, 16, {
            speed: 6
          });
          this.player.x = nx;
          this.player.z = nz;
          this.player.iframe = Math.max(this.player.iframe, 0.38);
          this.vfx.burst(_fxPos.set(nx, 1, nz), color, 16, {
            speed: 6
          });
          this.vfx.ring(_fxPos.set(nx, 0, nz), color, 3);
          this.opts.sfx.play("blink", {
            intensity: 0.6
          });
        }
        /* plan === null → no aim intent and no movement: the blink is
         * silently dropped WITHOUT spending the cooldown or i-frames (a
         * stray Space tap at rest must not fire a random-direction hop). */
      }
    }
    /* surge */
    if (inp.surge) {
      inp.surge = false;
      if (this.player.surge >= 1 && this.player.surgeActive <= 0) {
        this.player.surgeActive = SURGE_DURATION;
        this.player.surge = 0;
        this.vfx.ring(_fxPos.set(this.player.x, 0, this.player.z), 0xf5c96b, 10, {
          life: 0.8
        });
        this.vfx.burst(_fxPos.set(this.player.x, 1.4, this.player.z), 0xf5c96b, 40, {
          speed: 10
        });
        this.shake(0.4);
        this.opts.callbacks.onBanner("SURGE", "The rift bends to your will", "#f5c96b");
        this.opts.sfx.play("surge", {
          intensity: 1
        });
      }
    }
    /* casting */
    this.castDenyT -= dt;
    if (inp.castHeld) this.tryCast();
    if (inp.volleyHeld) {
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0) {
        const cost = this.player.surgeActive > 0 ? 0 : 4;
        if (this.player.aether >= cost) {
          this.player.aether -= cost;
          this.volleyTimer = 0.19;
          this.spells.volley(this.ctx);
          if (this.throwAnimCd <= 0 && this.playerAnim) {
            this.throwAnimCd = 0.5;
            this.playerAnim.play("cast");
          }
        } else if (this.castDenyT <= 0) {
          this.castDenyT = 0.35;
          this.opts.sfx.play("deny", {
            intensity: 0.3
          });
        }
      }
    } else {
      this.volleyTimer = 0;
    }
    /* pending merged-slot casts */
    for (let i = this.pendingCasts.length - 1; i >= 0; i--) {
      const pc = this.pendingCasts[i];
      pc.t -= dt;
      if (pc.t <= 0) {
        this.pendingCasts.splice(i, 1);
        this.executeCast(pc.element);
      }
    }
    /* cooldown tick */
    for (let i = 0; i < 3; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
  }
  updatePlayer(dt) {
    const p = this.player;
    if (p.dead) return;
    /* movement */
    const inp = this.input;
    let mx = inp.moveX,
      mz = inp.moveZ;
    const md = Math.hypot(mx, mz);
    if (md > 1) {
      mx /= md;
      mz /= md;
    }
    const spd = p.speed * (p.surgeActive > 0 ? 1.12 : 1);
    p.x += mx * spd * dt;
    p.z += mz * spd * dt;
    const d = Math.hypot(p.x, p.z);
    if (d > ARENA_RADIUS - PLAYER_MARGIN) {
      p.x *= (ARENA_RADIUS - PLAYER_MARGIN) / d;
      p.z *= (ARENA_RADIUS - PLAYER_MARGIN) / d;
    }
    /* gentle circle-vs-circle pushout vs the rune rubble — pure position
    projection along the normal, so there is no velocity to kill (blink
    and future dashes keep working; the player slides around rubble) */
    this.obstaclePushout(p, 0.55);
    /* timers */
    p.iframe = Math.max(0, p.iframe - dt);
    p.blinkCd = Math.max(0, p.blinkCd - dt);
    p.aether = Math.min(p.aetherMax, p.aether + p.aetherRegen * dt);
    if (p.surgeActive > 0) p.surgeActive -= dt;
  }
  tryCast() {
    const slot = this.equipped[this.selected];
    if (!slot) return;
    if (this.cooldowns[this.selected] > 0) return;
    const surge = this.player.surgeActive > 0;
    const elements = typeof slot === "string" ? [slot] : slot.merged;
    /* cost = sum (merged gets a modest discount); surge is free.
    v2.2: an EVOLVED spell's mana/cd multipliers apply here — the same
    evolvedSpellDef the cast itself uses (one source of truth). */
    let cost = 0;
    let cd = 0;
    for (const el of elements) {
      const def = evolvedSpellDef(el, this.evolved[el]);
      cost += def.manaCost;
      cd = Math.max(cd, def.cooldown);
    }
    if (elements.length > 1) {
      cost *= 0.72;
      cd *= 0.8;
    }
    if (surge) cost = 0;
    if (this.player.aether < cost) {
      if (this.castDenyT <= 0) {
        this.castDenyT = 0.35;
        this.opts.sfx.play("deny", {
          intensity: 0.3
        });
      }
      return;
    }
    this.player.aether -= cost;
    this.cooldowns[this.selected] = cd * this.player.cdMult * (surge ? 0.55 : 1);
    /* aim assist: bend the weave toward the nearest marked foe */
    if (this.opts.settings.aimAssist) this.applyAimAssist();
    /* cast: first element now, rest staggered (merged slot auto-resonates) */
    this.executeCast(elements[0]);
    for (let i = 1; i < elements.length; i++) {
      this.pendingCasts.push({
        element: elements[i],
        t: 0.14 * i
      });
    }
  }
  applyAimAssist() {
    const p = this.player;
    let dx = p.aimX - p.x,
      dz = p.aimZ - p.z;
    const aimDist = Math.hypot(dx, dz) || 1;
    const aimA = Math.atan2(dx / aimDist, dz / aimDist);
    let best: { x: number; z: number } | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      const ex = e.x - p.x,
        ez = e.z - p.z;
      const d = Math.hypot(ex, ez);
      if (d < 2 || d > 24) continue;
      let da = Math.atan2(ex / d, ez / d) - aimA;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const deg = Math.abs(da) * 180 / Math.PI;
      if (deg < 14) {
        const score = deg + d * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    if (best) {
      p.aimX = best.x;
      p.aimZ = best.z;
    }
  }
  executeCast(element) {
    const p = this.player;
    if (p.dead) return;
    /* v2.2: evolved spells cast through their EVOLVED def (multipliers,
    radius and identity color); base spells pass no override. */
    this.spells.cast(element, this.ctx, this.evolved[element] ? evolvedSpellDef(element, this.evolved[element]) : undefined);
    /* cast flourish — throttled so volleys don't spasm the arm (cast does NOT
    interrupt a hit flinch: priority 2 < 3 — the controller rejects it) */
    if (this.throwAnimCd <= 0 && this.playerAnim) {
      this.throwAnimCd = 0.5;
      this.playerAnim.play("cast");
    }
    /* resonance weave window */
    if (this.lastCast && this.lastCast.element !== element && this.time - this.lastCast.t <= RESONANCE_WINDOW) {
      const res = this.spells.triggerResonance(this.lastCast.element, element, this.ctx);
      this.lastCast = null;
      if (res) {
        const combo = COMBOS[res.key];
        this.opts.callbacks.onBanner(`RESONANCE — ${res.name.toUpperCase()}`, combo ? combo.lore : null, SPELLS[element].color);
        if (!this.newCombos.includes(res.key)) this.newCombos.push(res.key);
        this.opts.callbacks.onCombo(res.key);
        this.stats.damage += res.damageDealt;
      }
    } else {
      this.lastCast = {
        element,
        t: this.time
      };
    }
  }
  /* --------------------------- wave director ----------------------------- */
  updateWaveDirector(dt) {
    if (!this.waveActive) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) this.startWave(this.wave + 1);
      return;
    }
    /* deferred boss spawn (audit P2-3): retry every tick until a SAFE point
    exists — never an unchecked fallback. Every ~1 s of congestion the
    search relaxes one notch (player distance −1, radius band ±1) so a
    pathological arena still spawns the tyrant eventually. */
    if (this.pendingBoss) {
      const pb = this.pendingBoss;
      pb.tries++;
      const relax = Math.min(4, Math.floor(pb.tries / 60)); // 60 ticks ≈ 1 s
      const pos = this.spawnPosition(true, relax);
      if (pos) {
        this.pendingBoss = null;
        this.spawnBossNow(pb.def, pos.x, pos.z);
      }
    }
    /* trickle spawns */
    if (this.waveQueue.length > 0) {
      this.spawnTimer -= dt;
      const cap = Math.max(4, Math.round(spawnCap(this.wave) * (1 - this.mercyF * MERCY_CAPLIVE)));
      if (this.spawnTimer <= 0 && this.enemies.countAlive() < cap) {
        const next = this.waveQueue.shift();
        const pos = this.spawnPosition();
        if (pos) {
          this.enemies.queueSpawn(next.type, pos.x, pos.z, next.elite);
          this.enemies.flushSpawns(this.wave, this.ctx);
          this.budgetSpent += 1;
        } else {
          /* no safe point this tick — re-queue and retry next interval
          (audit P2-3: a skipped spawn is safe; the wave can never
          complete while the queue is non-empty, so no foe is lost). */
          this.waveQueue.unshift(next);
        }
        this.spawnTimer = Math.max(0.12, spawnWindow(this.wave) / Math.max(1, this.waveTotalCount) * 0.9);
      }
    }
    /* wave cleared — a PENDING boss blocks completion: the tyrant does not
    exist in `enemies` yet, so without this gate the director would wrongly
    advance the wave the moment the adds died (audit P2-3). */
    if (this.waveQueue.length === 0 && this.enemies.countAlive() === 0 && !this.pendingBoss) {
      this.waveActive = false;
      this.completeWave();
    }
  }
  waveTotalCount;
  startWave(n) {
    this.wave = n;
    this.waveActive = true;
    this.ctx.wave = n;
    const act = actForWave(n);
    /* F-05: the VIRTUAL act index advances past 6 in endless mode (one band
    *  per 10 waves) so the deterministic biome deck keeps cycling — a full
    *  10-theme permutation per decade, no repeats until all ten have shown. */
    const virtualActId = n <= VICTORY_WAVE ? act.id : 6 + Math.floor((n - 51) / 10);
    if (virtualActId !== this.currentActId) {
      this.buildArenaForAct(act, virtualActId);
      this.currentActId = virtualActId;
      /* 10-a/11-a: the rift shifts ground every act (every 10 waves) —
      name the new ground in the banner so the seed-driven change reads. */
      const flavor = `${act.flavor} · New ground: ${TERRAIN_NAME[this.actTerrain]}`;
      this.opts.callbacks.onBanner(act.name.toUpperCase(), flavor, "#f5c96b");
    }
    const isBoss = n % 10 === 0;
    if (isBoss) {
      const idx = Math.floor(n / 10) - 1;
      const base = this.bossOrder[idx % this.bossOrder.length];
      this.opts.callbacks.onBossSeen(base.id);
      const pos = this.spawnPosition(true);
      if (pos) {
        this.spawnBossNow(base, pos.x, pos.z);
      } else {
        /* no safe point right now — defer (audit P2-3): the pendingBoss
        retries every update tick and blocks wave completion until it
        spawns. The boss is never dropped and never placed unchecked. */
        this.pendingBoss = {
          def: base,
          tries: 0
        };
      }
    } else {
      this.opts.callbacks.onBanner(`WAVE ${n}`, act.name, "#f5c96b");
      this.opts.sfx.play("wave", {
        intensity: Math.min(1, 0.3 + n / 40)
      });
      if (this.enemies.boss === null) this.opts.sfx.musicCombat();
    }
    /* budget & composition */
    const budget = waveBudget(n) * (isBoss ? 0.4 : 1) * (1 - this.mercyF * MERCY_SPAWNS);
    this.waveQueue = [];
    const types = availableTypes(n);
    if (types.length > 0) {
      let spent = 0;
      let guard = 0;
      while (spent < budget && guard++ < 200) {
        /* weighted pick by seed ecology */let total = 0;
        const weights = types.map(t => {
          const w = (this.poolWeights[t] ?? 1) / Math.max(0.5, /* late bias */1);
          total += w;
          return w;
        });
        let roll = this.rng.next() * total;
        let pick = types[0];
        for (let i = 0; i < types.length; i++) {
          roll -= weights[i];
          if (roll <= 0) {
            pick = types[i];
            break;
          }
        }
        const cost = ENEMY_COST(pick);
        if (spent + cost > budget + 1.5) break;
        this.waveQueue.push({
          type: pick,
          elite: this.rollElite(n)
        });
        spent += cost;
      }
    }
    this.waveTotalCount = Math.max(1, this.waveQueue.length);
    this.budgetTotal = this.waveTotalCount;
    this.budgetSpent = 0;
    this.spawnTimer = isBoss ? 2.2 : 0.35;
  }
  currentActId;
  actTerrain;
  rollElite(wave) {
    if (!this.rng.chance(eliteChance(wave))) return null;
    return this.rng.pick(ELITE_ORDER);
  }
  /** Circle-vs-circle position projection out of the rune rubble (in place).
  *  Dead-center landings fall out along +X (spawn zone is always clear, so
  *  this only guards blink edge cases). */
  obstaclePushout(pt, radius) {
    for (const o of this.obstacles) {
      const dx = pt.x - o.x,
        dz = pt.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + radius;
      if (d < min) {
        if (d < 1e-4) {
          pt.x = o.x + min;
          continue;
        }
        pt.x = o.x + dx / d * min;
        pt.z = o.z + dz / d * min;
      }
    }
  }
  /** True when (x,z) is outside every obstacle + margin (spawn safety). */
  obstacleClear(x, z, margin) {
    for (const o of this.obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r + margin) return false;
    }
    return true;
  }
  /** Safe spawn point or null (audit P2-3) — every returned point passes the
  *  distance + obstacle predicate; there is NO unchecked fallback. `relax`
  *  widens the search for boss congestion retries (see pendingBoss). */
  spawnPosition(boss = false, relax = 0) {
    return safeSpawnSweep(this.player.x, this.player.z, boss, (x, z) => this.obstacleClear(x, z, 1.0), () => this.rng.next(), {
      relax
    });
  }
  /** Spawn a tyrant at a SAFE point: rift-in + banner/music/sfx fire here so
  *  a deferred (retried) boss plays its full entrance on arrival. The
  *  endless HP multiplier reads the CURRENT wave (a deferred boss can never
  *  outlive its own wave — completion is blocked while it is pending). */
  spawnBossNow(def, x, z) {
    this.enemies.queueBoss(def, x, z);
    this.enemies.flushSpawns(this.wave, this.ctx);
    if (this.wave > VICTORY_WAVE) {
      const boss = this.enemies.boss;
      if (boss) {
        const m = endlessBossMult(this.wave);
        boss.hp *= m;
        boss.hpMax *= m;
      }
    }
    this.haptic([12, 40, 12]); // tyrant-arrival double pulse (settings-gated)
    this.opts.callbacks.onBanner(`TYRANT — ${def.name.toUpperCase()}`, def.title, def.color);
    this.opts.sfx.musicBoss();
    this.opts.sfx.play("boss", {
      intensity: 1
    });
  }
  completeWave() {
    const n = this.wave;
    this.stats.score += n * 50;
    /* wave 50 cleared → victory credits — a MILESTONE result (audit P1-1):
    the full run banks ONCE here (kind "victory", payout = 100% of
    glyphs), then the cumulative counters are snapshotted so a later
    endless death banks only the post-victory delta. */
    if (n === VICTORY_WAVE && !this.endless && !this.victoryEmitted) {
      this.victoryEmitted = true;
      this.stats.triumph = true;
      this.victorySnapshot = {
        kills: this.stats.kills,
        damage: this.stats.damage,
        timeSec: this.stats.timeSec,
        glyphs: this.stats.glyphs,
        score: this.stats.score
      };
      this.opts.sfx.musicStop();
      this.opts.sfx.play("victory", {
        intensity: 1
      });
      this.opts.callbacks.onStats({
        ...this.stats,
        wave: n,
        newCombos: [...this.newCombos],
        runId: this.runId,
        kind: "victory",
        payout: this.stats.glyphs,
        delta: null
      });
      this.setPhase("credits");
      return;
    }
    /* strict one-drop-per-wave economy */
    if (n % TRIBUTE_INTERVAL === 0) {
      const offer = {
        wave: n,
        choices: draftGateChoices(n, this.heldRewards, this.rng)
      };
      this.setPhase("gate");
      this.opts.callbacks.onGate(offer);
      this.opts.sfx.play("gate", {
        intensity: 1
      });
      return;
    }
    if (n % 10 === 9) {
      const payload = {
        equipped: [...this.equipped],
        resonanceName: "Resonance Orb",
        resonanceLore: "Sacrifice exactly two bound spells — they fuse into one merged slot."
      };
      const filled = this.equipped.filter(s => s !== null).length;
      if (filled >= 2) {
        this.setPhase("merge");
        this.opts.callbacks.onMerge(payload);
        this.opts.sfx.play("offer", {
          intensity: 1
        });
        return;
      }
    }
    if (n === this.nextSpellWave) {
      this.nextSpellWave = n + this.rng.int(SPELL_DROP_WAVE_MIN, SPELL_DROP_WAVE_MAX);
      if (this.rng.chance(1 - SPELL_DROP_NERF)) {
        const pool = draftSpellOffer(this.equipped, this.rng);
        if (pool.length > 0) {
          const offer = {
            pool,
            equipped: [...this.equipped],
            wave: n,
            selected: this.selected
          };
          this.setPhase("offer");
          this.opts.callbacks.onSpellOffer(offer);
          this.opts.sfx.play("offer", {
            intensity: 0.9
          });
          return;
        }
      }
    }
    /* v2.2 spell evolutions: after the tear-offer slot, offer ONE eligible
    long-bound spell its evolution branches (deterministic — same rng stream,
    documented consumption order in content.draftEvolutionOffer). Declining
    is allowed; deciding either way ends eligibility for that element. */
    const evolution = draftEvolutionOffer(this.equipped, this.evolved, this.boundWave, n, this.rng);
    if (evolution && evolution.cards.length > 0) {
      this.pendingEvolveElement = evolution.element;
      this.evolved[evolution.element] = "seen"; // one look per run (guard token — replaced or left on decline)
      this.setPhase("evolve");
      this.opts.callbacks.onEvolve({
        element: evolution.element,
        cards: evolution.cards,
        wave: n
      });
      this.opts.sfx.play("offer", {
        intensity: 1
      });
      return;
    }
    if (this.rng.chance(0.35)) {
      const heal = Math.round(this.player.hpMax * HEART_DROP_HEAL_FRAC);
      this.player.hp = Math.min(this.player.hpMax, this.player.hp + heal);
      this.opts.callbacks.onBanner("A HEART APPEARS", `Mended ${heal} HP`, "#ff8fa3");
      this.opts.sfx.play("heart", {
        intensity: 1
      });
      this.vfx.burst(_fxPos.set(this.player.x, 1.5, this.player.z), 0xff4d6b, 18, {
        speed: 5,
        up: 4
      });
    }
    this.waveDelay = 1.5;
  }
  applyReward(id) {
    const def = REWARD_DEFS.find(r => r.id === id);
    const p = this.player;
    switch (id) {
      case "vitality":
        p.hpMax += 18;
        p.hp += 18;
        break;
      case "mend":
        p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.45);
        break;
      case "power":
        p.dmgMult += 0.14;
        break;
      case "focus":
        p.aetherMax += 22;
        p.aetherRegen *= 1.2;
        p.aether += 22;
        break;
      case "swift":
        p.speed *= 1.1;
        break;
      case "haste":
        p.cdMult *= 0.88;
        break;
      case "surge":
        p.surgeRateMult += 0.25;
        break;
      case "ward":
        p.resist = Math.min(0.75, p.resist + 0.08);
        break;
      case "greed":
        p.glyphMult += 0.3;
        break;
      case "volley":
        p.volleyCount += 1;
        p.volleyDmg += 0.1;
        break;
    }
    if (def) {
      this.opts.callbacks.onBanner(def.name.toUpperCase(), def.desc, def.color);
      this.opts.sfx.play("buy", {
        intensity: 0.9
      });
    }
  }
  /* ------------------------------- combat -------------------------------- */
  makeContext() {
    return {
      scene: this.scene,
      arenaRadius: ARENA_RADIUS,
      time: 0,
      wave: 1,
      rng: this.rng,
      player: this.player,
      enemies: this.enemies.enemies,
      hazards: this.spells.hazards,
      vfx: this.vfx,
      sfx: this.opts.sfx,
      quality: this.opts.settings.quality,
      damageNumbers: this.opts.settings.damageNumbers,
      attunementMult: 1,
      mercyF: 0,
      damagePlayer: (amount, sx, sz, cause) => this.damagePlayer(amount, sx, sz, cause),
      damageEnemy: (e, amount, dmgOpts) => this.damageEnemy(e, amount, dmgOpts),
      killEnemy: (e, byPlayer) => {
        void byPlayer;
        if (e.hp <= 0) this.killEnemy(e);
      },
      spawnEnemyBolt: (x, y, z, tx, tz, speed, dmg, color, radius) => this.spells.spawnEnemyBolt(x, y, z, tx, tz, speed, dmg, color, radius),
      spawnMinion: (type, x, z) => this.enemies.queueSpawn(type, x, z, null),
      addHazard: h => this.spells.hazards.push(h),
      spawnBossShockring: (x, z, color, dmg, speed) => this.spells.createBossShockring(x, z, color, dmg, speed, this.ctx),
      spawnBossRift: (x, z, color) => this.spells.createBossRift(x, z, color, this.enemies.boss?.dmg ?? 24, this.ctx),
      shake: a => this.shake(a),
      hitStop: t => {
        this.hitStopT = Math.max(this.hitStopT, t);
      },
      slowmo: (t, f) => {
        this.slowmoT = Math.max(this.slowmoT, t);
        this.slowmoF = f;
      },
      banner: (title, sub, color) => this.opts.callbacks.onBanner(title, sub, color)
    };
  }
  damagePlayer(amount, sx, sz, cause) {
    const p = this.player;
    if (p.dead || p.iframe > 0) return;
    const final = amount * (1 - p.resist) * (1 - this.mercyF);
    p.hp -= final;
    p.iframe = 0.4;
    /* v2.2 death-cause log: remember the last three wounds (newest last).
    An absent cause stays honest — the defeat screen reads "the rift's
    aftermath" rather than inventing a killer. */
    this.lastHits.push({
      cause: cause ?? "the rift's aftermath",
      amount: Math.max(1, Math.round(final)),
      t: this.time
    });
    if (this.lastHits.length > 3) this.lastHits.shift();
    this.haptic(20); // player-hit haptic cue (settings-gated)
    this.playerAnim?.play("hit"); // acquired-mage flinch (no-op procedurally)
    this.trauma = Math.min(1, this.trauma + 0.35);
    this.rumble(120, 0.7, 0.4); // haptic hurt tick (screenShake-gated)
    this.vfx.burst(_fxPos.set(p.x, 1.3, p.z), 0xff4d6b, 10, {
      speed: 5
    });
    if (this.opts.settings.damageNumbers && final >= 1) {
      this.vfx.damageNumber(_fxPos.set(p.x, 1.8, p.z), `-${Math.round(final)}`, 0xff4d6b, true);
    }
    this.opts.sfx.play("hurt", {
      intensity: Math.min(1, final / 30)
    });
    void sx;
    void sz;
    if (p.hp <= 0) this.playerDeath();
  }
  damageEnemy(e, amount, opts) {
    if (e.dead) return;
    let final = amount;
    if (opts?.isSpell && e.elite) final *= ELITE_BONUS;
    if (e.elite === "bulwark") final *= 1 - 0.18;
    let crit = false;
    /* seeded combat stream (audit P2-2): the 12% spell crit is a gameplay
    roll — it must reproduce for the same run seed. */
    if (opts?.isSpell && this.rngCombat.chance(0.12)) {
      crit = true;
      final *= 1.75;
    }
    e.hp -= final;
    e.hitFlash = 1;
    e.squash = Math.max(e.squash, 0.4);
    this.stats.damage += final;
    /* surge charge */
    if (this.player.surgeActive <= 0) {
      const need = SURGE_BASE_NEED + this.wave * 26;
      this.player.surge = Math.min(1, this.player.surge + final / need * this.player.surgeRateMult);
      if (this.player.surge >= 1) this.opts.sfx.play("surgeReady", {
        intensity: 0.8
      });
    }
    /* knockback */
    if (opts?.knock && !e.boss && e.def.brain !== "tank") {
      const kx = e.x - (opts.sourceX ?? this.player.x);
      const kz = e.z - (opts.sourceZ ?? this.player.z);
      const kd = Math.hypot(kx, kz) || 1;
      e.vx += kx / kd * opts.knock;
      e.vz += kz / kd * opts.knock;
    }
    /* numbers & juice */
    if (this.opts.settings.damageNumbers && !opts?.noNumbers && final >= 1) {
      this.vfx.damageNumber(_fxPos.set(e.x, e.y + 1.6 + e.radius, e.z), `${Math.round(final)}`, crit ? 0xf5c96b : opts?.color ?? 0xffffff, crit || !!e.boss);
    }
    if (crit) {
      this.hitStopT = Math.max(this.hitStopT, 0.045);
      this.opts.sfx.play("crit", {
        intensity: 0.8
      });
    } else if (final > 1) {
      this.opts.sfx.play("hit", {
        intensity: Math.min(1, final / 60)
      });
    }
  }
  killEnemy(e) {
    /* exactly-once reward commit: projectiles + the engine sweep can both
    observe hp <= 0 in the same frame (plan §6 death/reward rule) */
    if (e.dead) return;
    e.dead = true;
    const isBoss = !!e.boss;
    this.stats.kills++;
    const scoreGain = Math.round(e.score * (e.elite ? 1.5 : 1));
    this.stats.score += scoreGain;
    const color = hexNum(e.def.color);
    if (isBoss && e.boss) {
      this.stats.bossesSlain.push(e.boss.def.id);
      this.rumble(320, 1, 0.8); // tyrant death haptic (screenShake-gated)
      this.vfx.explosion(_fxPos.set(e.x, 1.5, e.z), color, 8);
      this.vfx.ring(_fxPos.set(e.x, 0, e.z), color, 16, {
        life: 0.9
      });
      this.vfx.burst(_fxPos.set(e.x, 2, e.z), color, 60, {
        speed: 14
      });
      this.slowmoT = Math.max(this.slowmoT, 1.1);
      this.slowmoF = 0.3;
      this.trauma = MAX_TRAUMA;
      this.zoomPunch = 0.32;
      this.opts.callbacks.onBanner(`${e.boss.def.name.toUpperCase()} FALLS`, "Its light goes out", e.boss.def.color);
      this.opts.sfx.play("bossDie", {
        intensity: 1
      });
      this.opts.sfx.musicCombat();
    } else {
      this.vfx.explosion(_fxPos.set(e.x, 0.9, e.z), color, 1.4);
      this.vfx.soulWisp(_fxPos.set(e.x, 1, e.z), color);
      this.opts.sfx.play("kill", {
        intensity: Math.min(1, e.hpMax / 200)
      });
      this.trauma = Math.min(MAX_TRAUMA, this.trauma + 0.05);
      this.zoomPunch = Math.max(this.zoomPunch, 0.05);
    }
    /* glyph drops — seeded combat stream (audit P2-2): the extra-drop roll
    is gameplay (loot), never Math.random. */
    const count = isBoss ? 10 : 1 + (this.rngCombat.chance(0.35) ? 1 : 0);
    const value = Math.max(1, Math.round((1 + this.wave / 6) * (e.elite ? 2 : 1)));
    for (let i = 0; i < count; i++) this.spawnGlyphPickup(e.x, e.z, value);
    /* 10-d death linger: the Enemy leaves the sim NOW (economy/loot/wave
    all resolved above — identical to the old same-frame removal), but the
    body plays a short death sequence before it is freed (see entities.ts
    death-linger section). Bosses linger under their death slow-mo. */
    this.enemies.beginDeath(e);
  }
  playerDeath() {
    const p = this.player;
    p.hp = 0;
    p.dead = true;
    this.releaseWakeLock(); // the trial is over — let the screen sleep again
    this.countdownT = 0;
    this.slowmoT = 1.4;
    this.slowmoF = 0.25;
    this.trauma = MAX_TRAUMA;
    /* acquired-mage death collapse (procedural body simply explodes away);
    the controller locks every further state until resetPlayerAnim() */
    this.playerAnim?.play("death");
    this.vfx.explosion(_fxPos.set(p.x, 1.2, p.z), 0x9a7bff, 5);
    this.opts.sfx.musicStop();
    this.opts.sfx.play("death", {
      intensity: 1
    });
    this.stats.endless = this.endless;
    /* MILESTONE result (audit P1-1): a post-victory endless death banks ONLY
    the post-victory delta (kind "endless-death"); a pre-50 death banks the
    full run (kind "death"). Emitted at most once per run — belt-and-
    braces alongside the store's runId:kind idempotency set. */
    if (!this.deathEmitted) {
      this.deathEmitted = true;
      const snap = this.victorySnapshot;
      const delta = snap ? {
        kills: Math.max(0, this.stats.kills - snap.kills),
        damage: Math.max(0, this.stats.damage - snap.damage),
        timeSec: Math.max(0, this.stats.timeSec - snap.timeSec),
        glyphs: Math.max(0, this.stats.glyphs - snap.glyphs),
        score: Math.max(0, this.stats.score - snap.score)
      } : null;
      this.opts.callbacks.onStats({
        ...this.stats,
        wave: this.wave,
        newCombos: [...this.newCombos],
        runId: this.runId,
        kind: snap ? "endless-death" : "death",
        killedBy: this.lastHits.length > 0 ? this.lastHits[this.lastHits.length - 1].cause : null,
        lastHits: [...this.lastHits],
        payout: delta ? Math.round(delta.glyphs * 0.25) // endless: 25% of the DELTA glyphs
        : Math.round(this.stats.glyphs * 0.25),
        delta
      });
    }
    /* let the death slow-mo play out before the screen — the timer is
    lifecycle-scoped (audit P2-1): cleared on startRun/stopRun/dispose,
    and the callback re-validates engine + generation + player + phase
    before it may flip anything. */
    this.clearDeathTimer();
    const gen = this.runGeneration;
    this.deathTimer = window.setTimeout(() => {
      this.deathTimer = null;
      if (this.disposed || gen !== this.runGeneration || p !== this.player || this.phase !== "playing" || !p.dead) return;
      this.setPhase("gameover");
    }, 1300);
  }
  /* ------------------------------- pickups ------------------------------- */
  spawnGlyphPickup(x, z, value) {
    /* seeded pickup stream (audit P2-2): ejection angle moves the gem (it
    affects trajectory + collection timing), so it is gameplay RNG. */
    const a = this.rngPickup.range(0, Math.PI * 2);
    const group = this.pickupPool.pop() ?? this.makePickupMesh();
    group.visible = true;
    this.scene.add(group);
    this.pickups.push({
      kind: "glyph",
      x,
      z,
      y: 0.8,
      life: 11,
      vx: Math.cos(a) * 3.5,
      vz: Math.sin(a) * 3.5,
      value,
      group,
      magnet: false
    });
  }
  makePickupMesh() {
    /* R-05 (v2.0): glyph pickups must survive dense spell-light. Four parts,
    all sharing module-level geometries (never disposed per-pickup); the
    materials stay per-pickup so the expire-fade animates independently:
      children[0] gem   — OPAQUE high-luminance gold core (depth-tested,
                          depthWrite on — a solid body, not a glow)
      children[1] shell — dark BackSide octahedron scaled 1.32× → a crisp
                          contrasting silhouette on any background
      children[2] rim   — restrained additive halo (depthWrite off)
      children[3] ring  — flat gold ground ring (the beacon that marks the
                          pickup on the floor through any particle storm;
                          slowly counter-rotates + breathes) */
    const g = new THREE.Group();
    const gem = new THREE.Mesh(PICKUP_GEM_GEO, new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: false,
      opacity: 1
    }));
    gem.name = "gem";
    g.add(gem);
    const shell = new THREE.Mesh(PICKUP_SHELL_GEO, new THREE.MeshBasicMaterial({
      color: 0x1c1030,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    }));
    shell.scale.setScalar(1.32);
    shell.name = "shell";
    g.add(shell);
    const rim = new THREE.Mesh(PICKUP_RIM_GEO, new THREE.MeshBasicMaterial({
      color: 0xf5c96b,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    rim.scale.set(1, 1.35, 1);
    rim.name = "rim";
    g.add(rim);
    const ring = new THREE.Mesh(PICKUP_RING_GEO, new THREE.MeshBasicMaterial({
      color: 0xf5c96b,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.72; // relative to the bobbing gem — sits ≈0.06 above ground
    ring.name = "ring";
    g.add(ring);
    return g;
  }
  removePickupMesh(p) {
    this.scene.remove(p.group);
    if (this.pickupPool.length < 64) this.pickupPool.push(p.group);else p.group.traverse(o => {
      if (o instanceof THREE.Mesh) o.material.dispose();
    });
  }
  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      const dx = p.x - pk.x,
        dz = p.z - pk.z;
      const d = Math.hypot(dx, dz);
      if (d < 4.2 || pk.magnet) {
        pk.magnet = true;
        const sp = 14 * dt;
        pk.x += dx / (d || 1) * sp;
        pk.z += dz / (d || 1) * sp;
      } else {
        pk.x += pk.vx * dt;
        pk.z += pk.vz * dt;
        const damp = Math.pow(0.02, dt);
        pk.vx *= damp;
        pk.vz *= damp;
      }
      if (d < 0.85 && !p.dead) {
        const gain = Math.max(1, Math.round(pk.value * p.glyphMult));
        this.stats.glyphs += gain;
        this.stats.score += gain * 2;
        this.opts.sfx.play("glyph", {
          intensity: 0.4
        });
        this.removePickupMesh(pk);
        this.pickups.splice(i, 1);
        continue;
      }
      if (pk.life <= 0) {
        this.removePickupMesh(pk);
        this.pickups.splice(i, 1);
      }
    }
  }
  updatePickupVisuals(dt) {
    for (const pk of this.pickups) {
      pk.y = 0.8 + Math.sin(this.time * 4 + pk.x) * 0.15;
      pk.group.position.set(pk.x, pk.y, pk.z);
      pk.group.rotation.y += dt * 3;
      /* R-05: makePickupMesh adds exactly four children in fixed order —
      no per-pickup per-frame getObjectByName traversal. The expire fade
      drives only the TRANSPARENT parts (shell/rim/ring); the opaque core
      keeps full contrast until collection. The ground ring breathes on its
      own phase and counter-rotates so it never reads as spell VFX. */
      const shell = pk.group.children[1];
      const rim = pk.group.children[2];
      const ring = pk.group.children[3];
      const fading = pk.life < 2;
      const flick = Math.sin(this.time * 12);
      if (shell) {
        shell.material.opacity = fading ? 0.35 + flick * 0.3 : 0.92;
      }
      if (rim) {
        rim.material.opacity = fading ? 0.15 + flick * 0.12 : 0.4;
      }
      if (ring) {
        ring.material.opacity = fading ? 0.25 + flick * 0.2 : 0.75 + 0.2 * Math.sin(this.time * 5 + pk.z);
        ring.rotation.z -= dt * 1.4;
        const s = 1 + 0.08 * Math.sin(this.time * 3 + pk.x);
        ring.scale.set(s, s, 1);
      }
    }
  }
  /* ------------------------------- visuals ------------------------------- */ /** Acquired KayKit mage (CC0, docs/AUDITS.md): rigged model + staff
                                                                                *  bound to the right-hand bone + retargeted Rig_Medium clips (idle/run
                                                                                *  blend, hit flinch, death collapse, throw flourish on casts). */
  buildMageModel(g) {
    const mage = this.assets.spawnModel("mage");
    if (!mage) return;
    mage.scale.setScalar(MODEL_FIT.mage);
    g.add(mage);
    /* animation stack (plan §5 AnimationController) — clips retarget 1:1
    (identical Rig_Medium skeleton). Missing clips degrade gracefully:
    that state is simply unavailable (procedural-fallback parity). */
    this.playerAnim = new AnimationController(new THREE.AnimationMixer(mage), {
      idle: this.assets.clip("Idle_A"),
      move: this.assets.clip("Running_A"),
      dash: this.assets.clip("Running_B"),
      cast: this.assets.clip("Throw"),
      hit: this.assets.clip("Hit_A"),
      death: this.assets.clip("Death_A")
    });
    /* staff (KayKit CC0) — child of the hand bone so it rides every clip */
    const hand = mage.getObjectByName("handslotr");
    const staff = this.assets.spawnModel("staff");
    if (hand && staff) {
      staff.position.set(0, 0.1, 0.02);
      hand.add(staff);
      /* recolorable crystal crown on the staff head (updateStaffColor drives it) */
      const orbGeo = new THREE.OctahedronGeometry(0.11, 0);
      orbGeo.scale(1, 1.5, 1);
      this.staffOrb = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({
        color: 0xff7847,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      }));
      this.staffOrb.position.y = 1.3;
      staff.add(this.staffOrb);
    } else {
      const orbGeo = new THREE.OctahedronGeometry(0.17, 0);
      orbGeo.scale(1, 1.5, 1);
      this.staffOrb = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({
        color: 0xff7847,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      }));
      this.staffOrb.position.set(0.55, 2.2, 0.15);
      g.add(this.staffOrb);
    }
    this.addPlayerAuraFx(g);
    this.scene.add(g);
  }
  /** Shared living-detail fx for both player bodies: orbiting rune shards,
  *  ground glow + blob shadow, surge aura ring. */
  addPlayerAuraFx(g) {
    /* three small rune shards orbiting the mage */this.runeShards = new THREE.Group();
    this.runeShards.name = "runeShards";
    this.runeShards.position.y = 1.35;
    const shardGeo = new THREE.TetrahedronGeometry(0.09);
    const shardMat = new THREE.MeshBasicMaterial({
      color: 0x9a7bff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const shard = new THREE.Mesh(shardGeo, shardMat);
      shard.position.set(Math.cos(a) * 0.95, Math.sin(a * 2) * 0.18, Math.sin(a) * 0.95);
      this.runeShards.add(shard);
    }
    g.add(this.runeShards);
    /* ground glow + shadow */
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({
      color: 0x9a7bff,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    g.add(glow);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 20), new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    g.add(shadow);
    /* surge aura ring */
    this.auraRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 8, 32), new THREE.MeshBasicMaterial({
      color: 0xf5c96b,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    this.auraRing.rotation.x = -Math.PI / 2;
    this.auraRing.position.y = 0.1;
    g.add(this.auraRing);
  }
  /** Reset locomotion/one-shot actions for a fresh run (death pose clear).
  *  Same semantics as before the controller: stop one-shots, clear the
  *  death lock, restart idle/run at weights 1/0. */
  resetPlayerAnim() {
    this.playerAnim?.reset();
  }
  /** Procedural fallback archmage: flared lathe robe with gold trims,
  *  shoulder mantle with gold trim, boot hints, wide-brim hat (sloped brim +
  *  crown + band), gnarled segmented staff with pronged crystal head
  *  (tintable per selected spell — see updateStaffColor). ~1.6k triangles. */
  buildPlayerModel() {
    const g = this.playerGroup;
    g.clear();
    this.playerAnim?.dispose();
    this.playerAnim = null;
    /* acquired animated mage when the pack has landed; procedural archmage
    otherwise (identical silhouette role, zero gameplay difference) */
    if (this.assets.models.has("mage")) {
      this.buildMageModel(g);
      return;
    }
    const robeMat = new THREE.MeshStandardMaterial({
      color: 0x3a2766,
      roughness: 0.62,
      metalness: 0.05,
      emissive: 0x1c1140,
      emissiveIntensity: 0.9
    });
    const robeDarkMat = new THREE.MeshStandardMaterial({
      color: 0x251744,
      roughness: 0.68,
      metalness: 0.05,
      emissive: 0x150c2c
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf5c96b,
      roughness: 0.34,
      metalness: 0.55,
      emissive: 0x40300e,
      emissiveIntensity: 1
    });
    const hatMat = new THREE.MeshStandardMaterial({
      color: 0x2b1a52,
      roughness: 0.7,
      metalness: 0.05,
      emissive: 0x170e30,
      side: THREE.DoubleSide
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe8d5ff,
      roughness: 0.5
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a2a,
      roughness: 0.85,
      flatShading: true
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1a1030,
      roughness: 0.8
    });
    const eyeGlowMat = new THREE.MeshBasicMaterial({
      color: 0xbfa8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    /* --- robe: flared lathe profile (hem → skirt → waist → chest → neck) --- */
    const profile = [new THREE.Vector2(0.62, 0.03), new THREE.Vector2(0.56, 0.2), new THREE.Vector2(0.44, 0.5), new THREE.Vector2(0.35, 0.82), new THREE.Vector2(0.31, 1.04), new THREE.Vector2(0.27, 1.2), new THREE.Vector2(0.1, 1.3)];
    g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 12), robeMat));
    /* hem trim + belt + buckle */
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.585, 0.05, 5, 14), goldMat);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1, 1, 0.6);
    hem.position.y = 0.09;
    g.add(hem);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.375, 0.1, 12, 1, true), robeDarkMat);
    belt.position.y = 0.86;
    g.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.05), goldMat);
    buckle.position.set(0, 0.86, 0.33);
    g.add(buckle);
    /* shoulder mantle + gold trim */
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.48, 0.28, 12, 1, true), robeDarkMat);
    mantle.position.y = 1.17;
    g.add(mantle);
    const mantleTrim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.032, 5, 14), goldMat);
    mantleTrim.rotation.x = Math.PI / 2;
    mantleTrim.position.y = 1.05;
    g.add(mantleTrim);
    /* boot hints peeking under the hem */
    const bootGeo = new THREE.BoxGeometry(0.17, 0.12, 0.26);
    const bootL = new THREE.Mesh(bootGeo, darkMat);
    bootL.position.set(0.17, 0.06, 0.36);
    const bootR = new THREE.Mesh(bootGeo, darkMat);
    bootR.position.set(-0.17, 0.06, 0.36);
    g.add(bootL, bootR);
    /* head + glowing eyes (read against dark floors) */
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 9), skinMat);
    head.position.y = 1.62;
    g.add(head);
    const eyeGeo = new THREE.OctahedronGeometry(0.035);
    const eyeL = new THREE.Mesh(eyeGeo, eyeGlowMat);
    eyeL.position.set(0.09, 1.66, 0.21);
    const eyeR = new THREE.Mesh(eyeGeo, eyeGlowMat);
    eyeR.position.set(-0.09, 1.66, 0.21);
    g.add(eyeL, eyeR);
    /* wide-brim hat: sloped brim ring + crown + band (tilted for character) */
    const hat = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.68, 0.1, 14, 1, true), hatMat);
    brim.position.y = 1.86;
    hat.add(brim);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.62, 12), hatMat);
    crown.position.y = 2.2;
    hat.add(crown);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.042, 5, 12), goldMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.95;
    hat.add(band);
    hat.rotation.z = 0.12;
    hat.rotation.x = -0.05;
    g.add(hat);
    /* gnarled staff: three kinked segments + root knob + prongs clutching the crystal */
    const staff = new THREE.Group();
    staff.position.set(0.55, 0, 0.15);
    staff.rotation.z = -0.16;
    const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.85, 7), woodMat);
    seg1.position.y = 0.42;
    staff.add(seg1);
    const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.75, 7), woodMat);
    seg2.position.set(0.035, 1.18, 0);
    seg2.rotation.z = 0.1;
    staff.add(seg2);
    const seg3 = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.55, 7), woodMat);
    seg3.position.set(0.105, 1.79, 0);
    seg3.rotation.z = 0.16;
    staff.add(seg3);
    const root = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), woodMat);
    root.position.y = 0.06;
    staff.add(root);
    const prongGeo = new THREE.ConeGeometry(0.035, 0.24, 5);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.5;
      const prong = new THREE.Mesh(prongGeo, woodMat);
      prong.position.set(Math.cos(a) * 0.12, 2.14, Math.sin(a) * 0.12);
      prong.rotation.z = -Math.cos(a) * 0.45;
      prong.rotation.x = Math.sin(a) * 0.45;
      staff.add(prong);
    }
    /* crystal head — recolored per selected spell in updateStaffColor() */
    const orbGeo = new THREE.OctahedronGeometry(0.17, 0);
    orbGeo.scale(1, 1.5, 1);
    this.staffOrb = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({
      color: 0xff7847,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    }));
    this.staffOrb.position.y = 2.2;
    staff.add(this.staffOrb);
    g.add(staff);
    this.addPlayerAuraFx(g);
    this.scene.add(g);
  }
  /** Tear down the player model + aim ring (geometries AND materials). */
  disposePlayerModel() {
    this.playerAnim?.dispose();
    this.playerAnim = null;
    this.scene.remove(this.playerGroup);
    this.scene.remove(this.aimRing);
    this.playerGroup.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach(x => x.dispose());else m.dispose();
      }
    });
    this.aimRing.geometry.dispose();
    this.aimRing.material.dispose();
  }
  buildAimRing() {
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 28), new THREE.MeshBasicMaterial({
      color: 0xf5c96b,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.position.y = 0.06;
    this.scene.add(this.aimRing);
  }
  updateStaffColor() {
    const slot = this.equipped[this.selected];
    const el = typeof slot === "string" ? slot : slot ? slot.merged[0] : null;
    /* v2.2: evolved identity color first, then the colorblind palette. */
    const css = el ? (this.evolved[el] && this.evolved[el] !== "seen" ? evolvedSpellDef(el, this.evolved[el]).color : elementColor(el)) : "#f5c96b";
    const color = hexNum(css);
    this.staffOrb.material.color.setHex(color);
    this.aimRing.material.color.setHex(color);
  }
  updatePlayerVisual(dt) {
    const p = this.player;
    const bob = Math.sin(this.time * 2.2) * (this.playerAnim ? 0.02 : 0.07);
    this.playerGroup.position.set(p.x, bob, p.z);
    if (!p.dead) {
      const aimA = Math.atan2(p.aimX - p.x, p.aimZ - p.z);
      let diff = aimA - this.playerGroup.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.playerGroup.rotation.y += diff * Math.min(1, dt * 12);
    }
    /* living details: rune shards orbit + breathe, staff crystal spins + pulses */
    this.runeShards.rotation.y += dt * 1.5;
    this.runeShards.position.y = 1.35 + Math.sin(this.time * 2.2 + 0.8) * 0.08;
    this.staffOrb.rotation.y += dt * 1.1;
    this.staffOrb.scale.setScalar(1 + Math.sin(this.time * 5.4) * 0.08);
    /* acquired-mage locomotion: the controller blends idle/run from the
    input intent (same 9/s easing as before) and overlays any one-shot
    (hit/cast/death); footstep dust puffs keep the run grounded. */
    const movingNow = !p.dead && (this.input.moveX !== 0 || this.input.moveZ !== 0);
    if (this.playerAnim) {
      if (!p.dead) this.playerAnim.setMoveWeight(movingNow ? 1 : 0);
      this.playerAnim.update(dt);
    }
    if (movingNow) {
      this.stepDustT -= dt;
      if (this.stepDustT <= 0) {
        this.stepDustT = 0.22;
        this.vfx.burst(_fxPos.set(p.x, 0.12, p.z), 0x9a7bff, 2, {
          speed: 1.1,
          up: 1.6,
          life: 0.4,
          gravity: -2.5
        });
      }
    } else {
      this.stepDustT = 0;
    }
    this.throwAnimCd = Math.max(0, this.throwAnimCd - dt);
    /* surge aura */
    const auraMat = this.auraRing.material;
    if (p.surgeActive > 0) {
      auraMat.opacity = 0.55 + Math.sin(this.time * 10) * 0.25;
      this.auraRing.scale.setScalar(1.15 + Math.sin(this.time * 7) * 0.1);
      /* seeded cosmetic stream (audit P2-2): pure looks — isolated from the
      gameplay streams so cosmetics never perturb a gameplay roll. */
      if (this.rngCosmetic.next() < dt * 24) {
        this.vfx.burst(_fxPos.set(p.x, 1, p.z), 0xf5c96b, 1, {
          speed: 2.5,
          up: 3,
          life: 0.6,
          gravity: -2
        });
      }
    } else {
      auraMat.opacity = Math.max(0, auraMat.opacity - dt * 2);
    }
    /* iframe blink */
    this.playerGroup.visible = !(p.iframe > 0 && Math.sin(this.time * 30) < -0.2) || p.dead;
    /* aim ring */
    this.aimRing.position.set(p.aimX, 0.06, p.aimZ);
    this.aimRing.visible = this.phase === "playing";
    const pulse = 1 + Math.sin(this.time * 5) * 0.08;
    this.aimRing.scale.setScalar(pulse);
  }
  updateCamera(dt) {
    const p = this.player;
    /* look-ahead toward aim */
    const leadX = (p.aimX - p.x) * 0.12;
    const leadZ = (p.aimZ - p.z) * 0.12;
    const targetX = p.x + leadX;
    const targetZ = p.z + leadZ;
    const camX = targetX;
    const camY = CAM_HEIGHT + this.zoomPunch * -2.5;
    const camZ = targetZ + CAM_BACK;
    const k = 1 - Math.exp(-6 * dt);
    this.camera.position.x += (camX - this.camera.position.x) * k;
    this.camera.position.y += (camY - this.camera.position.y) * k;
    this.camera.position.z += (camZ - this.camera.position.z) * k;
    /* trauma shake — smooth layered sines read as a cinematic rumble;
    per-frame white noise read as a rattle and caused motion sickness. */
    if (this.opts.settings.screenShake && this.trauma > 0) {
      const t2 = this.trauma * this.trauma;
      const t = this.shakeClock * 5.5;
      const sx = Math.sin(t * 6.9) * 0.6 + Math.sin(t * 4.3 + 1.7) * 0.4;
      const sy = Math.sin(t * 7.7 + 2.4) * 0.6 + Math.sin(t * 5.1 + 0.6) * 0.4;
      const sz = Math.sin(t * 6.1 + 4.1) * 0.6 + Math.sin(t * 4.9 + 3.2) * 0.4;
      this.camera.position.x += sx * t2 * SHAKE_AMP;
      this.camera.position.y += sy * t2 * SHAKE_AMP * 0.7;
      this.camera.position.z += sz * t2 * SHAKE_AMP;
    }
    this.camera.lookAt(targetX, 0.6, targetZ);
    /* FOV setting (10-a): 45..80°, default 62 — a larger view than the old
    hardcoded 55; zoom-punch still widens on big hits. Live from settings. */
    const baseFov = THREE.MathUtils.clamp(this.opts.settings.fov ?? 62, 45, 80);
    const wantFov = baseFov + this.zoomPunch * 3.5;
    if (Math.abs(wantFov - this._appliedFov) > 1e-4) {
      this.camera.fov = wantFov;
      this._appliedFov = wantFov;
      this.camera.updateProjectionMatrix();
    }
  }
  buildArenaForAct(act, virtualActId = act.id) {
    this.arena?.dispose();
    const arenaRng = mulberry32(hashSeed(`${this.runSeed}:act${virtualActId}`));
    /* terrain (11-a + F-05): FULLY seed-driven — terrainForAct picks the
    *  BIOME from the deterministic deck (5 unique themes across the run's
    *  five act bands, ≥2 of the four new biomes; endless cycles all ten
    *  before reshuffling), and layoutForAct picks the TOPOLOGY from that
    *  biome's compatibility set on a SEPARATE rng stream — visual theme and
    *  obstacle grammar are now independent dimensions. Deterministic: same
    *  seed → same ground + same layout, every act. */
    const terrain = terrainForAct(this.runSeed, virtualActId);
    this.actTerrain = terrain;
    const layoutKind = layoutForAct(this.runSeed, virtualActId, terrain);
    /* 10-e: pass the model-clone accessor so the graveyard terrain can dress
    its clusters with the Kenney Graveyard Kit GLBs (10-c); other kits
    ignore it. Clones share GPU resources with the AssetSystem templates —
    arena.dispose() detaches them without disposing. */
    this.arena = buildArena(act, arenaRng, {
      quality: this.opts.settings.quality,
      terrain,
      layout: layoutKind,
      decor: k => this.assets.spawnModel(k)
    });
    /* rune rubble collision circles (plan §7) — gameplay reads these for the
    player pushout + spawn safety; the enemy system gets its own handle */
    this.obstacles = this.arena.obstacles;
    this.enemies.setObstacles(this.obstacles);
    this.scene.add(this.arena.group);
    const [r, g, b] = act.palette.sky.split(",").map(Number);
    /* explicit SRGB → linear conversion: the sky dome (arena) uses the same
    conversion, so the fog fades EXACTLY into the biome void instead of a
    mis-converted (washed-out) tint. Range pushed out so gameplay-range
    foes stay crisp while far pillars still get atmospheric depth. */
    const sky = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    this.scene.fog = new THREE.Fog(sky.getHex(), 55, 170);
    this.renderer.setClearColor(sky.clone().multiplyScalar(0.35).getHex());
  }
  shake(amount) {
    this.trauma = Math.min(MAX_TRAUMA, this.trauma + amount * SHAKE_GAIN);
  }
  /* --------------------------------- HUD --------------------------------- */
  pushHud() {
    const p = this.player;
    const spellIds: string[] = [];
    const spellNames: string[] = [];
    const spellColors: string[] = [];
    const spellEvolved: boolean[] = [];
    const cooldowns: number[] = [];
    const cooldownSeconds: number[] = []; // R-02: raw remaining seconds — the authoritative countdown
    for (let i = 0; i < 3; i++) {
      const slot = this.equipped[i];
      if (typeof slot === "string") {
        const def = evolvedSpellDef(slot as ElementId, this.evolved[slot]);
        spellIds.push(slot);
        spellNames.push(def.name);
        spellColors.push(def.color);
        spellEvolved.push(!!this.evolved[slot] && this.evolved[slot] !== "seen");
      } else if (slot) {
        const names = slot.merged.map(m => SPELLS[m].name.split(" ")[0]);
        spellIds.push(slot.merged.join("+"));
        spellNames.push(names.join("·"));
        spellColors.push(SPELLS[slot.merged[0]].color);
        spellEvolved.push(false);
      } else {
        spellIds.push("");
        spellNames.push("—");
        spellColors.push("#3a3352");
        spellEvolved.push(false);
      }
      const def = typeof slot === "string" ? evolvedSpellDef(slot as ElementId, this.evolved[slot]) : slot ? SPELLS[slot.merged[0]] : null;
      const cdMax = def ? def.cooldown * p.cdMult : 1;
      cooldowns.push(def ? Math.min(1, this.cooldowns[i] / cdMax) : 0);
      cooldownSeconds.push(def ? Math.max(0, this.cooldowns[i]) : 0);
    }
    const boss = this.enemies.boss;
    const snap = {
      hp: Math.max(0, p.hp),
      hpMax: p.hpMax,
      aether: p.aether,
      aetherMax: p.aetherMax,
      surge: p.surge,
      surgeActive: p.surgeActive,
      wave: this.wave,
      waveProgress: this.waveActive ? Math.max(0, Math.min(1, 1 - (this.waveQueue.length + this.enemies.countAlive() + (this.pendingBoss ? 1 : 0)) / Math.max(1, this.waveTotalCount))) : 1,
      enemiesLeft: this.enemies.countAlive() + this.waveQueue.length + (this.pendingBoss ? 1 : 0),
      glyphs: this.stats.glyphs,
      score: this.stats.score,
      spellIds,
      spellNames,
      spellColors,
      selected: this.selected,
      cooldowns,
      cooldownSeconds,
      castWindow: this.lastCast ? Math.max(0, 1 - (this.time - this.lastCast.t) / RESONANCE_WINDOW) : 0,
      lastCastElement: this.lastCast?.element ?? null,
      blinkCd: 1 - p.blinkCd / BLINK_CD,
      boss: boss && boss.boss ? {
        name: boss.boss.def.name,
        title: boss.boss.def.title,
        hp: Math.max(0, boss.hp),
        hpMax: boss.hpMax,
        color: boss.boss.def.color
      } : null,
      mercy: this.mercyF,
      /* v2.2 */
      spellEvolved,
      countdown: this.countdownT,
      threats: this.computeThreats(),
      /* F-06: the HUD describes the world actually generated — biome name
       *  + the FROZEN active-run seed (never the prospective next seed). */
      biomeName: TERRAIN_NAME[this.actTerrain] ?? "Rubble Field",
      seed: this.runSeed
    };
    this.opts.callbacks.onHud(snap);
  }
  /** v2.2 off-screen threat markers: up to 3 screen-space angle cues for
   *  looming danger — the tyrant first, then the nearest elites. Angles are
   *  relative to the camera's forward (screen-up), clockwise degrees, so
   *  the HUD can rotate an arrow chip directly. */
  computeThreats() {
    const p = this.player;
    const out: { angle: number; kind: "elite" | "boss" }[] = [];
    /* camera forward on the ground plane (fixed-rig follow camera: -Z is
     *  screen-up; derive from the actual camera for correctness) */
    const dir = this._threatDir;
    this.camera.getWorldDirection(dir);
    const camYaw = Math.atan2(dir.x, dir.z);
    const push = (x: number, z: number, kind: "elite" | "boss") => {
      const dx = x - p.x,
        dz = z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 14) return; // on-screen enough — markers are for the far threats
      let a = Math.atan2(dx, dz) - camYaw + Math.PI;
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      out.push({ angle: Math.round(a * 180 / Math.PI), kind });
    };
    const boss = this.enemies.boss;
    if (boss && boss.boss) push(boss.x, boss.z, "boss");
    const elites: { d: number; x: number; z: number }[] = [];
    for (const e of this.enemies.enemies) {
      if (e.dead || !e.elite) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d >= 14) elites.push({ d, x: e.x, z: e.z });
    }
    elites.sort((a, b) => a.d - b.d);
    for (const el of elites.slice(0, 3 - out.length)) push(el.x, el.z, "elite");
    return out.slice(0, 3);
  }
  /* ---------------------------- perf overlay ----------------------------- */ /* Plan §9 HUD item 6 (optional debug metrics) + §4 loading telemetry
                                                                                (load time / transfer size / instance counts) surfaced live. The engine
                                                                                owns the panel end-to-end: one element it creates, positions, writes at
                                                                                2 Hz and removes — the HudSnapshot path and React are never involved, so
                                                                                toggling it can never trigger a re-render or restart the run. */ /** Match the overlay's existence to settings.perfOverlay (live toggle). */
  syncPerfOverlay() {
    if (this.disposed) return;
    if (this.opts.settings.perfOverlay && !this.perfEl) this.buildPerfOverlay();else if (!this.opts.settings.perfOverlay && this.perfEl) this.destroyPerfOverlay();
  }
  buildPerfOverlay() {
    if (typeof document === "undefined" || this.perfEl) return;
    const el = document.createElement("div");
    el.id = "rift-perf-overlay";
    el.setAttribute("aria-hidden", "true");
    /* z-index 25: above the game root (canvas/HUD) yet below the banner (30),
    the in-run overlays (40) and every modal (50+) — and pointer-events none
    so it can never intercept a click or focus. */
    el.style.cssText = ["position:fixed", "z-index:25", "pointer-events:none", "font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", "color:rgba(214,220,255,0.82)", "background:rgba(10,8,18,0.62)", "border:1px solid rgba(154,123,255,0.28)", "border-radius:8px", "padding:7px 10px", "min-width:172px", "white-space:pre", "backdrop-filter:blur(4px)", "-webkit-backdrop-filter:blur(4px)"].join(";");
    this.perfLines = [];
    for (let i = 0; i < PERF_LINES; i++) {
      const line = document.createElement("div");
      if (i === 0) {
        line.style.color = "rgba(245,201,107,0.7)";
        line.style.letterSpacing = "0.1em";
      }
      el.appendChild(line);
      this.perfLines.push(line);
    }
    document.body.appendChild(el);
    this.perfEl = el;
    this.perfMsEma = 16.7; // fresh smoothing window per toggle
    this.perfTimer = 0; // first readout lands next frame
    this.placePerfOverlay();
  }
  destroyPerfOverlay() {
    this.perfEl?.remove();
    this.perfEl = null;
    this.perfLines = [];
  }
  /** Below the top-left HUD vitals plate; on <640px also below the wave plate
  *  (which stacks under the vitals on phones). Mirrors HUD left-3/sm:left-5. */
  placePerfOverlay() {
    const el = this.perfEl;
    if (!el) return;
    const mobile = window.innerWidth < 640;
    el.style.left = mobile ? "12px" : "20px";
    el.style.top = mobile ? "264px" : "172px";
  }
  /** The 2 Hz readout — the only place overlay strings are built. */
  updatePerfOverlay() {
    const lines = this.perfLines;
    if (!this.perfEl || lines.length < PERF_LINES) return;
    const info = this.renderer.info;
    const fps = 1000 / Math.max(1, this.perfMsEma);
    const q = this.opts.settings.quality ?? 1;
    const dyn = this.dynamicScale();
    const label = s => `${s.padEnd(7)} `;
    lines[0].textContent = "RIFT TELEMETRY · F3";
    lines[1].textContent = `${label("FPS")}${fps.toFixed(0)}`;
    /* color-coded: green ≥55, amber 30-55, red <30 */
    lines[1].style.color = fps >= 55 ? "#7ef2a8" : fps >= 30 ? "#f5c96b" : "#ff6b81";
    lines[2].textContent = `${label("frame")}${this.perfMsEma.toFixed(1)} ms`;
    lines[3].textContent = `${label("draws")}${info.render.calls}`;
    lines[4].textContent = `${label("tris")}${fmtCompact(info.render.triangles)}`;
    lines[5].textContent = `${label("geo/tex")}${info.memory.geometries} / ${info.memory.textures}`;
    lines[6].textContent = `${label("foes")}${this.enemies.countAlive()}`;
    lines[7].textContent = `${label("proj")}${this.spells.projectiles.length}`;
    lines[8].textContent = `${label("parts")}${this.vfx.liveParticles}`;
    lines[9].textContent = `${label("pick")}${this.pickups.length}`;
    lines[10].textContent = `${label("quality")}${Math.round(q * 100)}% · res ${(q * dyn).toFixed(2)}`;
    lines[11].textContent = this.assets.ready ? `${label("assets")}${(this.assets.stats.totalBytes / 1048576).toFixed(2)} MB · ${Math.round(this.assets.stats.loadMs)} ms` : `${label("assets")}loading ${Math.round((this.assets.progress ?? 0) * 100)}%`;
  }
  attachDamageLayer(root) {
    this.vfx.attachDamageLayer(root);
  }
  getRunStats() {
    return {
      ...this.stats,
      wave: this.wave,
      newCombos: [...this.newCombos]
    };
  }
}
/* ------------------------------- helpers -------------------------------- */
function makePlayer() {
  return {
    x: 0,
    z: 0,
    hp: 100,
    hpMax: 100,
    aether: 100,
    aetherMax: 100,
    aetherRegen: 11,
    speed: 7.4,
    surge: 0,
    surgeActive: 0,
    surgeRateMult: 1,
    blinkCd: 0,
    blinkCdMax: BLINK_CD,
    iframe: 0,
    aimX: 0,
    aimZ: -6,
    dmgMult: 1,
    cdMult: 1,
    resist: 0,
    volleyCount: 3,
    volleyDmg: 1,
    glyphMult: 1,
    dead: false
  };
}
function emptyStats(seed = "", runId = "") {
  return {
    wave: 0,
    score: 0,
    kills: 0,
    damage: 0,
    timeSec: 0,
    glyphs: 0,
    triumph: false,
    endless: false,
    newCombos: [],
    bossesSlain: [],
    bestResonance: null,
    seed,
    /* v2.2 death-cause log — filled at emission time */
    killedBy: null,
    lastHits: [],
    /* milestone-result fields (audit P1-1) — overwritten at emission time */runId,
    kind: "death",
    payout: 0,
    delta: null
  };
}
function ENEMY_COST(type) {
  return ENEMY_DEFS[type]?.cost ?? 2;
}
/** Compact count for the perf overlay: 1k above a thousand triangles. */function fmtCompact(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}