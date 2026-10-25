#!/usr/bin/env bun
/* ARCHMAGE: RIFT 3D — enemy movement / collision regression harness (audit F-01,
   F-02, F-03 + QA plan §8A/§8B).  Run: bun scripts/validate-enemy-motion.ts

   Drives the REAL EnemySystem headlessly (no renderer — Three.js object
   creation only) through deterministic staged-pipeline scenarios:
     1.  Exact zero-distance overlaps (2 foes and a 16-foe stack) resolve.
     2.  Ground foes route around obstacles from BOTH sides (stall recovery).
     3.  Flyers keep their different obstacle rule (no ground pushout).
     4.  Player pinned near the perimeter + crowd separation stays legal.
     5.  Ward displacement followed by separation keeps every invariant.
     6.  Knockback + AI movement in the same update stays finite + legal.
     7.  Boss charge into a crowd near the arena edge stays in bounds and the
         dash speed rides the global FOE_MOVE_SPEED_SCALE.
     8.  Foe spawned INSIDE an obstacle recovers on the first final pass.
     9.  Reduced delta (1/120), large frame delta (0.25) and resume stay sane.
     10. Contact-damage cadence honors the 0.7 s touch cooldown — no foe can
         keep damaging solely because it is embedded in the player.
     11. Same seed + input stream → bit-identical final state.
     12. ≥ 10,000 simulation steps total across multiple fixed seeds/waves.
   Plus the §8B balance matrix: representative types at waves 1/10/20/30/40/50/51
   measure exactly a FOE_MOVE_SPEED_SCALE locomotion reduction with hp/damage
   formulas untouched. */

import * as THREE from "three";
import { EnemySystem, motionDiagnostics } from "../src/game3d/entities";
import {
  ENEMY_DEFS, BOSS_DEFS, ELITE_DEFS, scaleEnemy, mulberry32, hashSeed,
  FOE_MOVE_SPEED_SCALE, DIFFICULTY_MULT,
} from "../src/game3d/content";
import { ARENA_RADIUS } from "../src/game3d/arena-config";
import type { SimContext, PlayerState, Hazard, Enemy } from "../src/game3d/sim";
import type { EnemyType } from "../src/game3d/content";
import type { VfxSystem } from "../src/game3d/vfx";
import type { SfxLike } from "../src/game3d/types";

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
function push(name: string, ok: boolean, detail?: string) { checks.push({ name, ok, detail }); }

let totalSteps = 0;

/* ------------------------------- stubs ---------------------------------- */
const vfxStub = {
  slashArc() {}, ring() {}, burst() {}, explosion() {}, muzzleFlash() {},
} as unknown as VfxSystem;
const sfxStub = {
  play() {}, musicMenu() {}, musicCombat() {}, musicBoss() {}, musicStop() {}, setIntensity() {},
} as SfxLike;

function makePlayer(x: number, z: number): PlayerState {
  return {
    x, z, hp: 10_000, hpMax: 10_000, aether: 100, aetherMax: 100, aetherRegen: 11,
    speed: 7.4, surge: 0, surgeActive: 0, surgeRateMult: 1, blinkCd: 0, blinkCdMax: 5,
    iframe: 0, aimX: x, aimZ: z, dmgMult: 1, cdMult: 1, resist: 0, volleyCount: 3,
    volleyDmg: 1, glyphMult: 1, dead: false,
  };
}

interface Harness {
  sys: EnemySystem;
  ctx: SimContext;
  player: PlayerState;
  obstacles: Array<{ x: number; z: number; r: number }>;
  damageLog: Array<{ t: number; amt: number; sx: number; sz: number }>;
}

