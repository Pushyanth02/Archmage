import * as THREE from "three";

/* ARCHMAGE: RIFTBOUND (3D Edition) — 3D visual effects system.
   Self-contained: imports `three` only. Consumed by engine.ts + spells.ts +
   entities.ts.

   ======================================================================
   SECTION ORDER (10-d "sequentially organize" pass — the file reads in the
   order effects are CONSUMED, which is also the per-frame update order):

     §1 options + constants   — the opts interfaces every caller sees
     §2 shaders               — the particle point-sprite program
     §3 pool state            — the state interfaces, in update order
     §4 system fields         — VfxSystem members, in update order
     §5 lifecycle             — ctor pools, sprite swap, dispose, quality
     §6 per-frame update      — update() + one updater per pool, in order
     §7 particle core         — spawnParticle + count/life scalers
     §8 effects               — the public effect API (see contract below)
     §9 damage numbers (DOM)  — the overlay layer

   EFFECT-SEQUENCE CONTRACT — the canonical combat moments and the layered
   effects each one plays. A moment's layers are enumerated spawn-order; every
   layer is pooled + allocation-free at spawn:

     SPAWN TELL (foe rift-in, entities.spawn)
       ring      containment ring (foe color, def.radius × 3.4)
       burst     rising arrival motes
       (bosses: double ring + 26-mote pillar — spawnBoss)

     CAST TELL (player + foe wind-ups, spells.cast / entities.tellFire)
       auraPulse  ground ring + body motes + chest flash (player)
       castGround contracting targeting ring + bloom + center flash
       ring+burst foe tell: contracting tick-ring + charge motes; the body
                   emissive pulses + the anticipation coil (entities.ts)

     PROJECTILE (spells.updateProjectile)
       trailPuff  per-frame element trail (per-school colors/sizes)
       halo       billboard glow sprite riding the projectile mesh
       glint      steering sparks (homing seekers)

     IMPACT (vfx.impact — spell hits / lance / blink strikes)
       hitSpark   cone of sparks off the wound + white-hot flash
       flash      2-particle white-leaning core pop
       ring       small thick ring at the wound (scales with strength)
       ripple     10-d: ground concentric-ripple shockwave when the hit is
                  near the floor (kenney-ripple sprite)

     BLAST (vfx.explosion — kills, novas, meaningful blasts)
       ring ×2    thin fast outer + thick slow inner shockwave
       decal      lingering ground glow (radius ≥ 1.15)
       ripple     10-d: expanding concentric ground ripple (same gate)
       flash      white-leaning core particles
       debris     radial shard streaks, every third white-hot
       smoke      slow buoyant half-gray puffs

     DEATH (engine.killEnemy + the 10-d death linger, entities.ts)
       explosion  the blast layer above (foes 1.4 / bosses 8)
       soulWisp   single rising swaying wisp
       slashArc   10-d (melee deaths land on a committed swing): curved
                  crescent arc at the strike (kenney-crescent sprite)
       body       10-d: the corpse itself lingers 0.65s (1.05s bosses)
                  playing Death01/Death_A or a procedural collapse, then
                  sinks + fades (entities.ts death-linger section)
       numbers    damage numbers ride the whole chain (DOM pool, §9)

   Engine notes:
   - Call update(dt) once per frame BEFORE renderer.render (any dt; clamped).
   - update() is safe before attachDamageLayer() (numbers simply no-op).
   - Mixers must have advanced BEFORE update() (engine frame-order contract):
     attached effects (slash arcs, ripples under corpses) align with this
     frame's poses, never the previous frame's.
   - dispose() is idempotent and frees every GPU resource it created.
   - All colors are plain 0xrrggbb numbers (engine converts via content.hexNum).
   - Ground plane is y=0; rings default to y=0.08 to avoid z-fighting.

   PERF CONTRACT (10-d optimization pass):
   - Every pool is preallocated in the constructor; steady state performs
     ZERO allocations (module-scope scratch vectors/colors, SoA typed arrays,
     swap-remove packing). The ONLY `new THREE.*` outside the ctor/dispose is
     the ring band-geometry rebuild, which is guarded by a builtTh check and
     never fires in steady state (two pre-built thickness families).
   - Pool minimums are enforced in setQuality (each cap floors at 2–6 slots).
   - The damage-number DOM pool is BOUNDED at DMG_POOL=48 divs, created once,
     steal-oldest on overflow; per-frame writes touch active divs only. */

/* ------------------------------- options -------------------------------- */

export interface BurstOpts {
  /** Outward speed, default 6. */
  speed?: number;
  /** Upward velocity bias added after direction, default 2. */
  up?: number;
  /** Particle size multiplier (world units), default 1. */
  size?: number;
  /** Lifetime seconds, default 0.7. */
  life?: number;
  /** Downward accel, default 9 (particles fall). Negative = rise. */
  gravity?: number;
  /** 0..1 direction randomness. 1 = full sphere, 0 = straight up. Default 1. */
  spread?: number;
}

export interface RingOpts {
  /** Seconds, default 0.5. */
  life?: number;
  /** Band width as fraction of max radius (inner = 1 - thickness), default 0.35.
      Quantized to 0.35 / 0.5 so pooled geometries never rebuild in steady state. */
  thickness?: number;
  /** Absolute Y height above ground, default 0.08. */
  y?: number;
  /** Easing sharpness exponent (higher = snappier initial pop), default 1. */
  expand?: number;
  /** Implosion: contract from maxRadius to 0 instead of expanding (targeting telegraphs). */
  contract?: boolean;
}

export interface TrailOpts {
  /** Base velocity (world units/s), default 0. */
  vx?: number;
  vy?: number;
  vz?: number;
  /** Random velocity magnitude added per axis, default 0.25. */
  jitter?: number;
  /** Particle size (world units), default 0.6. */
  size?: number;
  /** Lifetime seconds, default 0.35. */
  life?: number;
  /** Peak alpha, default 0.9. */
  alpha?: number;
  /** Downward accel (negative rises), default 0. */
  gravity?: number;
  /** Linear drag per second, default 0.6. */
  drag?: number;
  /** Lateral sine sway amplitude/freq (ribbon-like drift), default 0. */
  swayA?: number;
  swayF?: number;
  /** Spawn offset from `pos`, default 0. */
  ox?: number;
  oy?: number;
  oz?: number;
}

export interface DecalOpts {
  /** Seconds, default 1.5. */
  life?: number;
  /** Peak opacity, default 0.55. */
  intensity?: number;
  /** Absolute Y height above ground, default 0.05. */
  y?: number;
}

export interface ArcOpts {
  /** Seconds, default 0.22. */
  life?: number;
  /** Lateral jitter amplitude in world units; 0 = auto (12% of length). */
  jitter?: number;
}

export interface PillarOpts {
  /** Total height world units, default 8. */
  height?: number;
  /** Width world units, default 1.6. */
  width?: number;
  /** Seconds, default 0.6. */
  life?: number;
  /** Peak opacity, default 0.85. */
  intensity?: number;
}

export interface RippleOpts {
  /** Seconds, default 0.55. */
  life?: number;
  /** Peak opacity, default 0.7. */
  intensity?: number;
  /** Absolute Y height above ground, default 0.09. */
  y?: number;
}

export interface CrescentOpts {
  /** Arc width multiplier, default 1. */
  size?: number;
  /** Static roll (radians) applied on top of the camera billboard. */
  roll?: number;
  /** Sweep speed (radians/sec), default 3.2. */
  spin?: number;
  /** Seconds, default 0.28. */
  life?: number;
}

/* ------------------------------ constants ------------------------------- */

const PARTICLE_POOL = 2048;
const RING_POOL = 32;
const DMG_POOL = 48;
/* Spell FX upgrade (task 2-b) — new pooled primitives. */
const DECAL_POOL = 24;
const ARC_POOL = 12;
const PILLAR_POOL = 8;
const CROSS_POOL = 6;
const GLINT_POOL = 10;
/* 10-d Kenney sprite pools: ripple shockwaves + crescent slash arcs. */
const RIPPLE_POOL = 12;
const CRESCENT_POOL = 16;
/** Points per lightning stroke (10 segments × 2 strokes per arc). */
const ARC_PTS = 11;
const ARC_SEGS = ARC_PTS - 1;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Module-scope scratch objects — no per-frame allocation anywhere. */
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
/* arc polyline scratch */
const _a1 = new THREE.Vector3();
const _a2 = new THREE.Vector3();
const _a3 = new THREE.Vector3();
function easeOutCubic(t: number): number {
  const k = 1 - t;
  return 1 - k * k * k;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
/** Uniform random point on the unit sphere, written into `out`. */
function randUnit(out: THREE.Vector3): THREE.Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}
/** Random direction inside a cone around `base` (half-angle in radians). */
function coneDir(out: THREE.Vector3, base: THREE.Vector3, halfAngleRad: number): THREE.Vector3 {
  randUnit(out);
  const t = Math.tan(Math.min(halfAngleRad, 1.4)); // keep away from 90° blowup
  return out.multiplyScalar(t).add(base).normalize();
}
/** 0xff8844 -> "#ff8844" */
function cssHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}
/* ------------------------------- shaders -------------------------------- */ /* GLSL1: perspective-correct point size (world-unit diameters via uScale),
                                                                               soft radial sprite sampled for alpha, additive output. */
