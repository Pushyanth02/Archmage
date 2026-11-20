import * as THREE from "three";
import { hexNum, ENEMY_DEFS, scaleEnemy, ELITE_DEFS, FOE_MOVE_SPEED_SCALE, MERCY_HP, MERCY_SPD, type EliteAffix, type EnemyDef, type EnemyType, type BossDef } from "./content";
import type { AssetSystem } from "./assets";
import { BillboardSprite, getSheet, type PixelKind } from "./pixelsprites";
import { V31Sprite, v31Sheet, V31_BOSS_BY_BRAIN, V31_ENEMY_BY_BODY, V31_ENEMY_BY_TYPE, type V31Sheet } from "./v31sheets";
import type { BossState, Enemy, SimContext, Hazard } from "./sim";

/** Any billboard the engine may drive — the v3.1 validated sheets (V31Sprite)
 *  or the procedural canvas fallbacks (BillboardSprite). Both expose the
 *  same surface: state/face/flash + update/faceCamera/tint/setOpacity. */
export type EntitySprite = BillboardSprite | V31Sprite;

/* ARCHMAGE: RIFTBOUND (3D Edition) — EnemySystem: 19 foe types (8 AI archetypes) + 5 tyrant brains.
   Owns enemy entities, their 3D bodies, status effects (burn/poison/slow),
   separation, ward blocking and boss state machines. Consumes SimContext.
   Visual layers (audit P2-8): Rig_Medium foes (knight/caster bodies + the
   Sylthara tyrant) play the shared KayKit clip bank via per-foe
   AnimationMixers (foeAnims); every foe coils + releases on its pre-fire
   tell (bodyRoots/coils under the enemy group). All other rigs keep their
   intentional procedural motion. NOTE: this module never *kills* enemies —
   it only drains HP (ctx.damageEnemy) or self-destructs (bomber, e.dead =
   true). The engine sweeps deaths. */