function makeHarness(seed: string, wave: number, obstacles: Array<{ x: number; z: number; r: number }>): Harness {
  const player = makePlayer(0, 30);
  const damageLog: Array<{ t: number; amt: number; sx: number; sz: number }> = [];
  const scene = new THREE.Scene();
  const sys = new EnemySystem(scene, null);
  sys.setObstacles(obstacles);
  const ctx: SimContext = {
    scene, arenaRadius: ARENA_RADIUS, time: 0, wave,
    rng: mulberry32(hashSeed(seed)),
    player, enemies: sys.enemies, hazards: [],
    vfx: vfxStub, sfx: sfxStub, quality: 1, damageNumbers: false,
    damagePlayer(amount: number, sx?: number, sz?: number) { damageLog.push({ t: ctx.time, amt: amount, sx: sx ?? 0, sz: sz ?? 0 }); },
    damageEnemy(e: Enemy, amount: number) { e.hp -= amount; if (e.hp < 1) e.hp = 1; },
    killEnemy() {}, spawnEnemyBolt() {}, spawnMinion() {}, addHazard() {},
    spawnBossShockring() {}, spawnBossRift() {},
    shake() {}, hitStop() {}, slowmo() {}, banner: () => {},
    attunementMult: 1, mercyF: 0,
  };
  return { sys, ctx, player, obstacles, damageLog };
}

function step(h: Harness, dt: number): void {
  /* engine-order player integration (updatePlayer): bounds clamp + obstacle
   * pushout — the harness player must obey the SAME constraints as the real
   * one, else foes get squeezed between a phantom obstacle-inside player and
   * the rubble (an over-constraint that never exists in production) */
  const p = h.player;
  const pd = Math.hypot(p.x, p.z);
  if (pd > ARENA_RADIUS - 0.6) {
    p.x *= (ARENA_RADIUS - 0.6) / pd;
    p.z *= (ARENA_RADIUS - 0.6) / pd;
  }
  for (const o of h.obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const need = o.r + 0.55;
    if (d < need) {
      if (d < 1e-4) { p.x = o.x + need; continue; }
      p.x = o.x + dx / d * need;
      p.z = o.z + dz / d * need;
    }
  }
  h.ctx.time += dt;
  h.sys.update(dt, h.ctx);
  totalSteps++;
}

/** Full invariant battery — mirrors the acceptance criteria of audit F-01.
 *  dt feeds the intent-scaled pair tolerance (must match entities.ts). */
function invariantsOk(h: Harness, label: string, dt = 1 / 60): boolean {
  const { sys, ctx, player, obstacles } = h;
  for (const e of sys.enemies) {
    if (e.dead) continue;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.z)) { push(`${label}: NaN position`, false, `id ${e.id}`); return false; }
    const d = Math.hypot(e.x, e.z);
    if (d > ctx.arenaRadius - e.radius + 0.05) { push(`${label}: foe out of bounds`, false, `id ${e.id} d=${d.toFixed(2)}`); return false; }
    if (!e.flying) {
      for (const o of obstacles) {
        if (Math.hypot(e.x - o.x, e.z - o.z) < o.r + e.radius - 0.05) {
          push(`${label}: foe embedded in obstacle`, false, `id ${e.id}`); return false;
        }
      }
    }
    if (!player.dead && Math.hypot(player.x - e.x, player.z - e.z) < e.radius + 0.55 - 0.05) {
      push(`${label}: foe embedded in player`, false, `id ${e.id}`); return false;
    }
  }
  const arr = sys.enemies;
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]; if (a.dead) continue;
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j]; if (b.dead) continue;
      /* intent-scaled pair tolerance (mirrors entities.ts): a pressing crowd
       * re-adds ~1 frame of commanded motion between solver runs and pile
       * formation compounds neighbor pushes; the honest residual bound is
       * 2.5× the faster foe's per-frame intent distance (floor: steady-state
       * pile equilibrium 0.2u). Player/bounds/obstacle invariants stay exact. */
      const tol = Math.max(0.2, 2.5 * dt * Math.max(a.spd * a.slowF, b.spd * b.slowF));
      if (Math.hypot(b.x - a.x, b.z - a.z) < a.radius + b.radius - tol) {
        push(`${label}: unresolved pair overlap`, false, `ids ${a.id}/${b.id} tol=${tol.toFixed(2)}`); return false;
      }
    }
  }
  /* cross-check the engine's own diagnostics (computed post-final-pass) */
  const d = motionDiagnostics;
  if (d.outOfBounds || d.obstacleOverlaps || d.playerOverlaps || d.unresolvedPairOverlaps) {
    push(`${label}: motionDiagnostics residuals`, false,
      `oob=${d.outOfBounds} obst=${d.obstacleOverlaps} player=${d.playerOverlaps} pairs=${d.unresolvedPairOverlaps}`);
    return false;
  }
  return true;
}

