import * as THREE from "three";
import { hexNum, ENEMY_DEFS, scaleEnemy, ELITE_DEFS, FOE_MOVE_SPEED_SCALE, MERCY_HP, MERCY_SPD, type EliteAffix, type EnemyDef, type EnemyType, type BossDef } from "./content";
import type { AssetSystem, ModelKind } from "./assets";
import type { BossState, Enemy, SimContext, Hazard } from "./sim";

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
  const anim = foeAnims.get(e.group);
  if (anim) foeAttackWindup(anim, dur);
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
interface FoeClipPlan {
  bank: "kaykit" | "model";
  idle: string;
  walk?: string;
  run?: string;
  sprint?: string;
  attack?: string;
  attackStrike?: number;
  hit?: string;
  death?: string;
  worldH: number;
  idleTs?: number;
  gaitTs?: number;
  combo?: string[];
  comboStrike?: number[];
  comboTail?: number[];
}

/** Live per-foe animation record (foeAnims WeakMap value). */
interface FoeAnimRec {
  mixer: THREE.AnimationMixer;
  root: THREE.Object3D;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  sprint: THREE.AnimationAction | null;
  attack: THREE.AnimationAction | null;
  hit: THREE.AnimationAction | null;
  death: THREE.AnimationAction | null;
  current: string | null;
  legacy: boolean;
  worldH: number;
  gaitTs: number;
  blend: number;
  hitT: number;
  hitDur: number;
  attackT: number;
  attackWin: number;
  attackTail: number;
  strikeAt: number;
  combo: THREE.AnimationAction[];
  comboStrike: number[];
  comboTail: number[];
  comboStep: number;
  lastX: number;
  lastZ: number;
}

/** One lingering corpse in the death-linger pool (10-d). */
interface DyingBody {
  e: Enemy;
  anim: FoeAnimRec | null;
  style: "clip" | "ghost" | "slime" | "plant" | "fall";
  t: number;
  dur: number;
  fadeAt: number;
  bodyRoot: THREE.Group | null;
  fallDir: number;
  baseOpacity: number;
  baseY: number;
}

/** Ghost banking state (9-e) — smoothed local-frame velocity. */
interface GhostDrift {
  lx: number;
  lz: number;
  pitch: number;
  roll: number;
  yaw: number;
  model: THREE.Object3D;
}

/** Slime hop state (9-e). */
interface SlimeHop {
  lx: number;
  lz: number;
  phase: number;
  amp: number;
}

export const FOE_CLIP_PLANS: Partial<Record<ModelKind, FoeClipPlan>> = {
  skeleton: {
    bank: "kaykit",
    idle: "Idle_A",
    run: "Running_A",
    hit: "Hit_A",
    death: "Death_A",
    worldH: 1.9
  },
  skeletonmage: {
    bank: "kaykit",
    idle: "Idle_A",
    run: "Running_A",
    hit: "Hit_A",
    death: "Death_A",
    worldH: 1.9
  },
  imp: {
    bank: "model",
    idle: "Idle_Loop",
    walk: "Walk_Loop",
    run: "Jog_Fwd_Loop",
    sprint: "Sprint_Loop",
    attack: "Sword_Attack",
    attackStrike: 0.4,
    hit: "Hit_Chest",
    death: "Death01",
    worldH: 1.7,
    combo: ["Sword_Regular_A", "Sword_Regular_B", "Sword_Regular_A", "Sword_Regular_C", "Sword_Regular_B", "Sword_Regular_A", "Melee_Hook", "Sword_Regular_C"],
    comboStrike: [0.21, 0.21, 0.21, 0.64, 0.21, 0.21, 0.24, 0.64],
    comboTail: [0.32, 0.32, 0.32, 0.85, 0.32, 0.32, 0.32, 0.85]
  },
  puglin: {
    bank: "model",
    idle: "Idle_Loop",
    walk: "Walk_Loop",
    run: "Jog_Fwd_Loop",
    sprint: "Sprint_Loop",
    attack: "Sword_Attack",
    attackStrike: 0.4,
    hit: "Hit_Chest",
    death: "Death01",
    worldH: 2.1,
    combo: ["Sword_Regular_A", "Sword_Regular_B", "Sword_Regular_A", "Sword_Regular_C", "Sword_Regular_B", "Sword_Regular_A", "Melee_Hook", "Sword_Regular_C"],
    comboStrike: [0.21, 0.21, 0.21, 0.64, 0.21, 0.21, 0.24, 0.64],
    comboTail: [0.32, 0.32, 0.32, 0.85, 0.32, 0.32, 0.32, 0.85]
  }
};
/* ---- boss clip plans (10-d polish) — what each tyrant actually wears ----
   (BOSS_BODY + assets.modelFor: body brute→puglin, knight→skeleton,
   wraith→ghost, orb→procedural; NOTE ghost.glb ships a MeshBasicMaterial
   primary so clonePrimaryMat yields null and wraith bosses run the
   PROCEDURAL kit today — verified /home/z/tmp-10d/check-materials.ts)
   • Grimm (charger) + Cinder (juggernaut) = puglin colossus: same 4-gait
     substrate as puglin foes but idling at 0.55× (weightier) and stepping
     at 0.7× cadence; their told patterns play Sword_Regular_C — the 2.00s
     committed finisher — as the wind-up (Grimm's dash strike / Cinder's
     slam raise), recovery included.
   • Sable (dancer) = skeleton on the KayKit bank: Idle_B + Running_B (the
     bank's B-side — a distinct tyrant silhouette vs every skeleton foe's
     Idle_A/Running_A) + Hit_B, and Throw (the bank's cast/slash flourish,
     strike 0.67 measured) as her volley tell.
   • Dusk (fortress) = procedural orb kit — no rig, keeps the orbiting shard
     regalia + coil (documented: no clip possible).
   • Vex (storm) = wraith body (procedural kit today) — no rig, keeps the
     procedural bob/regalia + the anticipation coil as the tell. */
const BOSS_CLIP_PLANS: Partial<Record<ModelKind, FoeClipPlan>> = {
  puglin: {
    bank: "model",
    idle: "Idle_Loop",
    walk: "Walk_Loop",
    run: "Jog_Fwd_Loop",
    sprint: "Sprint_Loop",
    hit: "Hit_Chest",
    death: "Death01",
    worldH: 2.1,
    idleTs: 0.55,
    gaitTs: 0.7,
    combo: ["Sword_Regular_C"],
    comboStrike: [0.64],
    comboTail: [0.85]
  },
  skeleton: {
    bank: "kaykit",
    idle: "Idle_B",
    run: "Running_B",
    attack: "Throw",
    attackStrike: 0.67,
    hit: "Hit_B",
    death: "Death_A",
    worldH: 1.9,
    idleTs: 0.6,
    gaitTs: 0.75
  }
};
export const foeAnims = new WeakMap<THREE.Group, FoeAnimRec>();
export const RIG_MEDIUM_MODELS = ["skeleton", "skeletonmage"];
/** Model kind per foe group (set in buildEnemyBody) — lets syncVisual pick the
 *  per-model procedural motion layers (ghost drift / slime hop / plant sway)
 *  without Enemy schema changes. */