/* --------------------------- Geometry cache ----------------------------- */const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}
const shadowGeo = () => geo("shadow", () => new THREE.CircleGeometry(1, 20));
const glowDiscGeo = () => geo("glowdisc", () => new THREE.CircleGeometry(1, 20));
const eliteRingGeo = () => geo("elitering", () => new THREE.TorusGeometry(1, 0.06, 6, 28));
function discMesh(color: number, opacity: number, additive: boolean): THREE.Mesh {
  const m = new THREE.Mesh(glowDiscGeo(), new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
/* Optional per-enemy animated assembly (boss halos / shard rings), looked up
   by group in syncVisual — no per-frame scene traversals, no Enemy fields. */
const spinners = new WeakMap<THREE.Group, THREE.Object3D>();
/* Ground-contact fx (blob shadow + underglow) pinned to the floor even while
   the body group hovers (flying foes). */
const groundFx = new WeakMap<THREE.Group, { shadow: THREE.Mesh; glow: THREE.Mesh }>();
/* Billboarded health bars — shown only when a foe is damaged or elite (bosses
   use the HUD bar). Tilted once to the engine's fixed camera pitch so the bar
   always faces the eye without per-frame lookAt cost. */
const healthBars = new WeakMap<THREE.Group, { bar: THREE.Group; fill: THREE.Mesh }>();
const HPBAR_TILT = -1.0; // rad — matches the 25/15.5 camera rig pitch
/* ---- pre-fire telegraph channel (plan §6 "telegraph rules") ----
   Every ranged/caster brain and every boss volley/slam/spiral gets a
   0.3–0.45s tell BEFORE the shot: the body emissive pulses 2–3 beats
   (syncVisual adds this on top of hitFlash) while a small ground tick-ring
   contracts under the shooter plus a few charge motes at muzzle height —
   shape + motion, never color-only. WeakMap keyed by group: no Enemy/
   sim.ts schema changes needed. */
const fireTells = new WeakMap<THREE.Group, number>(); // seconds remaining
const RANGED_TELL = 0.38; // foe bolt windup
/* ---- attack anticipation: coil & release (audit P2-8) ----
   tellFire starts a coil on the body root; when the tell expires the coil
   releases with a quick overshoot. The body root is a dedicated transform
   layer under the enemy group (the acquired model AND the procedural kit
   parts live inside it; ground discs / elite ring / health bar / orbiting
   boss halos stay outside), so the coil composes with — instead of fighting
   — squash + spawn-in on the enemy group and bone clips on the model inside.
   Amplitudes are intentionally subtle (8% scale, ~8° lean, 0.12s release):
   polish, not a mechanic, and safe without a per-foe reduced-motion hook. */
const bodyRoots = new WeakMap<THREE.Group, THREE.Group>();
/** Anticipation coil state: phase 1 = coiling over the tell, 2 = release. */
interface CoilState {
  phase: 1 | 2;
  t: number;
  dur: number;
}
const coils = new WeakMap<THREE.Group, CoilState>();
const COIL_SCALE = 0.08; // coil to 0.92 over the tell window
const COIL_LEAN = 0.14; // rad, forward lean at full coil
const COIL_RELEASE = 0.12; // release window
const COIL_OVERSHOOT = 0.06; // release scale peak ≈ 1.04
const COIL_RECOIL = 0.06; // rad, backward lean at the release peak
/* ---- boss encounter structure (plan §6) ----
   spawnGrace: tyrant AI + damage are frozen while the intro scale-in plays
   (also reused as the 0.6s stagger on the phase-2 enrage transition).
   enrageT: crimson emissive surge window right after the phase flip. */
const bossGraces = new WeakMap<BossState, number>(); // seconds remaining
const enrageT = new WeakMap<BossState, number>(); // seconds remaining
const CRIMSON = new THREE.Color(0xff2447);
const _tellPos = new THREE.Vector3();
/** Register a pre-fire tell on a shooter (ground tick-ring + charge motes;
    the emissive pulse is driven by syncVisual while the channel counts down). */
function tellFire(e: Enemy, ctx: SimContext, dur: number): void {
  fireTells.set(e.group, dur);
  coils.set(e.group, {
    phase: 1,
    t: 0,
    dur: Math.max(0.05, dur)
  }); // anticipation coil
  /* 9-e attack policy, told route: the swing starts from its wind-up and the
   STRIKE lands on the tell's release (the committed shot) — clip layers on
   top of the coil, sim stays authoritative */
  attackPulses.set(e.group, Math.max(0.05, dur) + 0.18);
  const color = e.boss ? hexNum(e.boss.def.color) : hexNum(e.def.color);
  ctx.vfx.ring(_tellPos.set(e.x, 0, e.z), color, Math.max(1.7, e.radius * 2.6), {
    life: dur,
    contract: true,
    thickness: 0.5,
    y: 0.07
  });
  ctx.vfx.burst(_tellPos.set(e.x, e.boss ? 2.0 : 1.2, e.z), color, 3, {
    speed: 0.7,
    up: 0.9,
    life: dur,
    gravity: -1.2,
    size: 0.8
  });
}
const hpBarBgGeo = () => geo("hpbar-bg", () => new THREE.PlaneGeometry(1.16, 0.15).translate(0.58, 0, 0));
const hpBarFillGeo = () => geo("hpbar-fill", () => new THREE.PlaneGeometry(1.08, 0.08).translate(0.54, 0, 0));
/** Per-model clip plan (audits P2-8 / 9-e / 10-d): which clip bank to read,
 *  clip names per state, the combo rotation and gait tuning. */
/* v3.0 — the KayKit clip bank is retired with the GLTF bestiary. Foe
   animation is the pixel-sprite state machine in syncVisual; FOE_HIT_TRIGGER
   keeps its original role: the fresh-damage threshold that flips a foe into
   its hurt pose. */
const FOE_HIT_TRIGGER = 0.85; // hitFlash above this = fresh damage (brain telegraph pulses stay ≤ 0.85)
const FOE_HIT_DUR_KAYKIT = 0.5; // Hit_A window (8-d value, kept exactly)
const FOE_HIT_DUR_MODEL = 0.42; // Hit_Chest window (0.33s clip + small tail)
/* attack one-shot envelope + triggers (9-e policy — see foeAttackWindup) */
const FOE_ATTACK_TAIL = 0.32; // follow-through shown after the strike lands
const FOE_ATTACK_IN = 0.07; // weight-in (a strike snaps in)
const FOE_ATTACK_OUT = 0.18; // weight-out
const FOE_MELEE_RANGE = 1.45; // swing anticipation starts inside this range
const FOE_MELEE_LEAD = 0.15; // strike lands this far ahead of the wind-up
/* v3.0 — the shared maps/types the pixel-sprite system still needs
   (formerly interleaved with the retired clip machinery). */
const foeKinds = new WeakMap<THREE.Group, PixelKind>();
/** V3.1 asset id per foe group ("enemy_wraith"…) — null for procedural kinds. */
const v31Ids = new WeakMap<THREE.Group, string | null>();

/** V3.1 world-space BODY heights (the plane is sized via each manifest's
 *  body fraction, so these match the old chibi scale language). */
const V31_HEIGHTS: Record<string, number> = {
  enemy_skeleton_warrior: 2.3,
  enemy_cultist_acolyte: 2.3,
  enemy_shieldbone_knight: 2.5,
  enemy_necromancer: 2.4,
  enemy_wraith: 2.2,
  enemy_bone_archer: 2.3,
  enemy_plaguebearer: 2.2,
  enemy_flesh_construct: 2.75,
  boss_bone_regent: 5.4,
  boss_rift_leviathan: 5.0,
  boss_blight_colossus: 5.8,
};

/** Pick the V3.1 asset id for a foe: type overrides first (flavored picks),
 *  then the generic body map. "swarmlet" bodies have no V3.1 equivalent —
 *  the procedural bat reads better at that size — so they map to null. */
function v31AssetFor(def: EnemyDef, isBoss: boolean, bossBrain?: BossDef["brain"]): string | null {
  if (isBoss) return V31_BOSS_BY_BRAIN[bossBrain ?? "charger"] ?? null;
  return V31_ENEMY_BY_TYPE[def.type] ?? V31_ENEMY_BY_BODY[def.body] ?? null;
}
interface DyingBody {
  e: Enemy;
  anim: null;
  style: "ghost" | "slime" | "plant" | "fall";
  t: number;
  dur: number;
  fadeAt: number;
  bodyRoot: THREE.Group | null;
  fallDir: number;
  baseOpacity: number;
  baseY: number;
}
interface GhostDrift {
  lx: number;
  lz: number;
  pitch: number;
  roll: number;
}
interface SlimeHop {
  lx: number;
  lz: number;
  phase: number;
  amp: number;
}
/* ghost drift + slime hop tuning (9-e values, kept exactly) */
const FOE_HIT_IN = 0.07;
const FOE_HIT_OUT = 0.18;
const FOE_RUN_GATE = 0.22;
const FOE_MOVE_SMOOTH = 7;

const MAX_DYING = 12;
const DYING_FADE_SPAN = 0.3; // last 30% of the window = sink + fade
/* scratch (module scope — the linger update runs per frame, never allocates) */
const _deadColor = new THREE.Color();
/** Compute the linger window for a slain enemy (bosses read heavier — their
 *  death slow-mo runs 1.1s and wants a body under it). Clip deaths get the
 *  full 0.8s brief so Death_A's collapse completes; procedural styles run
 *  0.6–0.7s. */
function dyingDuration(e: Enemy, style: string): number {
  const base = style === "plant" ? 0.7 : style === "ghost" ? 0.6 : 0.65;
  return e.boss ? base + 0.25 : base;
}
/** Begin the death linger for a slain foe. Call INSTEAD of removeEnemy —
 *  this splices the Enemy out of the sim array (same-frame gameplay death)
 *  and takes ownership of the group until the sequence finishes. */
function beginDyingBody(sys: EnemySystem, e: Enemy): void {
  /* cap: oldest finishes instantly when the pool would overflow */while (sys.dyingCount() >= MAX_DYING) sys.finishOldestDying();
  const mk = foeKinds.get(e.group) ?? null;
  const vid = v31Ids.get(e.group) ?? null;
  /* death style by kind: wraiths (both sprite families) disperse, oozes
   deflate, plants wilt, everything else topples — the sprite's death
   frames play underneath */
  let style: DyingBody["style"] = "fall";
  if (mk === "wraith" || vid === "enemy_wraith" || vid === "boss_rift_leviathan") style = "ghost";else if (mk === "ooze" || mk === "swarm") style = "slime";else if (mk === "plant") style = "plant";
  /* clear the interaction layers so no tell/coil/bar survives on the corpse */
  fireTells.delete(e.group);
  coils.delete(e.group);
  attackPulses.delete(e.group);
  const hb = healthBars.get(e.group);
  if (hb) hb.bar.visible = false;
  /* the sprite enters its death frame sequence and fades via setOpacity */
  if (e.sprite) {
    e.sprite.state = "death";
    e.sprite.flash = 0;
  }
  const bodyRoot = bodyRoots.get(e.group) ?? null;
  sys.pushDying({
    e,
    anim: null,
    style,
    t: 0,
    dur: dyingDuration(e, style),
    fadeAt: 0.6,
    bodyRoot,
    fallDir: e.id % 2 === 0 ? 1 : -1,
    baseOpacity: 1,
    baseY: e.group.position.y
  });
}
/** Advance one dying body's sequence (called from EnemySystem.updateDying). */
function updateDyingBody(b: DyingBody, dt: number): boolean {
  b.t += dt;
  const u = b.t / b.dur;
  if (u >= 1) return false; // finished
  const e = b.e;
  /* the sprite's death frames keep advancing under the sequence */
  if (e.sprite) e.sprite.update(dt);
  /* shared fade/sink window (final DYING_FADE_SPAN of the sequence) */
  const f = Math.max(0, Math.min(1, (u - b.fadeAt) / DYING_FADE_SPAN));
  const fade = 1 - f;
  switch (b.style) {
    case "ghost":
      {
        /* disperse: rise, slow spin, thin out over the whole window */e.group.position.y = b.baseY + b.t * 0.9;
        if (b.bodyRoot) b.bodyRoot.rotation.y += dt * 1.4;
        const disperse = 1 - Math.pow(u, 1.5);
        if (e.sprite) e.sprite.setOpacity(b.baseOpacity * disperse);
        if (b.bodyRoot) b.bodyRoot.scale.setScalar(1 + u * 0.35);
        break;
      }
    case "slime":
      {
        /* deflate: squash flat + spread, then fade */if (b.bodyRoot) {
          const sy = Math.max(0.1, 1 - u * 1.05);
          b.bodyRoot.scale.set(1 + u * 0.5, sy, 1 + u * 0.5);
        }
        e.group.position.y = b.baseY - 0.2 * f;
        if (e.sprite) e.sprite.setOpacity(b.baseOpacity * fade);
        break;
      }
    case "plant":
      {
        /* wilt: droop forward + shrink, then fade */if (b.bodyRoot) {
          b.bodyRoot.rotation.x = Math.min(1.15, u * 1.6);
          b.bodyRoot.scale.setScalar(1 - u * 0.22);
        }
        e.group.position.y = b.baseY - 0.15 * f;
        if (e.sprite) e.sprite.setOpacity(b.baseOpacity * fade);
        break;
      }
    case "fall":
      {
        /* topple: pitch over the body root (ease-in gravity), then sink+fade */if (b.bodyRoot) {
          const topple = Math.min(1, u * 1.45);
          b.bodyRoot.rotation.x = b.fallDir * (Math.PI / 2 - 0.12) * (topple * topple);
        }
        e.group.position.y = b.baseY - 0.4 * f * f;
        if (e.sprite) e.sprite.setOpacity(b.baseOpacity * fade);
        break;
      }
  }
  /* fade the ground fx with the body (shadow + underglow discs) */
  const fx = groundFx.get(e.group);
  if (fx) {
    (fx.shadow.material as THREE.Material).opacity = 0.34 * fade;
    (fx.glow.material as THREE.Material).opacity = 0.5 * fade;
  }
  /* dying bosses keep their regalia orbiting while it dissolves */
  const spin = spinners.get(e.group);
  if (spin) spin.rotation.y += dt * 2.2 * fade;
  return true; // still dying
}
/** Player body radius — mirrors engine.updatePlayer's obstacle margin. */
const PLAYER_RADIUS = 0.55;
/** Contact-damage reach (slightly generous so grazing reads as a hit). */
const PLAYER_TOUCH = 0.55;
/** Bounded final-constraint iterations (audit §5.1 step 8) — every pass runs
 *  the full constraint set (bounds + obstacles + pairs + player). */
const FINAL_PASSES = 4;
/** Residual-overlap tolerance for the final invariant (world units).
 *  Bounds/obstacles/player violations beyond this are counted as defects. */
const INVAR_TOL = 0.05;
/** Foe-pair residual tolerance: an extreme pressing pile (more foes than fit
 *  around the player) is over-constrained — pairs equilibrate at ≤ ~1 frame
 *  of intent motion while the higher-priority invariants stay exact. */
const PAIR_RESIDUAL_TOL = 0.2;
/* ---- F-02 stall recovery (audit §5.2) ---- */
const STALL_WINDOW = 0.3; // progress-sample window (s)
const STALL_CMD_MIN = 0.45; // min commanded distance before a window can count
const STALL_NET_FRAC = 0.35; // net displacement must reach this fraction of commanded
const STALL_TIME = 0.75; // consecutive stalled seconds before recovery engages
const RECOVER_TIME = 0.9; // tangent steering duration (s)
/** Per-frame motion diagnostics — reset every update(); read by the headless
 *  validate-enemy-motion harness and (future) the dev overlay. */
export interface MotionDiagnostics {
  frames: number;
  unresolvedPairOverlaps: number;
  playerOverlaps: number;
  outOfBounds: number;
  obstacleOverlaps: number;
  stalledAgents: number;
  recoveries: number;
}
export const motionDiagnostics: MotionDiagnostics = {
  frames: 0,
  unresolvedPairOverlaps: 0,
  playerOverlaps: 0,
  outOfBounds: 0,
  obstacleOverlaps: 0,
  stalledAgents: 0,
  recoveries: 0
};
/* v3.0 sprite state maps: attack windup timers + last-frame positions. */
const attackPulses = new WeakMap<THREE.Group, number>();
const lastPos = new WeakMap<THREE.Group, { x: number; z: number }>();
const ghostDrifts = new WeakMap<THREE.Group, GhostDrift>();
const GHOST_BANK = 0.05; // rad per unit of local speed
const GHOST_BANK_MAX = 0.3; // rad clamp
const GHOST_SMOOTH = 3.5; // banking approach rate (slower than combat = wispy)
function updateGhostDrift(e: Enemy, dt: number): { pitch: number; roll: number; bobY: number } {
  let d = ghostDrifts.get(e.group);
  if (!d) {
    d = { lx: Number.NaN, lz: Number.NaN, pitch: 0, roll: 0 };
    ghostDrifts.set(e.group, d);
  }
  let fwd = 0,
    side = 0;
  if (Number.isFinite(d.lx) && dt > 0) {
    const vx = (e.x - d.lx) / dt,
      vz = (e.z - d.lz) / dt;
    /* the billboard group no longer yaws — banking is straight world-frame:
    pitch from north-south motion, roll from east-west */
    fwd = vz;
    side = vx;
  }
  d.lx = e.x;
  d.lz = e.z;
  const k = Math.min(1, dt * GHOST_SMOOTH);
  const cl = (v: number) => Math.max(-GHOST_BANK_MAX, Math.min(GHOST_BANK_MAX, v));
  d.pitch += (cl(fwd * GHOST_BANK) - d.pitch) * k;
  d.roll += (cl(-side * GHOST_BANK) - d.roll) * k;
  /* ground wraiths float; flyers bob at the group level already */
  const bobY = e.flying ? 0 : 0.14 + Math.sin(e.bobPhase * 0.8) * 0.1;
  /* zero-allocation out param: callers consume the fields immediately
     (same tick, before any other foe's update) — the shared scratch is safe */
  _ghostOut.pitch = d.pitch;
  _ghostOut.roll = d.roll;
  _ghostOut.bobY = bobY;
  return _ghostOut;
}
const _ghostOut = { pitch: 0, roll: 0, bobY: 0 };
const slimeHops = new WeakMap<THREE.Group, SlimeHop>();
const SLIME_HOP_RATE = 1.05; // hop-phase rad per unit of speed per second
const SLIME_HOP_BASE = 2.2; // base cadence (rad/s) once moving
const SLIME_HOP_HEIGHT = 0.3;
const SLIME_STRETCH = 0.16; // mid-hop vertical stretch
const SLIME_SQUASH = 0.2; // ground-contact flatten
function updateSlimeHop(e: Enemy, dt: number): { lift: number; sy: number; sxz: number } {
  let s = slimeHops.get(e.group);
  if (!s) {
    s = {
      lx: Number.NaN,
      lz: Number.NaN,
      phase: 0,
      amp: 0
    };
    slimeHops.set(e.group, s);
  }
  let spd = 0;
  if (Number.isFinite(s.lx) && dt > 0) spd = Math.hypot(e.x - s.lx, e.z - s.lz) / dt;
  s.lx = e.x;
  s.lz = e.z;
  /* hop amplitude eases with movement — a still slime settles to the floor */
  const base = e.spd > 0 ? e.spd : e.def.speed;
  const want = spd > 0.25 ? Math.min(1, 0.35 + spd / base * 0.65) : 0;
  s.amp += (want - s.amp) * Math.min(1, dt * 6);
  if (spd > 0.25) s.phase += dt * (SLIME_HOP_BASE + spd * SLIME_HOP_RATE);
  const hopT = s.phase % Math.PI; // one hop per π of phase
  const h = Math.sin(hopT); // 0 at contact → 1 mid-hop
  const contact = Math.cos(hopT) ** 2; // 1 at the contact instants
  const a = s.amp;
  const lift = h * SLIME_HOP_HEIGHT * a;
  const sy = 1 + SLIME_STRETCH * h * a - SLIME_SQUASH * contact * a * (1 - h);
  const sxz = 1 / Math.sqrt(Math.max(0.05, sy)); // volume-preserving
  /* zero-allocation out param — consumed immediately by the caller */
  _slimeOut.lift = lift;
  _slimeOut.sy = sy;
  _slimeOut.sxz = sxz;
  return _slimeOut;
}
const _slimeOut = { lift: 0, sy: 1, sxz: 1 };
/* v3.0 — MODEL_FIT / MODEL_HPBAR_Y retired with the GLTF bestiary (sprite
   geometry carries its own height; the hp bar rides spriteHeight+0.35). */
/* Emissive floor for textured models — their authored albedo carries identity,
   so they need less full-body glow than the flat-shaded procedural kits. */
const MODEL_EMISSIVE = 0.7;
/** Visual body kit per boss brain — distinct silhouettes, gameplay untouched. */
const BOSS_BODY: Record<BossDef["brain"], EnemyDef["body"]> = {
  charger: "brute",
  juggernaut: "brute",
  dancer: "knight",
  fortress: "orb",
  storm: "wraith"
};
export interface EnemyBody {
  group: THREE.Group;
  /** the pixel billboard — a V3.1 validated sheet when loaded, else the
   *  procedural canvas painter (seamless swap-in, identical surface). */
  sprite: EntitySprite;
}

/* ------------------- v3.0 pixel-billboard bodies ----------------------- */
/** body kind per EnemyDef.body (concept sheet p2). */
const BODY_KIND: Record<string, PixelKind> = {
  imp: "imp",
  brute: "brute",
  wraith: "wraith",
  orb: "ooze",
  knight: "knight",
  caster: "caster",
  swarmlet: "swarm",
  plant: "plant"
};
/** boss sprite per tyrant brain (concept sheet p3 — one silhouette each). */
const BOSS_SPRITE: Record<BossDef["brain"], PixelKind> = {
  charger: "regent",
  juggernaut: "behemoth",
  dancer: "seraph",
  fortress: "colossus",
  storm: "leviathan"
};
/** per-kind world heights (chibi proportions, gameplay-readable). */
function spriteHeight(kind: PixelKind, def: EnemyDef, isBoss: boolean): number {
  if (isBoss) return 5.5;
  switch (kind) {
    case "swarm": return 1.3;
    case "bat": return 1.55;
    case "ooze": return 1.95;
    case "imp": return 2.35;
    case "plant": return 2.5;
    case "wraith": return 2.65;
    default: return 2.15 + def.radius * 0.5;
  }
}

export function buildEnemyBody(def: EnemyDef, colorHex: number, elite: EliteAffix | null, isBoss: boolean, assets?: AssetSystem | null, bossBrain?: BossDef["brain"]): EnemyBody {
  const group = new THREE.Group();
  /* body root — the transform layer the anticipation coil drives (audit
   P2-8). The sprite lives inside it; floor-pinned discs, elite ring and
   health bar stay on the group so they never coil/lean with the body. */
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);
  bodyRoots.set(group, bodyRoot);
  /* the pixel kind: V3.1 validated sheet when it has settled (bosses by
   *  brain, foes by type/body flavor), else the procedural painter
   *  (flying swarmlets always read as bats). Elites recolor — V3.1 via a
   *  material tint, procedural via the tinted sheet variant. */
  const v31Id = v31AssetFor(def, isBoss, bossBrain);
  const v31: V31Sheet | null = v31Id ? v31Sheet(v31Id) : null;
  let sprite: EntitySprite;
  let kind: PixelKind;
  /* sprite height in world units — set by both branches below; the HP bar
   * and any later flourishes hang off this single number (fix: it used to
   * live only in the procedural branch, so V3.1-sheet spawns crashed with
   * `height is not defined`). */
  let height: number;
  if (v31 && v31Id) {
    const bodyH = (V31_HEIGHTS[v31Id] ?? (isBoss ? 5.4 : 2.3)) * (elite ? 1.12 : 1);
    height = bodyH;
    const spr = new V31Sprite(v31, { bodyHeight: bodyH });
    if (elite) {
      /* elite wash: the affix hue lerped well toward white so the pixel
       * art stays readable under the recolor */
      const c = new THREE.Color(ELITE_DEFS[elite].color).lerp(new THREE.Color(0xffffff), 0.45);
      spr.tint(c);
    }
    sprite = spr;
    kind = "imp"; /* unused for V31 foes — flourishes key off v31Ids */
    v31Ids.set(group, v31Id);
  } else {
    kind = isBoss ? BOSS_SPRITE[bossBrain ?? "charger"] : def.flying && BODY_KIND[def.body] === "swarm" ? "bat" : BODY_KIND[def.body] ?? "imp";
    const sheet = getSheet(kind, elite ? ELITE_DEFS[elite].color : null);
    height = spriteHeight(kind, def, isBoss) * (elite ? 1.12 : 1);
    sprite = new BillboardSprite(sheet, height);
    v31Ids.set(group, null);
  }
  /* a gentle backward lean toward the fixed follow camera — grounds the
   billboard without a full spherical face (the rig never orbits). */
  sprite.mesh.rotation.x = -0.1;
  bodyRoot.add(sprite.mesh);
  foeKinds.set(group, kind);
  /* underglow + shadow + elite ring — the underglow is a wide soft aura that
   reads as a threat marker on the floor even when the body is small/far */
  const glow = discMesh(colorHex, isBoss ? 0.6 : 0.5, true);
  glow.position.y = 0.04;
  glow.scale.setScalar(def.radius * 1.9);
  group.add(glow);
  const shadow = discMesh(0x000000, 0.34, false);
  shadow.position.y = 0.02;
  shadow.scale.setScalar(def.radius * 1.25);
  group.add(shadow);
  groundFx.set(group, {
    shadow,
    glow
  });
  if (elite) {
    const ring = new THREE.Mesh(eliteRingGeo(), new THREE.MeshBasicMaterial({
      color: 0xf5c96b,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    ring.scale.setScalar(def.radius * 1.35);
    group.add(ring);
  }
  /* health bar — a damaged or elite foe shows a crisp gold vitals bar above
   its head; the geometry is shared, materials are per-enemy (disposed with
   the body — see disposeEnemy). */
  if (!isBoss) {
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(hpBarBgGeo(), new THREE.MeshBasicMaterial({
      color: 0x0d0919,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      fog: false
    }));
    bg.position.x = -0.58;
    const fill = new THREE.Mesh(hpBarFillGeo(), new THREE.MeshBasicMaterial({
      color: 0xf5c96b,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false
    }));
    fill.position.set(-0.54, 0, 0.002);
    bar.add(bg, fill);
    bar.position.y = height + 0.35;
    bar.rotation.x = HPBAR_TILT;
    bar.visible = false;
    group.add(bar);
    healthBars.set(group, {
      bar,
      fill
    });
  }
  return {
    group,
    sprite
  };
}
function enemyBaseScale(e: Enemy): number {
  /* v3.0: sprite geometry already encodes the kind's height — the group
   scale only carries the elite bump (and the spawn-in growth curve). */
  return e.boss ? 1 : e.elite ? 1.1 : 1;
}
function easeOutBack(t: number): number {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
/* ------------------------------ EnemySystem ----------------------------- */
let nextId = 1;
export class EnemySystem {
  private scene: THREE.Scene;
  private assets: AssetSystem | null;
  enemies: Enemy[];
  private pending: Array<{ type: EnemyType; x: number; z: number; elite: EliteAffix | null; boss?: BossDef }>;
  boss: Enemy | null;
  onFirstSeen: (type: EnemyType) => void;
  /* 10-d death linger — slain bodies finishing their sequence. Capped at
   MAX_DYING; oldest finishes instantly on overflow. Never in `enemies`, so
   no sim path can touch them (no damage, no collision, no targeting). */
  dying: DyingBody[];
  /* rune-rubble collision circles (plan §7), supplied by the engine after
   buildArena — ground foes slide around them, flyers pass over, bolts are
   never blocked (low rubble). Cleared with the system (clear()). */
  private obstacles: Array<{ x: number; z: number; r: number }>;
  constructor(scene: THREE.Scene, assets: AssetSystem | null = null) {
    this.scene = scene;
    this.assets = assets;
    this.enemies = [];
    this.pending = [];
    this.boss = null;
    this.onFirstSeen = () => {};
    this.dying = [];
    this.obstacles = [];
  }
  setObstacles(obs: Array<{ x: number; z: number; r: number }>): void {
    this.obstacles = obs;
  }
  clear(): void {
    for (const e of this.enemies) this.disposeEnemy(e);
    this.enemies.length = 0;
    this.pending.length = 0;
    this.boss = null;
    this.obstacles = [];
    /* 10-d: lingering corpses never survive a run/act transition */
    for (const b of this.dying) this.disposeEnemy(b.e);
    this.dying.length = 0;
  }
  private disposeEnemy(e: Enemy): void {
    this.scene.remove(e.group);
    attackPulses.delete(e.group);
    lastPos.delete(e.group);
    e.sprite?.dispose();
    e.group.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const m = o.material;
        if (m instanceof THREE.Material) m.dispose();
      }
    });
  }
  /* ---------------------- death linger (10-d) --------------------------- */ /** Slain-foe entry point (engine.killEnemy): splice the Enemy out of the
                                                                               *  sim array — gameplay treats it as gone THIS frame (AI, collision,
                                                                               *  contact damage and targeting all iterate this.enemies) — and hand the
                                                                               *  3D body to the linger pool for its death sequence. */
  beginDeath(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (this.boss === e) this.boss = null;
    beginDyingBody(this, e);
  }
  /** Advance every dying body once per frame (frame dt — frozen in pause
  *  together with the vfx clock, disposal-safe). */
  updateDying(dt: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (!updateDyingBody(this.dying[i], dt)) {
        this.disposeEnemy(this.dying[i].e);
        this.dying.splice(i, 1);
      }
    }
  }
  /** Live lingering corpses (exposed for the headless death-sequence smoke). */
  dyingCount(): number {
    return this.dying.length;
  }
  /** Cap overflow: the oldest corpse finishes instantly. */
  finishOldestDying(): void {
    const b = this.dying.shift();
    if (b) this.disposeEnemy(b.e);
  }
  /** Module-internal: beginDyingBody pushes a corpse into the pool. */
  pushDying(b: DyingBody): void {
    this.dying.push(b);
  }
  queueSpawn(type: EnemyType, x: number, z: number, elite: EliteAffix | null = null): void {
    this.pending.push({
      type,
      x,
      z,
      elite
    });
  }
  queueBoss(def: BossDef, x: number, z: number): void {
    this.pending.push({
      type: "boss",
      x,
      z,
      elite: null,
      boss: def
    });
  }
  /** Process queued spawns at a safe point in the frame. */
  flushSpawns(wave: number, ctx: SimContext): void {
    void wave;
    while (this.pending.length > 0) {
      const p = this.pending.pop()!;
      if (p.boss) this.spawnBoss(p.boss, p.x, p.z, ctx);else this.spawn(p.type, p.x, p.z, p.elite, ctx);
    }
  }
  spawn(type: EnemyType, x: number, z: number, elite: EliteAffix | null, ctx: SimContext): Enemy {
    const def = ENEMY_DEFS[type];
    const raw = scaleEnemy(def, ctx.wave);
    const eliteDef = elite ? ELITE_DEFS[elite] : null;
    let colorHex = hexNum(def.color);
    if (eliteDef) colorHex = hexNum(eliteDef.color);
    const hp = raw.hp * (eliteDef ? eliteDef.hpMult : 1) * (1 - ctx.mercyF * MERCY_HP);
    const body = buildEnemyBody(def, colorHex, elite, false, this.assets);
    body.group.scale.setScalar(def.radius / 0.6 * (elite ? 1.12 : 1) * 0.05);
    body.group.position.set(x, 0, z);
    this.scene.add(body.group); // ← without this the foe exists in the sim but is INVISIBLE
    /* rift-in telegraph — a colored containment ring + rising motes so the
    spawn reads as an arrival, not a pop-in (game-to-life pass) */
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), colorHex, def.radius * 3.4, {
      life: 0.5
    });
    ctx.vfx.burst(new THREE.Vector3(x, 0.4, z), colorHex, 6, {
      speed: 2.5,
      up: 4,
      life: 0.5,
      gravity: -3
    });
    const foeId = nextId++;
    const e: Enemy = {
      id: foeId,
      type,
      def,
      hp,
      hpMax: hp,
      dmg: raw.damage,
      spd: raw.speed * (eliteDef ? eliteDef.spdMult : 1) * (1 - ctx.mercyF * MERCY_SPD),
      score: raw.score,
      x,
      z,
      y: def.flying ? 1.4 : 0,
      vx: 0,
      vz: 0,
      radius: def.radius * (elite ? 1.1 : 1),
      elite,
      flying: !!def.flying,
      slowT: 0,
      slowF: 1,
      burnT: 0,
      burnDps: 0,
      burnTick: 0,
      burnColor: 0xff7847,
      poisonT: 0,
      poisonDps: 0,
      poisonTick: 0,
      shootCd: def.shootsEvery ? ctx.rng.range(0.5, def.shootsEvery) : 0,
      touchCd: 0,
      state: 0,
      stateT: 0,
      chargeDx: 0,
      chargeDz: 1,
      bobPhase: ctx.rng.range(0, Math.PI * 2),
      hitFlash: 0,
      squash: 0,
      spawnT: 0,
      dead: false,
      winT: 0,
      stallRefX: x,
      stallRefZ: z,
      winCmd: 0,
      stallT: 0,
      stallSide: foeId % 2 === 0 ? 1 : -1,
      recoverT: 0,
      group: body.group,
      sprite: body.sprite,
      baseColor: new THREE.Color(colorHex),
      boss: null
    };
    this.enemies.push(e);
    this.onFirstSeen(type);
    return e;
  }
  spawnBoss(def: BossDef, x: number, z: number, ctx: SimContext): Enemy {
    const fakeDef = {
      ...ENEMY_DEFS.boss,
      name: def.name,
      color: def.color,
      glow: def.glow,
      radius: def.radius,
      speed: def.speed,
      damage: def.damage,
      body: BOSS_BODY[def.brain] ?? "brute"
    };
    const body = buildEnemyBody(fakeDef, hexNum(def.color), null, true, this.assets, def.brain);
    body.group.scale.setScalar(def.radius / 0.6 * 0.05);
    body.group.position.set(x, 0, z);
    this.scene.add(body.group); // ← without this the tyrant exists in the sim but is INVISIBLE
    /* tyrant rift-in — heavy double ring + pillar of motes (game-to-life) */
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), hexNum(def.color), def.radius * 3.6, {
      life: 0.9
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), hexNum(def.glow), def.radius * 2.4, {
      life: 0.7
    });
    ctx.vfx.burst(new THREE.Vector3(x, 1, z), hexNum(def.color), 26, {
      speed: 6,
      up: 8,
      life: 0.9,
      gravity: -4
    });
    const bossHpMult = 1 + (ctx.attunementMult - 1) * 0.58;
    const bossDmgMult = 1 + (ctx.attunementMult - 1) * 0.024;
    const hp = def.hp * bossHpMult;
    const bossId = nextId++;
    const e: Enemy = {
      id: bossId,
      type: "boss",
      def: fakeDef,
      hp,
      hpMax: hp,
      dmg: def.damage * bossDmgMult,
      /* F-03: tyrant locomotion rides the same global scale as every foe
         (walk phases AND the dash literals in updateBoss). */
      spd: def.speed * FOE_MOVE_SPEED_SCALE,
      score: 500 * ctx.wave,
      x,
      z,
      y: 0,
      vx: 0,
      vz: 0,
      radius: def.radius,
      elite: null,
      flying: false,
      slowT: 0,
      slowF: 1,
      burnT: 0,
      burnDps: 0,
      burnTick: 0,
      burnColor: 0,
      poisonT: 0,
      poisonDps: 0,
      poisonTick: 0,
      shootCd: 0,
      touchCd: 0,
      state: 0,
      stateT: 0,
      chargeDx: 0,
      chargeDz: 1,
      bobPhase: 0,
      hitFlash: 0,
      squash: 0,
      spawnT: 0,
      dead: false,
      winT: 0,
      stallRefX: x,
      stallRefZ: z,
      winCmd: 0,
      stallT: 0,
      stallSide: bossId % 2 === 0 ? 1 : -1,
      recoverT: 0,
      group: body.group,
      sprite: body.sprite,
      baseColor: new THREE.Color(def.color),
      boss: {
        def,
        brain: def.brain,
        state: 0,
        stateT: 0,
        cycle: 0,
        phase: 1,
        tx: 0,
        tz: 0,
        angle: 0,
        volleyT: 0,
        minionT: 5,
        ringR: 0,
        ringHits: [],
        lockedDx: 0,
        lockedDz: 0,
        flag: false
      }
    };
    /* intro grace (plan §6): the tyrant coalesces at 0→full scale over ~0.7s
    (ease-out-back, see syncVisual) with AI + damage frozen for 0.9s — the
    banner/rings/sfx play, the player gets a free read, then it wakes */
    bossGraces.set(e.boss!, 0.9);
    this.enemies.push(e);
    this.boss = e;
    return e;
  }
  removeEnemy(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (this.boss === e) this.boss = null;
    this.disposeEnemy(e);
  }
  nearest(x: number, z: number, maxDist = Infinity, excludeFlying = false): Enemy | null {
    let best: Enemy | null = null;
    let bestD2 = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (excludeFlying && e.flying) continue;
      const dx = e.x - x,
        dz = e.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }
  countAlive(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }
  /* ------------------------------- update -------------------------------- */
  update(dt: number, ctx: SimContext): void {
    const {
      player
    } = ctx;
    /* per-frame diagnostics reset (frames + recoveries are cumulative) */
    motionDiagnostics.frames++;
    motionDiagnostics.unresolvedPairOverlaps = 0;
    motionDiagnostics.playerOverlaps = 0;
    motionDiagnostics.outOfBounds = 0;
    motionDiagnostics.obstacleOverlaps = 0;
    motionDiagnostics.stalledAgents = 0;
    /* ---- Stage A: integrate (status effects, knockback, brains) ---- */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;
      /* spawn-in anim — tyrants take the full ~0.7s ease-out-back intro,
      regular foes pop in at the old ~0.42s */
      if (e.spawnT < 1) e.spawnT = Math.min(1, e.spawnT + dt * (e.boss ? 1.45 : 2.4));
      /* status effects */
      if (e.slowT > 0) {
        e.slowT -= dt;
        if (e.slowT <= 0) e.slowF = 1;
      }
      if (e.burnT > 0) {
        e.burnT -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = 0.5;
          ctx.damageEnemy(e, e.burnDps * 0.5, {
            color: e.burnColor,
            noNumbers: true
          });
        }
        if (e.dead) continue;
      }
      if (e.poisonT > 0) {
        e.poisonT -= dt;
        e.poisonTick -= dt;
        if (e.poisonTick <= 0) {
          e.poisonTick = 0.5;
          ctx.damageEnemy(e, e.poisonDps * 0.5, {
            color: 0x7ed957,
            noNumbers: true
          });
        }
        if (e.dead) continue;
      }
      /* knockback velocity decay */
      if (e.vx !== 0 || e.vz !== 0) {
        e.x += e.vx * dt;
        e.z += e.vz * dt;
        const damp = Math.pow(0.0001, dt);
        e.vx *= damp;
        e.vz *= damp;
        if (Math.abs(e.vx) < 0.01) e.vx = 0;
        if (Math.abs(e.vz) < 0.01) e.vz = 0;
      }
      e.touchCd -= dt;
      e.stateT += dt;
      /* brain — AI movement intent (pre-brain position feeds the F-02
      stall bookkeeping) */
      const preX = e.x,
        preZ = e.z;
      if (e.boss) this.updateBoss(e, dt, ctx);else this.updateFoe(e, dt, ctx);
      if (e.dead) continue;
      /* F-02 stall recovery: while recovering, bend the brain's intended
      displacement ±90° around the sticky side preference so a blocked
      ground foe routes AROUND rubble instead of grinding into it */
      if (e.recoverT > 0 && !e.flying && !e.boss) this.applyRecoverySteering(e, preX, preZ, dt);
      this.trackStall(e, preX, preZ, dt, ctx);
    }
    /* ---- Stage B: foe↔foe separation (bosses plow through) ---- */
    this.separateFoes();
    /* ---- Stage C: contact-damage EVENT + foe↔player separation ---- */
    this.resolvePlayerContacts(ctx);
    /* ---- Stage D: ward walls push ground foes ---- */
    for (const e of this.enemies) {
      if (!e.dead && !e.flying && !e.boss) this.applyWards(e, ctx.hazards);
    }
    /* ---- Stage E: bounded final invariant pass + diagnostics ---- */
    this.finalConstraintPass(ctx, dt);
    /* ---- Stage F: visuals from the RESOLVED positions ---- */
    for (const e of this.enemies) {
      if (e.dead) continue;
      /* melee swing anticipation (9-e attack policy, touch route): clip-driven
      melee foes start the swing as they close to strike range so the STRIKE
      lands right on the touch hit (~0.15s later); a whiff reads naturally
      if the player escapes. Re-arms at the 0.7s touch cadence. Bosses swing
      only via their told patterns (their tells carry the timing). */
      const pdx = player.x - e.x,
        pdz = player.z - e.z;
      const pd = Math.hypot(pdx, pdz);
      if (!e.boss && !player.dead && e.touchCd <= 0 && pd < e.radius + FOE_MELEE_RANGE) {
        if (!((attackPulses.get(e.group) ?? 0) > 0)) attackPulses.set(e.group, FOE_MELEE_LEAD + 0.18);
      }
      /* visuals */
      this.syncVisual(e, dt, player);
    }
  }
  /* ------------------- Stage B: foe↔foe separation ----------------------- */
  private separateFoes(): void {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.dead) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.dead) continue;
        this.separatePair(a, b);
      }
    }
  }
  /** Resolve one overlapping pair (bosses plow through). Exact-coincident
   *  centers (d²≈0) resolve along a deterministic fallback normal derived
   *  from a stable hash of the ordered id pair — a pair is NEVER left
   *  unresolved merely because its distance is zero (audit F-01). */
  private separatePair(a: Enemy, b: Enemy): void {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const min = a.radius + b.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    let nx: number, nz: number, d: number;
    if (d2 > 1e-8) {
      d = Math.sqrt(d2);
      nx = dx / d;
      nz = dz / d;
    } else {
      d = 0;
      const lo = a.id < b.id ? a.id : b.id;
      const hi = a.id < b.id ? b.id : a.id;
      const h = (Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hi + 0x7feb352d, 0x846ca68b)) >>> 0;
      const ang = h / 4294967296 * Math.PI * 2;
      nx = Math.cos(ang);
      nz = Math.sin(ang);
      if (a.id > b.id) {
        nx = -nx;
        nz = -nz;
      } // stable a→b orientation by id order
    }
    const push = (min - d) * 0.5;
    const aW = a.boss ? 0 : b.boss ? 1 : 0.5;
    const bW = 1 - aW;
    a.x -= nx * push * aW;
    a.z -= nz * push * aW;
    b.x += nx * push * bW;
    b.z += nz * push * bW;
  }
  /* ------------- Stage C: contact event + player separation -------------- */
  private resolvePlayerContacts(ctx: SimContext): void {
    const player = ctx.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const pdx = player.x - e.x,
        pdz = player.z - e.z;
      const pd = Math.hypot(pdx, pdz);
      const bossGraced = !!e.boss && bossGraces.has(e.boss);
      /* contact-damage EVENT — decided from the contact state BEFORE the
      separation below, so damage is driven by REACHING the player, never
      by staying embedded inside them. Suppressed while a boss is in its
      intro/enrage grace. */
      if (pd < e.radius + PLAYER_TOUCH && e.touchCd <= 0 && !player.dead && !bossGraced) {
        e.touchCd = 0.7;
        /* 10-d: the strike-land beat — a curved slash arc (kenney-crescent
        sprite, vfx.slashArc) exactly on the committed hit moment the clip
        swing was timed to (foeAttackWindup lands strikes on the touch
        hit). Deterministic roll from the foe id; visual only. */
        const hitYaw = Math.atan2(pdx, pdz);
        ctx.vfx.slashArc(_tellPos.set((player.x + e.x) / 2, 1.05, (player.z + e.z) / 2), hexNum(e.def.color), {
          size: 0.9 + e.radius * 0.5,
          roll: hitYaw * 0.22 + ((e.id * 2654435761 >>> 16) % 100 / 100 - 0.5) * 0.9
        });
        const dashing = e.boss && (e.boss.state === 3 || e.boss.state === 2);
        ctx.damagePlayer(e.dmg * (dashing ? 1.4 : 1), e.x, e.z, dashing ? `${e.def.name}'s charge` : `${e.def.name}'s strike`);
        if (!e.boss && !e.flying && pd > 0.01) {
          player.x += pdx / pd * 0.12;
          player.z += pdz / pd * 0.12;
        }
      }
      /* separation — non-boss foes step out of the player; bosses shove the
      PLAYER out instead (tyrants physically dominate, but a shoved player
      never leaves the arena bounds) */
      if (!player.dead) this.separateFromPlayer(e, ctx);
    }
  }
  private separateFromPlayer(e: Enemy, ctx: SimContext): void {
    const player = ctx.player;
    const pdx = player.x - e.x,
      pdz = player.z - e.z;
    const pd = Math.hypot(pdx, pdz);
    const sep = e.radius + PLAYER_RADIUS;
    if (pd >= sep) return;
    let nx: number, nz: number;
    if (pd > 1e-4) {
      nx = pdx / pd;
      nz = pdz / pd;
    } else {
      /* coincident with the player — deterministic fallback normal */
      const h = Math.imul(e.id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
      const ang = h / 4294967296 * Math.PI * 2;
      nx = Math.cos(ang);
      nz = Math.sin(ang);
    }
    if (e.boss) {
      player.x = e.x + nx * sep;
      player.z = e.z + nz * sep;
      const pdist = Math.hypot(player.x, player.z);
      const maxR = ctx.arenaRadius - 0.6;
      if (pdist > maxR && pdist > 1e-6) {
        player.x *= maxR / pdist;
        player.z *= maxR / pdist;
      }
    } else {
      e.x = player.x - nx * sep;
      e.z = player.z - nz * sep;
    }
  }
  /* -------------------- Stage E: final invariant pass -------------------- */
  private clampToArena(e: Enemy, arenaRadius: number): void {
    const d = Math.hypot(e.x, e.z);
    const maxR = arenaRadius - e.radius;
    if (d > maxR) {
      if (d < 1e-6) {
        e.x = maxR;
        e.z = 0;
      } else {
        e.x = e.x / d * maxR;
        e.z = e.z / d * maxR;
      }
    }
  }
  /** rune rubble: ground foes slide around the shards (flyers pass over,
   *  projectiles are never blocked — low rubble reads as clutter, not walls) */
  private pushOutOfObstacles(e: Enemy): void {
    if (e.flying) return;
    for (const o of this.obstacles) {
      const odx = e.x - o.x,
        odz = e.z - o.z;
      const od = Math.hypot(odx, odz);
      const omin = o.r + e.radius;
      if (od < omin) {
        if (od < 1e-4) {
          e.x = o.x + omin;
          continue;
        }
        e.x = o.x + odx / od * omin;
        e.z = o.z + odz / od * omin;
      }
    }
  }
  /** Bounded final constraint iteration (audit §5.1 step 8): EVERY pass
   *  re-resolves the full constraint set — arena bounds + solid obstacles +
   *  foe pairs + player — Gauss-Seidel style (positions updated in place, so
   *  later pairs see earlier corrections). Dense crowds piling on a
   *  stationary point are the worst case; three full sweeps relax them to
   *  within the diagnostic tolerance. Residual violations are counted for
   *  the harness/dev overlay. The FINAL invariant holds after the LAST
   *  displacement. All-pairs cost at the ~90-foe spawn cap is ~4k distance
   *  checks per sweep — no broadphase needed (documented audit §5.1 note). */
  private finalConstraintPass(ctx: SimContext, dt: number): void {
    const arr = this.enemies;
    for (let pass = 0; pass < FINAL_PASSES; pass++) {
      for (const e of arr) {
        if (e.dead) continue;
        this.clampToArena(e, ctx.arenaRadius);
        this.pushOutOfObstacles(e);
      }
      this.separateFoes();
      /* player separation gets the LAST word in every pass — the contact-
       * damage fairness invariant (no foe inside the player, audit F-01) is
       * higher priority than cosmetic pair residuals. In an extreme pressing
       * pile (more foes than fit around the player) the constraint set is
       * over-determined; pairs then equilibrate at ≤ ~0.2u penetration
       * (≈ one frame of intent motion) while player/bounds/obstacles stay
       * exact. Documented tolerance: see PAIR_RESIDUAL_TOL. */
      if (!ctx.player.dead) {
        for (const e of arr) {
          if (!e.dead) this.separateFromPlayer(e, ctx);
        }
      }
    }
    /* diagnostics: residual violations after the final displacement */
    for (const e of arr) {
      if (e.dead) continue;
      const d = Math.hypot(e.x, e.z);
      if (d > ctx.arenaRadius - e.radius + INVAR_TOL) motionDiagnostics.outOfBounds++;
      if (!e.flying) {
        for (const o of this.obstacles) {
          if (Math.hypot(e.x - o.x, e.z - o.z) < o.r + e.radius - INVAR_TOL) {
            motionDiagnostics.obstacleOverlaps++;
            break;
          }
        }
      }
      if (!ctx.player.dead && Math.hypot(ctx.player.x - e.x, ctx.player.z - e.z) < e.radius + PLAYER_RADIUS - INVAR_TOL) motionDiagnostics.playerOverlaps++;
      if (e.stallT >= STALL_WINDOW * 2) motionDiagnostics.stalledAgents++;
    }
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.dead) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.dead) continue;
        const min = a.radius + b.radius;
        /* intent-scaled pair tolerance: a pressing crowd re-adds up to one
         * frame of commanded motion between solver runs, and pile-FORMATION
         * transients compound neighbor pushes — the honest residual bound is
         * ~2.5× the faster foe's per-frame intent distance (floor: the
         * steady-state pile equilibrium). */
        const tol = Math.max(PAIR_RESIDUAL_TOL, 2.5 * dt * Math.max(a.spd * a.slowF, b.spd * b.slowF));
        if (Math.hypot(b.x - a.x, b.z - a.z) < min - tol) motionDiagnostics.unresolvedPairOverlaps++;
      }
    }
  }
  /* ------------------ F-02: stall detect + tangent recovery -------------- */
  /** Window-sampled progress detector (audit §5.2): when a ground foe's
   *  commanded motion is repeatedly erased by constraints (net ≪ commanded)
   *  while its brain keeps commanding movement, the stall score rises; past
   *  STALL_TIME a deterministic tangent recovery engages. Flyers/bosses do
   *  not participate (flyers ignore ground obstacles; tyrant patterns are
   *  telegraphed and short). */
  private trackStall(e: Enemy, preX: number, preZ: number, dt: number, ctx: SimContext): void {
    if (e.boss || e.flying) {
      e.stallT = 0;
      e.winT = 0;
      e.winCmd = 0;
      return;
    }
    /* commanded distance the brain intended this frame (recovery-redirected
    motion counts as commanded too — it is the cure, not the symptom) */
    e.winCmd += Math.hypot(e.x - preX, e.z - preZ);
    e.winT += dt;
    if (e.winT < STALL_WINDOW) return;
    /* ARRIVED foes never count as stalled: a melee foe pressed against its
     * target is where it wants to be — the detector exists for traversal,
     * not engagement (a foe in range reset its score every window). */
    const distToPlayer = Math.hypot(ctx.player.x - e.x, ctx.player.z - e.z);
    if (distToPlayer < e.radius + FOE_MELEE_RANGE + 1) {
      e.stallT = 0;
      e.winT = 0;
      e.winCmd = 0;
      e.stallRefX = e.x;
      e.stallRefZ = e.z;
      return;
    }
    const net = Math.hypot(e.x - e.stallRefX, e.z - e.stallRefZ);
    if (e.winCmd > STALL_CMD_MIN && net < e.winCmd * STALL_NET_FRAC) {
      e.stallT += e.winT; // commanded but going nowhere
    } else if (net >= e.winCmd * STALL_NET_FRAC) {
      e.stallT = 0; // making progress again
    }
    /* a window under the commanded floor (windup/fuse idle) neither
    accumulates nor resets the score */
    if (e.recoverT <= 0 && e.stallT >= STALL_TIME) {
      e.stallSide = this.pickStallSide(e, ctx);
      e.recoverT = RECOVER_TIME;
      e.stallT = 0;
      motionDiagnostics.recoveries++;
    }
    e.winT = 0;
    e.winCmd = 0;
    e.stallRefX = e.x;
    e.stallRefZ = e.z;
  }
  /** Deterministic tangent-side choice (audit §5.2): alternate from the last
   *  tried side (it failed), but never steer INTO the side the nearest
   *  blocking obstacle sits on. Pure function of live state + id order. */
  private pickStallSide(e: Enemy, ctx: SimContext): number {
    const alt = e.stallSide >= 0 ? -1 : 1;
    const dx = ctx.player.x - e.x,
      dz = ctx.player.z - e.z;
    const dm = Math.hypot(dx, dz) || 1;
    const ux = dx / dm,
      uz = dz / dm;
    for (const o of this.obstacles) {
      const ox = o.x - e.x,
        oz = o.z - e.z;
      const od = Math.hypot(ox, oz);
      if (od > o.r + e.radius + 1.5) continue; // not the blocker
      const cross = ux * oz - uz * ox;
      if (cross > 0 && alt > 0) return -1; // blocker left, alternation chose left → right
      if (cross < 0 && alt < 0) return 1; // blocker right, alternation chose right → left
      break;
    }
    return alt;
  }
  /** Bend the brain's intended displacement ±90° (magnitude preserved — the
   *  foe keeps its speed, only the heading swings around the block). Committed
   *  patterns (charger dash, bomber fuse) keep their telegraph. */
  private applyRecoverySteering(e: Enemy, preX: number, preZ: number, dt: number): void {
    e.recoverT -= dt;
    const brain = e.def.brain;
    if (brain === "charger" && e.state >= 2) return;
    if (brain === "bomber" && e.state === 1) return;
    const mx = e.x - preX,
      mz = e.z - preZ;
    const m = Math.hypot(mx, mz);
    if (m < 1e-4) return;
    const s = e.stallSide >= 0 ? 1 : -1;
    e.x = preX + -mz / m * s * m;
    e.z = preZ + mx / m * s * m;
  }
  private applyWards(e: Enemy, hazards: Hazard[]): void {
    for (const h of hazards) {
      if (h.kind !== "ward" || h.life <= 0) continue;
      const dx = h.dx ?? 0,
        dz = h.dz ?? 0;
      const relX = e.x - h.x,
        relZ = e.z - h.z;
      const along = relX * dx + relZ * dz;
      const lateral = -relX * dz + relZ * dx;
      if (Math.abs(lateral) < 2.6 + e.radius && Math.abs(along) < e.radius + 0.35) {
        const sign = along >= 0 ? 1 : -1;
        e.x += dx * sign * (e.radius + 0.35 - Math.abs(along));
        e.z += dz * sign * (e.radius + 0.35 - Math.abs(along));
      }
    }
  }
  private syncVisual(e: Enemy, dt: number, player: { x: number; z: number }): void {
    e.bobPhase += dt * 3;
    e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
    e.squash = Math.max(0, e.squash - dt * 6);
    const mk = foeKinds.get(e.group) ?? null;
    const hoverY = e.flying ? 1.3 + Math.sin(e.bobPhase) * 0.22 : 0;
    e.y = hoverY;
    e.group.position.set(e.x, hoverY, e.z);
    /* pin the blob shadow + underglow to the floor while the body hovers */
    const fx = groundFx.get(e.group);
    if (fx) {
      fx.shadow.position.y = 0.02 - hoverY;
      fx.glow.position.y = 0.04 - hoverY;
    }
    /* boss regalia spin (blade halos / shard rings) */
    const spin = spinners.get(e.group);
    if (spin) spin.rotation.y += dt * 2.2;
    /* face the player — billboards mirror horizontally (no group yaw) */
    const faceRight: 1 | -1 = player.x >= e.x ? 1 : -1;
    /* squash + spawn-in scale */
    const grow = 0.05 + 0.95 * easeOutBack(e.spawnT);
    const sq = e.squash;
    const s = enemyBaseScale(e) * grow;
    e.group.scale.set(s * (1 + sq * 0.25), s * (1 - sq * 0.4), s * (1 + sq * 0.25));
    /* pre-fire tell: the charge glow pulses 2–3 beats over the windup
    (counts down here; tellFire registers the channel) */
    let tellGlow = 0;
    const tell = fireTells.get(e.group);
    if (tell !== undefined) {
      const left = tell - dt;
      if (left <= 0) {
        fireTells.delete(e.group);
        /* the committed shot follows — release the anticipation coil */
        const co = coils.get(e.group);
        if (co && co.phase === 1) {
          co.phase = 2;
          co.t = 0;
        }
      } else {
        fireTells.set(e.group, left);
        /* ~2.5 beats per 0.38s windup (period 2π/40 ≈ 0.157s) */
        tellGlow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(left * 40));
      }
    }
    /* v3.0 sprite driving: hit/tell flash, wraith breathing, enrage pulse */
    const spr = e.sprite;
    if (spr) {
      let fl = Math.min(1, e.hitFlash * 1.6 + tellGlow * 0.3);
      if (e.boss) {
        const enr = enrageT.get(e.boss);
        if (enr !== undefined) {
          const left = enr - dt;
          if (left <= 0) enrageT.delete(e.boss);else {
            enrageT.set(e.boss, left);
            const pulse = 0.5 + 0.5 * Math.sin((1 - left) * 18);
            fl = Math.max(fl, pulse * 0.75);
          }
        }
      }
      spr.flash = fl;
      const ghostly = mk === "wraith" || v31Ids.get(e.group) === "enemy_wraith";
      if (ghostly) spr.setOpacity(0.84 + 0.08 * Math.sin(e.bobPhase * 0.9));
    }
    /* anticipation coil → release (audit P2-8): during the tell the body
    root scales down + leans toward the shot; on expiry it snaps back
    through a quick overshoot and settles. Subtle by design — the
    fireTells emissive pulse + ground ring stay the authoritative tell.
    The 9-e per-model procedural layers (ghost drift / slime hop / plant
    sway) compose ON TOP: banking adds to the lean, hop/sway scale the
    bodyRoot, lift raises it — every layer is a separate transform term,
    so none of them fight each other. */
    const bodyRoot = bodyRoots.get(e.group);
    if (bodyRoot) {
      const co = coils.get(e.group);
      let sc = 1,
        lean = 0;
      if (co) {
        if (co.phase === 1) {
          co.t += dt;
          const k = Math.min(1, co.t / co.dur);
          sc = 1 - COIL_SCALE * k;
          lean = COIL_LEAN * k;
        } else {
          co.t += dt;
          const u = Math.min(1, co.t / COIL_RELEASE);
          const ease = 1 - (1 - u) * (1 - u);
          const pop = Math.sin(Math.PI * u);
          sc = 1 - COIL_SCALE + COIL_SCALE * ease + COIL_OVERSHOOT * pop;
          lean = COIL_LEAN * (1 - ease) - COIL_RECOIL * pop;
          if (u >= 1) coils.delete(e.group);
        }
      }
      let liftY = 0,
        rollZ = 0,
        sy = 1,
        sxz = 1;
      const ghostDrift = mk === "wraith" || v31Ids.get(e.group) === "enemy_wraith";
      if (ghostDrift) {
        const g = updateGhostDrift(e, dt);
        lean += g.pitch;
        rollZ = g.roll;
        liftY = g.bobY;
      } else if ((mk === "ooze" || mk === "swarm") && !e.flying) {
        const h = updateSlimeHop(e, dt);
        liftY = h.lift;
        sy = h.sy;
        sxz = h.sxz;
      } else if (mk === "plant") {
        /* rooted-plant idle (9-e): a gentle sway + slow breathing pulse.
        Only while the plant has no clip plan — a clip-driven myconid gets
        its life from the skeletal clips instead (layers would double up). */
        rollZ = Math.sin(e.bobPhase * 0.5) * 0.055;
        sy = 1 + Math.sin(e.bobPhase * 0.8) * 0.02;
        sxz = 1 / Math.sqrt(sy);
      }
      bodyRoot.scale.set(sc * sxz, sc * sy, sc * sxz);
      bodyRoot.rotation.x = lean;
      bodyRoot.rotation.z = rollZ;
      bodyRoot.position.y = liftY;
    }
    /* v3.0 sprite state machine — locomotion from the ACTUAL displacement
    the AI produced, attack pulses from the tells/melee windups, hurt on
    fresh damage (visuals mirror the sim, they never drive it) */
    if (spr) {
      const atkT = attackPulses.get(e.group) ?? 0;
      if (atkT > 0) attackPulses.set(e.group, atkT - dt);
      const last = lastPos.get(e.group);
      const moved = last ? Math.hypot(e.x - last.x, e.z - last.z) : 0;
      /* V3.1 directional art needs the pre-mutation velocity — capture the
       * displacement before `last` absorbs the new position. */
      const velX = last ? (e.x - last.x) / dt : 0;
      const velZ = last ? (e.z - last.z) / dt : 0;
      /* mutate the WeakMap entry in place — one small object per foe per
         LIFETIME, not per frame (~1,800 fresh literals/s at the 30-foe cap) */
      if (last) {
        last.x = e.x;
        last.z = e.z;
      } else {
        lastPos.set(e.group, { x: e.x, z: e.z });
      }
      spr.face = faceRight;
      spr.state = e.hp <= 0 ? "death" : e.hitFlash > FOE_HIT_TRIGGER ? "hurt" : atkT > 0 ? "attack" : moved > 0.02 ? "walk" : "idle";
      /* V3.1 sheets carry four-direction art — feed the locomotion intent so
       * the correct row plays (idle keeps the last facing). */
      if (spr instanceof V31Sprite && moved > 0.02) {
        spr.setMotion(velX, velZ);
      }
      spr.update(dt);
    }
    /* vitals bar — visible once the foe has taken a hit (elites always).
    The body group YAWS to face the player, which would swing the bar
    edge-on to the camera; cancel the yaw, then re-apply the fixed tilt
    so the bar always reads flat toward the eye. */
    const hb = healthBars.get(e.group);
    if (hb) {
      hb.bar.rotation.set(HPBAR_TILT, 0, 0);
      hb.bar.visible = !!e.elite || e.hp < e.hpMax - 0.5;
      hb.fill.scale.x = Math.max(0.001, Math.min(1, e.hp / e.hpMax));
    }
  }
  /* --------------------------- foe AI brains ----------------------------- */
  private updateFoe(e: Enemy, dt: number, ctx: SimContext): void {
    const {
      player
    } = ctx;
    const spd = e.spd * e.slowF;
    const dx = player.x - e.x,
      dz = player.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist,
      nz = dz / dist;
    switch (e.def.brain) {
      case "chaser":
      case "tank":
        e.x += nx * spd * dt;
        e.z += nz * spd * dt;
        break;
      case "fast":
        {
          const wob = Math.sin(e.bobPhase * 2.1) * 0.45;
          e.x += (nx + -nz * wob) * spd * dt;
          e.z += (nz + nx * wob) * spd * dt;
          break;
        }
      case "flyer":
        e.x += nx * spd * dt;
        e.z += nz * spd * dt;
        break;
      case "ranged":
        {
          const want = 11;
          if (dist > want + 2) {
            e.x += nx * spd * dt;
            e.z += nz * spd * dt;
          } else if (dist < want - 2) {
            e.x -= nx * spd * 0.8 * dt;
            e.z -= nz * spd * 0.8 * dt;
          } else {
            e.x += -nz * spd * 0.3 * dt;
            e.z += nx * spd * 0.3 * dt;
          }
          /* pre-fire tell (plan §6): a 0.38s charge-up beat before every bolt —
          the committed shot always follows its tell */
          e.shootCd -= dt;
          if (e.state === 0) {
            if (dist < 26 && e.shootCd <= RANGED_TELL) {
              e.state = 1;
              e.shootCd = Math.max(e.shootCd, RANGED_TELL);
              tellFire(e, ctx, RANGED_TELL);
            }
          } else if (e.shootCd <= 0) {
            e.state = 0;
            e.shootCd = e.def.shootsEvery ?? 3;
            ctx.spawnEnemyBolt(e.x, 1.2, e.z, player.x, player.z, 10, e.dmg, hexNum(e.def.color), 0.28);
          }
          break;
        }
      case "orbit":
        {
          const want = 9.5;
          const radial = Math.max(-1, Math.min(1, (dist - want) * 0.6));
          const tang = e.id % 2 === 0 ? 1 : -1;
          e.x += (nx * radial + -nz * tang * 0.8) * spd * dt;
          e.z += (nz * radial + nx * tang * 0.8) * spd * dt;
          /* pre-fire tell before each strafing bolt (plan §6) */
          e.shootCd -= dt;
          if (e.state === 0) {
            if (dist < 24 && e.shootCd <= RANGED_TELL) {
              e.state = 1;
              e.shootCd = Math.max(e.shootCd, RANGED_TELL);
              tellFire(e, ctx, RANGED_TELL);
            }
          } else if (e.shootCd <= 0) {
            e.state = 0;
            e.shootCd = e.def.shootsEvery ?? 3.2;
            ctx.spawnEnemyBolt(e.x, 1.6, e.z, player.x, player.z, 12, e.dmg, hexNum(e.def.color), 0.3);
          }
          break;
        }
      case "bomber":
        {
          if (e.state === 0) {
            e.x += nx * spd * dt;
            e.z += nz * spd * dt;
            if (dist < 2.6) {
              e.state = 1;
              e.stateT = 0;
            }
          } else {
            /* fuse flash then pop (self-destruct — no player-kill rewards) */e.hitFlash = Math.max(e.hitFlash, 0.6 + Math.sin(e.stateT * 40) * 0.4);
            if (e.stateT > 0.55) {
              ctx.vfx.explosion(new THREE.Vector3(e.x, 1, e.z), 0xff6b3d, 3);
              ctx.vfx.ring(new THREE.Vector3(e.x, 0, e.z), 0xff6b3d, 4);
              ctx.shake(0.3);
              ctx.sfx.play("explode", {
                intensity: 0.7
              });
              if (Math.hypot(player.x - e.x, player.z - e.z) < 3.4) ctx.damagePlayer(e.dmg, e.x, e.z, `${e.def.name}'s detonation`);
              e.dead = true;
            }
          }
          break;
        }
      case "charger":
        {
          if (e.state === 0) {
            e.x += nx * spd * dt;
            e.z += nz * spd * dt;
            if (dist < 10 && e.stateT > 1.2) {
              e.state = 1;
              e.stateT = 0;
            }
          } else if (e.state === 1) {
            e.hitFlash = Math.max(e.hitFlash, 0.5 + Math.sin(e.stateT * 25) * 0.3);
            if (e.stateT > 0.65) {
              e.state = 2;
              e.stateT = 0;
              e.chargeDx = nx;
              e.chargeDz = nz;
            }
          } else if (e.state === 2) {
            e.x += e.chargeDx * spd * 4.2 * dt;
            e.z += e.chargeDz * spd * 4.2 * dt;
            if (e.stateT > 0.45) {
              e.state = 3;
              e.stateT = 0;
            }
          } else if (e.stateT > 1.0) {
            e.state = 0;
            e.stateT = 0;
          }
          break;
        }
      case "healer":
        {
          if (dist < 12) {
            e.x -= nx * spd * 0.9 * dt;
            e.z -= nz * spd * 0.9 * dt;
          }
          e.shootCd -= dt;
          if (e.shootCd <= 0) {
            e.shootCd = e.def.shootsEvery ?? 3;
            let target: Enemy | null = null;
            let bestFrac = 0.85;
            for (const o of this.enemies) {
              if (o === e || o.dead || o.boss) continue;
              const frac = o.hp / o.hpMax;
              if (frac < bestFrac && Math.hypot(o.x - e.x, o.z - e.z) < 14) {
                bestFrac = frac;
                target = o;
              }
            }
            if (target) {
              target.hp = Math.min(target.hpMax, target.hp + target.hpMax * 0.22);
              target.hitFlash = Math.max(target.hitFlash, 0.35);
              const from = new THREE.Vector3(e.x, 1.4, e.z);
              const to = new THREE.Vector3(target.x, 1, target.z);
              const dir = to.clone().sub(from);
              for (let s = 0; s <= 8; s++) {
                ctx.vfx.muzzleFlash(from.clone().addScaledVector(dir, s / 8), 0xf2a6ff);
              }
              ctx.sfx.play("pickup", {
                intensity: 0.5
              });
            }
          }
          break;
        }
    }
  }
  /* ---------------------------- boss brains ----------------------------- */
  private updateBoss(e: Enemy, dt: number, ctx: SimContext): void {
    const b = e.boss!;
    /* spawn-grace / enrage-stagger (plan §6): while active the brain does not
    tick (b.stateT freezes) and the boss deals no damage (update() gates
    contact damage on the same map). The boss CAN be damaged — the intro
    and the enrage beat are the player's free windows. */
    const grace = bossGraces.get(b);
    if (grace !== undefined) {
      if (grace <= dt) bossGraces.delete(b);else {
        bossGraces.set(b, grace - dt);
        return;
      }
    }
    const {
      player
    } = ctx;
    const color = hexNum(b.def.color);
    const spd = e.spd * e.slowF;
    const dx = player.x - e.x,
      dz = player.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist,
      nz = dz / dist;
    b.stateT += dt;
    /* phase 2 enrage at half health — unmistakable beat + stagger, then the
    pattern deepens (existing cues kept: banner, slam, shake, color ring) */
    if (b.phase === 1 && e.hp < e.hpMax * 0.5) {
      b.phase = 2;
      bossGraces.set(b, 0.6); // AI stagger before enrage patterns begin
      enrageT.set(b, 1.0); // crimson emissive surge ~1s (syncVisual)
      ctx.banner(`${b.def.name.toUpperCase()} ENRAGES`, "The pattern deepens", b.def.color);
      ctx.sfx.play("surgeReady", {
        intensity: 1
      }); // enrage sting
      ctx.sfx.play("boss", {
        intensity: 0.8
      });
      ctx.shake(0.6);
      ctx.hitStop(0.1);
      ctx.slowmo(0.45, 0.3);
      /* white → teal double ring flash — reads at any range, any palette */
      ctx.vfx.ring(_tellPos.set(e.x, 0, e.z), 0xffffff, 17, {
        life: 0.55
      });
      ctx.vfx.ring(_tellPos.set(e.x, 0, e.z), 0x43e8d8, 11, {
        life: 0.75
      });
      ctx.vfx.ring(_tellPos.set(e.x, 0, e.z), color, 12);
      return; // the stagger: no patterns this frame
    }
    /* minion shed */
    if (b.brain === "juggernaut" || b.brain === "charger" && b.phase === 2) {
      b.minionT -= dt;
      if (b.minionT <= 0) {
        b.minionT = b.brain === "juggernaut" ? 6.5 : 8;
        for (let i = 0; i < 2; i++) {
          const a = ctx.rng.range(0, Math.PI * 2);
          ctx.spawnMinion("imp", e.x + Math.cos(a) * 3.5, e.z + Math.sin(a) * 3.5);
        }
      }
    }
    /* pattern helpers live at module scope (bossVolleyFan / bossSpiralArm /
       bossGo) — zero closure allocation on the 60 Hz brain tick */
    switch (b.brain) {
      /* ---- Malgrym, the Maw of Ruin: stampede charger ---- */case "charger":
        {
          if (b.state === 0) {
            e.x += nx * spd * dt;
            e.z += nz * spd * dt;
            if (b.stateT > 1.5) {
              b.cycle = 0;
              bossGo(b, e, ctx, 1, 0, 0.35);
            }
          } else if (b.state === 1) {
            if (b.stateT > 0.35) {
              bossVolleyFan(b, e, ctx, color, b.phase === 2 ? 7 : 5, 52, 11, 0.3);
              bossGo(b, e, ctx, 2);
            }
          } else if (b.state === 2) {
            e.hitFlash = Math.max(e.hitFlash, 0.55 + Math.sin(b.stateT * 26) * 0.3);
            if (b.stateT < 0.45) {
              b.lockedDx = nx;
              b.lockedDz = nz;
            }
            if (b.stateT > 0.8) {
              ctx.sfx.play("cast", {
                intensity: 0.8
              });
              bossGo(b, e, ctx, 3);
            }
          } else if (b.state === 3) {
            /* F-03: the tyrant stampede rides the global locomotion scale
            (dash speed is an intended movement path, not a projectile) */
            const dashSpd = (24 + (b.phase === 2 ? 4 : 0)) * FOE_MOVE_SPEED_SCALE;
            e.x += b.lockedDx * dashSpd * dt;
            e.z += b.lockedDz * dashSpd * dt;
            if (Math.random() < dt * 14) ctx.vfx.muzzleFlash(_tellPos.set(e.x, 0.5, e.z), color);
            const d = Math.hypot(e.x, e.z);
            if (b.stateT > 0.55 || d > ctx.arenaRadius - e.radius - 0.3) {
              b.cycle++;
              if (b.cycle < (b.phase === 2 ? 4 : 3)) bossGo(b, e, ctx, 2, 0.35); // short re-aim
              else {
                ctx.shake(0.35);
                bossGo(b, e, ctx, 4);
              }
            }
          } else if (b.stateT > 1.3) {
            bossGo(b, e, ctx, 0);
          }
          break;
        }
      /* ---- Ashgorim, the Unquenched Pyre: immovable juggernaut ---- */
      case "juggernaut":
        {
          e.x += nx * spd * dt;
          e.z += nz * spd * dt;
          if (b.state === 0) {
            b.volleyT -= dt;
            if (b.volleyT <= 0) {
              b.volleyT = b.phase === 2 ? 2.6 : 3.6;
              bossGo(b, e, ctx, 1, 0, 0.5);
            }
          } else if (b.state === 1) {
            e.squash = Math.max(e.squash, 0.5);
            if (b.stateT > 0.5) {
              ctx.spawnBossShockring(e.x, e.z, color, e.dmg * 0.8, 9);
              if (b.phase === 2) ctx.spawnBossShockring(e.x, e.z, color, e.dmg * 0.6, 6.5);
              ctx.shake(0.5);
              ctx.sfx.play("nova", {
                intensity: 0.9
              });
              bossGo(b, e, ctx, 0);
            }
          }
          break;
        }
      /* ---- Sylthara, the Reaving Waltz: blade dancer ---- */
      case "dancer":
        {
          if (b.state === 0) {
            const tang = (b.cycle % 2 === 0 ? 1 : -1) * (1 + b.stateT * 0.1);
            const radial = Math.max(-1, Math.min(1, (dist - 10) * 0.5));
            e.x += (nx * radial + -nz * tang) * spd * 1.5 * dt;
            e.z += (nz * radial + nx * tang) * spd * 1.5 * dt;
            /* every fan is preceded by a 0.38s tell (b.flag re-arms after each
            volley — bossGo clears it on the lunge transition) */
            b.volleyT -= dt;
            if (!b.flag && b.volleyT <= 0.38) {
              b.flag = true;
              b.volleyT = Math.max(b.volleyT, 0.38);
              tellFire(e, ctx, 0.38);
            }
            if (b.volleyT <= 0) {
              b.volleyT = Math.max(1.1, 2.4 - b.stateT * 0.08);
              b.flag = false; // re-arm the next fan's tell
              bossVolleyFan(b, e, ctx, color, b.phase === 2 ? 5 : 3, 34, 12.5, 0.26);
              b.cycle++;
              if (b.cycle % 3 === 0) {
                b.cycle = 0;
                bossGo(b, e, ctx, 1);
              }
            }
          } else if (b.state === 1) {
            e.hitFlash = Math.max(e.hitFlash, 0.5 + Math.sin(b.stateT * 30) * 0.3);
            if (b.stateT < 0.25) {
              b.lockedDx = nx;
              b.lockedDz = nz;
            }
            if (b.stateT > 0.4) bossGo(b, e, ctx, 2);
          } else if (b.state === 2) {
            /* F-03: lunge speed rides the global locomotion scale */
            e.x += b.lockedDx * 22 * FOE_MOVE_SPEED_SCALE * dt;
            e.z += b.lockedDz * 22 * FOE_MOVE_SPEED_SCALE * dt;
            if (Math.random() < dt * 16) ctx.vfx.muzzleFlash(_tellPos.set(e.x, 0.8, e.z), color);
            if (b.stateT > 0.5) {
              b.cycle++;
              if (b.cycle < (b.phase === 2 ? 3 : 2)) bossGo(b, e, ctx, 1, 0.15);else {
                b.volleyT = 1;
                bossGo(b, e, ctx, 0);
              }
            }
          }
          break;
        }
      /* ---- Ysolth, the Hollow Hour: blink fortress ---- */
      case "fortress":
        {
          if (b.state === 0) {
            /* entry tell: the first arm burst is always told (b.ringR is the
            per-visit marker bossGo clears; volleyT floored past the tell) */
            if (b.ringR === 0) {
              b.ringR = 1;
              b.volleyT = Math.max(b.volleyT, 0.42);
              tellFire(e, ctx, 0.4);
            }
            bossSpiralArm(b, e, ctx, color, dt, b.phase === 2 ? 3 : 2, b.phase === 2 ? 2.1 : 1.6, 0.24);
            if (b.stateT > (b.phase === 2 ? 3.2 : 4)) bossGo(b, e, ctx, 1);
          } else if (b.state === 1) {
            e.hitFlash = Math.max(e.hitFlash, 0.7);
            if (b.stateT > 0.55) {
              ctx.vfx.burst(_tellPos.set(e.x, 1.5, e.z), color, 20, {
                speed: 8
              });
              const a = ctx.rng.range(0, Math.PI * 2);
              const r = ctx.rng.range(5.5, 8.5);
              /* F-04: blink clamp derives from the canonical arena radius —
              no stale hard-coded 38 (old r=42 remnant) */
              const bR = Math.max(1, ctx.arenaRadius - e.radius - 2);
              e.x = Math.max(-bR, Math.min(bR, player.x + Math.cos(a) * r));
              e.z = Math.max(-bR, Math.min(bR, player.z + Math.sin(a) * r));
              ctx.vfx.burst(_tellPos.set(e.x, 1.5, e.z), color, 26, {
                speed: 9
              });
              ctx.spawnBossShockring(e.x, e.z, color, e.dmg * 0.7, 10);
              ctx.sfx.play("blink", {
                intensity: 1
              });
              ctx.shake(0.3);
              bossGo(b, e, ctx, 0);
            }
          }
          break;
        }
      /* ---- Mordrax, the First Sundering: the apex storm ---- */
      case "storm":
        {
          if (b.state === 0) {
            if (b.ringR === 0) {
              b.ringR = 1;
              tellFire(e, ctx, 0.3);
            }
            if (!b.flag && b.stateT > 0.3) {
              b.flag = true;
              bossVolleyFan(b, e, ctx, color, 5, 46, 12, 0.26);
            }
            if (b.stateT > 0.9) bossGo(b, e, ctx, 1 + b.cycle % 3);
          } else if (b.state === 1) {
            if (b.stateT < 0.5) {
              e.hitFlash = Math.max(e.hitFlash, 0.5);
              if (b.stateT < 0.35) {
                b.lockedDx = nx;
                b.lockedDz = nz;
              }
            } else if (b.stateT < 1.05) {
              /* F-03: storm dashes ride the global locomotion scale */
              e.x += b.lockedDx * 25 * FOE_MOVE_SPEED_SCALE * dt;
              e.z += b.lockedDz * 25 * FOE_MOVE_SPEED_SCALE * dt;
            } else if (b.stateT < 1.4) {
              if (!b.flag && b.stateT >= 1.15) {
                b.flag = true;
                b.lockedDx = nx;
                b.lockedDz = nz;
                ctx.sfx.play("cast", {
                  intensity: 0.8
                });
              }
            } else if (b.stateT < 1.95) {
              /* F-03: storm dashes ride the global locomotion scale */
              e.x += b.lockedDx * 25 * FOE_MOVE_SPEED_SCALE * dt;
              e.z += b.lockedDz * 25 * FOE_MOVE_SPEED_SCALE * dt;
            } else {
              b.cycle++;
              bossGo(b, e, ctx, 0);
            }
          } else if (b.state === 2) {
            if (b.ringR === 0) {
              b.ringR = 1;
              b.volleyT = Math.max(b.volleyT, 0.36);
              tellFire(e, ctx, 0.35);
            }
            bossSpiralArm(b, e, ctx, color, dt, b.phase === 2 ? 4 : 3, 2.0, 0.2);
            if (b.stateT > 2.6) {
              b.cycle++;
              bossGo(b, e, ctx, 0);
            }
          } else if (b.state === 3) {
            if (!b.flag) {
              b.flag = true;
              b.tx = player.x;
              b.tz = player.z;
              ctx.spawnBossRift(b.tx, b.tz, color);
              ctx.sfx.play("offer", {
                intensity: 1
              });
            }
            e.x += nx * spd * 0.3 * dt;
            e.z += nz * spd * 0.3 * dt;
            if (b.stateT > 2.6) {
              b.cycle++;
              bossGo(b, e, ctx, 0);
            }
          }
          break;
        }
    }
  }
}