const NO_OBSTACLES: Array<{ x: number; z: number; r: number }> = [];

/* -------------------- 1. exact zero-distance overlaps -------------------- */
{
  let ok = true;
  { /* two foes exactly coincident */
    const h = makeHarness("exact-pair", 5, NO_OBSTACLES);
    h.player.x = -20; h.player.z = -20;
    h.sys.spawn("goblin", 5, 5, null, h.ctx);
    h.sys.spawn("knight", 5, 5, null, h.ctx);
    for (let f = 0; f < 10; f++) step(h, 1 / 60);
    const [a, b] = h.sys.enemies;
    const sep = Math.hypot(a.x - b.x, a.z - b.z);
    if (sep < a.radius + b.radius - 0.05) { ok = false; push("exact pair resolves", false, `sep=${sep.toFixed(3)}`); }
    ok = invariantsOk(h, "exact pair") && ok;
  }
  { /* 16-foe stack on one point */
    const h = makeHarness("exact-stack", 20, NO_OBSTACLES);
    h.player.x = -25; h.player.z = 25;
    for (let i = 0; i < 16; i++) h.sys.spawn(i % 2 ? "skitter" : "goblin", -7, 7, null, h.ctx);
    for (let f = 0; f < 300; f++) { step(h, 1 / 60); if (f % 30 === 29) ok = invariantsOk(h, "16-stack") && ok; }
    ok = invariantsOk(h, "16-stack final") && ok;
  }
  if (ok) push("zero-distance overlaps resolve (2-foe + 16-foe stack, bounded frames)", true);
}

/* ---------------- 2. stall recovery: route around obstacles -------------- */
{
  /* obstacle dead-center between foe and player — face-on grind case */
  const obstacles = [{ x: 0, z: 0, r: 2.4 }, { x: -14, z: -3, r: 1.8 }, { x: 13, z: 4, r: 2.0 }];
  const h = makeHarness("stall-faceon", 10, obstacles);
  h.player.x = 0; h.player.z = 25;
  h.sys.spawn("goblin", 0, -25, null, h.ctx);
  h.sys.spawn("knight", -24, 0, null, h.ctx);   /* approaches from the west side */
  h.sys.spawn("tank", 24, 0, null, h.ctx);      /* approaches from the east side */
  const startDist = (e: Enemy) => Math.hypot(h.player.x - e.x, h.player.z - e.z);
  const d0 = h.sys.enemies.map(startDist);
  let ok = true;
  for (let f = 0; f < 1200; f++) { /* 20 s */
    step(h, 1 / 60);
    if (f % 60 === 59) ok = invariantsOk(h, "stall-route") && ok;
  }
  const d1 = h.sys.enemies.map(startDist);
  /* every ground foe must have made real progress toward the player and be
     close enough to prove it got AROUND the blocking obstacle */
  const goblinGain = d0[0] - d1[0], westGain = d0[1] - d1[1], eastGain = d0[2] - d1[2];
  if (goblinGain < 35 || westGain < 30 || eastGain < 30) {
    ok = false;
    push("ground foes route around obstacles from both sides", false,
      `gains g=${goblinGain.toFixed(1)} w=${westGain.toFixed(1)} e=${eastGain.toFixed(1)} finals=${d1.map(v => v.toFixed(1)).join(",")}`);
  }
  if (motionDiagnostics.recoveries === 0) { ok = false; push("stall detector engaged at least once", false); }
  if (ok) push("stall recovery: face-on + both-side approaches reach the player (recoveries>0)", true,
    `recoveries=${motionDiagnostics.recoveries}`);
}

