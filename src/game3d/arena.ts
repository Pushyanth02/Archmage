import * as THREE from "three";
import type { ActDef, RNG, TerrainId, ArenaLayoutKind } from "./content";
import type { ModelKind } from "./assets";
import { ARENA_RADIUS, GROUND_RADIUS, FENCE_HEIGHT, FENCE_STUD_COUNT, OBSTACLE_R_MIN, OBSTACLE_R_MAX } from "./arena-config";

/* F-05: legacy-terrain → layout-kind fallback (old callers passing a
   TerrainId get that biome's FIRST allowed kind — same placement family as
   before the decoupling). */
const TERRAIN_KIND_FALLBACK: Partial<Record<TerrainId, ArenaLayoutKind>> = {
  rubble: "scatter",
  plaza: "scatter",
  ring: "ring",
  lanes: "lanes",
  chaos: "scatter",
  graveyard: "scatter",
  caldera: "islands",
  glacial: "radial",
  thornwild: "islands",
  astral: "radial"
};

export interface ArenaVisuals {
  group: THREE.Group;
  update: (dt: number, t: number) => void; // t = elapsed seconds
  dispose: () => void; // remove from parent + free resources; idempotent
  radius: number; // playable radius (canonical, from arena-config)
  /** Lights are already children of `group`; exposed for engine reference/tuning. */
  lights: THREE.Light[];
  /** Gameplay collision circles for the obstacle clusters INSIDE the arena
   *  (plan §7): deterministic from the seed's dedicated layout stream, never
   *  affected by cosmetic draws or the quality slider. Purely positional —
   *    engine/entities do the circle-vs-circle pushout. */
  obstacles: Array<{ x: number; z: number; r: number }>;
}

/* ARCHMAGE: RIFTBOUND (3D Edition) — arena.ts
   Biome arena visual builder (AGENT 3-d).

   API (binding contract, consumed by engine.ts):
     const v = buildArena(act, rng, { quality, terrain });   // quality 0.5..1,
     scene.add(v.group);                            // terrain: layout option (9-c;
     v.update(dt, tSeconds);                        // default "rubble" = original)
     v.dispose();                                   // idempotent teardown

   World constants the engine relies on:
     - playable radius = canonical ARENA_RADIUS from arena-config.ts (F-04),
       center (0,0,0), ground plane y=0
     - containment visuals on the fence line (derived stud count + energy
       fence; inner ghost shell r = ARENA_RADIUS − 0.2)
     - ground disc r = GROUND_RADIUS, outer pillars just past the fence,
       sky dome r=220 → camera.far > ~250
     - lights inside v.group — the STRUCTURE is identical in every act (hemi +
       shadowless directional key + center rune PointLight); intensities are
       per-act NORMALIZED so effective luminance matches across biomes (see
       lighting constants below). Engine must NOT double-add ambient/hemi.
     - engine sets scene.fog + clear color from act.palette.sky separately (sky dome
       material is fog:false so it reads as the biome void).

   Determinism: every placement uses the provided seeded rng (never Math.random).
   Perf: 12 draw calls, ≤ ~13k triangles worst terrain (budget 30 / 60k).

   PER-TERRAIN VISUAL KITS (task 10-b — "terrains must LOOK different"):
   planObstacles (9-c) decides WHERE the obstacle clusters go; TERRAIN_KITS
   below decides what each cluster IS geometrically + a subtle per-terrain
   ground-accent treatment, so every terrain reads instantly differently
   while sharing the exact same merged-bucket pipeline (rock + caps buckets,
   zero extra draw calls, collision circles untouched):

     terrain | kit (cluster geometry)              | read                  
     --------+--------------------------------------+-----------------------
     rubble  | original shard cluster, BIT-FOR-BIT   | scattered rune debris 
             | unchanged (9-c/3-d builder)           | (default; identical    
             |                                      | visuals for old seeds)
     plaza   | 2–3 wide LOW flat slabs/pavers        | almost-clear          
             | (h 0.25–0.45) + small stepped plinth  | ceremonial floor      
             | on some clusters                      |                       
     ring    | 1–2 tall stone pillars per cluster    | inner colonnade ring  
             | (cylindrical shaft h 3.2–4.5 + base +  | of tall pillars       
             | capital boxes), slight aged lean      |                       
     lanes   | long LOW wall segments (h 1.1–1.5)    | winding corridor      
             | oriented along the seeded row axis    | walls carving lanes   
             | (echoed from the layout stream) +     |                       
             | broken companion stubs                |                       
     chaos   | 4–6 jagged shards (4/5-sided cones +  | dense wild spike      
             | tetrahedra, h 0.8–2.6, steep tilts),  | field, darker tint    
             | slightly darker vertex tint           |                       

   Ground accents (scatterPatches) get a per-terrain density/scale/brightness
   treatment (rubble = identity, so rubble stays bit-identical for old seeds).
   Kit geometry is drawn from the LAYOUT stream AFTER planObstacles finished,
   so per-terrain visual draw counts can never move a cluster. */

/* ------------------------------ constants ------------------------------ */
/* F-04 (audit): every arena dimension derives from the canonical config in
   arena-config.ts — this module (the renderer) re-declares NOTHING. */
const SKY_RADIUS = 220;
/* mote density scales with arena area so the atmosphere reads the same at
   any radius (legacy: 180 motes on the r=42 disc) */
const MOTE_BASE_COUNT = Math.round(180 * (ARENA_RADIUS / 42) ** 2);
const MOTE_Y_MIN = 0.5;
const MOTE_Y_MAX = 10;
/* ---- rune rubble (obstacles, plan §7 + task 9-c terrain options) ----
   Shared safety constraints — enforced for EVERY terrain; terrain rules only
   change how many clusters are proposed, how big they are, and where the
   candidates are drawn from, never what is accepted. The scatter band and
   fence gap derive from the canonical radius (F-04). */
const OBST_CENTER_CLEAR = 9; // min distance from center (rift + spawn zone)
/* Inter-cluster clearance is PER-PAIR (F-01): the surface gap between two
   obstacle circles must exceed the largest regular foe's diameter (~2.2 for
   the tank) + margin, otherwise a foe squeezed between them is an
   over-constrained UNRESOLVABLE embed (the two radial projections fight
   forever). The old flat center-to-center 6 could leave a 1.2u surface gap
   between two max-radius clusters — narrower than a tank. */
const OBST_CLEAR_GAP = 2.4; // guaranteed walkable surface gap between circles
const OBST_FENCE_GAP = 6; // min distance from the playable fence line
const OBST_ATTEMPTS = 8; // re-rolls per cluster before skipping it
/* Global hard bounds for every terrain (task 9-c): cluster radius stays in
   0.9..2.4 and total cluster count never exceeds 9, so the merged rock/caps
   buckets keep the 9-draw-call / ~triangle budget no matter the pattern. */
const OBST_RADIUS_FLOOR = 0.9,
  OBST_RADIUS_CEIL = 2.4;
const OBST_CLUSTER_CAP = 9;
/* F-05: layout specs are keyed by TOPOLOGY (ArenaLayoutKind), decoupled from
   the visual TerrainId — content.ts layoutForAct() picks the kind from the
   biome's compatibility set on a separate RNG stream. */
const LAYOUT_SPECS: Record<ArenaLayoutKind, TerrainLayout> = {
  /* original scatter — unchanged (default; also the unknown-kind fallback) */
  scatter: {
    countMin: 3,
    countMax: 5,
    radiusMin: 1.3,
    radiusMax: 2.2,
    pattern: "scatter"
  },
  /* a ring of stone: 6–8 clusters on a mid-radius ring with seeded jitter */
  ring: {
    countMin: 6,
    countMax: 8,
    radiusMin: 1.4,
    radiusMax: 2.0,
    pattern: "ring"
  },
  /* two winding rows: 4–6 clusters on two S-curved rows that carve corridors */
  lanes: {
    countMin: 4,
    countMax: 6,
    radiusMin: 1.2,
    radiusMax: 1.8,
    pattern: "lanes"
  },
  /* F-05 NEW — broken-island clusters: 8–9 clusters grouped into 3 seeded
     mid-band "islands" (tight multi-cluster arcs); the walkable sea between
     islands reads as broken archipelago cover */
  islands: {
    countMin: 8,
    countMax: 9,
    radiusMin: 1.0,
    radiusMin2: 0,
    radiusMax: 1.9,
    pattern: "islands"
  },
  /* F-05 NEW — radial/curved corridors: 6–8 clusters riding 3–4 seeded
     spokes from the mid ring outward, leaving curved corridors between the
     spokes (the spokes bend slightly via a shared sine sweep) */
  radial: {
    countMin: 6,
    countMax: 8,
    radiusMin: 1.1,
    radiusMax: 1.8,
    pattern: "radial"
  }
};
/* ---- center rift landmark (plan §7) ---- */
const RIFT_WISP_MOTES = 20; // motes reassigned to the upward wisp column
const RIFT_WISP_CEIL = 6.4; // wisps wrap at the landmark's max visual height
const TAU = Math.PI * 2;
const WHITE = new THREE.Color(1, 1, 1);
/* ------------------- two-stream rng split (plan §7) ---------------------
   content.ts exports mulberry32, but arena.ts may import content as TYPES
   ONLY (architecture contract) — a minimal local twin keeps the dependency
   rule intact while giving the gameplay layout and the cosmetic decor
   independent, separately-seeded streams. */