/* ---- boss pattern helpers (module scope) --------------------------------
   Hoisted out of updateBoss so the 60 Hz brain tick allocates zero closures;
   all state rides the arguments, nothing is captured. */
function bossVolleyFan(b: BossState, e: Enemy, ctx: SimContext, color: number, count: number, spreadDeg: number, speed: number, dmgFrac: number): void {
  const baseA = Math.atan2(ctx.player.x - e.x, ctx.player.z - e.z);
  for (let i = 0; i < count; i++) {
    const off = (i / Math.max(1, count - 1) - 0.5) * (spreadDeg * Math.PI / 180);
    const a = baseA + off;
    ctx.spawnEnemyBolt(e.x, 1.8, e.z, e.x + Math.sin(a) * 30, e.z + Math.cos(a) * 30, speed, e.dmg * dmgFrac, color, 0.42);
  }
  ctx.vfx.muzzleFlash(_tellPos.set(e.x, 1.9, e.z), color); // release flash
  ctx.sfx.play("volley", {
    intensity: 0.9
  });
}
function bossSpiralArm(b: BossState, e: Enemy, ctx: SimContext, color: number, dt: number, armCount: number, rotSpeed: number, interval: number): void {
  b.volleyT -= dt;
  b.angle += rotSpeed * dt;
  if (b.volleyT <= 0) {
    b.volleyT = interval;
    for (let arm = 0; arm < armCount; arm++) {
      const a = b.angle + arm / armCount * Math.PI * 2;
      ctx.spawnEnemyBolt(e.x, 1.8, e.z, e.x + Math.sin(a) * 30, e.z + Math.cos(a) * 30, 9.5, e.dmg * 0.32, color, 0.4);
    }
  }
}
/* state transition helper — `tellDur` fires the pre-fire tell the moment a
   windup state begins; b.ringR doubles as the per-visit "already told" marker
   for in-state entry tells (fortress/storm) and is cleared here so every
   visit re-arms it. */
function bossGo(b: BossState, e: Enemy, ctx: SimContext, state: number, stateT = 0, tellDur = 0): void {
  b.state = state;
  b.stateT = stateT;
  b.flag = false;
  b.ringR = 0;
  if (tellDur > 0) tellFire(e, ctx, tellDur);
}