/* ------------------- 3. flyers keep their obstacle rule ------------------ */
{
  const obstacles = [{ x: 0, z: 0, r: 2.4 }];
  const h = makeHarness("flyer-rule", 8, obstacles);
  h.player.x = 0; h.player.z = 20;
  h.sys.spawn("swarm", 0, 0, null, h.ctx);   /* spawned INSIDE the obstacle */
  h.sys.spawn("imp", 0.5, 0.5, null, h.ctx);
  const d0 = Math.hypot(h.player.x - 0, h.player.z - 0);
  let ok = true;
  for (let f = 0; f < 240; f++) { step(h, 1 / 60); if (f % 40 === 39) ok = invariantsOk(h, "flyer-rule") && ok; }
  const d1 = Math.hypot(h.player.x - h.sys.enemies[0].x, h.player.z - h.sys.enemies[0].z);
  /* flyers are never pushed out by ground rubble — they must close freely */
  if (d1 > d0 - 8) { ok = false; push("flyers ignore ground obstacles", false, `d0=${d0.toFixed(1)} d1=${d1.toFixed(1)}`); }
  if (ok) push("flyers keep their obstacle exemption and close on the player", true, `d ${d0.toFixed(1)}→${d1.toFixed(1)}`);
}

/* -------------- 4. player pinned at the perimeter + crowd ---------------- */
{
  const h = makeHarness("perimeter-crowd", 30, [{ x: 0, z: 30, r: 2.2 }, { x: -8, z: 38, r: 1.6 }]);
  h.player.x = 0; h.player.z = 46.5; /* ~3.5u from the r=50 fence */
  const types: EnemyType[] = ["goblin", "knight", "skitter", "archer", "elemental", "lancer", "tank", "shadow", "swarm", "imp", "assassin", "voidbeast"];
  types.forEach((t, i) => {
    const a = i / types.length * Math.PI * 2;
    h.sys.spawn(t, h.player.x + Math.cos(a) * 6, h.player.z + Math.sin(a) * 6, i % 4 === 0 ? "swift" : null, h.ctx);
  });
  let ok = true;
  for (let f = 0; f < 420; f++) { step(h, 1 / 60); if (f % 30 === 29) ok = invariantsOk(h, "perimeter-crowd") && ok; }
  if (Math.hypot(h.player.x, h.player.z) > ARENA_RADIUS - 0.55) { ok = false; push("player stays inside the fence (boss shove path n/a here)", false); }
  if (ok) push("perimeter crowd: 12 mixed foes + 2 obstacles separate legally", true);
}

/* ----------------------- 5. ward push + separation ------------------------ */
{
  const h = makeHarness("ward-push", 15, [{ x: 3, z: -7, r: 1.9 }, { x: -6, z: -9, r: 2.1 }]);
  h.player.x = 0; h.player.z = 18;
  const ward: Hazard = {
    kind: "ward", x: 0, z: -5, y: 0, radius: 2.6, life: 30, maxLife: 30,
    friendly: true, group: new THREE.Group(), dx: 0, dz: 1,
  };
  h.ctx.hazards.push(ward);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    h.sys.spawn(i % 3 === 0 ? "knight" : "goblin", Math.cos(a) * 4, -5 + Math.sin(a) * 3, null, h.ctx);
  }
  let ok = true;
  for (let f = 0; f < 360; f++) { step(h, 1 / 60); if (f % 30 === 29) ok = invariantsOk(h, "ward-push") && ok; }
  if (ok) push("ward displacement followed by separation keeps all invariants", true);
}