function arenaRng(seed: number): RNG {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const range = (lo, hi) => lo + next() * (hi - lo);
  return {
    next,
    range,
    int: (lo, hi) => Math.floor(range(lo, hi + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    shuffle: arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  };
}
/* Split salts — golden-ratio / murmur mixers: distinct constants, so the
   gameplay stream and the cosmetic stream never alias each other. */
const LAYOUT_SALT = 0x9e3779b9;
const COSMETIC_SALT = 0x85ebca6b;

/** Per-kind obstacle-layout rules (F-05): count/radius draw ranges + the
 *  placement pattern. Shared safety bounds (floor/ceil/cap, clear-zone,
 *  fence gap, per-pair cluster clearance, attempts) are enforced for every
 *  kind. */
interface TerrainLayout {
  countMin: number;
  countMax: number;
  radiusMin: number;
  radiusMin2?: number; // (unused placeholder kept for shape compat)
  radiusMax: number;
  pattern: ArenaLayoutKind;
}

export function planObstacles(rng: RNG, kind: ArenaLayoutKind | TerrainId = "scatter", density = 1): Array<{ x: number; z: number; r: number }> {
  const out: Array<{ x: number; z: number; r: number }> = [];
  /* accept BOTH the new ArenaLayoutKind and legacy TerrainId strings — a
   * terrain id maps to its first allowed kind, so old callers behave */
  const k: ArenaLayoutKind = kind in LAYOUT_SPECS ? kind as ArenaLayoutKind : (TERRAIN_KIND_FALLBACK[kind as TerrainId] ?? "scatter");
  const layout = LAYOUT_SPECS[k];
  /* per-biome density bias (from the kit, deterministic per seed+act) keeps
   * open biomes open and dense biomes dense after the topology decoupling */
  const count = Math.max(1, Math.min(OBST_CLUSTER_CAP, Math.round(rng.int(layout.countMin, layout.countMax) * Math.max(0.3, Math.min(1.6, density)))));
  /* pattern pre-draws — single draws before the cluster loop, fixed order */
  let ring: { r0: number; a0: number } | null = null;
  let rows: { theta: number; off: number; amp: number; freq: number; phase: number; span: number } | null = null;
  let groups: Array<{ a: number; d: number }> | null = null; // islands anchors
  let spokes: { n: number; a0: number; sweep: number; r0: number; r1: number } | null = null; // radial
  if (layout.pattern === "ring") {
    ring = {
      r0: rng.range(16, 24),
      a0: rng.range(0, TAU)
    }; // mid-radius ring
  } else if (layout.pattern === "lanes") {
    rows = {
      theta: rng.range(0, TAU),
      off: rng.range(11, 15),
      amp: rng.range(1.5, 3),
      freq: rng.range(0.09, 0.16),
      phase: rng.range(0, TAU),
      span: rng.range(20, 26)
    };
  } else if (layout.pattern === "islands") {
    /* three seeded mid-band anchor points, even third-spacing + jitter */
    const a0 = rng.range(0, TAU);
    groups = [0, 1, 2].map(g => ({
      a: a0 + g / 3 * TAU + rng.range(-0.35, 0.35),
      d: rng.range(17, ARENA_RADIUS - 12)
    }));
  } else if (layout.pattern === "radial") {
    spokes = {
      n: rng.int(3, 4),
      a0: rng.range(0, TAU),
      sweep: rng.range(0.35, 0.8), // shared bend: spokes curve, corridors follow
      r0: rng.range(13, 16),
      r1: ARENA_RADIUS - 9
    };
  }
  for (let i = 0; i < count; i++) {
    /* radius drawn per cluster (rubble: the original 1.3..2.2 draw, bit-for-bit);
    clamped to the global floor/ceil so a bad table entry can never leak out.
    NOTE (10-b): the lanes pattern's pre-draw order (count int, then
    rows.theta) is mirrored by laneRowAxis() below — if this draw order ever
    changes, update that echo to match. */
    const r = Math.min(OBST_RADIUS_CEIL, Math.max(OBST_RADIUS_FLOOR, rng.range(layout.radiusMin, layout.radiusMax)));
    for (let attempt = 0; attempt < OBST_ATTEMPTS; attempt++) {
      let x, z;
      if (layout.pattern === "ring" && ring) {
        /* evenly spaced around the ring, seeded jitter on angle + radius */const ang = ring.a0 + i / count * TAU + rng.range(-0.14, 0.14);
        const dist = ring.r0 + rng.range(-2.5, 2.5);
        x = Math.cos(ang) * dist;
        z = Math.sin(ang) * dist;
      } else if (layout.pattern === "lanes" && rows) {
        /* two winding rows: clusters ride an S-curve on each side of a seeded
        center line; the corridor between the rows and the lanes outside
        them come from the shared winding (same freq + phase both sides) */
        const half = Math.ceil(count / 2);
        const s = i < half ? 1 : -1; // +row first, then −row
        const rowLen = s > 0 ? half : count - half;
        const j = s > 0 ? i : i - half;
        const along = (rowLen > 1 ? -rows.span + 2 * rows.span * (j / (rowLen - 1)) : 0) + rng.range(-1.2, 1.2);
        const lateral = s * rows.off + Math.sin(along * rows.freq + rows.phase) * rows.amp + rng.range(-1.0, 1.0);
        x = Math.cos(rows.theta) * along - Math.sin(rows.theta) * lateral;
        z = Math.sin(rows.theta) * along + Math.cos(rows.theta) * lateral;
      } else if (layout.pattern === "islands" && groups) {
        /* broken-island clusters: round-robin onto the 3 anchors, tight polar
        offsets around each anchor form multi-cluster island arcs */
        const g = groups[i % groups.length];
        const oa = rng.range(0, TAU);
        const od = rng.range(0.4, 2.1);
        x = Math.cos(g.a) * g.d + Math.cos(oa) * od;
        z = Math.sin(g.a) * g.d + Math.sin(oa) * od;
      } else if (layout.pattern === "radial" && spokes) {
        /* radial corridors: clusters ride a bent spoke (angle sweeps with
        radius), evenly spaced along it; corridors fall between the spokes */
        const sp = i % spokes.n;
        const per = Math.ceil(count / spokes.n);
        const j = Math.floor(i / spokes.n);
        const t = per > 1 ? (j + 0.5) / per : 0.5;
        const rr = spokes.r0 + (spokes.r1 - spokes.r0) * t + rng.range(-1.2, 1.2);
        const ang = spokes.a0 + sp / spokes.n * TAU + spokes.sweep * (t - 0.5) * 2 + rng.range(-0.09, 0.09);
        x = Math.cos(ang) * rr;
        z = Math.sin(ang) * rr;
      } else {
        /* scatter (rubble/plaza/chaos) — the original polar placement */const a = rng.range(0, TAU);
        const dist = rng.range(OBSTACLE_R_MIN, OBSTACLE_R_MAX);
        x = Math.cos(a) * dist;
        z = Math.sin(a) * dist;
      }
      if (Math.hypot(x, z) < OBST_CENTER_CLEAR) continue; // rift + spawn zone
      if (Math.hypot(x, z) + r > ARENA_RADIUS - OBST_FENCE_GAP) continue; // fence
      let clash = false;
      for (const o of out) {
        if (Math.hypot(x - o.x, z - o.z) < o.r + r + OBST_CLEAR_GAP) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      out.push({
        x,
        z,
        r
      });
      break;
    }
  }
  return out;
}
/* ------------------------------ lighting -------------------------------- */ /** Rec.709 relative luminance of a linear-space color. */
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
/* Cross-act brightness normalization (mission: no biome murkier or blown-out
   than another). A light's EFFECTIVE output is color × intensity, and the six
   palettes span ~18× in sky luminance (act 4 ≈ 0.22 vs act 6 ≈ 0.012 linear),
   so every light is intensity-normalized to hit the same effective luminance
   in every act — hue is preserved, only intensity compensates. */
const HEMI_SKY_LUM = 0.12; // sky ambient on up-facing surfaces (floor readability)
const HEMI_GND_LUM = 0.05; // bounce ambient on down-facing surfaces
const KEY_INTENSITY = 0.62; // directional key — identical in every act
const KEY_TINT = 0.25; // how far the key drifts toward the biome rune hue
const RUNE_LUM = 0.3; // center rune light effective luminance @ 10u
const GROUND_LUM = 0.024; // ground albedo target → readable floor everywhere
/* ------------------------- reusable temp objects ------------------------ */ /* Module scope only — never allocate in update(). */
const _o = new THREE.Object3D();
const _cA = new THREE.Color();
const _cB = new THREE.Color();
/* ---------------------------- palette helpers --------------------------- */ /** Parse "r,g,b" (0..255 css components) into a linear THREE.Color. */
function cssRGB(rgb: string, out: THREE.Color): THREE.Color {
  const parts = rgb.split(",");
  const r = Number(parts[0]?.trim() ?? "0");
  const g = Number(parts[1]?.trim() ?? "0");
  const b = Number(parts[2]?.trim() ?? "0");
  return out.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}
interface ArenaColors {
  sky: THREE.Color;
  rune: THREE.Color;
  mote: THREE.Color;
  pillarHi: THREE.Color; // pillar[0] — dark
  pillarLo: THREE.Color; // pillar[1] — darker
  ground: THREE.Color;
  accent: THREE.Color;
}

interface ArenaCtx {
  act: ActDef;
  rng: RNG;
  quality: number; // clamped 0.5..1
  colors: ArenaColors;
  /** Normalized floor albedo — luma-matched across acts for readability. */
  groundColor: THREE.Color;
  /** 10-e decor dressing: the arena group + the model-clone accessor + the
   *  clone tracker (teardown detaches without disposing shared resources). */
  group: THREE.Group;
  decor: ((kind: ModelKind) => THREE.Group | null) | undefined;
  decorClones: THREE.Group[];
}

/* --------------------------- geometry merging --------------------------- */

interface Bucket {
  pos: number[];
  nrm: number[];
  col: number[];
}

const newBucket = (): Bucket => ({
  pos: [],
  nrm: [],
  col: []
});
/**
 * Append a (freshly created) geometry into a merge bucket.
 * Vertex colors are a vertical gradient cLo→cHi over local y range [yLo, yHi],
 * which gives every pillar/stud a baked bottom-shadow without extra materials.
 */
function pushPart(b: Bucket, geom: THREE.BufferGeometry, mtx: THREE.Matrix4, cLo: THREE.Color, cHi: THREE.Color, yLo: number, yHi: number): void {
  const g = geom.index !== null ? geom.toNonIndexed() : geom;
  g.applyMatrix4(mtx); // transforms position + normal
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const span = yHi - yLo;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    b.pos.push(p.getX(i), y, p.getZ(i));
    b.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    const t = span > 1e-6 ? THREE.MathUtils.clamp((y - yLo) / span, 0, 1) : 1;
    _cA.copy(cLo).lerp(cHi, t);
    b.col.push(_cA.r, _cA.g, _cA.b);
  }
  if (g !== geom) g.dispose();
  geom.dispose();
}
/** Place + push one part. `s` is a uniform scale or [sx,sy,sz]. */
function addPart(b: Bucket, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, ry: number, rz: number, s: number | [number, number, number], cLo: THREE.Color, cHi: THREE.Color, yLo: number, yHi: number): void {
  _o.position.set(x, y, z);
  _o.rotation.set(rx, ry, rz);
  if (typeof s === "number") _o.scale.setScalar(s);else _o.scale.set(s[0], s[1], s[2]);
  _o.updateMatrix();
  pushPart(b, geo, _o.matrix, cLo, cHi, yLo, yHi);
}
function bucketGeometry(b: Bucket): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  return g;
}
/* ------------------------------ ground ---------------------------------- */ /** Big ground disc with a baked radial vignette (vertex colors darken the rim). */
function buildGround(c: ArenaCtx): THREE.Mesh {
  const geo = new THREE.CircleGeometry(GROUND_RADIUS, 96);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i)) / GROUND_RADIUS;
    const v = 1 - 0.55 * THREE.MathUtils.smoothstep(r, 0.55, 1.0);
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({
    color: c.groundColor,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
/** Scatter seeded dark stains + crack rings across the floor (merged).
 *  Terrain-accented (10-b): rubble keeps the exact original treatment. */
/** Per-terrain ground-accent treatment (task 10-b): multipliers on the
 *  scatterPatches count/size + brightness/hue shifts (rubble = identity). */
interface TerrainGroundSpec {
  countMul: number;
  sizeMul: number;
  bright: number;
  hueMix: number;
}

function scatterPatches(c: ArenaCtx, rock: Bucket, spec: TerrainGroundSpec): void {
  const {
    rng,
    colors
  } = c;
  const count = Math.round((40 + 40 * c.quality) * spec.countMul); // 60..80 at rubble
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, TAU);
    const r = Math.sqrt(rng.next()) * (ARENA_RADIUS + 1.5); // uniform over the disc (F-04-derived)
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = 0.05 + i / count * 0.02; // micro-stagger avoids coplanar z-fight
    let g;
    if (rng.chance(0.55)) {
      g = new THREE.CircleGeometry(rng.range(0.35, 1.9) * spec.sizeMul, rng.int(7, 10)); // stain
    } else {
      const rr = rng.range(0.5, 2.3) * spec.sizeMul;
      g = new THREE.RingGeometry(rr, rr + rng.range(0.05, 0.16) * spec.sizeMul, rng.int(20, 30)); // crack
    }
    g.rotateX(-Math.PI / 2);
    _cB.copy(rng.chance(0.5) ? colors.accent : colors.pillarLo);
    if (spec.hueMix > 0) _cB.lerp(colors.pillarHi, spec.hueMix); // subtle stone-tone lift
    _cB.multiplyScalar(rng.range(0.45, 0.85) + spec.bright);
    addPart(rock, g, x, y, z, 0, rng.range(0, TAU), 0, 1, _cB, _cB, 0, 1);
  }
}
/* ------------------------------ rune fence ------------------------------- */ /** Containment studs ON the fence line (merged into the rock bucket) —
   count derived from the canonical radius so post density is size-stable. */
