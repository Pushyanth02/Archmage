/* ============================================================================
   VFX CORE — the Radiant Rework's combat-effects engine (V1.3).
   ----------------------------------------------------------------------------
   Techniques applied from the top open-source web-game playbooks
   (Phaser/PixiJS particle + camera systems, canvas-confetti, LittleJS,
   tsParticles, "Juice it or lose it", js13k postmortems, Fiedler loops):

   · SPRITE BAKERY — every glow / flash / streak / smoke is rasterized ONCE
     into a small offscreen canvas (shadowBlur and radial gradients are the
     two slowest Canvas2D ops; baked sprites replace both with one
     drawImage).  Demand-baked per color, cached forever.
   · ONE ADDITIVE PASS — all combat glow (blasts, sparks, shockwaves, wisps,
     aura shells) draws inside the engine's single `globalCompositeOperation
     = "lighter"` block; smoke then returns under `source-over` so it softly
     occludes the glow edges (the "layered explosion" stack).
   · ZERO-ALLOCATION POOLS — every effect slot is preallocated and flagged
     `on`; emitters recycle dead slots through a rolling cursor.  No object,
     array, closure, string or gradient is created per frame.
   · RIBBON TRAILS — per-projectile tapered polygon trails on a Float32Array
     ring buffer (one fill per trail; no per-frame particle emission, no GC).
   · JUICE CONTROLLER — trauma-based screen shake (shake = trauma², smooth
     dual-sine noise, exponential decay), render-only kill zoom-punch, color
     flash overlay, boss-kill slow-mo and a 150 ms re-trigger guard so
     hitstop never stacks into mush.
   · EASED CURVES — impacts ride easeOutExpo / easeOutCubic; squash recovers
     through an eased spring, not a linear drain.
============================================================================ */

export const TAU = Math.PI * 2;

/* ------------------------------- color utils ------------------------------ */

/** "#rrggbb" → [r,g,b]. Anything else resolves to white (all palette colors
 *  in this game are hex literals from content.ts). */
export function hexRgb(hex: string): [number, number, number] {
  if (hex.length === 7 && hex[0] === "#") {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  }
  return [255, 255, 255];
}

/* ------------------------------ sprite bakery ----------------------------- */

const GLOW_SIZE = 64;
const spriteCache = new Map<string, HTMLCanvasElement>();

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

/** Soft additive glow: white-hot center melting into the tint, feathered to
 *  nothing.  This is the workhorse — projectile bloom, enemy under-aura,
 *  blast cores, wisps and motes are all THIS, drawn at different scales. */
function bakeGlow(hex: string): HTMLCanvasElement {
  const [r, g, b] = hexRgb(hex);
  const cv = makeCanvas(GLOW_SIZE, GLOW_SIZE);
  const c = cv.getContext("2d")!;
  const grad = c.createRadialGradient(GLOW_SIZE / 2, GLOW_SIZE / 2, 1, GLOW_SIZE / 2, GLOW_SIZE / 2, GLOW_SIZE / 2);
  grad.addColorStop(0, `rgba(255,255,255,0.95)`);
  grad.addColorStop(0.22, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.28)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return cv;
}

/** Hard impact flash: crisp white disc with a tight tinted corona — the
 *  first frame of every blast. */
function bakeFlash(hex: string): HTMLCanvasElement {
  const [r, g, b] = hexRgb(hex);
  const cv = makeCanvas(GLOW_SIZE, GLOW_SIZE);
  const c = cv.getContext("2d")!;
  const grad = c.createRadialGradient(GLOW_SIZE / 2, GLOW_SIZE / 2, 1, GLOW_SIZE / 2, GLOW_SIZE / 2, GLOW_SIZE / 2);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(0.30, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.32)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return cv;
}

/** Chromatic-fringed flash: the impact core with a red/cyan split edge —
 *  drawn for the first ~100 ms of big blasts (fake aberration). */