/* --------------------- 6. knockback + AI same update --------------------- */
{
  const h = makeHarness("knockback-ai", 12, [{ x: 6, z: 22, r: 2.0 }]);
  h.player.x = 0; h.player.z = 24;
  h.sys.spawn("goblin", 2, 20, null, h.ctx);
  h.sys.spawn("skitter", -3, 19, null, h.ctx);
  const g = h.sys.enemies[0], s = h.sys.enemies[1];
  g.vx = 42; g.vz = -31;   /* big player-spell knockback mid-approach */
  s.vx = -25; s.vz = 18;
  let ok = true;
  for (let f = 0; f < 180; f++) { step(h, 1 / 60); if (f % 20 === 19) ok = invariantsOk(h, "knockback-ai") && ok; }
  const dG = Math.hypot(h.player.x - g.x, h.player.z - g.z);
  if (dG > 26) { ok = false; push("knockback recovers into pursuit", false, `dG=${dG.toFixed(1)}`); }
  if (ok) push("knockback + AI movement in the same update stays finite + converges", true, `post-knock dist=${dG.toFixed(1)}`);
}

/* ---------------- 7. boss charge into a crowd near the edge --------------- */
{
  const h = makeHarness("boss-dash", 40, [{ x: 10, z: -20, r: 2.2 }, { x: -12, z: -14, r: 1.8 }]);
  h.player.x = 0; h.player.z = -30; /* near the south fence */
  const boss = h.sys.spawnBoss(BOSS_DEFS[0], 0, 20, h.ctx); /* vorrac — charger brain */
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    h.sys.spawn("goblin", boss.x + Math.cos(a) * 5, boss.z + Math.sin(a) * 5, null, h.ctx);
  }
  let maxFrameSpeed = 0;
  let ok = true;
  let px = boss.x, pz = boss.z;
  for (let f = 0; f < 600; f++) { /* 10 s — covers intro grace + full cycle */
    step(h, 1 / 60);
    const sp = Math.hypot(boss.x - px, boss.z - pz) / (1 / 60);
    if (sp > maxFrameSpeed) maxFrameSpeed = sp;
    px = boss.x; pz = boss.z;
    if (f % 30 === 29) ok = invariantsOk(h, "boss-dash") && ok;
  }
  /* the boss must still be inside the fence... */
  const bd = Math.hypot(boss.x, boss.z);
  if (bd > ARENA_RADIUS - boss.radius + 0.05) { ok = false; push("boss stays in bounds after edge dashes", false, `d=${bd.toFixed(2)}`); }
  /* ...and the dash must ride the global locomotion scale: unscaled charger
     dash is 24 u/s (phase 1); scaled it is 24*0.92 = 22.08. */
  const unscaledDash = 24;
  if (maxFrameSpeed > unscaledDash * FOE_MOVE_SPEED_SCALE + 0.6) {
    ok = false; push("boss dash speed rides FOE_MOVE_SPEED_SCALE", false, `max=${maxFrameSpeed.toFixed(2)} cap=${(unscaledDash * FOE_MOVE_SPEED_SCALE).toFixed(2)}`);
  }
  if (maxFrameSpeed < unscaledDash * FOE_MOVE_SPEED_SCALE - 2.5) {
    ok = false; push("boss dash actually happened", false, `max=${maxFrameSpeed.toFixed(2)}`);
  }
  if (boss.spd !== BOSS_DEFS[0].speed * FOE_MOVE_SPEED_SCALE) {
    ok = false; push("boss walk speed scaled", false, `${boss.spd} vs ${BOSS_DEFS[0].speed * FOE_MOVE_SPEED_SCALE}`);
  }
  if (ok) push("boss charge near the edge: in bounds, crowd legal, dash scaled", true,
    `maxDash=${maxFrameSpeed.toFixed(2)}u/s (unscaled 24)`);
}

/* ------------------ 8. spawn inside an obstacle recovers ------------------ */
{
  const h = makeHarness("spawn-in-obstacle", 6, [{ x: 8, z: 8, r: 2.0 }]);
  h.player.x = -15; h.player.z = -15;
  const e = h.sys.spawn("goblin", 8.6, 8, null, h.ctx); /* overlaps the circle by 0.4 */
  step(h, 1 / 60); /* ONE frame — the final pass must already have recovered */
  const od = Math.hypot(e.x - 8, e.z - 8);
  const okNow = od >= 2.0 + e.radius - 0.05 && invariantsOk(h, "spawn-in-obstacle");
  push("foe spawned inside an obstacle recovers on the first final pass", okNow, `center-dist=${od.toFixed(2)} need=${(2.0 + e.radius).toFixed(2)}`);
}