function buildStuds(c: ArenaCtx, rock: Bucket, caps: Bucket): void {
  const {
    rng,
    colors
  } = c;
  for (let i = 0; i < FENCE_STUD_COUNT; i++) {
    const a = i / FENCE_STUD_COUNT * TAU;
    const x = Math.cos(a) * ARENA_RADIUS;
    const z = Math.sin(a) * ARENA_RADIUS;
    const hs = rng.range(0.85, 1.2); // height variance
    addPart(rock, new THREE.BoxGeometry(0.4, 2.6, 0.4), x, 1.3 * hs, z, rng.range(-0.05, 0.05), rng.range(-0.35, 0.35), rng.range(-0.05, 0.05), [1, hs, 1], colors.pillarLo, colors.pillarHi, 0, 2.6);
    if (i % 3 === 0) {
      // glowing wardstone tip on every third stud
      addPart(caps, new THREE.BoxGeometry(0.26, 0.26, 0.26), x, 2.6 * hs + 0.28, z, 0, a, 0, 1, WHITE, WHITE, 0, 1);
    }
  }
}
/* ------------------------------- pillars --------------------------------- */ /** One themed pillar outside the fence; silhouette varies by act id. */
function buildPillar(c: ArenaCtx, rock: Bucket, caps: Bucket, x: number, z: number): void {
  const {
    rng,
    act,
    colors
  } = c;
  const lo = colors.pillarLo;
  const hi = colors.pillarHi;
  const hSpan = act.id === 4 ? [4.5, 7.0] : act.id === 5 ? [8.5, 12.0] : act.id === 3 ? [6.0, 9.0] : [6.5, 10.5];
  const h = rng.range(hSpan[0], hSpan[1]);
  const top = 1.1 + h;
  // shared plinth
  addPart(rock, new THREE.BoxGeometry(2.0, 1.1, 2.0), x, 0.55, z, 0, rng.range(0, Math.PI), 0, 1, lo, hi, 0, h);
  switch (act.id) {
    case 2:
      {
        // cinder — charred, jagged shard stack
        let y = 1.15;
        let w = 1.55;
        while (y < top - 0.3) {
          const seg = Math.min(top - y, rng.range(h * 0.22, h * 0.34));
          addPart(rock, new THREE.BoxGeometry(1, 1, 1), x + rng.range(-0.18, 0.18), y + seg / 2, z + rng.range(-0.18, 0.18), rng.range(-0.2, 0.2), rng.range(0, Math.PI), rng.range(-0.2, 0.2), [w, seg, w], lo, hi, 0, h);
          y += seg * 0.88;
          w *= 0.7;
        }
        addPart(caps, new THREE.OctahedronGeometry(0.36), x, top + 0.4, z, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
        break;
      }
    case 3:
      {
        // drowned — tilted broken column + fallen drum
        const len = h * 0.75;
        const tilt = rng.range(0.12, 0.24);
        const ta = rng.range(0, TAU);
        const rx = Math.cos(ta) * tilt;
        const rz = Math.sin(ta) * tilt;
        addPart(rock, new THREE.CylinderGeometry(0.48, 0.7, len, 9), x + rz * len * 0.5, 1.1 + Math.cos(tilt) * len * 0.5, z - rx * len * 0.5, rx, 0, rz, 1, lo, hi, 0, len);
        const fa = ta + rng.range(1.2, 2.1);
        addPart(rock, new THREE.CylinderGeometry(0.42, 0.42, rng.range(2.4, 3.6), 8), x + Math.cos(fa) * 2.3, 0.42, z + Math.sin(fa) * 2.3, Math.PI / 2, rng.range(0, Math.PI), 0, 1, lo, hi, 0, 1);
        addPart(caps, new THREE.OctahedronGeometry(0.36), x + rz * len, 1.1 + Math.cos(tilt) * len + 0.55, z - rx * len, 0, 0, 0, 1, WHITE, WHITE, 0, 1);
        break;
      }
    case 4:
      {
        // sepulcher — ice crystal spike cluster
        let tallY = 0;
        let tallX = x;
        let tallZ = z;
        for (let s = 0; s < 3; s++) {
          const ch = h * rng.range(0.55, 1.0);
          const ca = s / 3 * TAU + rng.range(0, 1.5);
          const cr = rng.range(0.2, 1.0);
          const px = x + Math.cos(ca) * cr;
          const pz = z + Math.sin(ca) * cr;
          const tiltOut = rng.range(0.05, 0.2);
          addPart(rock, new THREE.ConeGeometry(rng.range(0.5, 0.78), ch, 5), px, 1.1 + ch / 2, pz, Math.cos(ca) * tiltOut, rng.range(0, Math.PI), Math.sin(ca) * tiltOut, 1, lo, hi, 0, h);
          if (1.1 + ch > tallY) {
            tallY = 1.1 + ch;
            tallX = px;
            tallZ = pz;
          }
        }
        addPart(caps, new THREE.OctahedronGeometry(0.34), tallX, tallY + 0.5, tallZ, 0, 0, 0, 1, WHITE, WHITE, 0, 1);
        break;
      }
    case 5:
      {
        // abyss — tall 4-sided obelisk with spire tip
        const ry = rng.range(0, Math.PI);
        addPart(rock, new THREE.CylinderGeometry(0.22, 0.85, h, 4), x, 1.1 + h / 2, z, 0, ry, 0, 1, lo, hi, 0, h);
        addPart(rock, new THREE.ConeGeometry(0.34, 1.6, 4), x, top + 0.8, z, 0, ry, 0, 1, lo, hi, 0, h);
        addPart(caps, new THREE.OctahedronGeometry(0.4), x, top + 2.0, z, 0, ry, 0, 1, WHITE, WHITE, 0, 1);
        break;
      }
    case 6:
      {
        // endless — rune monolith with floating crown
        addPart(rock, new THREE.BoxGeometry(1.25, h, 0.85), x, 1.1 + h / 2, z, 0, rng.range(-0.5, 0.5), 0, 1, lo, hi, 0, h);
        addPart(rock, new THREE.BoxGeometry(1.7, 0.4, 1.2), x, 1.35, z, 0, rng.range(-0.4, 0.4), 0, 1, lo, hi, 0, h);
        addPart(caps, new THREE.OctahedronGeometry(0.5), x, top + 1.1, z, 0.4, 0.2, 0.5, 1, WHITE, WHITE, 0, 1);
        break;
      }
    case 1:
    default:
      {
        // sunless vestibule — classic vaulted column
        addPart(rock, new THREE.CylinderGeometry(0.55, 0.8, h, 9), x, 1.1 + h / 2, z, 0, rng.range(0, Math.PI), 0, 1, lo, hi, 0, h);
        addPart(rock, new THREE.BoxGeometry(1.6, 0.5, 1.6), x, top + 0.25, z, 0, 0, 0, 1, lo, hi, 0, h);
        addPart(caps, new THREE.OctahedronGeometry(0.42), x, top + 1.0, z, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
        break;
      }
  }
}
/* --------------------------- rune rubble -------------------------------- */ /** One low rubble cluster (visual height ≤ ~1.3, reads as debris, not walls).
                                                                               *  2–4 merged shards themed per act (following the pillar silhouettes) + a
                                                                               *  single small glow crown so the cluster reads as rune-lit ground clutter.
                                                                               *  Drawn from the LAYOUT stream: the visual variance is deterministic per
                                                                               *  seed and independent of the quality slider. */
function buildRubbleCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const {
    act,
    colors
  } = c;
  const lo = colors.pillarLo;
  const hi = colors.pillarHi;
  const shards = rng.int(2, 4);
  let tallestY = 0;
  let tallX = x;
  let tallZ = z;
  for (let i = 0; i < shards; i++) {
    const a = rng.range(0, TAU);
    const cr = rng.range(0.15, 0.62) * r;
    const sx = x + Math.cos(a) * cr;
    const sz = z + Math.sin(a) * cr;
    const h = rng.range(0.35, 1.25);
    const tiltA = rng.range(0, TAU);
    const tilt = rng.range(0.06, 0.28);
    let g;
    switch (act.id) {
      case 2:
        g = new THREE.ConeGeometry(rng.range(0.28, 0.52), h, 5);
        break;
      // charred stump
      case 3:
        g = new THREE.SphereGeometry(rng.range(0.26, 0.46), 7, 5);
        break;
      // drowned knob
      case 4:
        g = new THREE.ConeGeometry(rng.range(0.24, 0.44), h * 1.05, 5);
        break;
      // ice crystal
      case 5:
        g = new THREE.TetrahedronGeometry(rng.range(0.3, 0.52));
        break;
      // obsidian tooth
      case 6:
        g = new THREE.BoxGeometry(1, 1, 1);
        break;
      // monolith chunk
      default:
        g = new THREE.CylinderGeometry(rng.range(0.2, 0.34), rng.range(0.3, 0.48), h, 7);
        break;
      // column stump
    }
    const sy = act.id === 3 || act.id === 5 ? h * 0.4 : h * 0.5;
    const s: number | [number, number, number] = act.id === 6 ? [rng.range(0.5, 0.9), h, rng.range(0.5, 0.9)] : [1, 1, 1];
    addPart(rock, g, sx, sy, sz, Math.cos(tiltA) * tilt, rng.range(0, Math.PI), Math.sin(tiltA) * tilt, s, lo, hi, 0, 1.3);
    if (sy + h * 0.5 > tallestY) {
      tallestY = sy + h * 0.5;
      tallX = sx;
      tallZ = sz;
    }
  }
  /* one small rune crown on the tallest shard — the "lit rubble" read */
  addPart(caps, new THREE.OctahedronGeometry(0.2), tallX, Math.min(1.3, tallestY + 0.24), tallZ, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
}
/** plaza — 2–3 wide LOW flat pavers + an optional small stepped plinth:
 *  reads as an almost-clear ceremonial floor. Lighter, slightly
 *  accent-warmed vertex tint (pavers catch more sky than rubble). */
function buildPlazaCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const {
    colors
  } = c;
  const lo = colors.pillarLo.clone().lerp(colors.pillarHi, 0.45);
  const hi = colors.pillarHi.clone().lerp(colors.accent, 0.22);
  const slabs = rng.int(2, 3);
  let bigH = 0;
  let bigX = x;
  let bigZ = z;
  for (let i = 0; i < slabs; i++) {
    const yaw = rng.range(0, TAU);
    const oa = rng.range(0, TAU);
    const off = rng.range(0, 0.25) * r;
    const w = r * rng.range(0.95, 1.4);
    const d = r * rng.range(0.65, 1.0);
    const h = rng.range(0.25, 0.45);
    const px = x + Math.cos(oa) * off;
    const pz = z + Math.sin(oa) * off;
    addPart(rock, new THREE.BoxGeometry(1, 1, 1), px, h / 2 + 0.02, pz, 0, yaw, 0, [w, h, d], lo, hi, 0, h);
    if (h > bigH) {
      bigH = h;
      bigX = px;
      bigZ = pz;
    }
  }
  if (rng.chance(0.6)) {
    /* small central ceremonial plinth (stepped) — total height ≤ ~1.2 */const ph = rng.range(0.55, 0.95);
    addPart(rock, new THREE.BoxGeometry(1, 1, 1), x, 0.14, z, 0, rng.range(0, TAU), 0, [r * 0.72, 0.28, r * 0.72], lo, hi, 0, ph);
    addPart(rock, new THREE.BoxGeometry(1, 1, 1), x, 0.28 + ph / 2, z, 0, rng.range(0, TAU), 0, [r * 0.4, ph, r * 0.4], lo, hi, 0, ph);
    addPart(caps, new THREE.OctahedronGeometry(0.16), x, 0.28 + ph + 0.22, z, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
  } else {
    /* no plinth → keep the rune-lit language with a tiny glow over the
    largest paver */
    addPart(caps, new THREE.OctahedronGeometry(0.14), bigX, bigH + 0.3, bigZ, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
  }
}
/** ring — 1–2 tall stone pillars (stepped base + cylindrical shaft h 3.2–4.5
 *  + capital box), slight aged lean; reads as an inner colonnade echoing the
 *  outer fence pillars. Base act stone (pillarLo/pillarHi) — the arena's own
 *  material language. */
function buildPillarRingCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const {
    colors
  } = c;
  const lo = colors.pillarLo;
  const hi = colors.pillarHi;
  const n = rng.int(1, 2);
  const pairA = rng.range(0, TAU);
  let topY = 0;
  let topX = x;
  let topZ = z;
  for (let i = 0; i < n; i++) {
    /* single pillar sits near the center; a pair splits to opposite sides
    (0.45r each) so both stay inside the collision circle */
    const pa = n === 1 ? rng.range(0, TAU) : pairA + i * Math.PI + rng.range(-0.3, 0.3);
    const pd = n === 1 ? rng.range(0, 0.18) * r : 0.45 * r;
    const px = x + Math.cos(pa) * pd;
    const pz = z + Math.sin(pa) * pd;
    const h = rng.range(3.2, 4.5); // shaft height — TALL, the kit's signature
    const rad = n === 1 ? rng.range(0.45, 0.58) : rng.range(0.36, 0.48);
    const lean = rng.range(0, 0.05); // slight aged lean
    const leanA = rng.range(0, TAU);
    const yaw = rng.range(0, Math.PI);
    const gy = i * 0.03; // micro-stagger: paired bases never z-fight
    /* stepped base */
    addPart(rock, new THREE.CylinderGeometry(rad * 1.35, rad * 1.5, 0.4, 9), px, 0.2 + gy, pz, 0, yaw, 0, 1, lo, hi, 0, h);
    /* shaft */
    addPart(rock, new THREE.CylinderGeometry(rad * 0.92, rad * 1.08, h, 9), px, 0.4 + h / 2, pz, Math.cos(leanA) * lean, yaw, Math.sin(leanA) * lean, 1, lo, hi, 0, h);
    /* capital */
    addPart(rock, new THREE.BoxGeometry(rad * 2.3, 0.34, rad * 2.3), px, 0.4 + h + 0.17, pz, 0, yaw, 0, 1, lo, hi, 0, h);
    if (0.4 + h + 0.34 > topY) {
      topY = 0.4 + h + 0.34;
      topX = px;
      topZ = pz;
    }
  }
  addPart(caps, new THREE.OctahedronGeometry(0.2), topX, topY + 0.26, topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
}
/** lanes — one long LOW wall (h 1.1–1.5) oriented along the seeded row axis
 *  so the two winding rows read as corridors; ~half the clusters add a
 *  shorter broken stub beside it. Wall length is drawn 3.5–5.5 but capped at
 *  2.7·r so the visual footprint stays ≈ the collision circle. */
function buildLaneWallCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number, angle: number): void {
  const {
    colors
  } = c;
  const lo = colors.pillarLo.clone().lerp(colors.pillarHi, 0.15); // slightly lifted base
  const hi = colors.pillarHi;
  const len = Math.min(rng.range(3.5, 5.5), 2.7 * r);
  const hgt = rng.range(1.1, 1.5);
  const wid = rng.range(0.55, 0.85);
  const yaw = angle + rng.range(-0.1, 0.1);
  addPart(rock, new THREE.BoxGeometry(1, 1, 1), x, hgt / 2, z, 0, yaw, 0, [len, hgt, wid], lo, hi, 0, hgt);
  if (rng.chance(0.55)) {
    /* broken companion stub — offset laterally + slightly along the wall */const len2 = len * rng.range(0.35, 0.55);
    const h2 = hgt * rng.range(0.55, 0.8);
    const side = rng.chance(0.5) ? 1 : -1;
    const lat = side * (wid / 2 + rng.range(0.25, 0.5));
    const alo = rng.range(-0.3, 0.3) * len;
    const ox = -Math.sin(yaw) * lat + Math.cos(yaw) * alo;
    const oz = Math.cos(yaw) * lat + Math.sin(yaw) * alo;
    addPart(rock, new THREE.BoxGeometry(1, 1, 1), x + ox, h2 / 2, z + oz, 0, yaw + rng.range(-0.08, 0.08), 0, [len2, h2, wid * 0.9], lo, hi, 0, hgt);
  }
  /* rune marker on the wall top — lane walls read as warded boundaries */
  addPart(caps, new THREE.OctahedronGeometry(0.15), x, hgt + 0.2, z, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
}
/** chaos — 4–6 jagged shards (sharp 4/5-sided cones + tetrahedron chunks) at
 *  steep random tilts, heights 0.8–2.6; slightly darker vertex tint. Dense
 *  and wild. */
function buildChaosCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const {
    colors
  } = c;
  const lo = colors.pillarLo.clone().multiplyScalar(0.72); // darker tint
  const hi = colors.pillarHi.clone().multiplyScalar(0.8);
  const shards = rng.int(4, 6);
  let topY = 0;
  let topX = x;
  let topZ = z;
  for (let i = 0; i < shards; i++) {
    const a = rng.range(0, TAU);
    const cr = rng.range(0.1, 0.62) * r;
    const sx = x + Math.cos(a) * cr;
    const sz = z + Math.sin(a) * cr;
    const tiltA = rng.range(0, TAU);
    const tilt = rng.range(0.08, 0.5); // steep — jagged, not stacked
    let tip = 0;
    if (rng.chance(0.6)) {
      /* spike: sharp cone, full height variance */const h = rng.range(0.8, 2.6);
      addPart(rock, new THREE.ConeGeometry(rng.range(0.14, 0.34), h, rng.chance(0.5) ? 4 : 5), sx, h * 0.46, sz, Math.cos(tiltA) * tilt, rng.range(0, TAU), Math.sin(tiltA) * tilt, 1, lo, hi, 0, 2.6);
      tip = h * 0.46 + h / 2;
    } else {
      /* chunk: tilted tetrahedron */const tr = rng.range(0.26, 0.5);
      addPart(rock, new THREE.TetrahedronGeometry(tr), sx, tr * 0.6, sz, Math.cos(tiltA) * tilt, rng.range(0, TAU), Math.sin(tiltA) * tilt, rng.range(0.8, 1.3), lo, hi, 0, 2.6);
      tip = tr * 0.6 + tr;
    }
    if (tip > topY) {
      topY = tip;
      topX = sx;
      topZ = sz;
    }
  }
  addPart(caps, new THREE.OctahedronGeometry(0.15), topX, Math.min(topY + 0.14, 2.75), topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
}
/** Echo of the layout stream's lanes pre-draws (10-b): re-seeds a MIRROR of
 *  the layout stream with the same seed and replays the first two draws to
 *  recover the lanes' global row axis WITHOUT touching the real streams.
 *  COUPLING: mirrors planObstacles' draw order for the "lanes" pattern
 *  (draw 1 = cluster count int, draw 2 = rows.theta range(0, TAU)) — the
 *  NOTE inside planObstacles points here. */
function laneRowAxis(layoutSeed: number): number {
  const m = arenaRng(layoutSeed);
  m.next(); // draw 1: cluster count (rng.int)
  return m.next() * TAU; // draw 2: rows.theta (rng.range(0, TAU))
}
/** Per-cluster wall angle for the lanes kit: start from the echoed row axis,
 *  then follow the NEAREST row-aligned neighbour so walls track the shared
 *  winding (S-curve tangent) instead of a straight global axis. Pure geometry
 *  over the FIXED obstacle list — no rng draws. Walls are direction-agnostic,
 *  so alignment is measured modulo π. */
function laneWallAngle(obstacles: Array<{ x: number; z: number; r: number }>, i: number, axis: number): number {
  const o = obstacles[i];
  if (!o) return axis;
  let bestD = Infinity;
  let bestA = axis;
  for (let j = 0; j < obstacles.length; j++) {
    if (j === i) continue;
    const dx = obstacles[j].x - o.x;
    const dz = obstacles[j].z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= bestD) continue; // only interested in the nearest ALIGNED one
    const ang = Math.atan2(dz, dx);
    let diff = Math.abs(ang - axis) % Math.PI;
    if (diff > Math.PI / 2) diff = Math.PI - diff;
    if (diff < 0.6) {
      bestD = d;
      bestA = ang;
    }
  }
  return bestA;
}
/* The kit table (task 10-b + F-05): cluster geometry + ground-accent +
   obstacle-density bias per terrain. rubble's cluster WRAPS the original
   builder with the angle arg dropped, so its layout-stream consumption —
   and therefore its visual output — stays bit-for-bit identical to the
   pre-10-b arena; rubble's ground spec is all-identity for the same reason. */

/** Per-terrain cluster builder signature (lanes receives the row angle). */
type TerrainClusterBuilder = (c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number, angle: number) => void;

interface TerrainKit {
  cluster: TerrainClusterBuilder;
  ground: TerrainGroundSpec;
  /** F-05: obstacle-count bias (open biomes < 1, dense biomes > 1) applied
   *  inside planObstacles AFTER the count draw — deterministic per seed. */
  density: number;
}

const TERRAIN_KITS: Record<TerrainId, TerrainKit> = {
  rubble: {
    cluster: (c, rock, caps, rng, x, z, r) => buildRubbleCluster(c, rock, caps, rng, x, z, r),
    density: 1,
    ground: {
      countMul: 1,
      sizeMul: 1,
      bright: 0,
      hueMix: 0
    }
  },
  plaza: {
    cluster: buildPlazaCluster,
    /* clean ceremonial floor: sparser, larger, brighter, stone-lifted */
    density: 0.45,
    ground: {
      countMul: 0.55,
      sizeMul: 1.35,
      bright: 0.15,
      hueMix: 0.3
    }
  },
  ring: {
    cluster: buildPillarRingCluster,
    /* colonnade court: slightly sparser + stoned */
    density: 1,
    ground: {
      countMul: 0.8,
      sizeMul: 1.05,
      bright: 0.05,
      hueMix: 0.15
    }
  },
  lanes: {
    cluster: buildLaneWallCluster,
    /* worn corridors: denser, smaller chips */
    density: 1,
    ground: {
      countMul: 1.3,
      sizeMul: 0.8,
      bright: -0.05,
      hueMix: 0.1
    }
  },
  chaos: {
    cluster: buildChaosCluster,
    /* wild ground: densest, smallest, darkest */
    density: 1.35,
    ground: {
      countMul: 1.45,
      sizeMul: 0.75,
      bright: -0.12,
      hueMix: 0
    }
  },
  graveyard: {
    cluster: buildGraveyardCluster,
    /* old burial ground: near-neutral floor, slightly darker chips */
    density: 1,
    ground: {
      countMul: 0.95,
      sizeMul: 0.9,
      bright: -0.04,
      hueMix: 0.06
    }
  },
  /* ---- F-05 new biomes ---- */
  caldera: {
    cluster: buildCalderaCluster,
    /* volcanic shard field: ashen chips, warm-dark ground */
    density: 1,
    ground: {
      countMul: 1.1,
      sizeMul: 1.0,
      bright: -0.08,
      hueMix: 0.18
    }
  },
  glacial: {
    cluster: buildGlacialCluster,
    /* frozen archive: sparse, LARGE pale patches — the clearest floor */
    density: 0.8,
    ground: {
      countMul: 0.7,
      sizeMul: 1.25,
      bright: 0.22,
      hueMix: 0.25
    }
  },
  thornwild: {
    cluster: buildThornwildCluster,
    /* blighted thicket: denser, darker organic scatter */
    density: 1.15,
    ground: {
      countMul: 1.35,
      sizeMul: 0.85,
      bright: -0.06,
      hueMix: 0.2
    }
  },
  astral: {
    cluster: buildAstralCluster,
    /* shardfield: sparse, slightly cool-dark patches */
    density: 0.85,
    ground: {
      countMul: 0.6,
      sizeMul: 1.1,
      bright: -0.02,
      hueMix: 0.3
    }
  }
};
/* graveyard dressing table (10-e): the Kenney Graveyard Kit set acquired in
   10-c. Majors anchor a cluster; minors accompany. Gameplay scale is baked
   into the GLBs (heights ≈1.1–4.4 world units). If the models are missing
   (asset fallback path), the cluster degrades to the procedural rubble kit. */
const GRAVE_MAJORS: readonly ModelKind[] = ["terrain-crypt", "terrain-sarcophagus", "terrain-tree", "terrain-pillar"];
const GRAVE_MINORS: readonly ModelKind[] = ["terrain-tomb", "terrain-tomb-round", "terrain-tomb-broken", "terrain-cross", "terrain-fence", "terrain-lantern"];
/** graveyard — a model-dressed burial cluster (10-e): one major piece (crypt /
 *  sarcophagus / dead tree / memorial pillar) anchored near the cluster
 *  center, a seeded chance of one minor (tomb / cross / fence / lantern), and
 *  the kit contract's single rune cap glowing at the tallest piece. Falls
 *  back to the rubble kit when the decor models are unavailable. */
function buildGraveyardCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  if (!c.decor || !c.group || !c.decorClones) {
    buildRubbleCluster(c, rock, caps, rng, x, z, r);
    return;
  }
  let topY = 0;
  let topX = x;
  let topZ = z;
  let placed = 0;
  const place = (kind: ModelKind, maxOff: number): void => {
    const g = c.decor!(kind);
    if (!g) return;
    const ang = rng.range(0, TAU);
    const off = rng.range(0, maxOff) * r;
    g.position.set(x + Math.cos(ang) * off, 0, z + Math.sin(ang) * off);
    g.rotation.y = rng.range(0, TAU);
    c.group.add(g);
    c.decorClones.push(g);
    placed++;
    const box = new THREE.Box3().setFromObject(g);
    if (box.max.y > topY) {
      topY = box.max.y;
      topX = g.position.x;
      topZ = g.position.z;
    }
  };
  place(rng.pick(GRAVE_MAJORS), 0.22);
  if (rng.chance(0.55)) place(rng.pick(GRAVE_MINORS), 0.72);
  if (placed === 0) {
    /* nothing spawned (asset fallback) — procedural rocks keep the cluster */buildRubbleCluster(c, rock, caps, rng, x, z, r);
    return;
  }
  /* kit contract: exactly one rune cap per cluster, at the tallest piece */
  addPart(caps, new THREE.OctahedronGeometry(0.15), topX, Math.min(topY + 0.14, 2.75), topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, WHITE, WHITE, 0, 1);
}
/* ------ F-05 new biome kits (all PROCEDURAL — zero new assets, zero new
   draw calls; rock/caps merged buckets as always). Colors stay anchored on
   the act palette (pillarLo/Hi + rune) so the normalized-lighting system
   keeps every biome equally readable; each kit lerps a MODEST identity bias
   and uses a tinted cap instead of pure white. ------ */

/* scratch color for kit tints (module scope — never allocate per cluster) */
const _kit = new THREE.Color();
/** caldera — Ashen Caldera: 2–4 jagged basalt fins (thin 4-sided cones,
 *  steep tilts) + one flat crust slab; ember-tinted crown on the tallest
 *  fin. Reads as cooled lava shard fields. */
function buildCalderaCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const lo = c.colors.pillarLo.clone().lerp(_kit.set(0x2a1a14), 0.35);
  const hi = c.colors.pillarHi.clone().lerp(_kit.set(0x51362a), 0.3);
  const cap = WHITE.clone().lerp(_kit.set(0xff9a3d), 0.55);
  const fins = rng.int(2, 4);
  let topY = 0, topX = x, topZ = z;
  for (let i = 0; i < fins; i++) {
    const a = rng.range(0, TAU);
    const off = rng.range(0.1, 0.6) * r;
    const fx = x + Math.cos(a) * off, fz = z + Math.sin(a) * off;
    const h = rng.range(0.7, 2.2);
    const ta = rng.range(0, TAU), tilt = rng.range(0.12, 0.38);
    addPart(rock, new THREE.ConeGeometry(rng.range(0.22, 0.42), h, 4), fx, h * 0.48, fz, Math.cos(ta) * tilt, rng.range(0, TAU), Math.sin(ta) * tilt, 1, lo, hi, 0, h);
    if (h > topY) { topY = h; topX = fx; topZ = fz; }
  }
  /* flat crust slab at the cluster foot — the "cooled pool" read */
  addPart(rock, new THREE.CylinderGeometry(r * 0.8, r * 0.95, 0.22, 8), x, 0.11, z, 0, rng.range(0, TAU), 0, 1, lo, hi, 0, 0.25);
  addPart(caps, new THREE.OctahedronGeometry(0.17), topX, topY + 0.26, topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, cap, cap, 0, 1);
}
/** glacial — Glacial Archive: 2–4 cold crystal spikes (tall thin 6-sided
 *  prisms with a knuckle base, slight lean) + a pale shard chip; the crown
 *  glints cold cyan-white. */
function buildGlacialCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const lo = c.colors.pillarLo.clone().lerp(_kit.set(0x9fc4cf), 0.4);
  const hi = c.colors.pillarHi.clone().lerp(_kit.set(0xd8eef5), 0.45);
  const cap = WHITE.clone().lerp(_kit.set(0x9fe8ff), 0.5);
  const spikes = rng.int(2, 4);
  let topY = 0, topX = x, topZ = z;
  for (let i = 0; i < spikes; i++) {
    const a = rng.range(0, TAU);
    const off = rng.range(0.1, 0.55) * r;
    const sx = x + Math.cos(a) * off, sz = z + Math.sin(a) * off;
    const h = rng.range(0.9, 2.6);
    const ta = rng.range(0, TAU), tilt = rng.range(0.05, 0.2);
    /* knuckle base + faceted spike */
    addPart(rock, new THREE.SphereGeometry(rng.range(0.22, 0.34), 6, 4), sx, 0.16, sz, 0, 0, 0, 1, lo, hi, 0, 0.4);
    addPart(rock, new THREE.ConeGeometry(rng.range(0.16, 0.3), h, 6), sx, h * 0.5 + 0.1, sz, Math.cos(ta) * tilt, rng.range(0, TAU), Math.sin(ta) * tilt, 1, lo, hi, 0.1, h);
    if (h > topY) { topY = h; topX = sx; topZ = sz; }
  }
  if (rng.chance(0.5)) {
    /* fallen shard chip */
    addPart(rock, new THREE.TetrahedronGeometry(rng.range(0.25, 0.4)), x + rng.range(-0.4, 0.4) * r, 0.18, z + rng.range(-0.4, 0.4) * r, rng.range(0, 1), rng.range(0, TAU), 0, 1, lo, hi, 0, 0.5);
  }
  addPart(caps, new THREE.OctahedronGeometry(0.16), topX, topY + 0.3, topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, cap, cap, 0, 1);
}
/** thornwild — Thornwild Blight: 2–3 twisted root spikes (two stacked tilted
 *  cone segments — the upper thinner and tilted further, reading as a curve)
 *  + a low bramble mass; sickly green-gold crown. Silhouette stays OPEN so
 *  ground readability is preserved. */
function buildThornwildCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const lo = c.colors.pillarLo.clone().lerp(_kit.set(0x232e18), 0.4);
  const hi = c.colors.pillarHi.clone().lerp(_kit.set(0x44502c), 0.35);
  const cap = WHITE.clone().lerp(_kit.set(0xb8d98a), 0.45);
  const roots = rng.int(2, 3);
  let topY = 0, topX = x, topZ = z;
  for (let i = 0; i < roots; i++) {
    const a = rng.range(0, TAU);
    const off = rng.range(0.15, 0.6) * r;
    const rx = x + Math.cos(a) * off, rz = z + Math.sin(a) * off;
    const h1 = rng.range(0.5, 1.0);
    const h2 = rng.range(0.6, 1.4);
    const ta = rng.range(0, TAU), t1 = rng.range(0.1, 0.3), t2 = t1 + rng.range(0.12, 0.3);
    /* lower segment */
    addPart(rock, new THREE.ConeGeometry(rng.range(0.26, 0.4), h1, 5), rx, h1 * 0.5, rz, Math.cos(ta) * t1, rng.range(0, TAU), Math.sin(ta) * t1, 1, lo, hi, 0, h1);
    /* upper segment — leans further out along the same axis (curve read) */
    const ux = rx + Math.cos(ta) * t1 * h1 * 0.9, uz = rz + Math.sin(ta) * t1 * h1 * 0.9;
    addPart(rock, new THREE.ConeGeometry(rng.range(0.12, 0.22), h2, 5), ux, h1 + h2 * 0.42, uz, Math.cos(ta) * t2, rng.range(0, TAU), Math.sin(ta) * t2, 1, hi, hi, h1 * 0.6, h1 + h2);
    if (h1 + h2 > topY) { topY = h1 + h2; topX = ux; topZ = uz; }
  }
  /* low bramble mass at the foot */
  addPart(rock, new THREE.SphereGeometry(r * rng.range(0.35, 0.5), 7, 4), x + rng.range(-0.2, 0.2) * r, 0.22, z + rng.range(-0.2, 0.2) * r, 0, 0, 0, [1, 0.55, 1], lo, hi, 0, 0.5);
  addPart(caps, new THREE.OctahedronGeometry(0.13), topX, Math.min(topY + 0.2, 2.6), topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, cap, cap, 0, 1);
}
/** astral — Astral Shardfield: 1–3 leaning obsidian monoliths (tall thin
 *  boxes, strong tilts, varied yaw) + one small FLOATING shard octahedron
 *  hovering beside the tallest; violet-cyan crown. */