function bakeFringe(hex: string): HTMLCanvasElement {
  const [r, g, b] = hexRgb(hex);
  const cv = makeCanvas(GLOW_SIZE, GLOW_SIZE);
  const c = cv.getContext("2d")!;
  const half = GLOW_SIZE / 2;
  const off = 3;
  for (const [rr, rg, rb, dx, dy] of [
    [255, 60, 80, -off, -off] as const,
    [80, 220, 255, off, off] as const,
  ]) {
    const grad = c.createRadialGradient(half + dx, half + dy, 1, half + dx, half + dy, half * 0.8);
    grad.addColorStop(0, `rgba(${rr},${rg},${rb},0.42)`);
    grad.addColorStop(1, `rgba(${rr},${rg},${rb},0)`);
    c.fillStyle = grad;
    c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  }
  const core = c.createRadialGradient(half, half, 1, half, half, half * 0.9);
  core.addColorStop(0, `rgba(255,255,255,0.9)`);
  core.addColorStop(0.4, `rgba(${r},${g},${b},0.55)`);
  core.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = core;
  c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return cv;
}

/** Motion streak: horizontal bright→dark head with a soft vertical falloff.
 *  Rotated along the streak's velocity and stretched by speed = free motion
 *  blur without any filter. */
const STREAK_W = 32;
const STREAK_H = 10;
function bakeStreak(hex: string): HTMLCanvasElement {
  const [r, g, b] = hexRgb(hex);
  const cv = makeCanvas(STREAK_W, STREAK_H);
  const c = cv.getContext("2d")!;
  const grad = c.createLinearGradient(0, 0, STREAK_W, 0);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.8, `rgba(255,255,255,0.9)`);
  grad.addColorStop(1, `rgba(255,255,255,1)`);
  c.fillStyle = grad;
  c.fillRect(0, 1, STREAK_W, STREAK_H - 2);
  /* soften the vertical edges so it never reads as a hard rectangle */
  c.globalCompositeOperation = "destination-in";
  const v = c.createLinearGradient(0, 0, 0, STREAK_H);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(0.28, "rgba(0,0,0,1)");
  v.addColorStop(0.72, "rgba(0,0,0,1)");
  v.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = v;
  c.fillRect(0, 0, STREAK_W, STREAK_H);
  return cv;
}

/** Smoke wisp: two overlapping soft dark blobs (soot with character). */
function bakeSmoke(): HTMLCanvasElement {
  const cv = makeCanvas(GLOW_SIZE, GLOW_SIZE);
  const c = cv.getContext("2d")!;
  for (const [x, y, rad, a] of [
    [32, 32, 26, 0.5] as const,
    [42, 38, 20, 0.34] as const,
  ]) {
    const grad = c.createRadialGradient(x, y, 2, x, y, rad);
    grad.addColorStop(0, `rgba(16,11,26,${a})`);
    grad.addColorStop(0.6, `rgba(16,11,26,${a * 0.55})`);
    grad.addColorStop(1, "rgba(16,11,26,0)");
    c.fillStyle = grad;
    c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  }
  return cv;
}

function sprite(kind: "glow" | "flash" | "fringe" | "streak", color: string): HTMLCanvasElement {
  const key = kind + ":" + color;
  let cv = spriteCache.get(key);
  if (!cv) {
    cv = kind === "glow" ? bakeGlow(color)
      : kind === "flash" ? bakeFlash(color)
      : kind === "fringe" ? bakeFringe(color)
      : bakeStreak(color);
    spriteCache.set(key, cv);
  }
  return cv;
}

let smokeSprite: HTMLCanvasElement | null = null;
export function smokeSpr(): HTMLCanvasElement {
  if (!smokeSprite) smokeSprite = bakeSmoke();
  return smokeSprite;
}

/* -------------------------------- easings --------------------------------- */