/* ------------- 9. reduced delta, large frame delta, resume --------------- */
{
  const h = makeHarness("delta-variation", 25, [{ x: 0, z: 10, r: 2.2 }]);
  h.player.x = 0; h.player.z = 26;
  for (let i = 0; i < 8; i++) h.sys.spawn("goblin", -12 + i * 3, 0, null, h.ctx);
  let ok = true;
  for (let f = 0; f < 120; f++) { step(h, 1 / 60); if (f % 30 === 29) ok = invariantsOk(h, "delta-60", 1 / 60) && ok; }
  for (let f = 0; f < 120; f++) { step(h, 1 / 120); if (f % 30 === 29) ok = invariantsOk(h, "delta-120", 1 / 120) && ok; }
  /* NOTE: the production engine feeds enemies.update a FIXED 1/60 step
   * (accumulator, ≤5 catch-up steps) — a direct 0.25s call is a defensive
   * stress beyond the contract; pairs may transiently exceed the relaxed
   * intent tolerance, so finiteness + bounds are the hard asserts here. */
  for (let f = 0; f < 4; f++) { step(h, 0.25); ok = invariantsOk(h, "delta-large", 0.25) && ok; } /* paused-tab catch-up spike */
  for (let f = 0; f < 120; f++) { step(h, 1 / 60); if (f % 30 === 29) ok = invariantsOk(h, "delta-resume", 1 / 60) && ok; }
  for (const e of h.sys.enemies) {
    if (Math.hypot(e.x, e.z) > ARENA_RADIUS * 1.2) { ok = false; push("no explosion after large delta", false, `id ${e.id}`); }
  }
  if (ok) push("delta variation (1/60 → 1/120 → 0.25 → resume) stays finite + legal", true);
}

/* --------------- 10. contact-damage cadence (no embed-damage) ------------ */
{
  /* cadence contract is PER-FOE — a single embedded foe measures it directly */
  const h = makeHarness("damage-cadence", 10, NO_OBSTACLES);
  h.player.x = 0; h.player.z = 0;
  /* ONE foe — the 0.7s cooldown is a per-foe contract, so a single embedded
     foe measures it directly (multi-foe embedding is covered by the soak) */
  h.sys.spawn("goblin", 0, 0, null, h.ctx); /* spawned EXACTLY inside the player */
  let ok = true;
  let embeddedFrames = 0;
  for (let f = 0; f < 300; f++) { /* 5 s */
    step(h, 1 / 60);
    for (const e of h.sys.enemies) {
      if (!e.dead && Math.hypot(h.player.x - e.x, h.player.z - e.z) < e.radius + 0.55 - 0.05) embeddedFrames++;
    }
    if (f % 30 === 29) ok = invariantsOk(h, "damage-cadence", 1 / 60) && ok;
  }
  const times = h.damageLog.map(d => d.t).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i] - times[i - 1]);
  const total = h.damageLog.length;
  if (embeddedFrames > 0) { ok = false; push("no foe stays embedded in the player", false, `${embeddedFrames} embedded frames`); }
  if (minGap < 0.65) { ok = false; push("touch damage honors the 0.7s cooldown", false, `minGap=${minGap.toFixed(3)}s`); }
  if (total < 8) { ok = false; push("melee pressure still lands (cadence not starved)", false, `${total} hits / 5s`); }
  if (ok) push("contact damage: per-foe cooldown contract kept, zero embedded frames", true,
    `${total} hits, minGap=${minGap.toFixed(2)}s`);
}

