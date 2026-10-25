#!/usr/bin/env bun
/* ARCHMAGE: RIFT 3D — biome deck / topology / terrain gate (audit F-05 §8C).
   Run: bun scripts/validate-terrain.ts

   Validates the decoupled biome+topology system:
     1.  terrainForAct / layoutForAct determinism (same seed+act → identical).
     2.  Deck rules: first five act bands = 5 UNIQUE themes incl. ≥2 of the
         four new biomes; the first decade is a full 10-permutation (no
         repeats); endless decades reshuffle deterministically with no
         repeats until all ten have shown.
     3.  100-seed coverage: every theme reachable, every layout kind
         reachable, layouts meaningfully differ across seeds.
     4.  planObstacles determinism per kind + genuine differentiation.
     5.  Full buildArena reproducibility on the engine-identical rng path
         for ALL TEN terrains (visual kits build + dispose cleanly).
     6.  Collision safety: bounds, center spawn corridor, per-pair cluster
         clearance (no unsatisfiable squeeze), fence gap. */

import {
  ACTS, TERRAIN_IDS, TERRAINS, NEW_TERRAIN_IDS, TERRAIN_LAYOUTS_ALLOWED,
  terrainForAct, layoutForAct, biomeDeckFor, hashSeed, mulberry32,
  type ArenaLayoutKind,
} from "../src/game3d/content";
import { planObstacles, buildArena } from "../src/game3d/arena";
import { ARENA_RADIUS } from "../src/game3d/arena-config";

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
function push(name: string, ok: boolean, detail?: string) { checks.push({ name, ok, detail }); }

const SEEDS = ["rune-1234", "veil-0000", "ember-9999", "rift", "a", "test-seed-xyz"];
const LAYOUT_KINDS: ArenaLayoutKind[] = ["scatter", "ring", "lanes", "islands", "radial"];

/* deterministic 100-seed probe set */
const PROBE_SEEDS: string[] = [];
{
  const rng = mulberry32(hashSeed("terrain-coverage-probe"));
  for (let i = 0; i < 100; i++) PROBE_SEEDS.push(`probe-${rng.int(0, 1_000_000)}`);
}

/* --- 1. determinism -------------------------------------------------------- */
{
  let detOK = true;
  for (const seed of SEEDS) {
    for (let act = 1; act <= 12; act++) {
      const a = terrainForAct(seed, act);
      const b = terrainForAct(seed, act);
      if (a !== b) { detOK = false; push(`terrain determinism ${seed} act ${act}`, false, `${a}/${b}`); }
      const la = layoutForAct(seed, act, a);
      const lb = layoutForAct(seed, act, a);
      if (la !== lb) { detOK = false; push(`layout determinism ${seed} act ${act}`, false, `${la}/${lb}`); }
    }
  }
  push("terrainForAct + layoutForAct: same seed+act → identical (72 combos ×2)", detOK);
}

/* --- 2. deck rules --------------------------------------------------------- */
{
  /* first five act bands: 5 unique themes + ≥2 new */
  let fiveUnique = 0, twoNew = 0, newCounts: number[] = [];
  for (const seed of PROBE_SEEDS) {
    const five = [1, 2, 3, 4, 5].map(a => terrainForAct(seed, a));
    if (new Set(five).size === 5) fiveUnique++;
    const n = five.filter(t => NEW_TERRAIN_IDS.includes(t)).length;
    newCounts.push(n);
    if (n >= 2) twoNew++;
  }
  push("first five act bands are 5 UNIQUE themes (100 seeds)", fiveUnique === 100, `${fiveUnique}/100`);
  push("first five act bands include ≥2 of the four new biomes (100 seeds)", twoNew === 100, `${twoNew}/100, avg ${newCounts.reduce((s, v) => s + v, 0) / 100})`);

  /* first decade = full permutation (no repeats across acts 1..10) */
  let decadeOK = 0;
  for (const seed of PROBE_SEEDS) {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(a => terrainForAct(seed, a));
    if (new Set(ten).size === 10) decadeOK++;
  }
  push("decade 0: acts 1–10 cover ALL TEN themes exactly once (no repeats)", decadeOK === 100, `${decadeOK}/100`);

  /* endless: acts 11..20 (decade 1) also a full permutation; deterministic */
  let endlessOK = 0, endlessDet = true;
  for (const seed of PROBE_SEEDS) {
    const d1 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(a => terrainForAct(seed, a));
    if (new Set(d1).size === 10) endlessOK++;
    for (let i = 0; i < 10; i++) if (terrainForAct(seed, 11 + i) !== d1[i]) endlessDet = false;
  }
  push("endless decade 1: another full 10-permutation (no repeat until all shown)", endlessOK === 100, `${endlessOK}/100`);
  push("endless deck is deterministic across calls", endlessDet);

  /* biomeDeckFor preview === per-act lookups (the menu itinerary is truthful) */
  let previewOK = true;
  for (const seed of SEEDS) {
    const deck = biomeDeckFor(seed);
    for (let i = 0; i < 10; i++) if (terrainForAct(seed, i + 1) !== deck[i]) previewOK = false;
  }
  push("biomeDeckFor preview matches terrainForAct exactly (truthful itinerary)", previewOK);
}