export function easeOutExpo(t: number): number { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
export function easeOutCubic(t: number): number { return 1 - (1 - t) * (1 - t) * (1 - t); }
export function easeOutBack(t: number): number { const k = 1.70158; const u = t - 1; return 1 + u * u * ((k + 1) * u + k); }

/* ------------------------------ ribbon trail ------------------------------ */

/** Tapered polygon trail on a Float32Array ring buffer. One `fill` per
 *  trail, zero allocations, spike-proof (teleports reset it). The caller
 *  sets `fillStyle` from a precomposed per-element string table. */
export class Trail {
  private readonly n: number;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly nx: Float32Array;
  private readonly ny: Float32Array;
  private head = 0;
  private len = 0;

  constructor(n: number) {
    this.n = n;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
  }

  push(x: number, y: number): void {
    const last = (this.head - 1 + this.n) % this.n;
    if (this.len > 0) {
      const dx = x - this.xs[last];
      const dy = y - this.ys[last];
      if (dx * dx + dy * dy > 20 * 20) { this.clear(); }  // teleport / respawn → no spike
    }
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.head = (this.head + 1) % this.n;
    if (this.len < this.n) this.len++;
  }

  /** Width is in world px at the newest point; tapers to nothing at the tail.
   *  Fills with the caller's fillStyle at the given alpha. */
  draw(c: CanvasRenderingContext2D, width: number, alpha: number): void {
    const len = this.len;
    if (len < 2) return;
    const n = this.n;
    const xs = this.xs, ys = this.ys, nx = this.nx, ny = this.ny;
    /* first pass — segment normals, oldest → newest, into the scratch array */
    let i = (this.head - len + n) % n;
    for (let k = 0; k < len; k++) {
      const x0 = xs[i], y0 = ys[i];
      let dx: number, dy: number;
      if (k < len - 1) {
        const j = (i + 1) % n;
        dx = xs[j] - x0; dy = ys[j] - y0;
      } else {
        const j = (i - 1 + n) % n;
        dx = x0 - xs[j]; dy = y0 - ys[j];
      }
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l < 0.0001) { dx = 1; dy = 0; } else { dx /= l; dy /= l; }
      nx[k] = -dy; ny[k] = dx;
      i = (i + 1) % n;
    }
    /* second pass — the tapered polygon: +side newest→oldest, −side back */
    const newest = (this.head - 1 + n) % n;
    c.beginPath();
    let idx = newest;
    let first = true;
    for (let k = len - 1; k >= 0; k--) {
      const t = k / (len - 1);                       // 1 at the head, 0 at the tail
      const hw = width * 0.5 * t * t + 0.3;
      const ox = nx[k] * hw, oy = ny[k] * hw;
      if (first) { c.moveTo(xs[idx] + ox, ys[idx] + oy); first = false; }
      else c.lineTo(xs[idx] + ox, ys[idx] + oy);
      idx = (idx - 1 + n) % n;
    }
    for (let k = 0; k < len; k++) {
      const t = k / (len - 1);
      const hw = width * 0.5 * t * t + 0.3;
      c.lineTo(xs[idx] - nx[k] * hw, ys[idx] - ny[k] * hw);
      idx = (idx + 1) % n;
    }
    c.closePath();
    c.globalAlpha = alpha;
    c.fill();
    c.globalAlpha = 1;
  }

  clear(): void { this.head = 0; this.len = 0; }
}

/* ----------------------------- effect records ----------------------------- */

interface StreakRec {
  on: boolean; x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; drag: number; grav: number;
  spr: HTMLCanvasElement | null;
}
interface ShockRec {
  on: boolean; x: number; y: number; maxR: number; life: number; maxLife: number;
  r: number; g: number; b: number; w: number; rot: number; segs: number;
}
interface BlastRec {
  on: boolean; x: number; y: number; rad: number; life: number; maxLife: number;
  spr: HTMLCanvasElement | null; fringe: HTMLCanvasElement | null;
}
interface AuraRec {
  on: boolean; x: number; y: number; maxR: number; life: number; maxLife: number;
  r: number; g: number; b: number; w: number;
}
interface WispRec {
  on: boolean; x: number; y: number; vy: number; ph: number;
  life: number; maxLife: number; size: number; spr: HTMLCanvasElement | null;
}
interface SmokeRec {
  on: boolean; x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; rot: number; spin: number;
}