function buildAstralCluster(c: ArenaCtx, rock: Bucket, caps: Bucket, rng: RNG, x: number, z: number, r: number): void {
  const lo = c.colors.pillarLo.clone().lerp(_kit.set(0x191026), 0.35);
  const hi = c.colors.pillarHi.clone().lerp(_kit.set(0x3a2a55), 0.3);
  const cap = WHITE.clone().lerp(_kit.set(0xb48aff), 0.5);
  const n = rng.int(1, 3);
  let topY = 0, topX = x, topZ = z;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const off = rng.range(0.1, 0.55) * r;
    const mx = x + Math.cos(a) * off, mz = z + Math.sin(a) * off;
    const h = rng.range(1.4, 3.2);
    const ta = rng.range(0, TAU), tilt = rng.range(0.15, 0.45);
    addPart(rock, new THREE.BoxGeometry(1, 1, 1), mx, h * 0.48, mz, Math.cos(ta) * tilt, rng.range(0, TAU), Math.sin(ta) * tilt, [rng.range(0.28, 0.5), h, rng.range(0.28, 0.5)], lo, hi, 0, h);
    if (h > topY) { topY = h; topX = mx; topZ = mz; }
  }
  /* the floating shard — an offset hover reads as weightlessness */
  const fa = rng.range(0, TAU);
  addPart(caps, new THREE.OctahedronGeometry(rng.range(0.14, 0.22)), topX + Math.cos(fa) * rng.range(0.5, 0.9), Math.min(topY * 0.7 + 0.6, 2.9), topZ + Math.sin(fa) * rng.range(0.5, 0.9), rng.range(0, 3), rng.range(0, 3), 0, 1, cap, cap, 0, 1);
  /* grounded crown on the monolith itself */
  addPart(caps, new THREE.OctahedronGeometry(0.12), topX, topY + 0.18, topZ, rng.range(0, 3), rng.range(0, 3), 0, 1, cap, cap, 0, 1);
}
/* ----------------------------- glow layers ------------------------------- */ /** Flat horizontal ring (pre-rotated) pushed into a bucket. */
function addFlatRing(b: Bucket, r0: number, r1: number, y: number, seg = 96): void {
  const g = new THREE.RingGeometry(r0, r1, seg);
  g.rotateX(-Math.PI / 2);
  addPart(b, g, 0, y, 0, 0, 0, 0, 1, WHITE, WHITE, 0, 1);
}
/** All additive rune-glow flat geometry: concentric ground rings, sigil, fence rims.
 *  F-04: every ring radius is a FRACTION of the canonical ARENA_RADIUS
 *  (fractions preserve the legacy r=42 composition at any configured size). */