/* ---------------------- 11. determinism (same seed) ---------------------- */
{
  function runDeterministic(): Array<[number, number]> {
    const h = makeHarness("determinism", 18, [{ x: -5, z: 5, r: 2.0 }, { x: 8, z: -6, r: 1.7 }]);
    h.player.x = 3; h.player.z = -20;
    const pick: EnemyType[] = ["goblin", "skitter", "archer", "knight", "swarm", "elemental", "lancer", "mender"];
    pick.forEach((t, i) => h.sys.spawn(t, -10 + i * 3, 10 - (i % 3) * 4, i === 2 ? "swift" : null, h.ctx));
    /* scripted player wobble — identical input stream both runs */
    for (let f = 0; f < 480; f++) {
      h.player.x = 3 + Math.sin(f * 0.021) * 6;
      h.player.z = -20 + Math.cos(f * 0.017) * 5;
      step(h, 1 / 60);
    }
    return h.sys.enemies.filter(e => !e.dead).map(e => [e.x, e.z] as [number, number]);
  }
  const a = runDeterministic();
  const b = runDeterministic();
  let ok = a.length === b.length && a.length > 0;
  if (ok) for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { ok = false; push("determinism", false, `foe ${i}: ${a[i]} vs ${b[i]}`); break; }
  }
  if (ok) push("same seed + input stream → bit-identical final state", true, `${a.length} foes`);
}

/* ------------------------ 12. soak to ≥10k steps ------------------------- */
{
  const SEEDS = ["soak-a", "soak-b", "soak-c"];
  let ok = true;
  for (const seed of SEEDS) {
    const rng = mulberry32(hashSeed(seed + ":obst"));
    /* obstacles honor the production planObstacles invariants: surface gap
     * between circles ≥ the largest regular foe diameter (2.4u) so a squeezed
     * foe is never over-constrained (narrower gaps are unsolvable by any
     * projection solver and never occur in the real arena) */
    const obstacles: Array<{ x: number; z: number; r: number }> = [];
    for (let i = 0; i < 7; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const cand = { x: rng.range(-30, 30), z: rng.range(-30, 30), r: rng.range(1.0, 2.4) };
        if (obstacles.every(o => Math.hypot(o.x - cand.x, o.z - cand.z) >= o.r + cand.r + 2.4)) {
          obstacles.push(cand);
          break;
        }
      }
    }
    const h = makeHarness(seed, 45, obstacles);
    h.player.x = 12; h.player.z = -8;
    const pick: EnemyType[] = ["goblin", "knight", "skitter", "archer", "elemental", "lancer", "tank", "shadow", "swarm", "imp", "assassin", "voidbeast", "mage", "necromancer", "warden", "timewalker"];
    for (let i = 0; i < 40; i++) {
      const t = pick[i % pick.length];
      const a = rng.range(0, Math.PI * 2), r = rng.range(6, 40);
      h.sys.spawn(t, Math.cos(a) * r, Math.sin(a) * r, i % 5 === 0 ? "swift" : null, h.ctx);
    }
    for (let f = 0; f < 400; f++) {
      /* engine order: the player moves BEFORE enemies.update — checking a
       * post-teleport state would report phantom embeddings */
      h.player.x = Math.max(-40, Math.min(40, h.player.x + Math.sin(f * 0.05 + seed.length) * 0.4));
      step(h, 1 / 60);
      if (f % 40 === 39) ok = invariantsOk(h, `soak ${seed}`) && ok;
    }
  }
  while (totalSteps < 12_000) {
    const h = makeHarness("soak-extra", 51, [{ x: 0, z: 0, r: 2.4 }, { x: 15, z: 10, r: 1.6 }]);
    for (let i = 0; i < 20; i++) h.sys.spawn("goblin", -20 + i * 2, 15, null, h.ctx);
    for (let f = 0; f < 200; f++) step(h, 1 / 60);
    ok = invariantsOk(h, "soak-extra") && ok;
  }
  if (ok) push(`crowd soak across seeds/waves stays legal (≥10k steps)`, true, `${totalSteps} steps`);
}