function mkStreak(): StreakRec { return { on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, drag: 3, grav: 0, spr: null }; }
function mkShock(): ShockRec { return { on: false, x: 0, y: 0, maxR: 10, life: 0, maxLife: 1, r: 255, g: 255, b: 255, w: 2, rot: 0, segs: 0 }; }
function mkBlast(): BlastRec { return { on: false, x: 0, y: 0, rad: 10, life: 0, maxLife: 1, spr: null, fringe: null }; }
function mkAura(): AuraRec { return { on: false, x: 0, y: 0, maxR: 10, life: 0, maxLife: 1, r: 255, g: 255, b: 255, w: 2 }; }
function mkWisp(): WispRec { return { on: false, x: 0, y: 0, vy: -40, ph: 0, life: 0, maxLife: 1, size: 4, spr: null }; }
function mkSmoke(): SmokeRec { return { on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 6, rot: 0, spin: 0.4 }; }

/* ------------------------------ VFX system -------------------------------- */

/**
 * Owns every combat effect pool. All emitters are side-effect only — they
 * never allocate: dead slots are found via a rolling cursor, revived in
 * place and drawn with baked sprites inside one additive pass.
 *
 * Density: `quality` (0.4 … 1.0) scales every emitter count; the engine sets
 * it from the device class and the adaptive frame-time monitor.
 */
export class Vfx {
  /** effect-density scalar (device tier × adaptive load-shedding) */
  quality = 1;

  private readonly streaks: StreakRec[] = [];
  private readonly shocks: ShockRec[] = [];
  private readonly blasts: BlastRec[] = [];
  private readonly auras: AuraRec[] = [];
  private readonly wisps: WispRec[] = [];
  private readonly smokes: SmokeRec[] = [];
  private sc = 0; private hc = 0; private bc = 0; private ac = 0; private wc = 0; private mc = 0;

  constructor() {
    for (let i = 0; i < 224; i++) this.streaks.push(mkStreak());
    for (let i = 0; i < 72; i++) this.shocks.push(mkShock());
    for (let i = 0; i < 20; i++) this.blasts.push(mkBlast());
    for (let i = 0; i < 14; i++) this.auras.push(mkAura());
    for (let i = 0; i < 26; i++) this.wisps.push(mkWisp());
    for (let i = 0; i < 44; i++) this.smokes.push(mkSmoke());
  }

  /* ------------------------------- emitters ------------------------------ */

  /** Public sprite accessors (engine draws its own under-glows with them). */
  glowSpr(color: string): HTMLCanvasElement { return sprite("glow", color); }
  flashSpr(color: string): HTMLCanvasElement { return sprite("flash", color); }
  fringeSpr(color: string): HTMLCanvasElement { return sprite("fringe", color); }
  streakSpr(color: string): HTMLCanvasElement { return sprite("streak", color); }

