/* ARCHMAGE: RIFTBOUND (3D Edition) — shared simulation types.
   Binds entities.ts / spells.ts / engine.ts without import cycles:
   sim.ts → (three, content, types, vfx); entities/spells → sim; engine → all. */

import * as THREE from "three";
import type { RNG, EnemyType, EliteAffix, EnemyDef, BossDef } from "./content";
import type { VfxSystem } from "./vfx";
import type { SfxLike } from "./types";

/* ------------------------------- Player --------------------------------- */
export interface PlayerState {
  x: number;
  z: number;
  hp: number;
  hpMax: number;
  aether: number;
  aetherMax: number;
  aetherRegen: number; // per second
  speed: number; // world units / s
  surge: number; // 0..1 charge
  surgeActive: number; // seconds remaining (0 = off)
  surgeRateMult: number;
  blinkCd: number;
  blinkCdMax: number;
  iframe: number; // invulnerability seconds
  aimX: number; // world aim point
  aimZ: number;
  dmgMult: number;
  cdMult: number;
  resist: number; // 0..0.75
  volleyCount: number;
  volleyDmg: number;
  glyphMult: number;
  dead: boolean;
}

/* ------------------------------- Enemies -------------------------------- */
export interface BossState {
  def: BossDef;
  brain: string;
  state: number; // brain state machine index
  stateT: number; // seconds in state
  cycle: number; // attack cycle counter
  phase: 1 | 2;
  tx: number; // target/anchor x
  tz: number;
  angle: number; // spiral arm angle
  volleyT: number;
  minionT: number;
  ringR: number; // active shockwave radius
  ringHits: boolean[]; // player hit flags for rings
  lockedDx: number; // dash direction
  lockedDz: number;
  /** generic one-shot flag for the current state */
  flag: boolean;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  def: EnemyDef;
  hp: number;
  hpMax: number;
  dmg: number;
  spd: number;
  score: number;
  x: number;
  z: number;
  y: number; // height (flyers hover)
  vx: number; // knockback velocity
  vz: number;
  radius: number;
  elite: EliteAffix | null;
  flying: boolean;
  slowT: number; // seconds of slow remaining
  slowF: number; // slow factor (multiplier on speed, e.g. 0.45)
  burnT: number;
  burnDps: number;
  burnTick: number;
  burnColor: number;
  poisonT: number;
  poisonDps: number;
  poisonTick: number;
  shootCd: number;
  touchCd: number; // contact damage cooldown
  state: number; // generic AI state
  stateT: number;
  chargeDx: number;
  chargeDz: number;
  bobPhase: number;
  hitFlash: number;
  squash: number;
  spawnT: number; // spawn animation (0..1)
  dead: boolean;
  /* ---- F-02 audit (stall recovery) — movement-intent bookkeeping ----
   * Window-sampled progress detector: winT is the sample-window clock,
   * (stallRefX/Z) the window start, winCmd the commanded distance the brain
   * attempted this window. When commanded motion is repeatedly erased by
   * constraints (net ≪ commanded) the stall score rises; past the threshold
   * recoverT engages deterministic ±90° tangent steering with a sticky
   * stallSide so blocked ground foes route around obstacles instead of
   * grinding into them. Bosses/flyers do not participate. */
  winT: number;
  stallRefX: number;
  stallRefZ: number;
  winCmd: number;
  stallT: number;
  stallSide: number;
  recoverT: number;
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  baseEmissive: number;
  boss: BossState | null;
}

/* ------------------------------ Hazards --------------------------------- */
export type HazardKind = "ward" | "well" | "cloud" | "timefield" | "shockring" | "rift";

export interface Hazard {
  kind: HazardKind;
  x: number;
  z: number;
  y: number;
  radius: number;
  life: number; // remaining
  maxLife: number;
  friendly: boolean; // created by player
  group: THREE.Group;
  // ward
  dx?: number; // facing dir (normal of wall)
  dz?: number;
  // shockring (boss)
  ringSpeed?: number;
  ringR?: number;
  hitPlayer?: boolean;
  // well / cloud / timefield dps
  dps?: number;
  pull?: number;
  slowF?: number;
  // rift (boss gravity rift)
  pullPlayer?: number;
  armed?: boolean;
}

/* ----------------------------- Projectiles ------------------------------ */
export type ProjKind =
  | "orb" | "shard" | "seeker" | "javelin" | "crescent" | "pod"
  | "volley" | "ebolt" | "bossbolt";

export interface Projectile {
  kind: ProjKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  dmg: number;
  radius: number;
  color: number;
  fromPlayer: boolean;
  pierce: number; // remaining pierce count
  homing: number; // homing strength (0 = none)
  targetId: number; // enemy id for homing
  knock: number;
  slowF: number; // applied slow factor (1 = none)
  slowT: number;
  burnDps: number;
  burnT: number;
  explodeRadius: number; // 0 = no explosion
  element: string;
  mesh: THREE.Group;
  spinPhase: number;
  arcT: number; // pod arc param 0..1
  arcH: number;
  startX: number;
  startZ: number;
  targetX: number;
  targetZ: number;
  hitIds: Set<number>;
}

/* ------------------------------ Pickups --------------------------------- */
export interface Pickup {
  kind: "glyph" | "heart";
  x: number;
  z: number;
  y: number;
  life: number;
  vx: number;
  vz: number;
  value: number;
  group: THREE.Group;
  magnet: boolean;
}

/* ------------------------------ SimContext ------------------------------ */
export interface DamageOpts {
  crit?: boolean;
  color?: number;
  isSpell?: boolean;
  knock?: number;
  sourceX?: number;
  sourceZ?: number;
  noNumbers?: boolean;
}

export interface SimContext {
  scene: THREE.Scene;
  arenaRadius: number;
  time: number;
  wave: number;
  rng: RNG;
  player: PlayerState;
  enemies: Enemy[];
  hazards: Hazard[];
  vfx: VfxSystem;
  sfx: SfxLike;
  quality: number;
  damageNumbers: boolean;

  damagePlayer(amount: number, sourceX?: number, sourceZ?: number, cause?: string): void;
  damageEnemy(e: Enemy, amount: number, opts?: DamageOpts): void;
  killEnemy(e: Enemy, byPlayer: boolean): void;
  spawnEnemyBolt(x: number, y: number, z: number, tx: number, tz: number, speed: number, dmg: number, color: number, radius?: number): void;
  spawnMinion(type: EnemyType, x: number, z: number): void;
  addHazard(h: Hazard): void;
  spawnBossShockring(x: number, z: number, color: number, dmg: number, speed: number): void;
  spawnBossRift(x: number, z: number, color: number): void;
  shake(amount: number): void;
  hitStop(t: number): void;
  slowmo(t: number, factor: number): void;
  banner: (title: string, sub: string | null, color: string) => void;
  attunementMult: number;
  /** effective rift-mercy fraction 0..1 (softens foes) */
  mercyF: number;
}