const foeKinds = new WeakMap<THREE.Group, ModelKind>();
const FOE_MOVE_SMOOTH = 8; // blend approach rate (player rig uses 9)
const FOE_RUN_GATE = 0.25; // legacy: speedRatio above this = running
const FOE_HIT_IN = 0.1; // hit weight-in
const FOE_HIT_OUT = 0.15; // hit weight-out
const FOE_HIT_TRIGGER = 0.85; // hitFlash above this = fresh damage (brain telegraph pulses stay ≤ 0.85)
const FOE_HIT_DUR_KAYKIT = 0.5; // Hit_A window (8-d value, kept exactly)
const FOE_HIT_DUR_MODEL = 0.42; // Hit_Chest window (0.33s clip + small tail)
/* attack one-shot envelope + triggers (9-e policy — see foeAttackWindup) */
const FOE_ATTACK_TAIL = 0.32; // follow-through shown after the strike lands
const FOE_ATTACK_IN = 0.07; // weight-in (a strike snaps in)
const FOE_ATTACK_OUT = 0.18; // weight-out
const FOE_MELEE_RANGE = 1.45; // swing anticipation starts inside this range
const FOE_MELEE_LEAD = 0.15; // strike lands this far ahead of the wind-up
/* ==================== staged movement contract (audit F-01) ================
   The FINAL invariant must hold after the LAST displacement of the frame:
     A. integrate   — status effects, knockback velocity, AI brains
     B. foe↔foe     — pairwise separation (bosses plow through)
     C. foe↔player  — contact-damage EVENT, then separation (foes step out of
                      the player; bosses shove the player out instead)
     D. wards       — ward walls push ground foes
     E. final pass  — bounded iteration over arena bounds + solid obstacles
                      + pairs + player; diagnostics collected after the last
     F. visuals     — anims/transforms from the RESOLVED positions
   Contact damage is decided from the contact state BEFORE the pair is
   separated, so no foe can keep re-damaging merely because it stayed
   embedded inside the player. */
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
/* 10-d combo pattern start offsets — the NON-finisher slots (A/B/Hook) of the
   8-slot pattern [A,B,A,C,B,A,Hook,C]. A foe's first swing uses slot
   STARTS[e.id % 6] so different foes open on different hits (never the heavy
   C), then advance deterministically — same foe id ⇒ same visible sequence. */
const COMBO_STARTS = [0, 1, 2, 4, 5, 6];
/* gait bands on u = speed / worldH (body heights per second) — normalized so
   one set of bands fits the imp (1.7 u) and the puglin (2.1 u): a stylized
   biped walks ≈0.5–1.1 h/s, jogs ≈1.2–2.6, sprints above ≈2.8. Using the
   ABSOLUTE speed (not the per-foe ratio) is what lets the slow Colossus
   (2.1 u/s) WALK while the zippy Ghoul (6.3 u/s) SPRINTS at each one's own
   pace. Telescoping smoothsteps: the four weights always sum to exactly 1. */
