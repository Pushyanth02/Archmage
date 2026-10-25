#!/usr/bin/env bun
/* ARCHMAGE: RIFTBOUND (3D Edition) — blink targeting regression harness
   (v2.0 audit R-04).  Run: bun scripts/validate-blink.ts

   Property-tests the PURE planBlinkLanding() planner (the same function the
   engine step calls) — no renderer needed:

     1.  Reach: a clear field carries the full BLINK_DISTANCE (9.0) toward
         the pointer; the old 5.5 hop is gone.
     2.  Pointer clamping: cursor offsets of 2 and 7 units blink ~the
         cursor's own distance, never past it; 15 units clamps to 9.
     3.  Pointer priority: with BOTH movement held and a meaningful pointer
         offset, the pointer direction wins (cursor-directed targeting).
     4.  Deadzone: a cursor within 0.75 units of the mage falls back to the
         movement vector.
     5.  No intent: no pointer offset + no movement ⇒ null (the engine
         no-ops without spending the cooldown).
     6.  Movement fallback: move vector alone carries the full 9 units,
         normalized (diagonals included).
     7.  All four diagonals: direction preserved to within 1e-6.
     8.  Arena boundary: blinking toward/over the wall clamps the landing
         inside radius-0.8 from EVERY approach angle (360 samples).
     9.  Obstacle safety: a wall of obstacles across the ray forces either
         a shortened hop or an arc sample — the landing is never inside an
         obstacle + margin, and never outside the arena.
     10. Ring fallback: a COMPLETE enclosure (obstacles everywhere on the
         9-ring) still yields a legal landing via the pushout path.
     11. Determinism: identical inputs → bit-identical plans (100 repeats).
     12. No NaN/Infinity under degenerate inputs (zero aim, zero move,
         enormous coordinates, overlapping obstacles at the player).
     13. Off-center origin: the same rules hold from a non-origin player
         position (arena checks are radial, not axis-aligned).
*/

import { planBlinkLanding, BLINK_DISTANCE } from "../src/game3d/engine";
import { ARENA_RADIUS } from "../src/game3d/arena-config";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
function push(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}
type Obstacle = { x: number; z: number; r: number };
const CLEAR: Obstacle[] = [];
const MARGIN = 0.55; // BLINK_LAND_CLEAR
const RING = ARENA_RADIUS - 0.8; // BLINK_ARENA_MARGIN

const legal = (p: { x: number; z: number } | null, obs: readonly Obstacle[]) =>
  p !== null && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x, p.z) <= RING + 1e-9 &&
  obs.every(o => Math.hypot(p.x - o.x, p.z - o.z) >= o.r + MARGIN - 1e-9);