function buildGlowRings(c: ArenaCtx, glow: Bucket): void {
  const R = ARENA_RADIUS;
  addFlatRing(glow, R * 0.2738, R * 0.3024, 0.06); // inner trial ring (was 11.5–12.7 @42)
  addFlatRing(glow, R * 0.6048, R * 0.6405, 0.07); // mid ring (was 25.4–26.9 @42)
  addFlatRing(glow, R * 0.9619, R * 0.9857, 0.08); // boundary ring (under the fence)
  addFlatRing(glow, R * 1.0643, R * 1.0738, 0.06); // outer lip
  addFlatRing(glow, 2.1, 2.55, 0.07, 48); // center sigil ring
  addFlatRing(glow, R * 0.9905, R * 1.0095, FENCE_HEIGHT + 0.02); // fence top rim
  addFlatRing(glow, R * 0.9905, R * 1.0095, 0.04); // fence base rim
  if (c.act.id % 2 === 0) {
    // even acts get a doubled rune cadence
    addFlatRing(glow, R * 0.3119, R * 0.3162, 0.07);
    addFlatRing(glow, R * 0.5833, R * 0.5871, 0.06);
  }
}
export function buildArena(
  act: ActDef,
  rng: RNG,
  opts: { quality: number; terrain?: TerrainId; layout?: ArenaLayoutKind; decor?: (kind: ModelKind) => THREE.Group | null },
): ArenaVisuals {
  const quality = Number.isFinite(opts.quality) ? THREE.MathUtils.clamp(opts.quality, 0.5, 1) : 1;
  const colors = {
    sky: cssRGB(act.palette.sky, new THREE.Color()),
    rune: cssRGB(act.palette.rune, new THREE.Color()),
    mote: cssRGB(act.palette.mote, new THREE.Color()),
    pillarHi: new THREE.Color(act.palette.pillar[0]),
    pillarLo: new THREE.Color(act.palette.pillar[1]),
    ground: new THREE.Color(act.palette.ground),
    accent: new THREE.Color(act.palette.groundAccent)
  };
  /* normalized floor albedo: lift toward the biome accent (keeps hue), then
   scale to the shared target luminance — clamped so extreme palettes keep
   their character while every act's floor stays equally readable */
  const groundColor = colors.ground.clone().lerp(colors.accent, 0.4);
  groundColor.multiplyScalar(THREE.MathUtils.clamp(GROUND_LUM / Math.max(luminance(groundColor), 1e-4), 0.8, 2.2));
  /* --- two independent rng streams (plan §7: "cosmetic random calls cannot
   change combat spawns") — the incoming seeded rng is split ONCE; the
   gameplay layout stream plans the obstacles, the cosmetic stream drives
   every decorative draw (patches, studs, pillars, motes, landmark jitter).
   Same seed → same split → same obstacle layout regardless of quality. */
  const split = (rng.int(0, 0x3fffffff) ^ rng.int(0, 0x3fffffff) << 2) >>> 0;
  const layout = arenaRng((split ^ LAYOUT_SALT) >>> 0);
  const cosmetic = arenaRng((split ^ COSMETIC_SALT) >>> 0);
  /* --- rune rubble obstacles: validated, deterministic gameplay layout
   (F-05: the TOPOLOGY kind — defaulting to the terrain's first allowed
   kind for old callers — selects the pattern; the kit's density bias
   keeps open biomes open and dense biomes dense) --- */
  const terrain = opts.terrain !== undefined && opts.terrain in TERRAIN_KITS ? opts.terrain : "rubble";
  const kind: ArenaLayoutKind = opts.layout ?? TERRAIN_KIND_FALLBACK[terrain] ?? "scatter";
  const kit = TERRAIN_KITS[terrain];
  const obstacles = planObstacles(layout, kind, kit.density);
  /* lanes only: recover the seeded row axis by echoing the layout stream's
   lanes pre-draws on a same-seeded mirror (pure; real streams untouched) */
  const laneAxis = kind === "lanes" ? laneRowAxis((split ^ LAYOUT_SALT) >>> 0) : 0;
  const group = new THREE.Group();
  group.name = "ArenaVisuals";
  /* 10-e: decor dressing support — model clones land in `group`, tracked in
   `decorClones` so teardown can detach them WITHOUT disposing the geometry/
   textures they share with the AssetSystem templates. */
  const decorClones: THREE.Group[] = [];
  const c: ArenaCtx = {
    act,
    rng: cosmetic,
    quality,
    colors,
    groundColor,
    group,
    decor: opts.decor,
    decorClones
  };
  /* --- ground + merged rock (patches, studs, pillars) --- */
  const ground = buildGround(c);
  group.add(ground);
  const rock = newBucket();
  const caps = newBucket();
  scatterPatches(c, rock, kit.ground);
  buildStuds(c, rock, caps);
  /* obstacle clusters INSIDE the arena (plan §7) — merged into the rock/caps
   buckets (zero extra draw calls); kit geometry drawn from the layout
   stream AFTER planObstacles froze the layout, so visuals can never move
   a collision circle. Lanes walls get the per-cluster row orientation. */
  obstacles.forEach((ob, i) => {
    kit.cluster(c, rock, caps, layout, ob.x, ob.z, ob.r, kind === "lanes" ? laneWallAngle(obstacles, i, laneAxis) : 0);
  });
  const pillarCount = cosmetic.int(12, 14);
  const a0 = cosmetic.range(0, TAU);
  for (let i = 0; i < pillarCount; i++) {
    const ang = a0 + i / pillarCount * TAU + cosmetic.range(-0.12, 0.12);
    const rad = cosmetic.range(ARENA_RADIUS + 3, ARENA_RADIUS + 7);
    buildPillar(c, rock, caps, Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04
  });
  const rockMesh = new THREE.Mesh(bucketGeometry(rock), rockMat);
  rockMesh.matrixAutoUpdate = false;
  rockMesh.updateMatrix();
  group.add(rockMesh);
  /* --- rune glow rings (ground runes + fence rims + center sigil) --- */
  const glow = newBucket();
  buildGlowRings(c, glow);
  const glowMat = new THREE.MeshBasicMaterial({
    color: colors.rune,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const glowMesh = new THREE.Mesh(bucketGeometry(glow), glowMat);
  glowMesh.renderOrder = 2;
  glowMesh.matrixAutoUpdate = false;
  glowMesh.updateMatrix();
  group.add(glowMesh);
  /* --- energy fence (containment shell at r=42) + inner ghost --- */
  const fenceMat = new THREE.MeshBasicMaterial({
    color: colors.rune,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const fence = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, FENCE_HEIGHT, 72, 1, true), fenceMat);
  fence.position.y = FENCE_HEIGHT / 2;
  fence.renderOrder = 4;
  group.add(fence);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: colors.rune,
    transparent: true,
    opacity: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const ghost = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS - 0.2, ARENA_RADIUS - 0.2, FENCE_HEIGHT, 72, 1, true), ghostMat);
  ghost.position.y = FENCE_HEIGHT / 2;
  ghost.renderOrder = 3;
  group.add(ghost);
  /* --- emissive caps (pillar crowns + stud wardstones) --- */
  const capMat = new THREE.MeshBasicMaterial({
    color: colors.rune,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const capMesh = new THREE.Mesh(bucketGeometry(caps), capMat);
  capMesh.renderOrder = 5;
  capMesh.matrixAutoUpdate = false;
  capMesh.updateMatrix();
  group.add(capMesh);
  /* --- CENTER LANDMARK — the rift portal (plan §7) ----------------------
   (a) grounded runic base rings (merged into the glow bucket, 0 draws),
   (b) two interlocked torus rings tilted ±30°, spinning as one gyroscope
       (merged into a single mesh, 1 draw),
   (c) an inner "swirl" of two counter-rotating flat rings (2 draws),
   (d) a gentle upward wisp column carried by the mote system (first
       RIFT_WISP_MOTES motes spawn near the center, rune-tinted via vertex
       colors, and wrap at the landmark's ceiling),
   (e) a few small orbiting shards for life (capMat, 1 draw).
   Max visual height ~4.2 (< 6), thin additive profile, depthWrite:false,
   NO collision — the mage walks straight through the middle. ~2k tris. */
  addFlatRing(glow, 3.0, 3.42, 0.09, 64); // runic base ring (outer)
  addFlatRing(glow, 2.42, 2.52, 0.08, 48); // runic base ring (inner)
  const riftRingMat = new THREE.MeshBasicMaterial({
    color: colors.rune,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  /* two tori, tilted ±30° from vertical, merged into one geometry —
   counter-rotation comes from the whole gyroscope spinning around Y */
  const ringsBucket = newBucket();
  for (const side of [1, -1]) {
    const torus = new THREE.TorusGeometry(2.05, 0.075, 8, 44);
    torus.rotateX(side * Math.PI / 6);
    addPart(ringsBucket, torus, 0, 2.35, 0, 0, 0, 0, 1, WHITE, WHITE, 0, 1);
  }
  const riftRings = new THREE.Mesh(bucketGeometry(ringsBucket), riftRingMat);
  riftRings.renderOrder = 6;
  group.add(riftRings);
  const riftSwirlMat = new THREE.MeshBasicMaterial({
    color: colors.rune,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  /* the swirl is an ARC stack (full rings would spin invisibly): arcs merge
   into one geometry per layer, and mesh.rotation.y sweeps them around */
  const swirlBucketA = newBucket();
  for (let k = 0; k < 3; k++) {
    addPart(swirlBucketA, new THREE.RingGeometry(0.82, 1.18, 26, 1, k / 3 * TAU, 1.9), 0, 1.02, 0, -Math.PI / 2, 0, 0, 1, WHITE, WHITE, 0, 1);
  }
  const riftSwirlA = new THREE.Mesh(bucketGeometry(swirlBucketA), riftSwirlMat);
  riftSwirlA.renderOrder = 6;
  group.add(riftSwirlA);
  const swirlBucketB = newBucket();
  for (let k = 0; k < 2; k++) {
    addPart(swirlBucketB, new THREE.RingGeometry(1.34, 1.72, 30, 1, k / 2 * TAU, 2.2), 0, 1.46, 0, -Math.PI / 2, 0, 0, 1, WHITE, WHITE, 0, 1);
  }
  const riftSwirlB = new THREE.Mesh(bucketGeometry(swirlBucketB), riftSwirlMat);
  riftSwirlB.renderOrder = 6;
  group.add(riftSwirlB);
  /* small orbiting shards (life; merged, rotate together) */
  const shardBucket = newBucket();
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + cosmetic.range(-0.15, 0.15);
    const r = 2.5 + cosmetic.range(-0.2, 0.2);
    addPart(shardBucket, new THREE.TetrahedronGeometry(0.3), Math.cos(a) * r, 2.3 + cosmetic.range(-0.3, 0.4), Math.sin(a) * r, cosmetic.range(0, 3), cosmetic.range(0, 3), cosmetic.range(0, 3), cosmetic.range(0.8, 1.2), WHITE, WHITE, 0, 1);
  }
  const riftShards = new THREE.Mesh(bucketGeometry(shardBucket), capMat);
  riftShards.renderOrder = 6;
  group.add(riftShards);
  /* --- motes: slow-drifting ambient particles in a torus volume + the
   rift's upward wisp column (first RIFT_WISP_MOTES indices spawn near the
   center, tinted rune-color via per-vertex colors, drifting up faster and
   wrapping at the landmark ceiling — same Points draw, zero extra cost) --- */
  const moteN = Math.max(60, Math.round(MOTE_BASE_COUNT * quality));
  const wispN = Math.min(RIFT_WISP_MOTES, moteN);
  const motePos = new Float32Array(moteN * 3);
  const moteCol = new Float32Array(moteN * 3);
  const moteBaseY = new Float32Array(moteN);
  const moteSpd = new Float32Array(moteN);
  const moteAmp = new Float32Array(moteN);
  const moteBobSpd = new Float32Array(moteN);
  const moteBobPh = new Float32Array(moteN);
  for (let i = 0; i < moteN; i++) {
    const wisp = i < wispN;
    const a = cosmetic.range(0, TAU);
    const r = wisp ? Math.sqrt(cosmetic.range(0.09, 6.2)) // tight column r 0.3..2.5
    : Math.sqrt(cosmetic.range(64, 1936)); // uniform annulus r 8..44
    motePos[i * 3] = Math.cos(a) * r;
    motePos[i * 3 + 2] = Math.sin(a) * r;
    moteBaseY[i] = wisp ? cosmetic.range(0.25, RIFT_WISP_CEIL - 0.4) : cosmetic.range(MOTE_Y_MIN, MOTE_Y_MAX);
    motePos[i * 3 + 1] = moteBaseY[i];
    moteSpd[i] = wisp ? cosmetic.range(0.9, 1.9) : cosmetic.range(0.15, 0.5);
    moteAmp[i] = wisp ? cosmetic.range(0.08, 0.22) : cosmetic.range(0.15, 0.45);
    moteBobSpd[i] = cosmetic.range(0.5, 1.2);
    moteBobPh[i] = cosmetic.range(0, TAU);
    const tint = wisp ? colors.rune : colors.mote;
    moteCol[i * 3] = tint.r;
    moteCol[i * 3 + 1] = tint.g;
    moteCol[i * 3 + 2] = tint.b;
  }
  const moteGeom = new THREE.BufferGeometry();
  const moteAttr = new THREE.BufferAttribute(motePos, 3);
  moteGeom.setAttribute("position", moteAttr);
  moteGeom.setAttribute("color", new THREE.BufferAttribute(moteCol, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    size: 0.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const motes = new THREE.Points(moteGeom, moteMat);
  motes.renderOrder = 7;
  motes.frustumCulled = false;
  group.add(motes);
  /* --- lights (inside the group; engine must not double-add ambient) ---
   Fixed structure (hemi + shadowless key + center rune point light);
   per-act intensity normalization — see the lighting constants above. */
  const hemiIntensity = THREE.MathUtils.clamp(HEMI_SKY_LUM / Math.max(luminance(colors.sky), 1e-4), 0.3, 9);
  const hemiGround = colors.accent.clone().lerp(colors.pillarLo, 0.45);
  hemiGround.multiplyScalar(THREE.MathUtils.clamp(HEMI_GND_LUM / Math.max(luminance(hemiGround) * hemiIntensity, 1e-4), 0.2, 4));
  const hemi = new THREE.HemisphereLight(colors.sky, hemiGround, hemiIntensity);
  const dir = new THREE.DirectionalLight(WHITE.clone().lerp(colors.rune, KEY_TINT), KEY_INTENSITY); // biome-tinted key
  dir.position.set(20, 40, 10);
  dir.castShadow = false; // engine may add its own shadow light
  const runeIntensity = THREE.MathUtils.clamp(RUNE_LUM * 100 / Math.max(luminance(colors.rune), 1e-3), 24, 95);
  const runeLight = new THREE.PointLight(colors.rune, runeIntensity, 90, 2);
  runeLight.position.set(0, 7, 0);
  group.add(hemi, dir, runeLight);
  /* --- sky dome: huge inverted sphere so the void reads as biome sky --- */
  const skyMat = new THREE.MeshBasicMaterial({
    color: colors.sky,
    side: THREE.BackSide,
    fog: false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 40, 20), skyMat);
  sky.matrixAutoUpdate = false;
  sky.updateMatrix();
  group.add(sky);
  /* ------------------------------ lifetime ------------------------------- */
  let disposed = false;
  const update = (dt: number, t: number): void => {
    if (disposed) return;
    // fence breathes
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.35);
    fenceMat.opacity = 0.1 + 0.05 * pulse;
    ghostMat.opacity = 0.045 + 0.025 * pulse;
    // ground rune pulse (offset phase)
    glowMat.opacity = 0.22 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.8 + 1.6));
    // center rune light flicker (normalized base per act)
    runeLight.intensity = runeIntensity * (0.9 + 0.1 * Math.sin(t * 2.1));
    // rift landmark: gyroscope rings precess, swirl counter-rotates + breathes,
    // orbiting shards ride the rings
    riftRings.rotation.y = t * 0.22;
    riftRings.position.y = Math.sin(t * 0.6) * 0.14;
    riftSwirlA.rotation.y = t * 0.9;
    riftSwirlB.rotation.y = -t * 0.55;
    riftSwirlMat.opacity = 0.24 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.7));
    riftShards.rotation.y = -t * 0.34;
    riftShards.position.y = Math.sin(t * 0.85 + 1.2) * 0.2;
    // motes: upward drift + wrap + per-mote bob, plus slow whole-system swirl;
    // rift wisps (first wispN) wrap at the landmark ceiling for a tight column
    for (let i = 0; i < moteN; i++) {
      const wisp = i < wispN;
      let y = moteBaseY[i] + dt * moteSpd[i];
      if (wisp ? y > RIFT_WISP_CEIL : y > MOTE_Y_MAX + 0.2) y = wisp ? 0.2 : MOTE_Y_MIN - 0.1;
      moteBaseY[i] = y;
      motePos[i * 3 + 1] = y + Math.sin(t * moteBobSpd[i] + moteBobPh[i]) * moteAmp[i];
    }
    moteAttr.needsUpdate = true;
    motes.rotation.y += dt * 0.02;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    /* 10-e: detach shared decor clones FIRST — their geometry/textures belong
    to the AssetSystem templates and must survive this arena's teardown. */
    for (const g of decorClones) g.removeFromParent();
    decorClones.length = 0;
    group.traverse(obj => {
      const geom = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (geom) geom.dispose();
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());else mat.dispose();
      }
    });
    group.removeFromParent();
  };
  return {
    group,
    update,
    dispose,
    radius: ARENA_RADIUS,
    lights: [hemi, dir, runeLight],
    obstacles
  };
}