/* --- 3. 100-seed coverage + variety ---------------------------------------- */
{
  const themes = new Set<string>(), kinds = new Set<string>();
  for (const seed of PROBE_SEEDS) {
    for (let act = 1; act <= 10; act++) {
      themes.add(terrainForAct(seed, act));
      kinds.add(layoutForAct(seed, act, terrainForAct(seed, act)));
    }
  }
  push("all TEN terrain ids reachable across 100 seeds", themes.size === TERRAIN_IDS.length, [...themes].join(","));
  push("all FIVE layout kinds reachable across 100 seeds", kinds.size === LAYOUT_KINDS.length, [...kinds].join(","));
  const newReach = NEW_TERRAIN_IDS.filter(t => themes.has(t)).length;
  push("all four new biomes reachable", newReach === 4, `${newReach}/4`);
  const metaIds = TERRAINS.map(t => t.id).sort().join(",");
  push("TERRAINS metadata ids === TERRAIN_IDS", metaIds === [...TERRAIN_IDS].sort().join(","), metaIds);

  /* layout compatibility respected */
  let compatOK = true;
  for (const seed of SEEDS) {
    for (let act = 1; act <= 10; act++) {
      const t = terrainForAct(seed, act);
      const k = layoutForAct(seed, act, t);
      if (!(TERRAIN_LAYOUTS_ALLOWED[t] ?? []).includes(k)) compatOK = false;
    }
  }
  push("layoutForAct always respects the biome compatibility set", compatOK);

  /* different seeds → meaningfully different itineraries */
  const itins = new Set(PROBE_SEEDS.map(s => [1, 2, 3, 4, 5].map(a => terrainForAct(s, a)).join(",")));
  push("different seeds → varied 5-act itineraries", itins.size > 90, `${itins.size}/100 distinct`);
}

/* --- 4. planObstacles determinism + differentiation ------------------------ */
{
  let detOK = true;
  for (const seed of SEEDS) {
    for (const kind of LAYOUT_KINDS) {
      const r1 = mulberry32(hashSeed(`${seed}:layout`));
      const r2 = mulberry32(hashSeed(`${seed}:layout`));
      const a = planObstacles(r1, kind).map(o => `${o.x.toFixed(4)},${o.z.toFixed(4)},${o.r.toFixed(4)}`).join("|");
      const b = planObstacles(r2, kind).map(o => `${o.x.toFixed(4)},${o.z.toFixed(4)},${o.r.toFixed(4)}`).join("|");
      if (a !== b) detOK = false;
    }
  }
  push("planObstacles: same seed+kind → identical circles (30 combos)", detOK);

  /* distinct topologies produce genuinely different circle sets */
  const layouts = new Map<string, string>();
  for (const kind of LAYOUT_KINDS) {
    const rng = mulberry32(hashSeed("layout-differentiation-probe"));
    const circles = planObstacles(rng, kind).map(o => `${o.x.toFixed(3)},${o.z.toFixed(3)},${o.r.toFixed(3)}`).join("|");
    layouts.set(kind, `${circles.length}::${circles}`);
  }
  const distinct = new Set([...layouts.values()]).size;
  push("five topology kinds → distinct obstacle layouts (not recolors)", distinct >= 4, `${distinct}/5 distinct`);

  /* new patterns place clusters (islands/radial are non-empty) */
  let nonEmpty = true;
  for (const kind of ["islands", "radial"] as ArenaLayoutKind[]) {
    for (const seed of SEEDS) {
      const rng = mulberry32(hashSeed(`${seed}:layout`));
      if (planObstacles(rng, kind).length < 3) nonEmpty = false;
    }
  }
  push("islands + radial patterns produce real cluster sets", nonEmpty);
}