  private freeStreak(): StreakRec | null {
    const arr = this.streaks;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[this.sc];
      this.sc = (this.sc + 1) % arr.length;
      if (!s.on) return s;
    }
    return null;   // pool exhausted — the effect is skipped (load-shedding by design)
  }

  private spark(x: number, y: number, ang: number, spread: number, color: string,
               spd: number, life: number, size: number, grav = 0, drag = 3.2): void {
    const s = this.freeStreak();
    if (!s) return;
    const a = ang + (Math.random() - 0.5) * spread;
    const v = spd * (0.55 + Math.random() * 0.7);
    s.on = true;
    s.x = x; s.y = y;
    s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
    s.life = s.maxLife = life * (0.6 + Math.random() * 0.6);
    s.size = size * (0.7 + Math.random() * 0.6);
    s.drag = drag; s.grav = grav;
    s.spr = sprite("streak", color);
  }

  /** HIT — directional spark cone off the impact point + micro shock ring.
   *  This is the "hit feel" layer: bright, fast, directional. */
  impact(x: number, y: number, ang: number, color: string, power: number): void {
    const q = this.quality;
    const n = Math.max(2, Math.round((power >= 2 ? 7 : 4) * q));
    for (let i = 0; i < n; i++) {
      this.spark(x, y, ang, power >= 2 ? 1.9 : 1.35, color,
        170 + power * 60, 0.22 + Math.random() * 0.14, 3.2 + power * 0.8);
    }
    /* micro flash at the wound */
    this.blastCore(x, y, 9 + power * 5, 0.14, color, true);
    if (power >= 2) this.shock(x, y, 26 + power * 8, color, 2, 0);
  }

  /** Shockwave ring — the upgraded replacement for the legacy ring():
   *  dual stroke (broad soft + bright tight), eased expansion, optional
   *  rotating segmented arcs for the big ones. */
  shock(x: number, y: number, maxR: number, color: string, w: number, segs = 0): void {
    const arr = this.shocks;
    let rec: ShockRec | null = null;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[this.hc];
      this.hc = (this.hc + 1) % arr.length;
      if (!s.on) { rec = s; break; }
    }
    if (!rec) return;
    const [r, g, b] = hexRgb(color);
    rec.on = true;
    rec.x = x; rec.y = y;
    rec.maxR = maxR;
    rec.maxLife = 0.22 + Math.min(0.5, maxR * 0.004);
    rec.life = rec.maxLife;
    rec.r = r; rec.g = g; rec.b = b;
    rec.w = w;
    rec.rot = Math.random() * TAU;
    rec.segs = this.quality >= 0.7 ? segs : 0;
  }

  private blastCore(x: number, y: number, rad: number, life: number, color: string, fringe: boolean): void {
    const arr = this.blasts;
    let rec: BlastRec | null = null;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[this.bc];
      this.bc = (this.bc + 1) % arr.length;
      if (!b.on) { rec = b; break; }
    }
    if (!rec) return;
    rec.on = true;
    rec.x = x; rec.y = y;
    rec.rad = rad;
    rec.maxLife = life; rec.life = life;
    rec.spr = sprite("flash", color);
    rec.fringe = fringe && this.quality >= 0.7 ? sprite("fringe", color) : null;
  }

  /** BLAST — the full layered explosion (core flash + chromatic fringe +
   *  double shockwave + debris sparks + smoke). One call, complete impact. */
  blast(x: number, y: number, color: string, alt: string, rad: number, power: number): void {
    const q = this.quality;
    this.blastCore(x, y, rad * (power >= 2 ? 1.35 : 1), 0.30, color, rad > 44);
    this.shock(x, y, rad * (power >= 2 ? 1.7 : 1.25), color, 3.2, rad > 44 ? 5 : 0);
    this.shock(x, y, rad * 0.66, alt, 2, 0);
    const n = Math.max(4, Math.round((10 + power * 6) * q));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.6;
      this.spark(x, y, a, 0.4, i % 3 === 0 ? alt : color,
        140 + power * 90 + Math.random() * 160, 0.3 + Math.random() * 0.25, 3.6, 260, 2.6);
    }
    if (q >= 0.6) {
      const sm = Math.max(1, Math.round((rad > 60 ? 4 : 2) * q));
      for (let i = 0; i < sm; i++) this.smokeP(x, y, 0.7);
    }
  }

  /** AURA BURST — the "hit + aura" shell: an expanding double-ringed aura
   *  with rotating arc segments. Used on kills, auras and elite deaths. */
  aura(x: number, y: number, color: string, maxR: number): void {
    const arr = this.auras;
    let rec: AuraRec | null = null;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[this.ac];
      this.ac = (this.ac + 1) % arr.length;
      if (!a.on) { rec = a; break; }
    }
    if (!rec) return;
    const [r, g, b] = hexRgb(color);
    rec.on = true;
    rec.x = x; rec.y = y; rec.maxR = maxR;
    rec.maxLife = 0.42; rec.life = rec.maxLife;
    rec.r = r; rec.g = g; rec.b = b;
    rec.w = maxR > 60 ? 2.6 : 1.8;
  }

  /** Soul wisp — the rising spirit released at a kill. */
  wisp(x: number, y: number, color: string): void {
    const arr = this.wisps;
    let rec: WispRec | null = null;
    for (let i = 0; i < arr.length; i++) {
      const w = arr[this.wc];
      this.wc = (this.wc + 1) % arr.length;
      if (!w.on) { rec = w; break; }
    }
    if (!rec) return;
    rec.on = true;
    rec.x = x + (Math.random() * 16 - 8); rec.y = y;
    rec.vy = -(34 + Math.random() * 30);
    rec.ph = Math.random() * TAU;
    rec.maxLife = 0.9 + Math.random() * 0.4; rec.life = rec.maxLife;
    rec.size = 5 + Math.random() * 4;
    rec.spr = sprite("glow", color);
  }

  /** Smoke puff — soft occlusion after the additive pass. */
  smokeP(x: number, y: number, scale = 1): void {
    const arr = this.smokes;
    let rec: SmokeRec | null = null;
    for (let i = 0; i < arr.length; i++) {
      const m = arr[this.mc];
      this.mc = (this.mc + 1) % arr.length;
      if (!m.on) { rec = m; break; }
    }
    if (!rec) return;
    rec.on = true;
    rec.x = x + (Math.random() * 22 - 11); rec.y = y + (Math.random() * 22 - 11);
    const a = Math.random() * TAU;
    const v = 22 * scale;
    rec.vx = Math.cos(a) * v; rec.vy = Math.sin(a) * v - 18 * scale;
    rec.maxLife = 0.7 + Math.random() * 0.5; rec.life = rec.maxLife;
    rec.size = (14 + Math.random() * 14) * scale;
    rec.rot = Math.random() * TAU;
    rec.spin = (Math.random() - 0.5) * 1.4;
  }

  /** Cast feedback — a two-frame muzzle bloom at the staff tip. */
  muzzle(x: number, y: number, ang: number, color: string): void {
    this.blastCore(x, y, 13, 0.11, color, false);
    const q = this.quality;
    const n = Math.max(1, Math.round(2 * q));
    for (let i = 0; i < n; i++) {
      this.spark(x, y, ang, 0.9, color, 130, 0.12, 2.6);
    }
  }

  /* -------------------------------- update ------------------------------- */

  update(dt: number): void {
    for (const s of this.streaks) {
      if (!s.on) continue;
      s.life -= dt;
      if (s.life <= 0) { s.on = false; s.spr = null; continue; }
      s.vy += s.grav * dt;
      const dr = Math.min(1, s.drag * dt);
      s.vx -= s.vx * dr; s.vy -= s.vy * dr;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (const s of this.shocks) { if (s.on) { s.life -= dt; if (s.life <= 0) s.on = false; } }
    for (const b of this.blasts) { if (b.on) { b.life -= dt; if (b.life <= 0) { b.on = false; b.spr = null; b.fringe = null; } } }
    for (const a of this.auras) { if (a.on) { a.life -= dt; if (a.life <= 0) a.on = false; } }
    for (const w of this.wisps) {
      if (!w.on) continue;
      w.life -= dt;
      if (w.life <= 0) { w.on = false; w.spr = null; continue; }
      w.y += w.vy * dt;
      w.x += Math.sin(w.life * 6 + w.ph) * 14 * dt;
    }
    for (const m of this.smokes) {
      if (!m.on) continue;
      m.life -= dt;
      if (m.life <= 0) { m.on = false; continue; }
      m.x += m.vx * dt; m.y += m.vy * dt;
      m.vx *= 1 - Math.min(1, 2 * dt); m.vy *= 1 - Math.min(1, 2 * dt);
      m.rot += m.spin * dt;
    }
  }

  /** The additive (lighter) pass — call from inside the engine's existing
   *  `globalCompositeOperation = "lighter"` block, world-space transform. */
  drawAdditive(c: CanvasRenderingContext2D, inView: (x: number, y: number, pad: number) => boolean): void {
    /* blast cores — eased expand + square fade */
    for (const b of this.blasts) {
      if (!b.on || !b.spr || !inView(b.x, b.y, b.rad * 2 + 20)) continue;
      const k = 1 - b.life / b.maxLife;
      const scale = easeOutExpo(Math.min(1, k * 1.8)) * 1.15 + 0.25;
      const fade = (1 - k) * (1 - k);
      const d = b.rad * 2 * scale;
      if (b.fringe && k < 0.34) {
        c.globalAlpha = fade * (1 - k / 0.34);
        c.drawImage(b.fringe, b.x - d * 0.75, b.y - d * 0.75, d * 1.5, d * 1.5);
      }
      c.globalAlpha = fade;
      c.drawImage(b.spr, b.x - d / 2, b.y - d / 2, d, d);
    }
    /* shockwaves — eased expansion, broad soft stroke + bright tight stroke */
    for (const s of this.shocks) {
      if (!s.on || !inView(s.x, s.y, s.maxR + 30)) continue;
      const k = 1 - s.life / s.maxLife;
      const ke = easeOutCubic(k);
      const rad = 4 + ke * s.maxR;
      const fade = (1 - ke) * (1 - ke);
      const col = `rgba(${s.r},${s.g},${s.b},`;
      if (s.segs > 0) {
        c.strokeStyle = col + (fade * 0.5) + ")";
        c.lineWidth = s.w * 2.2;
        const arc = TAU / s.segs * 0.7;
        for (let i = 0; i < s.segs; i++) {
          const a0 = s.rot + (i / s.segs) * TAU + ke * 1.2;
          c.beginPath();
          c.arc(s.x, s.y, rad, a0, a0 + arc);
          c.stroke();
        }
      } else {
        c.strokeStyle = col + (fade * 0.45) + ")";
        c.lineWidth = s.w * 2.4;
        c.beginPath(); c.arc(s.x, s.y, rad, 0, TAU); c.stroke();
      }
      c.strokeStyle = col + (fade * 0.95) + ")";
      c.lineWidth = Math.max(1, s.w * (1 - ke * 0.55));
      c.beginPath(); c.arc(s.x, s.y, rad * 0.92, 0, TAU); c.stroke();
    }
    /* aura shells — double ring + soft interior + rotating arc accents */
    for (const a of this.auras) {
      if (!a.on || !inView(a.x, a.y, a.maxR + 30)) continue;
      const k = 1 - a.life / a.maxLife;
      const ke = easeOutCubic(k);
      const rad = 6 + ke * a.maxR;
      const fade = (1 - ke) * (1 - ke);
      const col = `rgba(${a.r},${a.g},${a.b},`;
      c.globalAlpha = fade * 0.16;
      c.fillStyle = col + "0.9)";
      c.beginPath(); c.arc(a.x, a.y, rad, 0, TAU); c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = col + (fade * 0.85) + ")";
      c.lineWidth = a.w;
      c.beginPath(); c.arc(a.x, a.y, rad, 0, TAU); c.stroke();
      c.globalAlpha = fade * 0.6;
      c.lineWidth = a.w * 2.2;
      for (let i = 0; i < 3; i++) {
        const a0 = ke * 2.6 + (i / 3) * TAU;
        c.beginPath(); c.arc(a.x, a.y, rad * 1.12, a0, a0 + 0.85); c.stroke();
      }
      c.globalAlpha = 1;
    }
    /* debris streaks — stretched along velocity = free motion blur */
    for (const s of this.streaks) {
      if (!s.on || !s.spr || !inView(s.x, s.y, 24)) continue;
      const a = s.life / s.maxLife;
      const spd = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      const len = s.size * (2 + spd * 0.02);
      c.globalAlpha = a * a * 0.95;
      c.save();
      c.translate(s.x, s.y);
      c.rotate(Math.atan2(s.vy, s.vx));
      c.drawImage(s.spr, -len * 0.5, -s.size * 0.5, len, s.size);
      c.restore();
    }
    /* soul wisps — glow sprite + short curl */
    for (const w of this.wisps) {
      if (!w.on || !w.spr || !inView(w.x, w.y, 20)) continue;
      const a = w.life / w.maxLife;
      const d = w.size * 3 * (0.6 + a * 0.5);
      c.globalAlpha = a * a * 0.9;
      c.drawImage(w.spr, w.x - d / 2, w.y - d / 2, d, d);
    }
    c.globalAlpha = 1;
  }

  /** The normal-blend pass (smoke) — draw AFTER the additive block closes so
   *  the soot softly occludes the glow edges. Same world-space transform. */
  drawNormal(c: CanvasRenderingContext2D, inView: (x: number, y: number, pad: number) => boolean): void {
    const spr = smokeSpr();
    for (const m of this.smokes) {
      if (!m.on || !inView(m.x, m.y, 40)) continue;
      const a = m.life / m.maxLife;
      const grow = (1 - a) * 1.8 + 1;
      const d = m.size * 2.6 * grow;
      c.save();
      c.translate(m.x, m.y);
      c.rotate(m.rot);
      c.globalAlpha = a * a * 0.42;
      c.drawImage(spr, -d / 2, -d / 2, d, d);
      c.restore();
    }
    c.globalAlpha = 1;
  }

  clear(): void {
    for (const s of this.streaks) { s.on = false; s.spr = null; }
    for (const s of this.shocks) s.on = false;
    for (const b of this.blasts) { b.on = false; b.spr = null; b.fringe = null; }
    for (const a of this.auras) a.on = false;
    for (const w of this.wisps) { w.on = false; w.spr = null; }
    for (const m of this.smokes) m.on = false;
    this.sc = this.hc = this.bc = this.ac = this.wc = this.mc = 0;
  }
}