const GAIT_IDLE_WALK = [0.18, 0.55];
const GAIT_WALK_RUN = [1.05, 1.6];
const GAIT_RUN_SPRINT = [2.6, 3.2];
const GAIT_TS_WALK = 0.65; // u at which Walk_Loop plays 1×
const GAIT_TS_RUN = 1.9; // u at which Jog_Fwd_Loop plays 1×
const GAIT_TS_SPRINT = 3.6; // u at which Sprint_Loop plays 1×
const clampf = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smoothstepf = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function setupFoeAnim(group: THREE.Group, model: THREE.Object3D, kind: ModelKind, assets: AssetSystem, isBoss = false, foeId = 1): FoeAnimRec | null {
  const plan = (isBoss ? BOSS_CLIP_PLANS[kind] : undefined) ?? FOE_CLIP_PLANS[kind];
  if (!plan || !assets) return null;
  const src = (name: string): THREE.AnimationClip | null => plan.bank === "kaykit" ? assets.clip(name) : assets.modelClip(kind, name);
  const idleClip = src(plan.idle);
  if (!idleClip) return null; // no clips → procedural motion stays
  const mixer = new THREE.AnimationMixer(model);
  const loopAction = (clip: THREE.AnimationClip | null): THREE.AnimationAction | null => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    return a;
  };
  const oneShot = (clip: THREE.AnimationClip | null): THREE.AnimationAction | null => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    return a;
  };
  const idle = loopAction(idleClip) as THREE.AnimationAction;
  const walk = plan.walk ? loopAction(src(plan.walk)) : null;
  const run = plan.run ? loopAction(src(plan.run)) : null;
  const sprint = plan.sprint ? loopAction(src(plan.sprint)) : null;
  const attack = plan.attack ? oneShot(src(plan.attack)) : null;
  const hit = plan.hit ? oneShot(src(plan.hit)) : null;
  const death = plan.death ? oneShot(src(plan.death)) : null;
  /* 10-d combo: one action per pattern slot (actions are mixer-cached per
   clip; absent clips simply drop out of the rotation) */
  const combo: THREE.AnimationAction[] = [];
  for (const name of plan.combo ?? []) {
    const a = oneShot(src(name));
    if (a) combo.push(a);else break; // partial clip set — stop before the parallel arrays desync
  }
  const comboStrike = combo.length > 0 ? (plan.comboStrike ?? []).slice(0, combo.length) : [];
  const comboTail = combo.length > 0 ? (plan.comboTail ?? []).slice(0, combo.length) : [];
  /* no combo (or partial) — fall back to the single primary attack */
  const hasCombo = combo.length > 0 && comboStrike.length === combo.length;
  if (!hasCombo) {
    combo.length = 0;
    comboStrike.length = 0;
  }
  /* locomotion starts immediately — idle at 1, everything else at 0 */
  idle?.reset().play();
  idle?.setEffectiveWeight(1);
  if (plan.idleTs && plan.idleTs > 0) idle.timeScale = plan.idleTs; // boss weight
  for (const a of [walk, run, sprint]) {
    a?.reset().play();
    a?.setEffectiveWeight(0);
  }
  const rec = {
    mixer,
    root: model,
    idle,
    walk,
    run,
    sprint,
    attack,
    hit,
    death,
    current: "idle",
    legacy: walk === null && sprint === null,
    worldH: plan.worldH,
    gaitTs: plan.gaitTs ?? 1,
    blend: 0,
    hitT: 0,
    hitDur: plan.bank === "kaykit" ? FOE_HIT_DUR_KAYKIT : FOE_HIT_DUR_MODEL,
    attackT: 0,
    attackWin: 0,
    attackTail: FOE_ATTACK_TAIL,
    strikeAt: plan.attackStrike ?? 0.4,
    combo: hasCombo ? combo : [],
    comboStrike: hasCombo ? comboStrike : [],
    comboTail: hasCombo && comboTail.length === combo.length ? comboTail : [],
    comboStep: hasCombo ? COMBO_STARTS[Math.abs(foeId) % COMBO_STARTS.length] % combo.length : 0,
    lastX: Number.NaN,
    lastZ: Number.NaN
  };
  foeAnims.set(group, rec);
  return rec;
}
export function foeAttackWindup(anim: FoeAnimRec, lead: number): void {
  /* 10-d combo slot pick (deterministic); falls back to the single primary
   attack when the plan carries no combo */
  let action = anim.attack;
  let strike = anim.strikeAt;
  let tail = FOE_ATTACK_TAIL;
  if (anim.combo.length > 0) {
    const idx = anim.comboStep % anim.combo.length;
    anim.comboStep = (anim.comboStep + 1) % anim.combo.length;
    action = anim.combo[idx];
    strike = anim.comboStrike[idx] ?? 0.4;
    tail = anim.comboTail[idx] ?? FOE_ATTACK_TAIL;
    anim.attack = action;
    anim.strikeAt = strike;
    anim.attackTail = tail;
  }
  if (!action) return;
  const leadS = Math.max(0.05, lead);
  const strikeT = Math.min(strike, action.getClip().duration - 0.08);
  const startAt = Math.max(0, strikeT - leadS);
  action.reset();
  action.time = startAt;
  action.timeScale = (strikeT - startAt) / leadS;
  action.setEffectiveWeight(0);
  action.play();
  anim.attackWin = leadS + tail;
  anim.attackT = anim.attackWin;
  anim.current = "attack";
}
export function updateFoeAnim(anim: FoeAnimRec, e: Enemy, dt: number): void {
  /* actual speed from position deltas (the first frame after setup is
   skipped — lastX/lastZ start as NaN) */
  let ratio = 0;
  let spd = 0;
  if (Number.isFinite(anim.lastX)) {
    const moved = Math.hypot(e.x - anim.lastX, e.z - anim.lastZ);
    spd = dt > 0 ? moved / dt : 0;
    const base = e.spd > 0 ? e.spd : e.def.speed;
    ratio = base > 0 ? spd / base : 0;
  }
  anim.lastX = e.x;
  anim.lastZ = e.z;
  /* hit one-shot: fresh damage trips it (the engine sets hitFlash = 1 on
   damage; telegraph pulses stay below the trigger). A flinch outranks a
   swing — the player controller's hit>cast priority, mirrored. */
  if (anim.hit && anim.current !== "hit" && e.hitFlash > FOE_HIT_TRIGGER) {
    if (anim.current === "attack" && anim.attack) {
      anim.attack.stop();
      anim.attack.setEffectiveWeight(0);
      anim.attackT = 0;
      anim.current = null;
    }
    anim.current = "hit";
    anim.hitT = anim.hitDur;
    anim.hit.reset().play();
  }
  let hitW = 0;
  if (anim.current === "hit" && anim.hit) {
    anim.hitT -= dt;
    const t = anim.hitDur - anim.hitT;
    hitW = t < FOE_HIT_IN ? Math.max(0, t / FOE_HIT_IN) : anim.hitT > FOE_HIT_OUT ? 1 : Math.max(0, anim.hitT / FOE_HIT_OUT);
    if (anim.hitT <= 0) {
      hitW = 0;
      anim.current = null;
      anim.hit.stop();
    }
    anim.hit.setEffectiveWeight(hitW);
  }
  /* attack one-shot envelope (started by foeAttackWindup) */
  let attackW = 0;
  if (anim.current === "attack" && anim.attack) {
    anim.attackT -= dt;
    const t = anim.attackWin - anim.attackT;
    attackW = t < FOE_ATTACK_IN ? Math.max(0, t / FOE_ATTACK_IN) : anim.attackT > FOE_ATTACK_OUT ? 1 : Math.max(0, anim.attackT / FOE_ATTACK_OUT);
    if (anim.attackT <= 0) {
      attackW = 0;
      anim.current = null;
      anim.attack.stop();
      anim.attack.setEffectiveWeight(0);
    }
    anim.attack.setEffectiveWeight(attackW);
  }
  /* locomotion substrate — total weight is always exactly 1, so the pose
   never falls through to the baked rest stance */
  const locW = 1 - Math.min(1, hitW + attackW);
  if (anim.legacy) {
    /* 8-d path verbatim (idle↔run blend by speed ratio, run cadence
    tracking); 10-d: bosses scale the cadence by gaitTs — weightier steps
    at the same sim speed (Sable's Running_B at 0.75×). */
    anim.blend += ((ratio > FOE_RUN_GATE ? 1 : 0) - anim.blend) * Math.min(1, dt * FOE_MOVE_SMOOTH);
    if (anim.run) anim.run.timeScale = Math.max(0.65, Math.min(1.5, ratio)) * anim.gaitTs;
    anim.idle?.setEffectiveWeight(locW * (1 - anim.blend));
    anim.run?.setEffectiveWeight(locW * anim.blend);
    if (anim.current !== "hit" && anim.current !== "attack") anim.current = anim.blend > 0.5 ? "run" : "idle";
  } else {
    /* 4-gait blend on u = speed / worldH (body heights per second); 10-d:
    gaitTs scales every cadence clamp for the boss plans */
    const u = anim.worldH > 0 ? spd / anim.worldH : 0;
    anim.blend += (u - anim.blend) * Math.min(1, dt * FOE_MOVE_SMOOTH);
    const b = anim.blend;
    let wIdle = 1 - smoothstepf(GAIT_IDLE_WALK[0], GAIT_IDLE_WALK[1], b);
    let wWalk = smoothstepf(GAIT_IDLE_WALK[0], GAIT_IDLE_WALK[1], b) * (1 - smoothstepf(GAIT_WALK_RUN[0], GAIT_WALK_RUN[1], b));
    let wRun = smoothstepf(GAIT_WALK_RUN[0], GAIT_WALK_RUN[1], b) * (1 - smoothstepf(GAIT_RUN_SPRINT[0], GAIT_RUN_SPRINT[1], b));
    let wSprint = smoothstepf(GAIT_RUN_SPRINT[0], GAIT_RUN_SPRINT[1], b);
    /* missing gaits fold down into the next slower present gait (defensive —
    the shipped imp/puglin carry all four) */
    if (!anim.sprint) {
      wRun += wSprint;
      wSprint = 0;
    }
    if (!anim.run) {
      wWalk += wRun;
      wRun = 0;
    }
    if (!anim.walk) {
      wIdle += wWalk;
      wWalk = 0;
    }
    if (anim.walk) anim.walk.timeScale = clampf(b / GAIT_TS_WALK, 0.6, 1.6) * anim.gaitTs;
    if (anim.run) anim.run.timeScale = clampf(b / GAIT_TS_RUN, 0.6, 1.5) * anim.gaitTs;
    if (anim.sprint) anim.sprint.timeScale = clampf(b / GAIT_TS_SPRINT, 0.7, 1.6) * anim.gaitTs;
    anim.idle?.setEffectiveWeight(locW * wIdle);
    anim.walk?.setEffectiveWeight(locW * wWalk);
    anim.run?.setEffectiveWeight(locW * wRun);
    anim.sprint?.setEffectiveWeight(locW * wSprint);
    if (anim.current !== "hit" && anim.current !== "attack") {
      anim.current = wSprint > 0.5 ? "sprint" : wRun > 0.5 ? "run" : wWalk > 0.5 ? "walk" : "idle";
    }
  }
  anim.mixer.update(dt);
}
export function disposeFoeAnim(group: THREE.Group): void {
  const anim = foeAnims.get(group);
  if (!anim) return;
  anim.mixer.stopAllAction();
  anim.mixer.uncacheRoot(anim.root);
  foeAnims.delete(group);
}
const MAX_DYING = 12;
const DYING_FADE_SPAN = 0.3; // last 30% of the window = sink + fade
/* scratch (module scope — the linger update runs per frame, never allocates) */
const _deadColor = new THREE.Color();
/** Compute the linger window for a slain enemy (bosses read heavier — their
 *  death slow-mo runs 1.1s and wants a body under it). Clip deaths get the
 *  full 0.8s brief so Death_A's collapse completes; procedural styles run
 *  0.6–0.7s. */