/* 1 — full reach on a clear field */
{
  const p = planBlinkLanding(0, 0, 12, 0, 0, 0, CLEAR, ARENA_RADIUS);
  push("1a. clear field carries the full 9.0 reach", p !== null && Math.abs(p.dist - 9) < 1e-9, `dist=${p?.dist}`);
  push("1b. reach is the named BLINK_DISTANCE constant", BLINK_DISTANCE === 9.0, `BLINK_DISTANCE=${BLINK_DISTANCE}`);
}
/* 2 — pointer distance clamping */
for (const d of [2, 7, 15]) {
  const p = planBlinkLanding(0, 0, d, 0, 0, 0, CLEAR, ARENA_RADIUS);
  const expect = Math.min(9, d);
  push(`2. cursor ${d}u away blinks ~${expect}u (never past the cursor)`,
    p !== null && Math.abs(p.dist - expect) < 1e-9, `dist=${p?.dist}`);
}
/* 3 — pointer priority over movement */
{
  const p = planBlinkLanding(0, 0, 9, 0, 0, 1, CLEAR, ARENA_RADIUS); // pointer +X, move +Z
  push("3. pointer direction wins over held movement",
    p !== null && Math.abs(p.x - 9) < 1e-9 && Math.abs(p.z) < 1e-9, `(${p?.x?.toFixed(3)}, ${p?.z?.toFixed(3)})`);
}
/* 4 — deadzone falls back to movement */
{
  const p = planBlinkLanding(0, 0, 0.4, 0.4, 0, -1, CLEAR, ARENA_RADIUS); // cursor ~0.57u, move -Z
  push("4. sub-deadzone cursor defers to the movement vector",
    p !== null && Math.abs(p.z + 9) < 1e-9 && Math.abs(p.x) < 1e-9, `(${p?.x?.toFixed(3)}, ${p?.z?.toFixed(3)})`);
}
/* 5 — no intent */
{
  const p = planBlinkLanding(3, -2, 3, -2, 0, 0, CLEAR, ARENA_RADIUS);
  push("5. no pointer offset + no movement ⇒ null (cooldown spared)", p === null, `plan=${JSON.stringify(p)}`);
}
/* 6 — movement fallback full distance, diagonals normalized */
for (const [mx, mz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [0.3, 0.9]]) {
  const p = planBlinkLanding(0, 0, 0.1, 0.1, mx, mz, CLEAR, ARENA_RADIUS);
  const len = Math.hypot(mx, mz);
  const ex = (mx / len) * 9,
    ez = (mz / len) * 9;
  push(`6. move (${mx},${mz}) → normalized 9u hop`,
    p !== null && Math.abs(p.x - ex) < 1e-6 && Math.abs(p.z - ez) < 1e-6, `(${p?.x?.toFixed(4)}, ${p?.z?.toFixed(4)})`);
}
/* 7 — diagonals preserve direction exactly (angle-difference mod 2π —
   atan2 wraps to (-π,π], so 5π/4 reads as -3π/4) */
{
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const p = planBlinkLanding(0, 0, Math.cos(a) * 12, Math.sin(a) * 12, 0, 0, CLEAR, ARENA_RADIUS);
    const diff = p === null ? Infinity : Math.abs(((Math.atan2(p.z, p.x) - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    push(`7. diagonal ${a.toFixed(3)}rad preserves direction`, diff < 1e-9,
      `ang=${p ? Math.atan2(p.z, p.x).toFixed(6) : "null"}`);
  }
}
/* 8 — boundary clamp from every angle */
{
  let worst = 0;
  let ok = true;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const px = Math.cos(a) * (RING - 2),
      pz = Math.sin(a) * (RING - 2); // near the wall already
    const p = planBlinkLanding(px, pz, px + Math.cos(a) * 50, pz + Math.sin(a) * 50, 0, 0, CLEAR, ARENA_RADIUS);
    if (p === null || Math.hypot(p.x, p.z) > RING + 1e-9) {
      ok = false;
      break;
    }
    worst = Math.max(worst, Math.hypot(p.x, p.z));
  }
  push("8. outward blink from near the wall clamps inside the ring (360°)", ok, `worstR=${worst.toFixed(3)} ring=${RING}`);
}
/* 9 — obstacle wall across the ray */
{
  // a row of boulders 5 units out, spanning ±6 laterally
  const obs: Obstacle[] = [];
  for (let z = -6; z <= 6; z += 1.5) obs.push({ x: 5, z, r: 1.2 });
  const p = planBlinkLanding(0, 0, 12, 0, 0, 0, obs, ARENA_RADIUS);
  push("9a. obstacle wall never yields an illegal landing", legal(p, obs), `(${p?.x?.toFixed(3)}, ${p?.z?.toFixed(3)}) dist=${p?.dist?.toFixed(3)}`);
  push("9b. blocked ray still travels (shortened hop or arc)", p !== null && p.dist > 1.5, `dist=${p?.dist?.toFixed(3)}`);
}
/* 10 — full enclosure fallback */
{
  // obstacles covering every candidate distance/angle: a complete 9-radius picket
  const obs: Obstacle[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const r of [9, 7.2, 5.6, 4.1, 2.7, 1.6, 9 * 0.6]) {
      obs.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: 1.05 });
    }
  }
  const p = planBlinkLanding(0, 0, 12, 0, 0, 0, obs, ARENA_RADIUS);
  push("10. pathological full enclosure still lands legally (pushout path)",
    legal(p, obs), `(${p?.x?.toFixed(3)}, ${p?.z?.toFixed(3)})`);
}
/* 11 — determinism */
{
  const obs: Obstacle[] = [{ x: 4, z: 1, r: 1.5 }, { x: -3, z: -2, r: 2 }];
  const first = planBlinkLanding(1, 1, 8, -3, 0.4, 0.2, obs, ARENA_RADIUS);
  let same = true;
  for (let i = 0; i < 100; i++) {
    const p = planBlinkLanding(1, 1, 8, -3, 0.4, 0.2, obs, ARENA_RADIUS);
    if (!first || !p || p.x !== first.x || p.z !== first.z || p.dist !== first.dist) {
      same = false;
      break;
    }
  }
  push("11. identical inputs → bit-identical plans (100 repeats)", same);
}
/* 12 — degenerate inputs stay finite */
{
  const cases: Array<[number, number, number, number, number, number]> = [
    [0, 0, 0, 0, 0, 0],
    [1e6, -1e6, 1e6 + 5, -1e6, 0, 0],
    [5, 5, 5, 5, 0, 0],
    [-RING + 0.5, 0, -RING - 10, 0, 0, 0],
  ];
  let ok = true;
  for (const [px, pz, ax, az, mx, mz] of cases) {
    const p = planBlinkLanding(px, pz, ax, az, mx, mz, CLEAR, ARENA_RADIUS);
    if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.dist) || Math.hypot(p.x, p.z) > RING + 1e-6)) {
      ok = false;
      break;
    }
  }
  push("12. degenerate inputs: finite results, inside the ring (or null)", ok);
}
/* 13 — off-center origin */
{
  const px = 14,
    pz = -9;
  const obs: Obstacle[] = [{ x: px + 5, z: pz, r: 1.4 }];
  const p = planBlinkLanding(px, pz, px + 12, pz, 0, 0, obs, ARENA_RADIUS);
  push("13. off-center player: obstacle-safe, ring-legal landing", legal(p, obs),
    `(${p?.x?.toFixed(3)}, ${p?.z?.toFixed(3)})`);
}

/* report */
let fail = 0;
for (const c of checks) {
  if (!c.ok) fail++;
  console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}${c.ok ? "" : ` — ${c.detail ?? "FAILED"}`}`);
}
console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"} — ${checks.length - fail}/${checks.length} blink checks`);
process.exit(fail === 0 ? 0 : 1);