/* ------------------------------- Juice core ------------------------------- */

/**
 * Camera + time game-feel controller (trauma shake, kill zoom-punch, color
 * flash, boss-kill slow-mo, hitstop re-trigger guard). The engine reads the
 * public fields inside render()/frame(); nothing here allocates.
 */
export class Juice {
  /* trauma shake (shake = trauma², k ≈ 10/s exponential decay) */
  trauma = 0;
  shakeX = 0; shakeY = 0; shakeRot = 0;
  private maxOff = 9;        // px at trauma 1
  private maxRot = 0.022;    // rad at trauma 1

  /* render-only zoom punch */
  private punchT = 0;
  private punchDur = 0.32;
  private punchMag = 0;
  get punchK(): number {
    if (this.punchT <= 0) return 0;
    const k = 1 - this.punchT / this.punchDur;
    return this.punchMag * (1 - easeOutCubic(k));
  }

  /* full-screen color flash */
  flashA = 0; flashR = 255; flashG = 255; flashB = 255;

  /* slow motion (boss kills) */
  private slowT = 0; private slowDur = 0; private slowScale = 1;
  get timeScale(): number { return this.slowT > 0 ? this.slowScale : 1; }

  /* hitstop re-trigger guard — no stacking within 150 ms */
  private clock = 0;
  private lastStop = -1;