function dyingDuration(e: Enemy, style: string): number {
  const base = style === "clip" ? 0.8 : style === "plant" ? 0.7 : style === "ghost" ? 0.6 : 0.65;
  return e.boss ? base + 0.25 : base;
}
/** Begin the death linger for a slain foe. Call INSTEAD of removeEnemy —
 *  this splices the Enemy out of the sim array (same-frame gameplay death)
 *  and takes ownership of the group until the sequence finishes. */
function beginDyingBody(sys: EnemySystem, e: Enemy): void {
  /* cap: oldest finishes instantly when the pool would overflow */while (sys.dyingCount() >= MAX_DYING) sys.finishOldestDying();
  const anim = foeAnims.get(e.group) ?? null;
  const mk = foeKinds.get(e.group) ?? null;
  /* pick the death style: clip when the plan carries a death clip */
  let style: DyingBody["style"] = "fall";
  if (anim?.death) style = "clip";else if (mk === "ghost") style = "ghost";else if (mk === "slime") style = "slime";else if (mk === "plant") style = "plant";
  /* start the clip death: silence locomotion + one-shots, play the collapse
   at weight 1 (the mixer stays alive until the linger ends) */
  if (style === "clip" && anim && anim.death) {
    anim.mixer.stopAllAction();
    anim.death.reset();
    anim.death.setEffectiveWeight(1);
    anim.death.play();
    anim.current = null;
  }
  /* clear the interaction layers so no tell/coil/bar survives on the corpse */
  fireTells.delete(e.group);
  coils.delete(e.group);
  const hb = healthBars.get(e.group);
  if (hb) hb.bar.visible = false;
  /* settle the emissive at the base (no stale hit/tell glow on the corpse) */
  e.bodyMat.emissive.copy(e.baseColor).multiplyScalar(e.baseEmissive);
  /* the fade needs a transparent body — per-foe cloned materials, so this
   never leaks to other foes; depthWrite off avoids sorting pops mid-fade */
  e.bodyMat.transparent = true;
  e.bodyMat.depthWrite = false;
  const bodyRoot = bodyRoots.get(e.group) ?? null;
  sys.pushDying({
    e,
    anim: style === "clip" ? anim : null,
    style,
    t: 0,
    dur: dyingDuration(e, style),
    fadeAt: style === "clip" ? 0.7 : 0.6,
    bodyRoot,
    fallDir: e.id % 2 === 0 ? 1 : -1,
    baseOpacity: e.bodyMat.opacity,
    baseY: e.group.position.y
  });
}
/** Advance one dying body's sequence (called from EnemySystem.updateDying). */
function updateDyingBody(b: DyingBody, dt: number): boolean {
  b.t += dt;
  const u = b.t / b.dur;
  if (u >= 1) return false; // finished
  const e = b.e;
  /* the death clip keeps playing (mixer is the same one the foe lived with) */
  if (b.anim) b.anim.mixer.update(dt);
  /* shared fade/sink window (final DYING_FADE_SPAN of the sequence) */
  const f = Math.max(0, Math.min(1, (u - b.fadeAt) / DYING_FADE_SPAN));
  const fade = 1 - f;
  switch (b.style) {
    case "clip":
      {
        /* the clip collapses the body; the tail sinks it into the floor.
        Flyers drop out of their hover first (Death01 is an in-place
        collapse — the corpse falls to the ground by ~60% of the window,
        then sinks with everyone else). */
        e.group.position.y = b.baseY * Math.max(0, 1 - u * 1.6) - 0.45 * f * f;
        break;
      }
    case "ghost":
      {
        /* disperse: rise, slow spin, thin out over the whole window */e.group.position.y = b.baseY + b.t * 0.9;
        if (b.bodyRoot) b.bodyRoot.rotation.y += dt * 1.4;
        const disperse = 1 - Math.pow(u, 1.5);
        e.bodyMat.opacity = b.baseOpacity * disperse;
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
        e.bodyMat.opacity = b.baseOpacity * fade;
        break;
      }
    case "plant":
      {
        /* wilt: droop forward + shrink, then fade */if (b.bodyRoot) {
          b.bodyRoot.rotation.x = Math.min(1.15, u * 1.6);
          b.bodyRoot.scale.setScalar(1 - u * 0.22);
        }
        e.group.position.y = b.baseY - 0.15 * f;
        e.bodyMat.opacity = b.baseOpacity * fade;
        break;
      }
    case "fall":
      {
        /* topple: pitch over the body root (ease-in gravity), then sink+fade */if (b.bodyRoot) {
          const topple = Math.min(1, u * 1.45);
          b.bodyRoot.rotation.x = b.fallDir * (Math.PI / 2 - 0.12) * (topple * topple);
        }
        e.group.position.y = b.baseY - 0.4 * f * f;
        e.bodyMat.opacity = b.baseOpacity * fade;
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
  /* the tint emissive dims with the fade (a corpse, not a lantern) */
  if (f > 0) {
    _deadColor.copy(e.baseColor).multiplyScalar(e.baseEmissive * fade);
    e.bodyMat.emissive.copy(_deadColor);
    e.glowMat.opacity = 0.85 * fade;
  }
  return true; // still dying
}
const ghostDrifts = new WeakMap<THREE.Group, GhostDrift>();
const GHOST_BANK = 0.05; // rad per unit of local speed
const GHOST_BANK_MAX = 0.3; // rad clamp
const GHOST_SMOOTH = 3.5; // banking approach rate (slower than combat = wispy)
function updateGhostDrift(e: Enemy, dt: number): { pitch: number; roll: number; bobY: number } {
  let d = ghostDrifts.get(e.group);
  if (!d) {
    const root = bodyRoots.get(e.group);
    d = {
      lx: Number.NaN,
      lz: Number.NaN,
      pitch: 0,
      roll: 0,
      yaw: 0,
      model: root && root.children.length > 0 ? root.children[0] : new THREE.Group()
    };
    ghostDrifts.set(e.group, d);
  }
  let fwd = 0,
    side = 0,
    spd = 0;
  if (Number.isFinite(d.lx) && dt > 0) {
    const vx = (e.x - d.lx) / dt,
      vz = (e.z - d.lz) / dt;
    spd = Math.hypot(vx, vz);
    /* world velocity → the foe's local frame (the group yaws to face the
    player; +Z local = facing) so the ghost banks toward where IT moves */
    const yaw = e.group.rotation.y;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    fwd = sy * vx + cy * vz;
    side = cy * vx - sy * vz;
  }
  d.lx = e.x;
  d.lz = e.z;
  const k = Math.min(1, dt * GHOST_SMOOTH);
  d.pitch += (clampf(fwd * GHOST_BANK, -GHOST_BANK_MAX, GHOST_BANK_MAX) - d.pitch) * k;
  d.roll += (clampf(-side * GHOST_BANK, -GHOST_BANK_MAX, GHOST_BANK_MAX) - d.roll) * k;
  /* idle yaw wander — a slow sway of the model itself, eased out by speed */
  const idleF = Math.max(0, 1 - spd / 1.2);
  d.yaw += (Math.sin(e.bobPhase * 0.35) * 0.14 * idleF - d.yaw) * k;
  d.model.rotation.y = d.yaw;
  /* ground wraiths float; flyers bob at the group level already */
  const bobY = e.flying ? 0 : 0.14 + Math.sin(e.bobPhase * 0.8) * 0.1;
  return {
    pitch: d.pitch,
    roll: d.roll,
    bobY
  };
}
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
  return {
    lift,
    sy,
    sxz
  };
}
export const MODEL_FIT: Record<ModelKind, number> = {
  mage: 2.3 / 2.655,
  staff: 1,
  imp: 1.7 / 1.68,
  puglin: 1.73 / 0.93,
  slime: 1.1 / 1.948,
  ghost: 1.49 / 0.89,
  plant: 1.71 / 0.92,
  skeleton: 1.9 / 2.59,
  skeletonmage: 1.9 / 2.63,
  /* 10-c terrain decor: gameplay scale is ALREADY BAKED into the GLBs — these
  *  are never enemy bodies; identity so a stray clone renders 1:1. */
  "terrain-tomb": 1,
  "terrain-tomb-round": 1,
  "terrain-tomb-broken": 1,
  "terrain-cross": 1,
  "terrain-tree": 1,
  "terrain-fence": 1,
  "terrain-crypt": 1,
  "terrain-sarcophagus": 1,
  "terrain-pillar": 1,
  "terrain-lantern": 1
};
/* Health-bar height per model kind (group-local, before enemy scale). */
const MODEL_HPBAR_Y: Partial<Record<ModelKind, number>> = {
  imp: 2.15,
  puglin: 2.1,
  slime: 1.5,
  ghost: 1.77,
  plant: 2.12,
  skeleton: 2.35,
  skeletonmage: 2.35
};
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
  bodyMat: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshBasicMaterial;
  /** Acquired itch.io model kind used for the body (null = procedural kit). */
  modelKind: ModelKind | null;
}