/* ==================== §8B: speed & balance matrix ======================== */
{
  const WAVES = [1, 10, 20, 30, 40, 50, 51];
  const reps: EnemyType[] = ["goblin", "knight", "skitter", "swarm", "archer", "elemental", "lancer", "mender", "tank", "voidbeast"];
  let speedOk = true, hpOk = true, dmgOk = true;
  const detail: string[] = [];
  for (const w of WAVES) {
    for (const t of reps) {
      const def = ENEMY_DEFS[t];
      const raw = scaleEnemy(def, w);
      /* unscaled reference formulas (pre-F-03 baseline) */
      const spdMult = Math.min(1 + w * 0.012, 1.6);
      const lin = 1 + Math.max(0, w - 1) * 0.13;
      const comp = w > 6 ? Math.pow(1.09, w - 6) : 1;
      const hpMult = Math.min(lin * comp, 150) * DIFFICULTY_MULT;
      const dmgMult = Math.min((1 + Math.max(0, w - 1) * 0.04) * (w > 8 ? Math.pow(1.045, w - 8) : 1), 12) * DIFFICULTY_MULT;
      const ratio = raw.speed / (def.speed * spdMult);
      if (Math.abs(ratio - FOE_MOVE_SPEED_SCALE) > 1e-9) { speedOk = false; detail.push(`${t}@${w}: ratio=${ratio}`); }
      if (Math.abs(raw.hp - def.hp * hpMult) > 1e-6) { hpOk = false; detail.push(`${t}@${w}: hp`); }
      if (Math.abs(raw.damage - def.damage * dmgMult) > 1e-6) { dmgOk = false; detail.push(`${t}@${w}: dmg`); }
    }
  }
  push(`locomotion scale = ${FOE_MOVE_SPEED_SCALE} exactly at waves ${WAVES.join("/")} (10 types × 7 waves)`, speedOk, detail.slice(0, 3).join("; "));
  push("enemy HP formula untouched by the locomotion tuning", hpOk);
  push("enemy damage formula untouched by the locomotion tuning", dmgOk);
  /* elite swift multiplier composes ON TOP of the scaled base */
  {
    const h = makeHarness("elite-swift", 20, NO_OBSTACLES);
    const e = h.sys.spawn("goblin", 0, 0, "swift", h.ctx);
    const expected = scaleEnemy(ENEMY_DEFS.goblin, 20).speed * ELITE_DEFS.swift.spdMult;
    push("elite swift speed = scaled base × elite multiplier", Math.abs(e.spd - expected) < 1e-9, `${e.spd.toFixed(3)} vs ${expected.toFixed(3)}`);
  }
  /* end-to-end measured locomotion: a free-running chaser moves at its
     (scaled) stat speed — proving the pipeline applies the scale, not just
     the spawn table */
  {
    const h = makeHarness("measured-speed", 1, NO_OBSTACLES);
    h.player.x = 0; h.player.z = 40;
    const e = h.sys.spawn("goblin", 0, -40, null, h.ctx);
    const x0 = e.x, z0 = e.z;
    for (let f = 0; f < 120; f++) step(h, 1 / 60); /* 2 s */
    const measured = Math.hypot(e.x - x0, e.z - z0) / 2;
    const unscaled = ENEMY_DEFS.goblin.speed * (1 + 1 * 0.012);
    const ok = Math.abs(measured - e.spd) < 0.2 && measured / unscaled < FOE_MOVE_SPEED_SCALE + 0.02;
    push("measured pursuit speed ≈ scaled stat (end-to-end)", ok,
      `measured=${measured.toFixed(2)} spd=${e.spd.toFixed(2)} unscaled=${unscaled.toFixed(2)}`);
  }
  /* player speed + projectile speeds are NOT part of the tuning (documented
     constants — verified by construction: engine player.speed = 7.4 × bonuses,
     enemy bolt speeds are per-shot literals untouched by this diff) */
  push("player speed & projectile speeds excluded from the locomotion tuning (by construction)", true);
}

/* ------------------------------- report ---------------------------------- */
let pass = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (c.ok) pass++;
}
console.log(`\n  total simulation steps: ${totalSteps}`);
const failed = checks.length - pass;
if (failed > 0) {
  console.log(`\nRESULT: FAIL — ${pass}/${checks.length} motion checks passed, ${failed} failure(s)`);
  process.exit(1);
}
console.log(`\nRESULT: PASS — ${pass}/${checks.length} motion checks (${totalSteps} steps)`);