const PARTICLE_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 320.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;
/* ------------------------------ pool state ------------------------------ */

interface RingState {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  /** Normalized age 0..1. */
  t: number;
  /** Total lifetime seconds. */
  life: number;
  /** Final world radius. */
  maxR: number;
  /** Easing sharpness. */
  expand: number;
  /** Band thickness this mesh's geometry was built with. */
  builtTh: number;
  /** True = implode from maxR to 0 (targeting telegraph). */
  contract: boolean;
}

interface DecalState {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  /** Normalized age 0..1. */
  t: number;
  life: number;
  /** Final world radius. */
  r: number;
  /** Peak opacity. */
  op: number;
}

interface ArcState {
  obj: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  mat: THREE.LineBasicMaterial;
  /** Position attribute array (shared with the geometry). */
  pos: Float32Array;
  /** Color attribute array (shared with the geometry). */
  col: Float32Array;
  active: boolean;
  t: number;
  life: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  jitter: number;
  phase: number;
  /** Countdown to next crackle re-jitter. */
  nextJ: number;
}

interface PillarState {
  group: THREE.Group;
  mats: THREE.MeshBasicMaterial[];
  active: boolean;
  t: number;
  life: number;
  w: number;
  h: number;
  op: number;
}

interface CrossState {
  group: THREE.Group;
  mA: THREE.MeshBasicMaterial;
  mB: THREE.MeshBasicMaterial;
  active: boolean;
  t: number;
  life: number;
  r: number;
}

interface GlintState {
  group: THREE.Group;
  blob: THREE.Sprite;
  streak: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  t: number;
  life: number;
  size: number;
}

interface RippleState {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  t: number;
  life: number;
  /** Final world radius. */
  r: number;
  /** Peak opacity. */
  op: number;
}

interface CrescentState {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  t: number;
  life: number;
  size: number;
  /** Static roll (radians) over the billboard. */
  roll: number;
  /** Sweep speed (radians/sec). */
  spin: number;
}

/* ================================ system ================================ */

export class VfxSystem {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private disposed = false;
  private quality = 1;
  private reducedMotion = false;
  private dmgEnabled = true;

  /* ---- particles (SoA; alive packed at [0, count)) ---- */
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tex: THREE.CanvasTexture;
  private readonly attrPos: THREE.BufferAttribute;
  private readonly attrCol: THREE.BufferAttribute;
  private readonly attrSize: THREE.BufferAttribute;
  private readonly attrAlpha: THREE.BufferAttribute;
  /** Geometry-backed arrays (position.xyz / color.rgb / size / alpha). */
  private readonly posArr: Float32Array;
  private readonly colArr: Float32Array;
  private readonly sizeArr: Float32Array;
  private readonly alphaArr: Float32Array;
  /** Sim-only arrays. */
  private readonly vel: Float32Array;
  private readonly lifeA: Float32Array;
  private readonly maxLifeA: Float32Array;
  private readonly size0: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly gravA: Float32Array;
  private readonly dragA: Float32Array;
  private readonly swayA: Float32Array;
  private readonly swayF: Float32Array;
  private readonly swayP: Float32Array;
  /** Alive count. */
  private count = 0;
  /** Quality-scaled allocation cap (<= PARTICLE_POOL, buffers never realloc). */
  private cap = PARTICLE_POOL;
  /** True when buffers changed but attributes were not flushed yet. */
  private dirty = false;

  /* ---- ground rings (two thickness families → zero geometry rebuilds) ---- */
  private readonly rings: RingState[] = [];
  private ringCursorD = 0;
  private ringCursorT = 0;
  private ringCapD = RING_POOL / 2;
  private ringCapT = RING_POOL / 2;

  /* ---- ground decals ---- */
  private readonly decals: DecalState[] = [];
  private decalCursor = 0;
  private decalCap = DECAL_POOL;
  private readonly decalGeo: THREE.CircleGeometry;

  /* ---- lightning arcs ---- */
  private readonly arcs: ArcState[] = [];
  private arcCursor = 0;
  private arcCap = ARC_POOL;

  /* ---- light pillars ---- */
  private readonly pillars: PillarState[] = [];
  private pillarCursor = 0;
  private pillarCap = PILLAR_POOL;
  private readonly pillarGeo: THREE.PlaneGeometry;
  private readonly pillarTex: THREE.CanvasTexture;

  /* ---- crossed ring pairs (resonance weave) ---- */
  private readonly crosses: CrossState[] = [];
  private crossCursor = 0;
  private crossCap = CROSS_POOL;
  private readonly crossGeo: THREE.TorusGeometry;

  /* ---- lens-flare glints ---- */
  private readonly glints: GlintState[] = [];
  private glintCursor = 0;
  private glintCap = GLINT_POOL;
  private readonly glintGeo: THREE.PlaneGeometry;
  private readonly glintTex: THREE.CanvasTexture;

  /* ---- 10-d: ripple shockwaves + crescent slash arcs (Kenney CC0) ---- */
  private readonly ripples: RippleState[] = [];
  private rippleCursor = 0;
  private rippleCap = RIPPLE_POOL;
  private readonly rippleGeo: THREE.PlaneGeometry;
  private readonly rippleTex: THREE.CanvasTexture;

  private readonly crescents: CrescentState[] = [];
  private crescentCursor = 0;
  private crescentCap = CRESCENT_POOL;
  private readonly crescentGeo: THREE.PlaneGeometry;
  private readonly crescentTex: THREE.CanvasTexture;