  addTrauma(n: number): void { this.trauma = Math.min(1, this.trauma + n); }
  punch(mag: number): void { this.punchMag = mag; this.punchT = this.punchDur; }
  flash(r: number, g: number, b: number, a: number): void {
    this.flashR = r; this.flashG = g; this.flashB = b; this.flashA = Math.max(this.flashA, a);
  }
  slowmo(scale: number, dur: number): void { this.slowScale = scale; this.slowDur = dur; this.slowT = dur; }

  /** Returns the requested hitstop ONLY if the 150 ms guard allows it. */
  requestHitStop(dur: number): number {
    if (this.clock - this.lastStop < 0.15) return 0;
    this.lastStop = this.clock;
    return dur;
  }

  update(rawDt: number): void {
    this.clock += rawDt;
    /* trauma decay — exponential, k ≈ 10/s (half-life ≈ 70 ms) */
    this.trauma = Math.max(0, this.trauma - this.trauma * 10 * rawDt - 0.28 * rawDt);
    const s = this.trauma * this.trauma;
    /* smooth dual-sine noise (~20 Hz effective, no white-noise buzz) */
    const t = this.clock;
    this.shakeX = s * this.maxOff * (Math.sin(t * 92.3) * 0.6 + Math.sin(t * 47.7 + 1.3) * 0.4);
    this.shakeY = s * this.maxOff * (Math.sin(t * 101.7 + 2.1) * 0.6 + Math.sin(t * 53.3 + 0.4) * 0.4);
    this.shakeRot = s * this.maxRot * Math.sin(t * 71.9 + 0.9);
    if (this.punchT > 0) this.punchT = Math.max(0, this.punchT - rawDt);
    if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - rawDt * 3.4);
    if (this.slowT > 0) this.slowT = Math.max(0, this.slowT - rawDt);
  }
}