export function buildEnemyBody(def: EnemyDef, colorHex: number, elite: EliteAffix | null, isBoss: boolean, assets?: AssetSystem | null): EnemyBody {
  const group = new THREE.Group();
  /* body root — the transform layer the anticipation coil drives (audit
   P2-8). The acquired model AND the procedural kit parts live inside it;
   floor-pinned discs, elite ring, health bar and orbiting boss halos stay
   on the group so they never coil/lean with the body. */
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);
  bodyRoots.set(group, bodyRoot);
  const baseColor = new THREE.Color(colorHex);
  /* fog:false — foes must NEVER wash out against biome fog: the floor and
   pillars dissolve into the void for atmosphere, enemies stay crisp and
   readable at every distance (Hades-style combat clarity). */
  let bodyMat!: THREE.MeshStandardMaterial;
  let glowMat: THREE.MeshBasicMaterial;
  let modelKind: ModelKind | null = null;
  /* --- acquired itch.io model path (docs/AUDITS.md) — clone the template,
   normalize its height to the gameplay footprint, tint + glow via ONE cloned
   material shared by every mesh of the clone (geometry/textures stay shared). --- */
  const wantKind = assets?.modelFor(def, isBoss) ?? null;
  if (wantKind && assets) {
    const model = assets.spawnModel(wantKind);
    const tintMat = model ? assets.clonePrimaryMat(wantKind, baseColor, MODEL_EMISSIVE) : null;
    if (model && tintMat) {
      if (wantKind === "ghost") {
        tintMat.transparent = true;
        tintMat.opacity = 0.88;
      }
      model.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = tintMat;
      });
      model.scale.setScalar(MODEL_FIT[wantKind]);
      bodyRoot.add(model);
      foeKinds.set(group, wantKind);
      /* clip-driven foes: KayKit-bank sharers + per-model embedded clip sets
      (FOE_CLIP_PLANS, audit P2-8 / task 9-e) — every other rig keeps its
      procedural motion by design. 10-d: bosses get the BOSS_CLIP_PLANS
      override and the combo offset seeds from the id this foe will
      receive (nextId is read BEFORE spawn() assigns it — deterministic). */
      if (FOE_CLIP_PLANS[wantKind] || BOSS_CLIP_PLANS[wantKind]) {
        setupFoeAnim(group, model, wantKind, assets, isBoss, nextId);
      }
      bodyMat = tintMat;
      modelKind = wantKind;
    }
  }
  if (!modelKind) {
    bodyMat = new THREE.MeshStandardMaterial({
      color: baseColor.clone(),
      roughness: 0.55,
      metalness: 0.15,
      flatShading: true,
      emissive: baseColor.clone().multiplyScalar(0.85),
      transparent: def.body === "wraith",
      opacity: def.body === "wraith" ? 0.85 : 1,
      fog: false
    });
  }
  glowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  const add = (mesh: THREE.Mesh, y: number): THREE.Mesh => {
    mesh.position.y = y;
    bodyRoot.add(mesh);
    return mesh;
  };
  const part = (key: string, make: () => THREE.BufferGeometry): THREE.Mesh => new THREE.Mesh(geo(key, make), bodyMat);
  const glowPart = (key: string, make: () => THREE.BufferGeometry): THREE.Mesh => new THREE.Mesh(geo(key, make), glowMat);
  if (!modelKind) switch (def.body) {
    case "imp":
      {
        add(part("imp-body", () => new THREE.IcosahedronGeometry(0.5, 0)), 0.62);
        for (const side of [1, -1]) {
          const h1 = add(part("imp-horn", () => new THREE.ConeGeometry(0.075, 0.24, 5)), 1.0);
          h1.position.x = 0.19 * side;
          h1.rotation.z = -0.55 * side;
          const h2 = add(part("imp-horn-tip", () => new THREE.ConeGeometry(0.045, 0.2, 5)), 1.16);
          h2.position.x = 0.3 * side;
          h2.rotation.z = -1.05 * side;
          const eye = add(glowPart("imp-eye", () => new THREE.OctahedronGeometry(0.07, 0)), 0.72);
          eye.position.x = 0.16 * side;
          eye.position.z = 0.42;
        }
        break;
      }
    case "brute":
      {
        add(part("brute-body", () => new THREE.BoxGeometry(1.15, 1.3, 0.85)), 1.0);
        for (const side of [1, -1]) {
          const s = add(part("brute-shoulder", () => new THREE.BoxGeometry(0.42, 0.42, 0.5)), 1.5);
          s.position.x = 0.72 * side;
          const f = add(part("brute-fist", () => new THREE.BoxGeometry(0.34, 0.34, 0.34)), 1.05);
          f.position.x = 0.78 * side;
          f.position.z = 0.35;
        }
        add(part("brute-head", () => new THREE.BoxGeometry(0.42, 0.36, 0.42)), 1.78);
        for (let i = 0; i < 3; i++) {
          const sp = add(part("brute-spike", () => new THREE.ConeGeometry(0.12, 0.4, 5)), 1.75);
          sp.position.x = (i - 1) * 0.34;
          sp.position.z = -0.48;
          sp.rotation.x = -0.55;
        }
        const visor = add(glowPart("brute-visor", () => new THREE.BoxGeometry(0.3, 0.07, 0.06)), 1.8);
        visor.position.z = 0.23;
        add(glowPart("brute-core", () => new THREE.OctahedronGeometry(0.14, 0)), 1.1).position.z = 0.45;
        break;
      }
    case "wraith":
      {
        /* hooded ghost — robe wide at the hem, tapering up to the head */add(part("wraith-body", () => new THREE.ConeGeometry(0.5, 1.5, 8, 1, true)), 0.85);
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * Math.PI * 2;
          const t = add(part("wraith-tatter", () => new THREE.ConeGeometry(0.09, 0.34, 4)), 0.28);
          t.position.x = Math.cos(a) * 0.42;
          t.position.z = Math.sin(a) * 0.42;
        }
        add(part("wraith-head", () => new THREE.SphereGeometry(0.3, 10, 8)), 1.68);
        const hood = add(part("wraith-hood", () => new THREE.ConeGeometry(0.24, 0.42, 6)), 1.95);
        hood.rotation.x = -0.25;
        for (const side of [1, -1]) {
          const claw = add(part("wraith-claw", () => new THREE.ConeGeometry(0.07, 0.5, 5)), 1.1);
          claw.position.x = 0.5 * side;
          claw.position.z = 0.18;
          claw.rotation.z = -0.9 * side;
          claw.rotation.x = 0.5;
          const eye = add(glowPart("wraith-eye", () => new THREE.OctahedronGeometry(0.06, 0)), 1.7);
          eye.position.x = 0.11 * side;
          eye.position.z = 0.27;
        }
        break;
      }
    case "orb":
      {
        add(part("orb-body", () => new THREE.SphereGeometry(0.55, 12, 9)), 0.85);
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          const s = add(part("orb-spike", () => new THREE.TetrahedronGeometry(0.2)), 0.85);
          s.position.x = Math.cos(a) * 0.6;
          s.position.z = Math.sin(a) * 0.6;
          s.rotation.set(a, a * 1.3, 0);
        }
        add(glowPart("orb-eye", () => new THREE.OctahedronGeometry(0.15, 0)), 0.9).position.z = 0.48;
        const fuse = add(glowPart("orb-fuse", () => new THREE.ConeGeometry(0.09, 0.3, 5)), 1.48);
        fuse.rotation.x = -0.15;
        break;
      }
    case "knight":
      {
        add(part("knight-body", () => new THREE.BoxGeometry(0.62, 0.85, 0.42)), 0.95);
        add(part("knight-helm", () => new THREE.BoxGeometry(0.4, 0.34, 0.44)), 1.55);
        const plume = add(part("knight-plume", () => new THREE.ConeGeometry(0.08, 0.36, 5)), 1.88);
        plume.rotation.x = -0.35;
        const shield = add(part("knight-shield", () => new THREE.BoxGeometry(0.72, 1.0, 0.1)), 1.0);
        shield.position.z = 0.38;
        add(glowPart("knight-boss", () => new THREE.OctahedronGeometry(0.1, 0)), 1.0).position.z = 0.46;
        const blade = add(part("knight-blade", () => new THREE.BoxGeometry(0.09, 0.95, 0.16)), 1.05);
        blade.position.x = 0.52;
        blade.position.z = 0.28;
        blade.rotation.x = 0.35;
        blade.rotation.z = -0.15;
        for (const side of [1, -1]) {
          const p = add(part("knight-pauldron", () => new THREE.BoxGeometry(0.26, 0.18, 0.34)), 1.42);
          p.position.x = 0.42 * side;
        }
        const visor = add(glowPart("knight-visor", () => new THREE.BoxGeometry(0.26, 0.06, 0.05)), 1.58);
        visor.position.z = 0.24;
        break;
      }
    case "caster":
      {
        add(part("caster-robe", () => new THREE.ConeGeometry(0.48, 1.5, 9)), 0.75);
        add(part("caster-head", () => new THREE.SphereGeometry(0.22, 10, 8)), 1.62);
        const hood = add(part("caster-hood", () => new THREE.ConeGeometry(0.3, 0.44, 7)), 1.86);
        hood.rotation.x = -0.22;
        const orb = add(glowPart("caster-orb", () => new THREE.IcosahedronGeometry(0.17, 0)), 1.4);
        orb.position.z = 0.5;
        for (const side of [1, -1]) {
          const crystal = add(glowPart("caster-crystal", () => new THREE.TetrahedronGeometry(0.09)), 1.5);
          crystal.position.x = 0.4 * side;
          const eye = add(glowPart("caster-eye", () => new THREE.OctahedronGeometry(0.05, 0)), 1.64);
          eye.position.x = 0.08 * side;
          eye.position.z = 0.2;
        }
        break;
      }
    case "swarmlet":
      {
        add(part("swarm-body", () => new THREE.OctahedronGeometry(0.32, 0)), 0.7);
        for (const side of [1, -1]) {
          const w = add(part("swarm-wing", () => new THREE.BoxGeometry(0.34, 0.04, 0.16)), 0.82);
          w.position.x = 0.34 * side;
          w.rotation.z = 0.5 * side;
        }
        add(glowPart("swarm-core", () => new THREE.TetrahedronGeometry(0.13)), 0.7).position.z = 0.3;
        const sting = add(part("swarm-sting", () => new THREE.ConeGeometry(0.06, 0.26, 4)), 0.66);
        sting.rotation.x = Math.PI / 2;
        sting.position.z = 0.42;
        break;
      }
  }
  /* tyrant regalia — a distinct larger silhouette per boss on top of the kit
   (generic crown fallback keeps unknown bosses covered) */
  if (isBoss) {
    let spinner: THREE.Group | null = null;
    switch (def.name) {
      case "Grimm":
        {
          /* the Maw — sweeping two-part crown horns + brow spikes
          (Y retuned ×0.823 with the 9-e puglin fit calibration) */
          for (const side of [1, -1]) {
            const h1 = add(part("boss-horn-a", () => new THREE.ConeGeometry(0.14, 0.5, 6)), 1.65);
            h1.position.x = 0.3 * side;
            h1.rotation.z = -0.7 * side;
            const h2 = add(part("boss-horn-b", () => new THREE.ConeGeometry(0.09, 0.42, 6)), 1.88);
            h2.position.x = 0.55 * side;
            h2.rotation.z = -1.35 * side;
            const brow = add(part("boss-brow", () => new THREE.ConeGeometry(0.08, 0.28, 5)), 1.6);
            brow.position.x = 0.18 * side;
            brow.position.z = 0.26;
            brow.rotation.x = 0.5;
          }
          break;
        }
      case "Cinder":
        {
          /* the Pyre — furnace core + ember chimney stack
          (Y retuned ×0.823 with the 9-e puglin fit calibration) */
          add(glowPart("boss-furnace", () => new THREE.OctahedronGeometry(0.22, 1)), 1.11).position.z = 0.5;
          for (let i = 0; i < 3; i++) {
            const x = (i - 1) * 0.4;
            const ch = add(part("boss-chimney", () => new THREE.CylinderGeometry(0.09, 0.13, 0.5, 6, 1, true)), 1.69);
            ch.position.x = x;
            ch.position.z = -0.5;
            const ember = add(glowPart("boss-ember", () => new THREE.OctahedronGeometry(0.07, 0)), 1.94);
            ember.position.x = x;
            ember.position.z = -0.5;
          }
          break;
        }
      case "Sable":
        {
          /* the Dancer — orbiting blade halo */spinner = new THREE.Group();
          for (let i = 0; i < 6; i++) {
            const a = i / 6 * Math.PI * 2;
            const blade = new THREE.Mesh(geo("boss-blade", () => new THREE.BoxGeometry(0.08, 0.72, 0.2)), bodyMat);
            blade.position.set(Math.cos(a) * 1.05, 1.25, Math.sin(a) * 1.05);
            blade.rotation.y = -a;
            spinner.add(blade);
          }
          group.add(spinner);
          break;
        }
      case "Dusk":
        {
          /* the Hollow — eye cluster + orbiting shard ring */for (let i = 0; i < 3; i++) {
            const eye = add(glowPart("boss-eye", () => new THREE.OctahedronGeometry(0.09, 0)), 0.95);
            eye.position.x = (i - 1) * 0.16;
            eye.position.z = 0.5;
          }
          spinner = new THREE.Group();
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2;
            const shard = new THREE.Mesh(geo("boss-shard", () => new THREE.TetrahedronGeometry(0.16)), glowMat);
            shard.position.set(Math.cos(a) * 0.95, 1.0 + Math.sin(a * 2) * 0.25, Math.sin(a) * 0.95);
            spinner.add(shard);
          }
          group.add(spinner);
          break;
        }
      case "Vex":
        {
          /* the Sunder — storm spike crown + orbiting shards
          (Y retuned ×0.708 with the 9-e ghost fit calibration) */
          for (let i = 0; i < 3; i++) {
            const spike = add(part("boss-stormspike", () => new THREE.ConeGeometry(0.11, 0.66, 5)), 1.63);
            spike.position.x = (i - 1) * 0.3;
          }
          spinner = new THREE.Group();
          for (let i = 0; i < 4; i++) {
            const a = i / 4 * Math.PI * 2 + Math.PI / 4;
            const shard = new THREE.Mesh(geo("boss-shard", () => new THREE.TetrahedronGeometry(0.15)), glowMat);
            shard.position.set(Math.cos(a) * 1.15, 1.2, Math.sin(a) * 1.15);
            spinner.add(shard);
          }
          group.add(spinner);
          break;
        }
      default:
        {
          const crownG = geo("boss-crown", () => new THREE.ConeGeometry(0.12, 0.5, 4));
          for (let i = 0; i < 5; i++) {
            const c = new THREE.Mesh(crownG, glowMat);
            const a = i / 5 * Math.PI * 2;
            c.position.set(Math.cos(a) * 0.28, 2.05, Math.sin(a) * 0.28);
            group.add(c);
          }
          break;
        }
    }
    if (spinner) spinners.set(group, spinner);
  }
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
    bar.position.y = (modelKind && MODEL_HPBAR_Y[modelKind]) ?? 2.45;
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
    bodyMat,
    glowMat,
    modelKind
  };
}
function enemyBaseScale(e: Enemy): number {
  if (e.boss) return e.boss.def.radius / 0.6;
  return e.def.radius / 0.6 * (e.elite ? 1.12 : 1);
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
    disposeFoeAnim(e.group); // mixer teardown before material disposal (audit P2-8)
    e.bodyMat.dispose();
    e.glowMat.dispose();
    e.group.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const m = o.material;
        if (m instanceof THREE.Material && m !== e.bodyMat && m !== e.glowMat) m.dispose();
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
      bodyMat: body.bodyMat,
      glowMat: body.glowMat,
      baseColor: new THREE.Color(colorHex),
      baseEmissive: body.modelKind ? MODEL_EMISSIVE : 0.85,
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
    const body = buildEnemyBody(fakeDef, hexNum(def.color), null, true, this.assets);
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
      bodyMat: body.bodyMat,
      glowMat: body.glowMat,
      baseColor: new THREE.Color(def.color),
      baseEmissive: body.modelKind ? MODEL_EMISSIVE : 0.85,
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
        const anim = foeAnims.get(e.group);
        if (anim?.attack && anim.current !== "attack") foeAttackWindup(anim, FOE_MELEE_LEAD);
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
    /* face the player */
    const target = Math.atan2(player.x - e.x, player.z - e.z);
    let diff = target - e.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    e.group.rotation.y += diff * Math.min(1, dt * 10);
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
    const em = e.baseEmissive + e.hitFlash * 2.2 + tellGlow * 1.7;
    e.bodyMat.emissive.copy(e.baseColor).multiplyScalar(em);
    /* ghost opacity breathes (9-e): each ghost clone owns its tint material,
    so the pulse cannot leak to other foes; hit/tell glows stay readable
    through it (emissive is opacity-independent) */
    if (mk === "ghost" && e.bodyMat.transparent) {
      e.bodyMat.opacity = 0.84 + 0.07 * Math.sin(e.bobPhase * 0.9);
    }
    /* phase-2 enrage surge: the body flashes crimson for ~1s after the flip */
    if (e.boss) {
      const enr = enrageT.get(e.boss);
      if (enr !== undefined) {
        const left = enr - dt;
        if (left <= 0) enrageT.delete(e.boss);else {
          enrageT.set(e.boss, left);
          const pulse = 0.5 + 0.5 * Math.sin((1 - left) * 18);
          e.bodyMat.emissive.lerp(CRIMSON, 0.35 + 0.5 * pulse);
        }
      }
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
      if (mk === "ghost") {
        const g = updateGhostDrift(e, dt);
        lean += g.pitch;
        rollZ = g.roll;
        liftY = g.bobY;
      } else if (mk === "slime" && !e.flying) {
        const h = updateSlimeHop(e, dt);
        liftY = h.lift;
        sy = h.sy;
        sxz = h.sxz;
      } else if (mk === "plant" && !foeAnims.has(e.group)) {
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
    /* clip-driven foes: advance the clip stack — locomotion blended by the
    ACTUAL speed the AI produced (u = spd / worldH for the 4-gait models,
    ratio for the legacy KayKit pair), attack wind-ups keyed to the tell,
    hit one-shot on fresh damage (audit P2-8: visuals mirror the sim,
    they never drive it) */
    const anim = foeAnims.get(e.group);
    if (anim) updateFoeAnim(anim, e, dt);
    /* vitals bar — visible once the foe has taken a hit (elites always).
    The body group YAWS to face the player, which would swing the bar
    edge-on to the camera; cancel the yaw, then re-apply the fixed tilt
    so the bar always reads flat toward the eye. */
    const hb = healthBars.get(e.group);
    if (hb) {
      hb.bar.rotation.set(0, -e.group.rotation.y, 0);
      hb.bar.rotateX(HPBAR_TILT);
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
      ctx.vfx.ring(new THREE.Vector3(e.x, 0, e.z), 0xffffff, 17, {
        life: 0.55
      });
      ctx.vfx.ring(new THREE.Vector3(e.x, 0, e.z), 0x43e8d8, 11, {
        life: 0.75
      });
      ctx.vfx.ring(new THREE.Vector3(e.x, 0, e.z), color, 12);
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
    const volleyFan = (count, spreadDeg, speed, dmgFrac) => {
      const baseA = Math.atan2(player.x - e.x, player.z - e.z);
      for (let i = 0; i < count; i++) {
        const off = (i / Math.max(1, count - 1) - 0.5) * (spreadDeg * Math.PI / 180);
        const a = baseA + off;
        ctx.spawnEnemyBolt(e.x, 1.8, e.z, e.x + Math.sin(a) * 30, e.z + Math.cos(a) * 30, speed, e.dmg * dmgFrac, color, 0.42);
      }
      ctx.vfx.muzzleFlash(new THREE.Vector3(e.x, 1.9, e.z), color); // release flash
      ctx.sfx.play("volley", {
        intensity: 0.9
      });
    };
    const spiralArm = (armCount, rotSpeed, interval) => {
      b.volleyT -= dt;
      b.angle += rotSpeed * dt;
      if (b.volleyT <= 0) {
        b.volleyT = interval;
        for (let arm = 0; arm < armCount; arm++) {
          const a = b.angle + arm / armCount * Math.PI * 2;
          ctx.spawnEnemyBolt(e.x, 1.8, e.z, e.x + Math.sin(a) * 30, e.z + Math.cos(a) * 30, 9.5, e.dmg * 0.32, color, 0.4);
        }
      }
    };
    /* state transition helper — `tellDur` fires the pre-fire tell the moment
    a windup state begins; b.ringR doubles as the per-visit "already told"
    marker for in-state entry tells (fortress/storm) and is cleared here so
    every visit re-arms it. */
    const go = (state, stateT = 0, tellDur = 0) => {
      b.state = state;
      b.stateT = stateT;
      b.flag = false;
      b.ringR = 0;
      if (tellDur > 0) tellFire(e, ctx, tellDur);
    };
    switch (b.brain) {
      /* ---- Malgrym, the Maw of Ruin: stampede charger ---- */case "charger":
        {
          if (b.state === 0) {
            e.x += nx * spd * dt;
            e.z += nz * spd * dt;
            if (b.stateT > 1.5) {
              b.cycle = 0;
              go(1, 0, 0.35);
            }
          } else if (b.state === 1) {
            if (b.stateT > 0.35) {
              volleyFan(b.phase === 2 ? 7 : 5, 52, 11, 0.3);
              go(2);
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
              go(3);
            }
          } else if (b.state === 3) {
            /* F-03: the tyrant stampede rides the global locomotion scale
            (dash speed is an intended movement path, not a projectile) */
            const dashSpd = (24 + (b.phase === 2 ? 4 : 0)) * FOE_MOVE_SPEED_SCALE;
            e.x += b.lockedDx * dashSpd * dt;
            e.z += b.lockedDz * dashSpd * dt;
            if (Math.random() < dt * 14) ctx.vfx.muzzleFlash(new THREE.Vector3(e.x, 0.5, e.z), color);
            const d = Math.hypot(e.x, e.z);
            if (b.stateT > 0.55 || d > ctx.arenaRadius - e.radius - 0.3) {
              b.cycle++;
              if (b.cycle < (b.phase === 2 ? 4 : 3)) go(2, 0.35); // short re-aim
              else {
                ctx.shake(0.35);
                go(4);
              }
            }
          } else if (b.stateT > 1.3) {
            go(0);
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
              go(1, 0, 0.5);
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
              go(0);
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
            volley — go() clears it on the lunge transition) */
            b.volleyT -= dt;
            if (!b.flag && b.volleyT <= 0.38) {
              b.flag = true;
              b.volleyT = Math.max(b.volleyT, 0.38);
              tellFire(e, ctx, 0.38);
            }
            if (b.volleyT <= 0) {
              b.volleyT = Math.max(1.1, 2.4 - b.stateT * 0.08);
              b.flag = false; // re-arm the next fan's tell
              volleyFan(b.phase === 2 ? 5 : 3, 34, 12.5, 0.26);
              b.cycle++;
              if (b.cycle % 3 === 0) {
                b.cycle = 0;
                go(1);
              }
            }
          } else if (b.state === 1) {
            e.hitFlash = Math.max(e.hitFlash, 0.5 + Math.sin(b.stateT * 30) * 0.3);
            if (b.stateT < 0.25) {
              b.lockedDx = nx;
              b.lockedDz = nz;
            }
            if (b.stateT > 0.4) go(2);
          } else if (b.state === 2) {
            /* F-03: lunge speed rides the global locomotion scale */
            e.x += b.lockedDx * 22 * FOE_MOVE_SPEED_SCALE * dt;
            e.z += b.lockedDz * 22 * FOE_MOVE_SPEED_SCALE * dt;
            if (Math.random() < dt * 16) ctx.vfx.muzzleFlash(new THREE.Vector3(e.x, 0.8, e.z), color);
            if (b.stateT > 0.5) {
              b.cycle++;
              if (b.cycle < (b.phase === 2 ? 3 : 2)) go(1, 0.15);else {
                b.volleyT = 1;
                go(0);
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
            per-visit marker go() clears; volleyT floored past the tell) */
            if (b.ringR === 0) {
              b.ringR = 1;
              b.volleyT = Math.max(b.volleyT, 0.42);
              tellFire(e, ctx, 0.4);
            }
            spiralArm(b.phase === 2 ? 3 : 2, b.phase === 2 ? 2.1 : 1.6, 0.24);
            if (b.stateT > (b.phase === 2 ? 3.2 : 4)) go(1);
          } else if (b.state === 1) {
            e.hitFlash = Math.max(e.hitFlash, 0.7);
            if (b.stateT > 0.55) {
              ctx.vfx.burst(new THREE.Vector3(e.x, 1.5, e.z), color, 20, {
                speed: 8
              });
              const a = ctx.rng.range(0, Math.PI * 2);
              const r = ctx.rng.range(5.5, 8.5);
              /* F-04: blink clamp derives from the canonical arena radius —
              no stale hard-coded 38 (old r=42 remnant) */
              const bR = Math.max(1, ctx.arenaRadius - e.radius - 2);
              e.x = Math.max(-bR, Math.min(bR, player.x + Math.cos(a) * r));
              e.z = Math.max(-bR, Math.min(bR, player.z + Math.sin(a) * r));
              ctx.vfx.burst(new THREE.Vector3(e.x, 1.5, e.z), color, 26, {
                speed: 9
              });
              ctx.spawnBossShockring(e.x, e.z, color, e.dmg * 0.7, 10);
              ctx.sfx.play("blink", {
                intensity: 1
              });
              ctx.shake(0.3);
              go(0);
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
              volleyFan(5, 46, 12, 0.26);
            }
            if (b.stateT > 0.9) go(1 + b.cycle % 3);
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
              go(0);
            }
          } else if (b.state === 2) {
            if (b.ringR === 0) {
              b.ringR = 1;
              b.volleyT = Math.max(b.volleyT, 0.36);
              tellFire(e, ctx, 0.35);
            }
            spiralArm(b.phase === 2 ? 4 : 3, 2.0, 0.2);
            if (b.stateT > 2.6) {
              b.cycle++;
              go(0);
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
              go(0);
            }
          }
          break;
        }
    }
  }
}