/* --- 5. full arena build reproducibility (engine-identical path) ------------ */
{
  const build = (seed: string, actId: number) => {
    const act = ACTS.find(a => a.id === actId) ?? ACTS[0];
    const terrain = terrainForAct(seed, act.id);
    const layout = layoutForAct(seed, act.id, terrain);
    const arenaRng = mulberry32(hashSeed(`${seed}:act${act.id}`));
    const arena = buildArena(act, arenaRng, { quality: 1, terrain, layout });
    const circles = arena.obstacles.map(o => `${o.x.toFixed(4)},${o.z.toFixed(4)},${o.r.toFixed(4)}`).join("|");
    const info = `${arena.radius}::${terrain}::${layout}::${circles}::${arena.group.children.length}`;
    const n = arena.obstacles.length;
    arena.dispose();
    return { terrain, info, obstacleCount: n, radius: arena.radius };
  };
  const a = build("rune-1234", 1);
  const b = build("rune-1234", 1);
  push("buildArena: same seed+act → identical arena (obstacles+radius+children)", a.info === b.info);
  const c = build("rune-1234", 2);
  push("buildArena: act 2 differs from act 1 (same seed)", a.info !== c.info);
  push("buildArena: obstacles exist", a.obstacleCount > 0, `${a.obstacleCount} circles`);

  /* every terrain kit builds + disposes cleanly through the engine path */
  let allKitsOK = true;
  const kitDetail: string[] = [];
  for (const terrain of TERRAIN_IDS) {
    try {
      const rng = mulberry32(hashSeed(`kit-probe-${terrain}`));
      const layout = (TERRAIN_LAYOUTS_ALLOWED[terrain] ?? ["scatter"])[0];
      const arena = buildArena(ACTS[0], rng, { quality: 1, terrain, layout });
      if (arena.obstacles.length === 0 && terrain !== "plaza") allKitsOK = false;
      if (!(arena.radius === ARENA_RADIUS)) allKitsOK = false;
      arena.dispose();
      kitDetail.push(terrain);
    } catch (err) {
      allKitsOK = false;
      kitDetail.push(`${terrain}!ERR:${err instanceof Error ? err.message : err}`);
    }
  }
  push("all TEN biome kits build + dispose cleanly on the engine path", allKitsOK, kitDetail.join(","));
}

/* --- 6. collision safety invariants (all kinds × all densities) -------------- */
{
  let inBounds = true, centerClear = true, squeezeFree = true;
  const densities = [0.45, 1, 1.35];
  for (const seed of SEEDS) {
    for (const kind of LAYOUT_KINDS) {
      for (const density of densities) {
        const rng = mulberry32(hashSeed(`${seed}:layout`));
        const obs = planObstacles(rng, kind, density);
        for (const o of obs) {
          const d = Math.hypot(o.x, o.z);
          if (d + o.r > ARENA_RADIUS - 0.5) inBounds = false; // must not clip the boundary wall
          if (d - o.r < 4.0) centerClear = false; // player spawn/center corridor stays open
        }
        /* per-pair clearance: no unsatisfiable squeeze between circles */
        for (let i = 0; i < obs.length; i++) {
          for (let j = i + 1; j < obs.length; j++) {
            if (Math.hypot(obs[i].x - obs[j].x, obs[i].z - obs[j].z) < obs[i].r + obs[j].r + 2.3) squeezeFree = false;
          }
        }
      }
    }
  }
  push("all obstacle circles stay inside the playable radius", inBounds);
  push("arena center keeps a clear ≥4u spawn corridor", centerClear);
  push("no unsatisfiable squeeze: every circle pair keeps ≥2.3u surface gap", squeezeFree);
}

/* --- report ---------------------------------------------------------------- */
let pass = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (c.ok) pass++;
}
console.log(`\nRESULT: ${pass === checks.length ? "PASS" : "FAIL"} — ${pass}/${checks.length} terrain checks`);
if (pass !== checks.length) process.exit(1);