  /* ---- damage numbers (DOM overlay) ---- */
  private layer: HTMLDivElement | null = null;
  private readonly dmgEls: HTMLDivElement[] = [];
  private readonly dmgActive: boolean[] = [];
  private readonly dmgX = new Float32Array(DMG_POOL);
  private readonly dmgY = new Float32Array(DMG_POOL);
  private readonly dmgAge = new Float32Array(DMG_POOL);
  private readonly dmgLife = new Float32Array(DMG_POOL);
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    /* --- particle buffers --- */
    this.posArr = new Float32Array(PARTICLE_POOL * 3);
    this.colArr = new Float32Array(PARTICLE_POOL * 3);
    this.sizeArr = new Float32Array(PARTICLE_POOL);
    this.alphaArr = new Float32Array(PARTICLE_POOL);
    this.vel = new Float32Array(PARTICLE_POOL * 3);
    this.lifeA = new Float32Array(PARTICLE_POOL);
    this.maxLifeA = new Float32Array(PARTICLE_POOL);
    this.size0 = new Float32Array(PARTICLE_POOL);
    this.alpha0 = new Float32Array(PARTICLE_POOL);
    this.gravA = new Float32Array(PARTICLE_POOL);
    this.dragA = new Float32Array(PARTICLE_POOL);
    this.swayA = new Float32Array(PARTICLE_POOL);
    this.swayF = new Float32Array(PARTICLE_POOL);
    this.swayP = new Float32Array(PARTICLE_POOL);
    this.geo = new THREE.BufferGeometry();
    this.attrPos = new THREE.BufferAttribute(this.posArr, 3);
    this.attrCol = new THREE.BufferAttribute(this.colArr, 3);
    this.attrSize = new THREE.BufferAttribute(this.sizeArr, 1);
    this.attrAlpha = new THREE.BufferAttribute(this.alphaArr, 1);
    this.geo.setAttribute("position", this.attrPos);
    this.geo.setAttribute("aColor", this.attrCol);
    this.geo.setAttribute("aSize", this.attrSize);
    this.geo.setAttribute("aAlpha", this.attrAlpha);
    this.geo.setDrawRange(0, 0);
    this.tex = VfxSystem.makeSpriteTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: {
          value: this.tex
        },
        uScale: {
          value: 600
        }
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; // particles move every frame
    this.points.renderOrder = 15;
    this.scene.add(this.points);
    /* --- ground ring pool: half default band (0.35), half thick (0.5) --- */
    for (let i = 0; i < RING_POOL; i++) {
      const th = i < RING_POOL / 2 ? 0.35 : 0.5;
      const rgeo = new THREE.RingGeometry(1 - th, 1, 48);
      const rmat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(rgeo, rmat);
      mesh.rotation.x = -Math.PI / 2; // flat on ground
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.scene.add(mesh);
      this.rings.push({
        mesh,
        mat: rmat,
        active: false,
        t: 0,
        life: 0.5,
        maxR: 1,
        expand: 1,
        builtTh: th,
        contract: false
      });
    }
    /* --- ground decal pool (soft fading glow circles) --- */
    this.decalGeo = new THREE.CircleGeometry(1, 36);
    for (let i = 0; i < DECAL_POOL; i++) {
      const dmat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        map: this.tex
      });
      const dmesh = new THREE.Mesh(this.decalGeo, dmat);
      dmesh.rotation.x = -Math.PI / 2;
      dmesh.visible = false;
      dmesh.renderOrder = 11;
      this.scene.add(dmesh);
      this.decals.push({
        mesh: dmesh,
        mat: dmat,
        active: false,
        t: 0,
        life: 1.5,
        r: 1,
        op: 0.55
      });
    }
    /* --- lightning arc pool (2-stroke LineSegments, preallocated buffers) --- */
    for (let i = 0; i < ARC_POOL; i++) {
      const ageo = new THREE.BufferGeometry();
      const apos = new Float32Array(2 * ARC_SEGS * 2 * 3);
      const acol = new Float32Array(2 * ARC_SEGS * 2 * 3);
      ageo.setAttribute("position", new THREE.BufferAttribute(apos, 3));
      ageo.setAttribute("color", new THREE.BufferAttribute(acol, 3));
      ageo.setDrawRange(0, 2 * ARC_SEGS * 2);
      const amat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const obj = new THREE.LineSegments(ageo, amat);
      obj.frustumCulled = false;
      obj.visible = false;
      obj.renderOrder = 14;
      this.scene.add(obj);
      this.arcs.push({
        obj,
        mat: amat,
        pos: apos,
        col: acol,
        active: false,
        t: 0,
        life: 0.22,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        color: new THREE.Color(),
        jitter: 0,
        phase: 0,
        nextJ: 0
      });
    }
    /* --- light pillar pool (2 crossed vertical gradient planes) --- */
    this.pillarTex = VfxSystem.makePillarTexture();
    this.pillarGeo = new THREE.PlaneGeometry(1, 1);
    this.pillarGeo.translate(0, 0.5, 0); // base at y=0
    for (let i = 0; i < PILLAR_POOL; i++) {
      const group = new THREE.Group();
      const mats: THREE.MeshBasicMaterial[] = [];
      for (let k = 0; k < 2; k++) {
        const pmat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          map: this.pillarTex
        });
        const plane = new THREE.Mesh(this.pillarGeo, pmat);
        plane.rotation.y = k * Math.PI / 2;
        plane.renderOrder = 13;
        group.add(plane);
        mats.push(pmat);
      }
      group.visible = false;
      this.scene.add(group);
      this.pillars.push({
        group,
        mats,
        active: false,
        t: 0,
        life: 0.6,
        w: 1.6,
        h: 8,
        op: 0.85
      });
    }
    /* --- crossed ring pair pool (resonance weave signature) --- */
    this.crossGeo = new THREE.TorusGeometry(1, 0.045, 8, 48);
    for (let i = 0; i < CROSS_POOL; i++) {
      const group = new THREE.Group();
      const mA = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mB = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const ringA = new THREE.Mesh(this.crossGeo, mA);
      const ringB = new THREE.Mesh(this.crossGeo, mB);
      ringB.rotation.y = Math.PI / 2;
      ringA.renderOrder = 13;
      ringB.renderOrder = 13;
      group.add(ringA);
      group.add(ringB);
      group.visible = false;
      this.scene.add(group);
      this.crosses.push({
        group,
        mA,
        mB,
        active: false,
        t: 0,
        life: 0.7,
        r: 2.4
      });
    }
    /* --- lens-flare glint pool (billboarded soft blob + streak cross) --- */
    this.glintTex = VfxSystem.makeGlintTexture();
    this.glintGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < GLINT_POOL; i++) {
      const group = new THREE.Group();
      const bmat = new THREE.SpriteMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const blob = new THREE.Sprite(bmat);
      blob.scale.setScalar(1.6);
      blob.renderOrder = 14;
      group.add(blob);
      const smat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        map: this.glintTex
      });
      const streak = new THREE.Mesh(this.glintGeo, smat);
      streak.renderOrder = 14;
      group.add(streak);
      group.visible = false;
      this.scene.add(group);
      this.glints.push({
        group,
        blob,
        streak,
        active: false,
        t: 0,
        life: 0.24,
        size: 1
      });
    }
    /* --- 10-d: ripple shockwave pool (ground concentric rings) --- */
    this.rippleTex = VfxSystem.makeRippleTexture();
    this.rippleGeo = new THREE.PlaneGeometry(2, 2); // ±1 → scale = radius
    for (let i = 0; i < RIPPLE_POOL; i++) {
      const rmat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        map: this.rippleTex
      });
      const rmesh = new THREE.Mesh(this.rippleGeo, rmat);
      rmesh.rotation.x = -Math.PI / 2; // flat on ground
      rmesh.visible = false;
      rmesh.renderOrder = 11; // with the ground decals
      this.scene.add(rmesh);
      this.ripples.push({
        mesh: rmesh,
        mat: rmat,
        active: false,
        t: 0,
        life: 0.55,
        r: 2,
        op: 0.7
      });
    }
    /* --- 10-d: crescent slash-arc pool (billboarded curved arcs) --- */
    this.crescentTex = VfxSystem.makeCrescentTexture();
    this.crescentGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < CRESCENT_POOL; i++) {
      const group = new THREE.Group();
      const cmat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        map: this.crescentTex
      });
      const cmesh = new THREE.Mesh(this.crescentGeo, cmat);
      cmesh.renderOrder = 14;
      group.add(cmesh);
      group.visible = false;
      this.scene.add(group);
      this.crescents.push({
        group,
        mat: cmat,
        active: false,
        t: 0,
        life: 0.28,
        size: 1,
        roll: 0,
        spin: 3.2
      });
    }
  }
  /* ------------------------------ lifecycle ----------------------------- */

  /** Soft round sprite: white radial gradient on a 64px canvas. */
  private static makeSpriteTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0.0, "rgba(255,255,255,1)");
      g.addColorStop(0.3, "rgba(255,255,255,0.75)");
      g.addColorStop(0.65, "rgba(255,255,255,0.22)");
      g.addColorStop(1.0, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  /** Vertical beam gradient: hot at the base, tapering to nothing up top,
    feathered horizontally. Used by light pillars. */
  private static makePillarTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const v = ctx.createLinearGradient(0, 128, 0, 0);
      v.addColorStop(0.0, "rgba(255,255,255,0.95)");
      v.addColorStop(0.3, "rgba(255,255,255,0.55)");
      v.addColorStop(1.0, "rgba(255,255,255,0)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 64, 128);
      ctx.globalCompositeOperation = "destination-in";
      const h = ctx.createLinearGradient(0, 0, 64, 0);
      h.addColorStop(0.0, "rgba(255,255,255,0)");
      h.addColorStop(0.5, "rgba(255,255,255,1)");
      h.addColorStop(1.0, "rgba(255,255,255,0)");
      ctx.fillStyle = h;
      ctx.fillRect(0, 0, 64, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  /** Lens-flare streaks: soft core plus a horizontal + vertical blade. */
  private static makeGlintTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 14);
      g.addColorStop(0.0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.5)");
      g.addColorStop(1.0, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const blade = (x0: number, y0: number, x1: number, y1: number) => {
        const lg = ctx.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0.0, "rgba(255,255,255,0)");
        lg.addColorStop(0.5, "rgba(255,255,255,0.85)");
        lg.addColorStop(1.0, "rgba(255,255,255,0)");
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, 64, 64);
      };
      blade(0, 0, 64, 0); // horizontal blade
      blade(0, 0, 0, 64); // vertical blade
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  /** 10-d PROCEDURAL FALLBACK for the ripple pool: three soft concentric
    rings centered on the quad (swapped for particles/kenney-ripple.png
    when the asset pack resolves — the Kenney sprite is the same motif). */
  private static makeRippleTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.translate(64, 64);
      for (const [r, w, a] of [[18, 7, 0.95], [38, 9, 0.6], [56, 11, 0.32]]) {
        const g = ctx.createRadialGradient(0, 0, Math.max(0, r - w), 0, 0, r + w);
        g.addColorStop(0.0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, `rgba(255,255,255,${a})`);
        g.addColorStop(1.0, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r + w, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  /** 10-d PROCEDURAL FALLBACK for the crescent pool: one thick soft arc
    stroke (swapped for particles/kenney-crescent.png when the pack
    resolves). */
  private static makeCrescentTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.translate(64, 64);
      ctx.lineCap = "round";
      for (const [w, a] of [[22, 0.35], [13, 0.8]]) {
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(0, 18, 42, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  /** Swap the procedural canvas textures for the acquired Kronbits + Kenney
  *  CC0 sprite art (docs/AUDITS.md §4/§7). Pools share materials, so
  *  this is a one-time O(pool) pass — call once after the asset pack
  *  resolves. A null entry leaves that family on its canvas texture.
  *  10-d: `ripple` (kenney-ripple — concentric shockwaves) and `crescent`
  *  (kenney-crescent — curved slash arcs) join the swap. */
  applySprites(t: {
    particle?: THREE.Texture | null;
    glint?: THREE.Texture | null;
    pillar?: THREE.Texture | null;
    ripple?: THREE.Texture | null;
    crescent?: THREE.Texture | null;
  }): void {
    if (this.disposed) return;
    if (t.particle) {
      const old = this.mat.uniforms.uMap.value as THREE.Texture;
      this.mat.uniforms.uMap.value = t.particle;
      if (old !== t.particle) old.dispose();
    }
    if (t.glint) {
      for (const g of this.glints) {
        g.blob.material.map = t.glint;
        g.blob.material.needsUpdate = true;
        g.streak.material.map = t.glint;
        g.streak.material.needsUpdate = true;
      }
      this.glintTex.dispose();
    }
    if (t.pillar) {
      for (const p of this.pillars) {
        for (const m of p.mats) {
          m.map = t.pillar;
          m.needsUpdate = true;
        }
      }
      this.pillarTex.dispose();
    }
    if (t.ripple) {
      for (const r of this.ripples) {
        r.mat.map = t.ripple;
        r.mat.needsUpdate = true;
      }
      this.rippleTex.dispose();
    }
    if (t.crescent) {
      for (const c of this.crescents) {
        c.mat.map = t.crescent;
        c.mat.needsUpdate = true;
      }
      this.crescentTex.dispose();
    }
  }
  /** Remove and free ALL GPU resources. Idempotent; update() no-ops after. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
    this.rings.length = 0;
    for (const d of this.decals) {
      this.scene.remove(d.mesh);
      d.mat.dispose();
    }
    this.decals.length = 0;
    this.decalGeo.dispose();
    for (const a of this.arcs) {
      this.scene.remove(a.obj);
      a.obj.geometry.dispose();
      a.mat.dispose();
    }
    this.arcs.length = 0;
    for (const p of this.pillars) {
      this.scene.remove(p.group);
      for (const m of p.mats) m.dispose();
    }
    this.pillars.length = 0;
    this.pillarGeo.dispose();
    this.pillarTex.dispose();
    for (const c of this.crosses) {
      this.scene.remove(c.group);
      c.mA.dispose();
      c.mB.dispose();
    }
    this.crosses.length = 0;
    this.crossGeo.dispose();
    for (const g of this.glints) {
      this.scene.remove(g.group);
      g.blob.material.dispose();
      g.streak.material.dispose();
    }
    this.glints.length = 0;
    this.glintGeo.dispose();
    this.glintTex.dispose();
    for (const r of this.ripples) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.ripples.length = 0;
    this.rippleGeo.dispose();
    this.rippleTex.dispose();
    for (const c of this.crescents) {
      this.scene.remove(c.group);
      c.mat.dispose();
    }
    this.crescents.length = 0;
    this.crescentGeo.dispose();
    this.crescentTex.dispose();
    this.count = 0;
    this.detachDamageLayer();
    this.layer = null;
    this.dmgEls.length = 0;
    this.dmgActive.length = 0;
  }
  /** 0.5..1 — caps active counts (every pool). Buffers are NOT reallocated. */
  setQuality(q: number): void {
    this.quality = Math.min(1, Math.max(0.5, q));
    this.cap = Math.max(128, Math.floor(PARTICLE_POOL * this.quality));
    this.ringCapD = Math.max(4, Math.round(RING_POOL / 2 * this.quality));
    this.ringCapT = Math.max(2, Math.round(RING_POOL / 2 * this.quality));
    this.decalCap = Math.max(6, Math.round(DECAL_POOL * this.quality));
    this.arcCap = Math.max(3, Math.round(ARC_POOL * this.quality));
    this.pillarCap = Math.max(2, Math.round(PILLAR_POOL * this.quality));
    this.crossCap = Math.max(2, Math.round(CROSS_POOL * this.quality));
    this.glintCap = Math.max(2, Math.round(GLINT_POOL * this.quality));
    this.rippleCap = Math.max(3, Math.round(RIPPLE_POOL * this.quality));
    this.crescentCap = Math.max(4, Math.round(CRESCENT_POOL * this.quality));
  }
  /** Reduced motion: half counts, skip flashes, ~25% shorter particle lives. */
  setReducedMotion(b: boolean): void {
    this.reducedMotion = b;
  }
  /** Read reduced-motion state (callers scale their emission rates). */
  get reduced(): boolean {
    return this.reducedMotion;
  }
  /** Live particle count — O(1) read of the packed-alive front (perf overlay). */
  get liveParticles(): number {
    return this.count;
  }
  /** Master toggle for damage numbers (from game settings). */
  setDamageNumbers(b: boolean): void {
    this.dmgEnabled = b;
    if (!b) this.clearDamage();
  }
  /* --------------------------- damage layer (DOM) ----------------------- */

  /** Create (once) + attach the overlay layer for damage numbers. */
  attachDamageLayer(root: HTMLElement): void {
    if (this.disposed) return;
    if (!this.layer) {
      const layer = document.createElement("div");
      const ls = layer.style;
      ls.position = "fixed";
      ls.left = "0";
      ls.top = "0";
      ls.right = "0";
      ls.bottom = "0";
      ls.overflow = "hidden";
      ls.pointerEvents = "none";
      ls.zIndex = "70";
      ls.userSelect = "none";
      for (let i = 0; i < DMG_POOL; i++) {
        const el = document.createElement("div");
        const s = el.style;
        s.position = "absolute";
        s.left = "0";
        s.top = "0";
        s.display = "none";
        s.whiteSpace = "nowrap";
        s.pointerEvents = "none";
        s.fontFamily = 'var(--font-mono), ui-monospace, "SF Mono", Consolas, monospace';
        s.fontSize = "14px";
        s.fontWeight = "700";
        s.textShadow = "0 0 6px rgba(0,0,0,0.9), 0 2px 2px rgba(0,0,0,0.8)";
        s.willChange = "transform, opacity";
        layer.appendChild(el);
        this.dmgEls.push(el);
        this.dmgActive.push(false);
      }
      this.layer = layer;
    }
    root.appendChild(this.layer); // re-attach moves it; idempotent
  }
  detachDamageLayer(): void {
    if (this.layer) this.layer.remove();
    this.clearDamage();
  }
  private clearDamage(): void {
    for (let i = 0; i < this.dmgActive.length; i++) {
      if (this.dmgActive[i]) {
        this.dmgActive[i] = false;
        this.dmgEls[i].style.display = "none";
      }
    }
  }
  /* ------------------------------ per-frame ----------------------------- */

  /** Advance all pools. Call once per frame with the frame delta (seconds). */
  update(dt: number): void {
    if (this.disposed) return;
    this.refreshScale();
    const d = Math.min(Math.max(dt, 0), 0.05); // suspend/latency spike guard
    if (d <= 0) return;
    this.updateParticles(d);
    this.updateRings(d);
    this.updateDecals(d);
    this.updateRipples(d);
    this.updateArcs(d);
    this.updatePillars(d);
    this.updateCrosses(d);
    this.updateGlints(d);
    this.updateCrescents(d);
    this.updateDamage(d);
  }
  /** Point sizes are world units: scale = viewportPx / (2 * tan(fov/2)). */
  private refreshScale(): void {
    const dpr = window.devicePixelRatio || 1;
    const h = Math.max(1, window.innerHeight) * dpr;
    const halfFov = this.camera.fov * Math.PI / 360;
    this.mat.uniforms.uScale.value = h / (2 * Math.tan(halfFov));
  }
  private updateParticles(dt: number): void {
    if (this.count === 0 && !this.dirty) return;
    const pos = this.posArr;
    const col = this.colArr;
    const szA = this.sizeArr;
    const alA = this.alphaArr;
    const vel = this.vel;
    const life = this.lifeA;
    const maxL = this.maxLifeA;
    const size0 = this.size0;
    const a0 = this.alpha0;
    const grav = this.gravA;
    const drag = this.dragA;
    const sA = this.swayA;
    const sF = this.swayF;
    const sP = this.swayP;
    let i = 0;
    let n = this.count;
    while (i < n) {
      const i3 = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) {
        /* swap-remove: move last alive into slot i, re-process it next loop */n--;
        if (i !== n) {
          const j3 = n * 3;
          pos[i3] = pos[j3];
          pos[i3 + 1] = pos[j3 + 1];
          pos[i3 + 2] = pos[j3 + 2];
          col[i3] = col[j3];
          col[i3 + 1] = col[j3 + 1];
          col[i3 + 2] = col[j3 + 2];
          vel[i3] = vel[j3];
          vel[i3 + 1] = vel[j3 + 1];
          vel[i3 + 2] = vel[j3 + 2];
          szA[i] = szA[n];
          alA[i] = alA[n];
          life[i] = life[n];
          maxL[i] = maxL[n];
          size0[i] = size0[n];
          a0[i] = a0[n];
          grav[i] = grav[n];
          drag[i] = drag[n];
          sA[i] = sA[n];
          sF[i] = sF[n];
          sP[i] = sP[n];
        }
        this.dirty = true;
        continue;
      }
      const ml = maxL[i];
      const remain = life[i];
      const t = 1 - remain / ml; // age progress 0..1
      const k = 1 - t;
      /* integrate: gravity, linear drag, sway override on x */
      let vx = vel[i3];
      let vy = vel[i3 + 1];
      let vz = vel[i3 + 2];
      vy -= grav[i] * dt;
      const damp = Math.max(0, 1 - drag[i] * dt);
      vx *= damp;
      vy *= damp;
      vz *= damp;
      if (sA[i] !== 0) {
        vx = Math.sin((ml - remain) * sF[i] + sP[i]) * sA[i];
      }
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      pos[i3] += vx * dt;
      pos[i3 + 1] += vy * dt;
      pos[i3 + 2] += vz * dt;
      /* size shrinks to 20%, alpha fades in fast / out as k^1.5 */
      szA[i] = size0[i] * (0.2 + 0.8 * k);
      const fadeIn = t * 12 < 1 ? t * 12 : 1;
      alA[i] = a0[i] * fadeIn * k * Math.sqrt(k);
      i++;
    }
    this.count = n;
    if (n > 0 || this.dirty) {
      this.geo.setDrawRange(0, n);
      this.attrPos.needsUpdate = true;
      this.attrCol.needsUpdate = true;
      this.attrSize.needsUpdate = true;
      this.attrAlpha.needsUpdate = true;
      this.dirty = false;
    }
  }
  private updateRings(dt: number): void {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.t += dt / r.life;
      if (r.t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = Math.pow(easeOutCubic(r.t), r.expand);
      const s = r.contract ? r.maxR * (1 - e) : r.maxR * e;
      r.mesh.scale.setScalar(Math.max(1e-3, s));
      r.mat.opacity = 0.9 * Math.pow(1 - r.t, 1.4);
    }
  }
  private updateDecals(dt: number): void {
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (!d.active) continue;
      d.t += dt / d.life;
      if (d.t >= 1) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      /* pop to full size in the first third, then hold */
      const e = easeOutCubic(Math.min(1, d.t * 3));
      d.mesh.scale.setScalar(Math.max(1e-3, d.r * (0.55 + 0.45 * e)));
      const fadeIn = d.t * 12 < 1 ? d.t * 12 : 1;
      const fadeOut = d.t < 0.55 ? 1 : 1 - (d.t - 0.55) / 0.45;
      d.mat.opacity = d.op * fadeIn * Math.max(0, fadeOut);
    }
  }
  private updateArcs(dt: number): void {
    for (let i = 0; i < this.arcs.length; i++) {
      const a = this.arcs[i];
      if (!a.active) continue;
      a.t += dt / a.life;
      if (a.t >= 1) {
        a.active = false;
        a.obj.visible = false;
        continue;
      }
      /* crackle: re-jitter the polyline every ~45ms (skipped in reduced motion) */
      if (!this.reducedMotion) {
        a.nextJ -= dt;
        if (a.nextJ <= 0) {
          this.writeArc(a);
          a.nextJ = 0.045;
        }
      }
      /* flicker: high-frequency strobe fading out */
      const flicker = 0.45 + 0.55 * Math.abs(Math.sin(a.t * 46 + a.phase));
      a.mat.opacity = 0.95 * flicker * Math.pow(1 - a.t, 1.1);
    }
  }
  private updatePillars(dt: number): void {
    for (let i = 0; i < this.pillars.length; i++) {
      const p = this.pillars[i];
      if (!p.active) continue;
      p.t += dt / p.life;
      if (p.t >= 1) {
        p.active = false;
        p.group.visible = false;
        continue;
      }
      const fadeIn = p.t * 10 < 1 ? p.t * 10 : 1;
      const o = p.op * fadeIn * Math.pow(1 - p.t, 1.3);
      p.mats[0].opacity = o;
      p.mats[1].opacity = o * 0.75;
      /* taper: narrow as it dies */
      const w = p.w * (0.55 + 0.45 * (1 - p.t));
      p.group.scale.set(w, p.h, w);
      p.group.rotation.y += dt * 0.6;
    }
  }
  private updateCrosses(dt: number): void {
    for (let i = 0; i < this.crosses.length; i++) {
      const c = this.crosses[i];
      if (!c.active) continue;
      c.t += dt / c.life;
      if (c.t >= 1) {
        c.active = false;
        c.group.visible = false;
        continue;
      }
      c.group.scale.setScalar(Math.max(1e-3, c.r * easeOutCubic(c.t)));
      const o = 0.85 * Math.pow(1 - c.t, 1.4);
      c.mA.opacity = o;
      c.mB.opacity = o * 0.85;
      c.group.rotation.y += dt * 1.5;
    }
  }
  private updateGlints(dt: number): void {
    /* single pass (10-d optimization: was a full glintsAllIdle() pre-scan
    followed by a second full loop every frame) */
    for (let i = 0; i < this.glints.length; i++) {
      const g = this.glints[i];
      if (!g.active) continue;
      g.t += dt / g.life;
      if (g.t >= 1) {
        g.active = false;
        g.group.visible = false;
        continue;
      }
      /* billboard the streak cross to the camera */
      g.group.quaternion.copy(this.camera.quaternion);
      const s = g.size * (0.45 + 0.65 * easeOutCubic(g.t));
      g.group.scale.setScalar(s);
      const o = Math.pow(1 - g.t, 1.6);
      g.blob.material.opacity = o * 0.8;
      g.streak.material.opacity = o;
    }
  }
  /** 10-d: ground ripple shockwaves — pop to full size, expand, fade. */
  private updateRipples(dt: number): void {
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      if (!r.active) continue;
      r.t += dt / r.life;
      if (r.t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      /* quick pop then steady expansion — reads as a pressure wave */
      const e = easeOutCubic(r.t);
      r.mesh.scale.setScalar(Math.max(1e-3, r.r * (0.3 + 0.7 * e)));
      const fadeIn = r.t * 10 < 1 ? r.t * 10 : 1;
      r.mat.opacity = r.op * fadeIn * Math.pow(1 - r.t, 1.5);
    }
  }
  /** 10-d: crescent slash arcs — billboard, sweep (roll), expand, fade. */
  private updateCrescents(dt: number): void {
    for (let i = 0; i < this.crescents.length; i++) {
      const c = this.crescents[i];
      if (!c.active) continue;
      c.t += dt / c.life;
      if (c.t >= 1) {
        c.active = false;
        c.group.visible = false;
        continue;
      }
      c.group.quaternion.copy(this.camera.quaternion);
      c.group.rotateZ(c.roll + c.spin * c.t);
      const s = c.size * (0.55 + 0.75 * easeOutCubic(c.t));
      c.group.scale.setScalar(s);
      const fadeIn = c.t * 14 < 1 ? c.t * 14 : 1; // a slash snaps in
      c.mat.opacity = 0.95 * fadeIn * Math.pow(1 - c.t, 1.35);
    }
  }
  private updateDamage(dt: number): void {
    if (!this.layer) return;
    for (let i = 0; i < this.dmgEls.length; i++) {
      if (!this.dmgActive[i]) continue;
      const age = this.dmgAge[i] + dt;
      const life = this.dmgLife[i];
      if (age >= life) {
        this.dmgActive[i] = false;
        this.dmgEls[i].style.display = "none";
        continue;
      }
      this.dmgAge[i] = age;
      const t = age / life;
      const rise = -42 * easeOutCubic(t);
      const pop = 1 + 0.35 * Math.max(0, 1 - t * 5); // spawn pop
      const alpha = Math.pow(1 - t, 1.25);
      const st = this.dmgEls[i].style;
      st.opacity = alpha.toFixed(3);
      st.transform = "translate(-50%,-50%) translate3d(" + this.dmgX[i].toFixed(1) + "px," + (this.dmgY[i] + rise).toFixed(1) + "px,0) scale(" + pop.toFixed(3) + ")";
    }
  }
  /* ---------------------------- particle core --------------------------- */

  /**
   * Raw particle spawn (allocation-free; skips silently when the pool cap is
   * reached — overloading a full pool just drops new particles).
   */
  private spawnParticle(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    size: number, life: number, alpha: number,
    gravity: number, drag: number,
    swayAmp: number, swayFreq: number, swayPhase: number,
  ): void {
    if (this.disposed || this.count >= this.cap) return;
    const i = this.count++;
    const i3 = i * 3;
    this.posArr[i3] = x;
    this.posArr[i3 + 1] = y;
    this.posArr[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.colArr[i3] = r;
    this.colArr[i3 + 1] = g;
    this.colArr[i3 + 2] = b;
    this.sizeArr[i] = size;
    this.alphaArr[i] = 0;
    this.lifeA[i] = life;
    this.maxLifeA[i] = life;
    this.size0[i] = size;
    this.alpha0[i] = alpha;
    this.gravA[i] = gravity;
    this.dragA[i] = drag;
    this.swayA[i] = swayAmp;
    this.swayF[i] = swayFreq;
    this.swayP[i] = swayPhase;
    this.dirty = true;
  }
  /** Reduced-motion count scaling (half, min 1). */
  private rmCount(n: number): number {
    const v = Math.max(0, Math.floor(n));
    return this.reducedMotion ? Math.max(1, Math.ceil(v * 0.5)) : v;
  }
  /** Reduced-motion lifetime scaling (~25% shorter). */
  private get lifeMul(): number {
    return this.reducedMotion ? 0.75 : 1;
  }
  /* ------------------------------ effects ------------------------------- */

  /** Omnidirectional particle burst (impact / cast feedback). */
  burst(pos: THREE.Vector3, color: number, count: number, opts?: BurstOpts): void {
    if (this.disposed || count <= 0) return;
    const speed = opts?.speed ?? 6;
    const up = opts?.up ?? 2;
    const size = opts?.size ?? 1;
    const life = (opts?.life ?? 0.7) * this.lifeMul;
    const gravity = opts?.gravity ?? 9;
    const spread = clamp01(opts?.spread ?? 1);
    const n = this.rmCount(count);
    _c1.setHex(color);
    for (let i = 0; i < n; i++) {
      randUnit(_v1);
      if (spread < 1) {
        /* blend random direction toward straight up as spread decreases */_v1.multiplyScalar(spread).addScaledVector(UP, 1 - spread).normalize();
      }
      const s = speed * randRange(0.7, 1.3);
      this.spawnParticle(pos.x, pos.y, pos.z, _v1.x * s, _v1.y * s + up, _v1.z * s, _c1.r, _c1.g, _c1.b, size * randRange(0.7, 1.3), life * randRange(0.7, 1.3), 1, gravity, 1.4, 0, 0, 0);
    }
  }
  /** Cone of sparks off a wound; `dir` is the hit normal (defaults to up). */
  hitSpark(pos: THREE.Vector3, color: number, dir?: THREE.Vector3): void {
    if (this.disposed) return;
    _v2.copy(dir ?? UP);
    if (_v2.lengthSq() < 1e-6) _v2.copy(UP);
    _v2.normalize();
    const n = this.rmCount(6 + Math.floor(Math.random() * 5)); // 6..10
    const life = 0.3 * this.lifeMul;
    _c1.setHex(color).lerp(WHITE, 0.2);
    for (let i = 0; i < n; i++) {
      coneDir(_v1, _v2, 40 * DEG);
      const s = randRange(3.5, 7);
      this.spawnParticle(pos.x, pos.y, pos.z, _v1.x * s, _v1.y * s, _v1.z * s, _c1.r, _c1.g, _c1.b, randRange(0.4, 0.65), life * randRange(0.7, 1.2), 1, 10, 2, 0, 0, 0);
    }
    /* one tiny flash at the wound */
    _c1.setHex(color).lerp(WHITE, 0.5);
    this.spawnParticle(pos.x, pos.y, pos.z, 0, 0.4, 0, _c1.r, _c1.g, _c1.b, 1.1, 0.1 * this.lifeMul, 1, 0, 0, 0, 0, 0);
  }
  /** Big composite: core flash + double ground ring + lingering glow decal +
    debris streaks + smoke puffs. Meaningful blasts (radius >= 1.15) also
    stamp a fading ground decal + a 10-d concentric ripple shockwave —
    this is what kill sites look like. */
  explosion(pos: THREE.Vector3, color: number, radius: number): void {
    if (this.disposed) return;
    const r = Math.max(0.5, radius);
    /* 1) double ground shockwave — thin fast outer + thick slow inner */
    this.ring(pos, color, r * 1.1, {
      life: 0.55,
      thickness: 0.35
    });
    this.ring(pos, color, r * 0.7, {
      life: 0.4,
      thickness: 0.5,
      expand: 1.4
    });
    /* 2) lingering ground glow + concentric ripple for meaningful blasts */
    if (r >= 1.15) {
      this.groundDecal(pos, color, r * 1.3, {
        life: this.reducedMotion ? 1.0 : 1.5,
        intensity: 0.5
      });
      if (!this.reducedMotion) {
        this.ripple(pos, color, r * 1.7, {
          life: 0.6,
          intensity: 0.55
        });
      }
    }
    /* 3) core flash — white-leaning, fast, big, gone quickly */
    if (!this.reducedMotion) {
      _c1.setHex(color).lerp(WHITE, 0.6);
      const fs = 4 + r * 3.5;
      for (let i = 0; i < 5; i++) {
        randUnit(_v1);
        const s = fs * randRange(0.6, 1.1);
        this.spawnParticle(pos.x, pos.y, pos.z, _v1.x * s, _v1.y * s, _v1.z * s, _c1.r, _c1.g, _c1.b, 2 + r * 0.12, 0.18, 1, 0, 3, 0, 0, 0);
      }
      /* one big single-pop flash in the middle */
      this.spawnParticle(pos.x, pos.y + 0.1, pos.z, 0, 0.6, 0, _c1.r, _c1.g, _c1.b, 2.4 + r * 0.25, 0.14 * this.lifeMul, 1, 0, 2, 0, 0, 0);
    }
    /* 4) debris streaks — fast radial shards, arcing down, every third white-hot */
    const dn = Math.max(4, this.rmCount(8 + Math.floor(Math.random() * 7))); // 8..14
    for (let i = 0; i < dn; i++) {
      const a = Math.random() * Math.PI * 2;
      _v1.set(Math.cos(a), 0.35, Math.sin(a)).normalize();
      const s = (6 + r * 2.2) * randRange(0.8, 1.25);
      _c1.setHex(color);
      if (i % 3 === 0) _c1.lerp(WHITE, 0.6);
      this.spawnParticle(pos.x, pos.y + 0.2, pos.z, _v1.x * s, _v1.y * s, _v1.z * s, _c1.r, _c1.g, _c1.b, 0.45, randRange(0.45, 0.8) * this.lifeMul, 1, 16, 1.2, 0, 0, 0);
    }
    /* 5) smoke puffs — slow, buoyant, tinted half gray half element */
    const sn = Math.max(2, this.rmCount(4 + Math.floor(Math.random() * 3))); // 4..6
    _c1.setHex(0x222222);
    _c2.setHex(color);
    _c1.lerp(_c2, 0.5);
    for (let i = 0; i < sn; i++) {
      randUnit(_v1);
      this.spawnParticle(pos.x + _v1.x * r * 0.25, pos.y + _v1.y * r * 0.2 + 0.3, pos.z + _v1.z * r * 0.25, _v1.x * 0.6, 1 + Math.random() * 0.8, _v1.z * 0.6, _c1.r, _c1.g, _c1.b, 1.8 + r * 0.3, randRange(1.0, 1.4) * this.lifeMul, 0.5, -1.2, 1.5, 0, 0, 0);
    }
  }
  /** Expanding (or contracting, see opts.contract) ground shockwave ring at
    `pos` (x/z used; y from opts). Thickness is quantized to the two pooled
    band families so geometries never rebuild in steady state. */
  ring(pos: THREE.Vector3, color: number, maxRadius: number, opts?: RingOpts): void {
    if (this.disposed || this.rings.length === 0) return;
    const life = Math.max(0.05, opts?.life ?? 0.5);
    const thRaw = Math.min(0.95, Math.max(0.05, opts?.thickness ?? 0.35));
    const y = opts?.y ?? 0.08;
    const expand = Math.max(0.2, opts?.expand ?? 1);
    const contract = opts?.contract ?? false;
    /* route to the matching thickness family: [0..15] = 0.35, [16..31] = 0.5 */
    const fam = thRaw >= 0.42 ? 1 : 0;
    const th = fam === 1 ? 0.5 : 0.35;
    let slot: RingState;
    if (fam === 1) {
      slot = this.rings[RING_POOL / 2 + this.ringCursorT % this.ringCapT];
      this.ringCursorT = (this.ringCursorT + 1) % this.ringCapT;
    } else {
      slot = this.rings[this.ringCursorD % this.ringCapD];
      this.ringCursorD = (this.ringCursorD + 1) % this.ringCapD;
    }
    /* rebuild band width only when it differs from what this mesh was built
    with (steady state never rebuilds — families are pre-built) */
    if (slot.builtTh !== th) {
      slot.builtTh = th;
      slot.mesh.geometry.dispose();
      slot.mesh.geometry = new THREE.RingGeometry(1 - th, 1, 48);
    }
    slot.mesh.position.set(pos.x, y, pos.z);
    slot.mesh.scale.setScalar(1e-3); // no 1-frame full-size flash
    slot.mat.color.setHex(color);
    slot.mat.opacity = 0.9;
    slot.t = 0;
    slot.life = life;
    slot.maxR = Math.max(0.05, maxRadius);
    slot.expand = expand;
    slot.contract = contract;
    slot.active = true;
    slot.mesh.visible = true;
  }
  /** Slow rising wisp (kill feedback) with lateral sine sway. */
  soulWisp(pos: THREE.Vector3, color: number): void {
    if (this.disposed) return;
    _c1.setHex(color).lerp(WHITE, 0.25);
    this.spawnParticle(pos.x, pos.y + 0.3, pos.z, 0, 1.5, 0, _c1.r, _c1.g, _c1.b, 1.5, 1.6 * this.lifeMul, 0.9, 0, 2, 0.55, 4.5, Math.random() * Math.PI * 2);
  }
  /** Quick point flash sprite (cast/muzzle feedback). */
  muzzleFlash(pos: THREE.Vector3, color: number): void {
    if (this.disposed) return;
    _c1.setHex(color).lerp(WHITE, 0.4);
    const n = this.reducedMotion ? 2 : 3;
    for (let i = 0; i < n; i++) {
      this.spawnParticle(pos.x + randRange(-0.12, 0.12), pos.y + randRange(-0.12, 0.12), pos.z + randRange(-0.12, 0.12), 0, 0, 0, _c1.r, _c1.g, _c1.b, 2 * randRange(0.85, 1.15), 0.12 * this.lifeMul, 1, 0, 0, 0, 0, 0);
    }
  }
  /* ------------------------ spell FX primitives -------------------------- */
  /* (added in task 2-b; all pooled, allocation-free, quality/reduced-motion
     aware. spells.ts is the primary caller.) */

  /** Precise particle puff for projectile trails — full control over velocity,
      sway, gravity and alpha (unlike `burst`'s spherical spread). */
  trailPuff(pos: THREE.Vector3, color: number, count: number, opts?: TrailOpts): void {
    if (this.disposed || count <= 0) return;
    const vx = opts?.vx ?? 0;
    const vy = opts?.vy ?? 0;
    const vz = opts?.vz ?? 0;
    const jit = opts?.jitter ?? 0.25;
    const size = opts?.size ?? 0.6;
    const life = (opts?.life ?? 0.35) * this.lifeMul;
    const alpha = opts?.alpha ?? 0.9;
    const grav = opts?.gravity ?? 0;
    const drag = opts?.drag ?? 0.6;
    const sA = opts?.swayA ?? 0;
    const sF = opts?.swayF ?? 4;
    const ox = opts?.ox ?? 0;
    const oy = opts?.oy ?? 0;
    const oz = opts?.oz ?? 0;
    const n = this.rmCount(count);
    _c1.setHex(color);
    for (let i = 0; i < n; i++) {
      this.spawnParticle(pos.x + ox + randRange(-jit, jit) * 0.35, pos.y + oy + randRange(-jit, jit) * 0.35, pos.z + oz + randRange(-jit, jit) * 0.35, vx + randRange(-jit, jit), vy + randRange(-jit, jit), vz + randRange(-jit, jit), _c1.r, _c1.g, _c1.b, size * randRange(0.75, 1.25), life * randRange(0.8, 1.2), alpha, grav, drag, sA, sF, Math.random() * Math.PI * 2);
    }
  }
  /** Lingering soft glow circle on the ground (kill sites, blasts, arrivals).
    Pooled at 24; round-robin reuse steals the oldest. */
  groundDecal(pos: THREE.Vector3, color: number, radius: number, opts?: DecalOpts): void {
    if (this.disposed || this.decals.length === 0) return;
    const slot = this.decals[this.decalCursor % this.decalCap];
    this.decalCursor = (this.decalCursor + 1) % this.decalCap;
    slot.mesh.position.set(pos.x, opts?.y ?? 0.05, pos.z);
    slot.mesh.scale.setScalar(1e-3);
    slot.mat.color.setHex(color);
    slot.op = Math.min(1, Math.max(0.05, opts?.intensity ?? 0.55));
    slot.t = 0;
    slot.life = Math.max(0.2, (opts?.life ?? 1.5) * this.lifeMul);
    slot.r = Math.max(0.2, radius);
    slot.active = true;
    slot.mesh.visible = true;
  }
  /** Jagged crackling lightning arc between two points — white-hot core
    stroke + colored outer stroke, re-jittered every ~45ms while alive. */
  arcFlash(from: THREE.Vector3, to: THREE.Vector3, color: number, opts?: ArcOpts): void {
    if (this.disposed || this.arcs.length === 0) return;
    const slot = this.arcs[this.arcCursor % this.arcCap];
    this.arcCursor = (this.arcCursor + 1) % this.arcCap;
    slot.from.copy(from);
    slot.to.copy(to);
    slot.color.setHex(color);
    slot.jitter = opts?.jitter ?? 0; // 0 = auto from length
    slot.life = Math.max(0.08, (opts?.life ?? 0.22) * this.lifeMul);
    slot.t = 0;
    slot.phase = Math.random() * Math.PI * 2;
    slot.nextJ = 0.045;
    /* vertex colors: stroke 0 = white core, stroke 1 = element color */
    const col = slot.col;
    const half = col.length / 2;
    for (let i = 0; i < half; i += 3) {
      col[i] = 1;
      col[i + 1] = 1;
      col[i + 2] = 1;
      col[half + i] = slot.color.r;
      col[half + i + 1] = slot.color.g;
      col[half + i + 2] = slot.color.b;
    }
    this.writeArc(slot);
    slot.obj.geometry.getAttribute("color").needsUpdate = true;
    slot.active = true;
    slot.obj.visible = true;
  }
  /** Rewrite the arc polyline with fresh jitter (bell-shaped, anchored ends). */
  private writeArc(a: ArcState): void {
    const pos = a.pos;
    const fx = a.from.x,
      fy = a.from.y,
      fz = a.from.z;
    let dx = a.to.x - fx,
      dy = a.to.y - fy,
      dz = a.to.z - fz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    _a3.set(dx, dy, dz);
    /* stable perpendicular basis (arc mostly horizontal in practice) */
    _a1.set(-dz, 0, dx);
    if (_a1.lengthSq() < 1e-4) _a1.set(1, 0, 0);
    _a1.normalize();
    _a2.crossVectors(_a1, _a3);
    const jit = a.jitter > 0 ? a.jitter : Math.min(1.1, Math.max(0.15, len * 0.12));
    for (let s = 0; s < 2; s++) {
      const amp = s === 0 ? 0.5 : 1; // core stroke follows tighter
      let px = fx,
        py = fy,
        pz = fz;
      const base = s * ARC_SEGS * 6;
      for (let i = 1; i < ARC_PTS; i++) {
        const u = i / (ARC_PTS - 1);
        const bell = Math.sin(u * Math.PI);
        const j1 = amp * jit * bell * (Math.random() * 2 - 1);
        const j2 = amp * jit * bell * (Math.random() * 2 - 1);
        const j3 = jit * 0.3 * bell * (Math.random() * 2 - 1);
        const qx = fx + dx * len * u + _a1.x * j1 + _a2.x * j2 + dx * j3;
        const qy = fy + dy * len * u + _a1.y * j1 + _a2.y * j2 + dy * j3;
        const qz = fz + dz * len * u + _a1.z * j1 + _a2.z * j2 + dz * j3;
        const o = base + (i - 1) * 6;
        pos[o] = px;
        pos[o + 1] = py;
        pos[o + 2] = pz;
        pos[o + 3] = qx;
        pos[o + 4] = qy;
        pos[o + 5] = qz;
        px = qx;
        py = qy;
        pz = qz;
      }
    }
    a.obj.geometry.getAttribute("position").needsUpdate = true;
  }
  /** Tall thin vertical light beam (crossed additive planes, base on ground).
    Fades fast — weave blasts, nova spikes, rift detonations. */
  lightPillar(pos: THREE.Vector3, color: number, opts?: PillarOpts): void {
    if (this.disposed || this.pillars.length === 0) return;
    const slot = this.pillars[this.pillarCursor % this.pillarCap];
    this.pillarCursor = (this.pillarCursor + 1) % this.pillarCap;
    slot.group.position.set(pos.x, 0, pos.z);
    slot.group.scale.set(1e-3, 1e-3, 1e-3);
    slot.group.rotation.y = Math.random() * Math.PI; // vary crossing angle
    slot.w = Math.max(0.3, opts?.width ?? 1.6);
    slot.h = Math.max(1, opts?.height ?? 8);
    slot.op = Math.min(1, opts?.intensity ?? 0.85);
    slot.life = Math.max(0.15, (opts?.life ?? 0.6) * this.lifeMul);
    slot.t = 0;
    for (const m of slot.mats) m.color.setHex(color);
    slot.active = true;
    slot.group.visible = true;
  }
  /** Pair of crossed vertical rings in two colors — the resonance weave
    signature mark (atom-like orbital crossing through `pos`). */
  crossRings(pos: THREE.Vector3, colorA: number, colorB: number, radius: number, opts?: { life?: number }): void {
    if (this.disposed || this.crosses.length === 0) return;
    const slot = this.crosses[this.crossCursor % this.crossCap];
    this.crossCursor = (this.crossCursor + 1) % this.crossCap;
    slot.group.position.copy(pos);
    slot.group.scale.setScalar(1e-3);
    slot.group.rotation.y = Math.random() * Math.PI;
    slot.r = Math.max(0.3, radius);
    slot.life = Math.max(0.15, (opts?.life ?? 0.7) * this.lifeMul);
    slot.t = 0;
    slot.mA.color.setHex(colorA);
    slot.mB.color.setHex(colorB);
    slot.active = true;
    slot.group.visible = true;
  }
  /** Lens-flare style cross glint — billboarded soft blob + streak blades.
    Short-lived accent for holy hits, lance impacts, weave detonations. */
  glint(pos: THREE.Vector3, color: number, size = 1): void {
    if (this.disposed || this.glints.length === 0) return;
    const slot = this.glints[this.glintCursor % this.glintCap];
    this.glintCursor = (this.glintCursor + 1) % this.glintCap;
    slot.group.position.copy(pos);
    slot.size = Math.max(0.2, size);
    slot.life = 0.24 * this.lifeMul;
    slot.t = 0;
    _c1.setHex(color);
    slot.blob.material.color.copy(_c1).lerp(WHITE, 0.4);
    slot.streak.material.color.copy(_c1).lerp(WHITE, 0.15);
    slot.active = true;
    slot.group.visible = true;
  }
  /** 10-d: expanding concentric ground ripple (kenney-ripple sprite) — the
    pressure-wave layer for impacts and meaningful blasts. Pooled at 12. */
  ripple(pos: THREE.Vector3, color: number, radius: number, opts?: RippleOpts): void {
    if (this.disposed || this.ripples.length === 0) return;
    const slot = this.ripples[this.rippleCursor % this.rippleCap];
    this.rippleCursor = (this.rippleCursor + 1) % this.rippleCap;
    slot.mesh.position.set(pos.x, opts?.y ?? 0.09, pos.z);
    slot.mesh.scale.setScalar(1e-3); // no 1-frame full-size flash
    slot.mat.color.setHex(color);
    slot.op = Math.min(1, Math.max(0.05, opts?.intensity ?? 0.7));
    slot.t = 0;
    slot.life = Math.max(0.2, (opts?.life ?? 0.55) * this.lifeMul);
    slot.r = Math.max(0.3, radius);
    slot.active = true;
    slot.mesh.visible = true;
  }
  /** 10-d: curved slash arc (kenney-crescent sprite) — the strike-land beat
    for committed melee swings (foe contact hits, blink strikes). The arc
    billboards to the camera, rolls by `opts.roll` and sweeps while it
    expands + fades. Pooled at 16. */
  slashArc(pos: THREE.Vector3, color: number, opts?: CrescentOpts): void {
    if (this.disposed || this.crescents.length === 0) return;
    const slot = this.crescents[this.crescentCursor % this.crescentCap];
    this.crescentCursor = (this.crescentCursor + 1) % this.crescentCap;
    slot.group.position.copy(pos);
    slot.size = Math.max(0.2, opts?.size ?? 1);
    slot.roll = opts?.roll ?? 0;
    slot.spin = opts?.spin ?? 3.2;
    slot.life = Math.max(0.12, (opts?.life ?? 0.28) * this.lifeMul);
    slot.t = 0;
    _c1.setHex(color).lerp(WHITE, 0.2);
    slot.mat.color.copy(_c1);
    slot.active = true;
    slot.group.visible = true;
  }
  /** Compact hit feedback: hitSpark cone + white-hot flash + small ripple
    ring at the wound. `strength` scales the ring/flash (1 = normal hit).
    10-d: near-ground hits also stamp a small concentric ground ripple. */
  impact(pos: THREE.Vector3, color: number, dir?: THREE.Vector3, strength = 1): void {
    if (this.disposed) return;
    this.hitSpark(pos, color, dir);
    if (!this.reducedMotion) {
      _c1.setHex(color).lerp(WHITE, 0.65);
      const fs = 1.05 + 0.5 * strength;
      for (let i = 0; i < 2; i++) {
        this.spawnParticle(pos.x + randRange(-0.1, 0.1), pos.y + randRange(-0.1, 0.1), pos.z + randRange(-0.1, 0.1), 0, 0.35, 0, _c1.r, _c1.g, _c1.b, fs * randRange(0.85, 1.15), 0.12 * this.lifeMul, 1, 0, 2, 0, 0, 0);
      }
      if (pos.y < 1.1 && strength >= 1) {
        this.ripple(pos, color, 1.1 + 0.5 * strength, {
          life: 0.4,
          intensity: 0.45
        });
      }
    }
    this.ring(pos, color, 0.8 + 0.55 * strength, {
      life: 0.3,
      thickness: 0.5,
      y: Math.max(0.14, Math.min(2.4, pos.y * 0.75)),
      expand: 1.6
    });
  }
  /** Player-side cast aura: ground ring + rising body motes + chest flash.
    `strength` 0..1.5 (spell weight). */
  auraPulse(pos: THREE.Vector3, color: number, strength = 1): void {
    if (this.disposed) return;
    this.ring(pos, color, 1.6 + 0.9 * strength, {
      life: 0.4,
      thickness: 0.35
    });
    _c1.setHex(color);
    const n = this.rmCount(4 + Math.round(3 * Math.min(1.5, strength)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const rr = 0.45 + Math.random() * 0.55;
      this.spawnParticle(pos.x + Math.cos(a) * rr, 0.35 + Math.random() * 0.9, pos.z + Math.sin(a) * rr, randRange(-0.3, 0.3), 1.8 * strength + Math.random() * 0.8, randRange(-0.3, 0.3), _c1.r, _c1.g, _c1.b, 0.45 * randRange(0.75, 1.25), 0.55 * this.lifeMul, 0.85, -1.5, 1.2, 0.25, 3.5, Math.random() * Math.PI * 2);
    }
    _c1.lerp(WHITE, 0.5);
    this.spawnParticle(pos.x, 1.25, pos.z, 0, 0.2, 0, _c1.r, _c1.g, _c1.b, 1.4 * Math.max(0.6, strength), 0.14 * this.lifeMul, 0.9, 0, 0, 0, 0, 0);
  }
  /** Ground cast telegraph at the aim point: contracting targeting ring +
    small bloom ring + center flash. Scales with the spell's blast radius. */
  castGround(pos: THREE.Vector3, color: number, radius = 2): void {
    if (this.disposed) return;
    const r = Math.max(0.6, radius);
    this.ring(pos, color, r, {
      life: 0.3,
      thickness: 0.35,
      contract: true,
      expand: 2
    });
    this.ring(pos, color, r * 0.5, {
      life: 0.35,
      thickness: 0.5,
      expand: 1.5
    });
    _c1.setHex(color).lerp(WHITE, 0.35);
    this.spawnParticle(pos.x, 0.25, pos.z, 0, 0.5, 0, _c1.r, _c1.g, _c1.b, 1.2, 0.15 * this.lifeMul, 0.9, 0, 0, 0, 0, 0);
  }
  /* --------------------------- damage numbers --------------------------- */

  /** Floating DOM number projected from world space. No-op if disabled or
      no damage layer attached yet. */
  damageNumber(worldPos: THREE.Vector3, text: string, color: number, big = false): void {
    if (this.disposed || !this.dmgEnabled || !this.layer) return;
    /* cull points behind / far off the camera */
    this.camera.getWorldDirection(_v2);
    _v3.copy(worldPos).sub(this.camera.position);
    if (_v3.dot(_v2) <= 0.05) return;
    _v1.set(worldPos.x, worldPos.y + 0.5, worldPos.z).project(this.camera);
    if (Math.abs(_v1.x) > 1.05 || Math.abs(_v1.y) > 1.05) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = (_v1.x * 0.5 + 0.5) * w + randRange(-8, 8);
    const y = (-_v1.y * 0.5 + 0.5) * h + randRange(-6, 6) - (big ? 16 : 10);
    /* find a free slot, else steal the oldest */
    let slot = -1;
    for (let i = 0; i < this.dmgActive.length; i++) {
      if (!this.dmgActive[i]) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      slot = 0;
      for (let i = 1; i < this.dmgActive.length; i++) {
        if (this.dmgAge[i] > this.dmgAge[slot]) slot = i;
      }
    }
    const el = this.dmgEls[slot];
    const st = el.style;
    el.textContent = text;
    st.color = cssHex(color);
    st.fontSize = big ? "20px" : "14px";
    st.fontWeight = big ? "900" : "700";
    st.display = "block";
    st.opacity = "1";
    st.transform = "translate(-50%,-50%) translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) scale(1.35)";
    this.dmgActive[slot] = true;
    this.dmgX[slot] = x;
    this.dmgY[slot] = y;
    this.dmgAge[slot] = 0;
    this.dmgLife[slot] = big ? 1.1 : 0.8;
  }
  /** Alias kept for engine naming compatibility (=== damageNumber). */
  text3d(worldPos: THREE.Vector3, text: string, color: number, big?: boolean): void {
    this.damageNumber(worldPos, text, color, big);
  }
}