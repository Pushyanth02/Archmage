/* ARCHMAGE: RIFTBOUND — MenuScene
   A layered 2.5D title-screen backdrop rendered with Three.js:

     Layer 0 (z = -9.0)  Sky & swirling rift portal — custom GLSL vortex with
                          lightning pulses, spiral arms, stars and a pale moon.
     Layer 1 (z = -2.6)  Midground vista — floating islands, castle silhouettes,
                          stone courtyard, foreground crystals. Painted onto a
                          canvas texture (procedural fallback) or a loaded
                          `bg-clean.png` via the texture candidate hook.
     Layer 2 (z = -1.55) Golden rune circle — RingGeometry driven by a pulsing,
                          dash-tick shader, lying on the painted floor.
     Layer 3 (z = -1.35) Central wizard sprite — idle bob + warm-gold PointLight
                          pulsing from the staff tip (`wizard-idle.png` hook with
                          procedural fallback).
     Layer 4 (z = -4..1)  Foreground VFX — two GPU particle systems (rising
                          purple crystal embers + golden arcane dust).

   Rendering contract: antialias off, pixelRatio capped, every texture on
   NearestFilter — a crisp retro feel. The camera parallaxes subtly with the
   pointer and dollies into the portal when a run starts. */

import * as THREE from "three";

export interface MenuSceneConfig {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Ordered candidate URLs for the painted midground (first that loads wins). */
  backgroundUrls?: string[];
  /** Ordered candidate URLs for the wizard sprite (first that loads wins). */
  wizardUrls?: string[];
  /** Fired once after the first rendered frame — HUD reveal hook. */
  onReady?: () => void;
}

/** Adapter the UI settings modal drives (implemented by this scene). */
export interface SceneControls {
  setParallax(enabled: boolean): void;
  setParticleDensity(density: number): void;
}

const CAMERA_BASE = new THREE.Vector3(0, 1.15, 7.5);
const CAMERA_LOOK = new THREE.Vector3(0, 0.65, -1);
/* The dive is part camera, part optics: the camera dollies gently toward
   the portal while the vortex shader magnifies — see uZoom in SKY_FRAG. */
const PORTAL_FOCUS = new THREE.Vector3(0, 2.6, -4);
const RUN_END = new THREE.Vector3(0, 2.4, 2.0);

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uFlash;   // lightning pulse energy, 0..1
  uniform float uZoom;    // 0..1 run-start dolly, intensifies the vortex
  uniform float uAspect;  // plane width / height, keeps the vortex round
  uniform vec2  uCenter;  // portal center in uv space

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - uCenter;
    p.x *= uAspect;
    /* Optical dive: the sampled radius contracts with uZoom, magnifying
       the vortex up to ~1.9x while the camera itself only dollies gently
       (no plane-crossing artifacts, the courtyard stays composed). */
    p /= (1.0 + uZoom * 0.9);
    float r = length(p);
    float ang = atan(p.y, p.x);

    // Rotating arcane vortex: angle sheared by inverse radius, dragged by
    // time. The drag accelerates hard while diving.
    float swirl = ang + (0.9 / (r + 0.18)) * 1.1 + uTime * (0.35 + uZoom * 2.2);
    float n = fbm(vec2(swirl * 1.6, r * 7.0 - uTime * 0.7));

    vec3 cDeep    = vec3(0.055, 0.030, 0.100);
    vec3 cViolet  = vec3(0.360, 0.170, 0.580);
    vec3 cMagenta = vec3(0.620, 0.260, 0.860);
    vec3 cAmber   = vec3(1.000, 0.580, 0.200);

    vec3 col = mix(cDeep, cViolet, smoothstep(0.78, 0.18, r) * (0.35 + 0.65 * n));
    /* The vortex contracts as the camera dives (uZoom): the eye tightens
       so arms and bands keep swirling AROUND the viewer instead of
       flattening into a solid overexposed disc. */
    float shrink = 1.0 - uZoom * 0.45;
    col = mix(col, cMagenta, smoothstep(0.34 * shrink, 0.10, r) * (0.30 + 0.70 * n));
    float coreR = 0.26 * shrink;
    /* Tight falloff keeps a defined eye instead of a diffuse smear. */
    float core = smoothstep(coreR + 0.03 * sin(uTime * 1.3), coreR * 0.45, r);
    col = mix(col, cAmber, core * (0.80 + 0.20 * sin(uTime * 2.1)));

    // Spiral arms sweeping out of the eye.
    float arms = sin(swirl * 2.5 + r * (10.0 + uZoom * 8.0) - uTime * 1.1);
    col += cMagenta * smoothstep(0.60, 0.98, arms) * smoothstep(0.62, 0.16, r) * 0.30 * (1.0 + uZoom * 0.6);

    // Lightning spokes — flicker with uFlash, reseeded every few seconds.
    float spoke = pow(abs(sin(ang * 3.0 + floor(uTime * 0.5) * 2.4)), 8.0);
    col += vec3(0.82, 0.72, 1.00) * spoke * uFlash * smoothstep(0.70, 0.10, r) * 1.25;
    col += vec3(0.90, 0.85, 1.00) * uFlash * 0.10;

    // Pale moon, upper right, with a soft halo.
    vec2 mp = uv - vec2(0.755, 0.80);
    mp.x *= uAspect;
    float mr = length(mp);
    col += vec3(0.91, 0.88, 0.94) * smoothstep(0.055, 0.050, mr);
    col += vec3(0.60, 0.55, 0.72) * smoothstep(0.16, 0.05, mr) * 0.22;

    // Starfield in the upper sky, slow twinkle.
    float star = step(0.9985, hash(floor(uv * vec2(420.0, 240.0))));
    col += vec3(0.80, 0.75, 0.95) * star * smoothstep(0.20, 0.85, uv.y)
         * (0.45 + 0.55 * sin(uTime * 3.0 + hash(uv * 91.7) * 30.0));

    // Hyperspace streaks: bright radial streamers that take over as the
    // rift swallows the frame — they carry the sense of speed.
    float streak = pow(abs(sin(ang * 14.0 + n * 6.2831)), 3.0) * smoothstep(0.05, 0.6, r);
    col += mix(cMagenta, cAmber, smoothstep(0.34, 0.04, r)) * streak * uZoom * 1.3;

    // Dolly-in: mid-tones fall away and only the eye blazes — a tunnel,
    // not a wash.
    col *= 1.0 - uZoom * 0.3;
    col += cAmber * uZoom * core * 0.9;

    // Vignette.
    float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.55 + 0.45 * vig;

    // Ordered-ish dither: breaks up 8-bit banding in the dark gradients.
    col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const RING_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vLocal;
  uniform float uTime;

  void main() {
    float r = length(vLocal);
    float a = atan(vLocal.y, vLocal.x);

    // Radial band between the ring's inner and outer radii.
    float band = smoothstep(0.95, 1.08, r) * (1.0 - smoothstep(1.38, 1.50, r));

    // Angular rune ticks: long dash, gap, short dash, gap — slowly orbiting.
    float seg = fract(a * 2.5465 + uTime * 0.06);
    float tick = (seg < 0.16 || (seg > 0.30 && seg < 0.36)) ? 1.0 : 0.30;

    float pulse = 0.65 + 0.35 * sin(uTime * 1.7 - r * 3.0);
    vec3 gold = mix(vec3(0.71, 0.55, 0.22), vec3(1.00, 0.85, 0.45), pulse);
    float alpha = band * tick * pulse;

    gl_FragColor = vec4(gold * 1.5, alpha * 0.9);
  }
`;

const POINTS_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aOffset;
  uniform float uTime;
  uniform float uDensity;   // fraction of particles visible, 0..1
  uniform float uScale;     // device-pixel scale reference (height / 1080)
  varying float vLife;
  varying float vSeed;

  void main() {
    vSeed = aSeed;
    float life = fract(aOffset + uTime * aSpeed);
    vLife = life;

    vec3 pos = position;
    pos.y += life * 6.8 - 2.4;
    pos.x += sin(uTime * (0.4 + aSeed * 0.5) + aSeed * 6.2831) * 0.45;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uScale * (9.0 / max(0.5, -mv.z));

    // Density culling: statically park particles beyond the visible fraction.
    if (aOffset > uDensity) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * mv;
  }
`;

const POINTS_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uTime;
  varying float vLife;
  varying float vSeed;

  void main() {
    // Crisp diamond sprite, no texture needed.
    vec2 pc = gl_PointCoord - 0.5;
    float d = abs(pc.x) + abs(pc.y);
    if (d > 0.5) discard;

    float twinkle = 0.55 + 0.45 * sin(uTime * (2.0 + 3.0 * vSeed) + vSeed * 40.0);
    float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.72, 1.0, vLife));
    float alpha = fade * smoothstep(0.5, 0.12, d) * twinkle;
    vec3 col = mix(uColorA, uColorB, vSeed);
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ------------------------------------------------------------------ */
/* Procedural fallback textures                                        */
/* ------------------------------------------------------------------ */

/** Midground vista: islands + courtyard + foreground crystals, 1024x576.
    The upper region stays transparent so the shader sky shows through. */
function createProceduralBackground(): THREE.CanvasTexture {
  const W = 1024;
  const H = 576;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable for procedural background");
  g.imageSmoothingEnabled = false;

  const px = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  /* Distant mountain silhouette along the horizon. */
  g.fillStyle = "#150c20";
  g.beginPath();
  g.moveTo(0, 330);
  const peaks: Array<[number, number]> = [
    [90, 290], [180, 322], [300, 274], [420, 318], [560, 286], [700, 320],
    [820, 278], [930, 316], [1024, 296],
  ];
  for (const [x, y] of peaks) g.lineTo(x, y);
  g.lineTo(1024, 340);
  g.lineTo(0, 340);
  g.closePath();
  g.fill();

  /* Helper: a floating island with towers. */
  const island = (
    cx: number, cy: number, rw: number, rh: number, towers: Array<[number, number, number]>,
  ) => {
    // Rock body (pointed bottom).
    g.fillStyle = "#241835";
    g.beginPath();
    g.moveTo(cx - rw, cy);
    g.lineTo(cx + rw, cy);
    g.lineTo(cx + rw * 0.4, cy + rh);
    g.lineTo(cx, cy + rh * 1.5);
    g.lineTo(cx - rw * 0.5, cy + rh * 0.8);
    g.closePath();
    g.fill();
    // Lit top surface + rim light.
    g.fillStyle = "#3a2956";
    g.beginPath();
    g.ellipse(cx, cy, rw, rh * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(120, 90, 180, 0.55)";
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, cy, rw, rh * 0.22, 0, Math.PI, Math.PI * 1.5);
    g.stroke();
    // Towers: [offsetX, width, height]
    for (const [tx, tw, th] of towers) {
      px(cx + tx - tw / 2, cy - th, tw, th, "#2c1e46");
      g.fillStyle = "#3a2a58";
      g.beginPath();
      g.moveTo(cx + tx - tw / 2 - 3, cy - th);
      g.lineTo(cx + tx, cy - th - 14);
      g.lineTo(cx + tx + tw / 2 + 3, cy - th);
      g.closePath();
      g.fill();
      // Warm windows.
      px(cx + tx - 2, cy - th + 8, 4, 4, "#ffd27a");
      px(cx + tx - 2, cy - th + 20, 4, 4, Math.random() > 0.5 ? "#9ad8ff" : "#ffd27a");
      px(cx + tx + 6, cy - th + 14, 3, 3, "#ffd27a");
    }
  };

  /* Left island — castle, blossom tree, waterfall (floating in the sky
     band, flanking the vortex). */
  island(195, 225, 108, 40, [[-56, 24, 62], [-8, 32, 88], [48, 22, 50]]);
  // Waterfall off the left island.
  g.strokeStyle = "rgba(180, 168, 235, 0.65)";
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const x = 142 + i * 9;
    g.beginPath();
    g.moveTo(x, 258);
    g.lineTo(x + (i % 2 === 0 ? 3 : -3), 316);
    g.stroke();
  }
  // Cherry blossom tree on the left island.
  px(238, 166, 6, 32, "#241631");
  const blossom = (x: number, y: number, r: number) => {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      px(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.55, 7, 6, i % 3 === 0 ? "#f08ab8" : "#e860a0");
    }
    px(x - 3, y - 3, 7, 7, "#f8b8d0");
  };
  blossom(232, 156, 20);
  blossom(254, 162, 14);

  /* Right island — twin towers + armillary sphere hint. */
  island(850, 215, 92, 36, [[-38, 20, 48], [28, 28, 72]]);
  g.strokeStyle = "rgba(232, 178, 58, 0.65)";
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(918, 152, 12, 5, 0.5, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(918, 152, 5, 12, 0.2, 0, Math.PI * 2);
  g.stroke();

  /* Courtyard floor — perspective stone slabs. */
  g.fillStyle = "#34284e";
  g.fillRect(0, 310, W, H - 310);
  // Horizon glow band.
  const floorGlow = g.createLinearGradient(0, 310, 0, 360);
  floorGlow.addColorStop(0, "rgba(122, 79, 168, 0.5)");
  floorGlow.addColorStop(1, "rgba(122, 79, 168, 0)");
  g.fillStyle = floorGlow;
  g.fillRect(0, 310, W, 50);
  g.strokeStyle = "#241636";
  g.lineWidth = 2;
  const vpx = 512;
  const vpy = 298;
  let y = 318;
  let step = 8;
  while (y < H) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    y += step;
    step = Math.min(64, step * 1.45);
  }
  for (let i = -10; i <= 10; i++) {
    const topX = vpx + i * 14;
    const botX = vpx + i * 150;
    g.beginPath();
    g.moveTo(topX, vpy);
    g.lineTo(botX, H);
    g.stroke();
  }
  // Cracks.
  g.strokeStyle = "#241734";
  for (let i = 0; i < 14; i++) {
    const sx = 60 + Math.random() * 904;
    const sy = 340 + Math.random() * 200;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + (Math.random() - 0.5) * 40, sy + Math.random() * 26);
    g.lineTo(sx + (Math.random() - 0.5) * 70, sy + 10 + Math.random() * 30);
    g.stroke();
  }
  // Grass tufts + flowers.
  for (let i = 0; i < 26; i++) {
    const sx = 40 + Math.random() * 944;
    const sy = 356 + Math.random() * 190;
    px(sx, sy, 2, 4, "#4f7a52");
    if (Math.random() > 0.55) px(sx - 1, sy - 2, 3, 2, "#e050a0");
  }
  // Gold inlay ellipse under the wizard.
  g.strokeStyle = "rgba(232, 178, 58, 0.38)";
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(512, 470, 252, 80, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.setLineDash([12, 9]);
  g.beginPath();
  g.ellipse(512, 470, 196, 60, 0, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  /* Foreground crystal clusters, both bottom corners. */
  const crystal = (x: number, y: number, w: number, h: number, skew: number) => {
    g.fillStyle = "#6a35a8";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w, y - skew);
    g.lineTo(x + w * 0.55, y - h);
    g.lineTo(x - w * 0.2, y - h * 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = "#b060e0";
    g.beginPath();
    g.moveTo(x + w * 0.3, y - skew * 0.4);
    g.lineTo(x + w * 0.72, y - skew);
    g.lineTo(x + w * 0.55, y - h);
    g.closePath();
    g.fill();
    px(x + w * 0.42, y - h * 0.72, 3, 6, "#e8b8ff");
  };
  g.fillStyle = "#0d0916";
  g.beginPath();
  g.ellipse(70, 596, 220, 120, 0, 0, Math.PI * 2);
  g.fill();
  crystal(40, 560, 56, 96, 14);
  crystal(120, 584, 42, 66, 10);
  crystal(190, 600, 64, 82, 16);
  g.fillStyle = "#0d0916";
  g.beginPath();
  g.ellipse(960, 596, 220, 120, 0, 0, Math.PI * 2);
  g.fill();
  crystal(1000, 566, 52, 92, -14);
  crystal(920, 588, 40, 62, -10);
  crystal(856, 602, 60, 78, -16);

  /* Lantern posts framing the sides. */
  const lantern = (x: number, flip: boolean) => {
    px(x, 320, 5, 170, "#1a1128");
    px(x - 8, 308, 21, 17, "#241736");
    px(x - 4, 312, 13, 10, "#ffb840");
    const grd = g.createRadialGradient(x + 3, 317, 2, x + 3, 317, 30);
    grd.addColorStop(0, "rgba(255, 184, 64, 0.35)");
    grd.addColorStop(1, "rgba(255, 184, 64, 0)");
    g.fillStyle = grd;
    g.fillRect(x - 30, 286, 66, 62);
    if (flip) {
      px(x - 14, 330, 32, 5, "#1a1128");
      px(x - 18, 358, 5, 24, "#1a1128");
    }
  };
  lantern(74, false);
  lantern(948, true);

  /* Blossom branch framing the top-left corner. */
  g.strokeStyle = "#241631";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(-6, 26);
  g.quadraticCurveTo(120, 44, 208, 14);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(96, 36);
  g.quadraticCurveTo(140, 66, 188, 60);
  g.stroke();
  blossom(64, 40, 16);
  blossom(150, 30, 18);
  blossom(196, 62, 12);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Fallback wizard: a blocky hooded mage with a glowing staff orb, 72x104. */
function createProceduralWizard(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 104;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable for procedural wizard");
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  // Robe.
  px(24, 40, 24, 52, "#3b2a5e");
  px(20, 62, 32, 30, "#33234f");
  px(24, 88, 6, 8, "#2a1d45");
  px(42, 88, 6, 8, "#2a1d45");
  px(26, 58, 20, 3, "#d4af37");
  // Hood + shadowed face.
  px(22, 22, 28, 20, "#4a3670");
  px(18, 34, 36, 10, "#4a3670");
  px(27, 30, 18, 12, "#120b1e");
  px(31, 34, 4, 3, "#ffd27a");
  px(41, 34, 4, 3, "#ffd27a");
  // Gold trim.
  px(22, 22, 28, 2, "#d4af37");
  // Staff (viewer's right) with glowing orb.
  px(56, 18, 4, 74, "#6b4a2a");
  px(54, 10, 8, 8, "#ffd27a");
  g.strokeStyle = "rgba(255, 210, 122, 0.8)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(58, 14, 8, 0, Math.PI * 2);
  g.stroke();
  // Arm to staff.
  px(46, 46, 12, 5, "#3b2a5e");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/* ------------------------------------------------------------------ */
/* MenuScene                                                           */
/* ------------------------------------------------------------------ */

interface ParticleSystem {
  points: THREE.Points;
  uniforms: { uTime: { value: number }; uDensity: { value: number }; uScale: { value: number } };
}

export class MenuScene implements SceneControls {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;

  private readonly skyUniforms: {
    uTime: { value: number };
    uFlash: { value: number };
    uZoom: { value: number };
    uAspect: { value: number };
    uCenter: { value: THREE.Vector2 };
  };
  private readonly ringUniforms: { uTime: { value: number } };
  private readonly ember: ParticleSystem;
  private readonly dust: ParticleSystem;

  private readonly wizard: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly staffLight: THREE.PointLight;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  private readonly midground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;

  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly onReady?: () => void;

  private pointer = { x: 0, y: 0 };
  private parallaxEnabled = true;
  private time = 0;
  private flash = 0;
  private nextFlash = 2.4;
  private wizardBaseY = -0.42;
  private readyFired = false;
  private transitioning = false;

  constructor(config: MenuSceneConfig) {
    this.onReady = config.onReady;

    /* Renderer — retro contract: no AA, capped pixel ratio. */
    this.renderer = new THREE.WebGLRenderer({
      canvas: config.canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x060310, 1);

    /* Camera — subtle pointer-driven parallax around a fixed vista. */
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    this.camera.position.copy(CAMERA_BASE);
    this.camera.lookAt(CAMERA_LOOK);

    /* Lights: ambient dusk, a violet rim from the portal, and the staff. */
    const ambient = new THREE.AmbientLight(0x5a4880, 1.5);
    const rim = new THREE.DirectionalLight(0x8a4fd0, 0.85);
    rim.position.set(0, 4, -8);
    this.staffLight = new THREE.PointLight(0xffc46a, 14, 9, 2);
    this.staffLight.position.set(0.46, 0.06, -1.25);
    this.scene.add(ambient, rim, this.staffLight);

    /* Layer 0 — sky & rift portal. */
    this.skyUniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uZoom: { value: 0 },
      uAspect: { value: 34 / 19.5 },
      uCenter: { value: new THREE.Vector2(0.5, 0.66) },
    };
    const skyGeo = new THREE.PlaneGeometry(34, 19.5);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.skyUniforms,
      depthWrite: true,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.set(0, 0.4, -9);
    sky.renderOrder = 0;
    this.scene.add(sky);
    this.disposables.push(skyGeo, skyMat);

    /* Layer 1 — midground vista (procedural fallback + loader hook). */
    const midGeo = new THREE.PlaneGeometry(26, 14.625);
    const midMat = new THREE.MeshLambertMaterial({
      map: createProceduralBackground(),
      transparent: true,
      depthWrite: false,
    });
    this.disposables.push(midGeo, midMat, midMat.map!);
    this.midground = new THREE.Mesh(midGeo, midMat);
    this.midground.position.set(0, 0, -2.6);
    this.midground.renderOrder = 1;
    this.scene.add(this.midground);
    void this.loadFirstAvailable(config.backgroundUrls ?? [], (tex) => {
      const img = tex.image as { width: number; height: number };
      const aspect = img.width / img.height;
      // Cover the 16:9 plane without distortion.
      this.midground.scale.set(
        Math.max(1, 16 / 9 / aspect),
        Math.max(1, aspect / (16 / 9)),
        1,
      );
      /* Painted art — unlike the pixel sprites, this wants linear sampling
         + mipmaps (the plane minifies on hi-dpi screens). The shared loader
         applies NearestFilter for sprites; re-derive here. */
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      const old = midMat.map;
      midMat.map = tex;
      midMat.needsUpdate = true;
      old?.dispose();
      this.disposables.push(tex);
    });

    /* Layer 2 — golden rune circle on the floor. */
    const ringGeo = new THREE.RingGeometry(0.95, 1.5, 72, 1);
    this.ringUniforms = { uTime: { value: 0 } };
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: this.ringUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.set(0, -0.92, -1.52);
    this.ring.rotation.x = -1.08;
    this.ring.renderOrder = 2;
    this.scene.add(this.ring);
    this.disposables.push(ringGeo, ringMat);

    /* Layer 3 — central wizard sprite with idle bob. Unit plane, scaled
       from the texture's aspect so both the fallback and loaded art keep
       their true proportions. */
    const WIZARD_HEIGHT = 1.75;
    const wizGeo = new THREE.PlaneGeometry(1, 1);
    const wizMat = new THREE.MeshBasicMaterial({
      map: createProceduralWizard(),
      transparent: true,
      depthWrite: false,
    });
    this.disposables.push(wizGeo, wizMat, wizMat.map!);
    const applyWizardAspect = (aspect: number): void => {
      this.wizard.scale.set(WIZARD_HEIGHT * aspect, WIZARD_HEIGHT, 1);
    };
    this.wizard = new THREE.Mesh(wizGeo, wizMat);
    applyWizardAspect(72 / 104);
    this.wizard.position.set(0, this.wizardBaseY, -1.35);
    this.wizard.renderOrder = 3;
    this.scene.add(this.wizard);
    void this.loadFirstAvailable(config.wizardUrls ?? [], (tex) => {
      const img = tex.image as { width: number; height: number };
      applyWizardAspect(img.width / img.height);
      const old = wizMat.map;
      wizMat.map = tex;
      wizMat.needsUpdate = true;
      old?.dispose();
      this.disposables.push(tex);
    });

    /* Layer 4 — foreground particle systems. */
    this.ember = this.buildParticles(300, new THREE.Color("#8b46f0"), new THREE.Color("#e2a9ff"), 16, 30, 0.055, 0.14);
    this.dust = this.buildParticles(180, new THREE.Color("#e8c56a"), new THREE.Color("#fff0b8"), 9, 16, 0.03, 0.08);
    this.scene.add(this.ember.points, this.dust.points);

    this.resize(config.width, config.height);
  }

  /* ---------------- public API ---------------- */

  resize(width: number, height: number): void {
    if (width < 2 || height < 2) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    const scale = (height * dpr) / 1080;
    this.ember.uniforms.uScale.value = scale;
    this.dust.uniforms.uScale.value = scale;
  }

  setPointer(nx: number, ny: number): void {
    this.pointer.x = nx;
    this.pointer.y = ny;
  }

  setParallax(enabled: boolean): void {
    this.parallaxEnabled = enabled;
    if (!enabled) {
      this.pointer.x = 0;
      this.pointer.y = 0;
    }
  }

  setParticleDensity(density: number): void {
    const d = Math.min(1, Math.max(0.05, density));
    this.ember.uniforms.uDensity.value = d;
    this.dust.uniforms.uDensity.value = d;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;

    this.skyUniforms.uTime.value = t;
    this.ringUniforms.uTime.value = t;
    this.ember.uniforms.uTime.value = t;
    this.dust.uniforms.uTime.value = t;

    /* Lightning scheduler — a decaying energy spike every few seconds. */
    if (t >= this.nextFlash) {
      this.flash = 0.7 + Math.random() * 0.3;
      this.nextFlash = t + 2.2 + Math.random() * 4.6;
    }
    this.flash *= Math.exp(-dt * 5.2);
    this.skyUniforms.uFlash.value = this.flash;

    /* Wizard idle bob + slow sway. */
    this.wizard.position.y = this.wizardBaseY + Math.sin(t * 1.5) * 0.045;
    this.wizard.rotation.z = Math.sin(t * 0.8) * 0.012;

    /* Staff light: warm pulse, sharpened by lightning. */
    this.staffLight.intensity = 13 + Math.sin(t * 2.3) * 4 + this.flash * 7;

    /* Rune circle slow rotation. */
    this.ring.rotation.z = t * 0.05;

    /* Camera: parallax lerp, skipped while the dolly owns the camera. */
    if (!this.transitioning) {
      const k = 1 - Math.exp(-dt * 3.2);
      const tx = this.parallaxEnabled ? this.pointer.x * 0.45 : 0;
      const ty = this.parallaxEnabled ? -this.pointer.y * 0.28 : 0;
      this.camera.position.x += (CAMERA_BASE.x + tx - this.camera.position.x) * k;
      this.camera.position.y += (CAMERA_BASE.y + ty - this.camera.position.y) * k;
      this.camera.position.z += (CAMERA_BASE.z - this.camera.position.z) * k;
      this.camera.lookAt(CAMERA_LOOK);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    if (!this.readyFired) {
      this.readyFired = true;
      this.onReady?.();
    }
  }

  /** Arc up and into the portal. Resolves when fully inside; onProgress is 0..1. */
  startRunTransition(durationMs = 1900, onProgress?: (t: number) => void): Promise<void> {
    this.transitioning = true;
    const start = performance.now();
    const look = new THREE.Vector3();
    return new Promise((resolve) => {
      const step = () => {
        const raw = Math.min(1, (performance.now() - start) / durationMs);
        const e = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        this.camera.position.lerpVectors(CAMERA_BASE, RUN_END, e);
        /* The gaze swings from the courtyard up to the portal eye, so the
           vortex swells to fill the frame instead of sliding below it. */
        look.lerpVectors(CAMERA_LOOK, PORTAL_FOCUS, e);
        this.camera.lookAt(look);
        this.skyUniforms.uZoom.value = e;
        this.staffLight.intensity = 13 + e * 30;
        onProgress?.(raw);
        if (raw < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  /** Snap back to the vista (call while the veil is opaque). */
  resetView(): void {
    this.camera.position.copy(CAMERA_BASE);
    this.camera.lookAt(CAMERA_LOOK);
    this.skyUniforms.uZoom.value = 0;
    this.transitioning = false;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* ---------------- internals ---------------- */

  private buildParticles(
    count: number,
    colorA: THREE.Color,
    colorB: THREE.Color,
    minSize: number,
    maxSize: number,
    minSpeed: number,
    maxSpeed: number,
  ): ParticleSystem {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 13;
      pos[i * 3 + 1] = -2.4;
      pos[i * 3 + 2] = -4 + Math.random() * 4.6;
      seeds[i] = Math.random();
      speeds[i] = minSpeed + Math.random() * (maxSpeed - minSpeed);
      sizes[i] = minSize + Math.random() * (maxSize - minSize);
      offsets[i] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));
    const uniforms = {
      uTime: { value: 0 },
      uDensity: { value: 1 },
      uScale: { value: 1 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 4;
    points.frustumCulled = false;
    this.disposables.push(geo, mat);
    return { points, uniforms };
  }

  /** Try each URL in order; hand the first success to `apply`. Failures fall
      through silently — the procedural texture is already on screen. */
  private loadFirstAvailable(urls: string[], apply: (tex: THREE.Texture) => void): void {
    if (urls.length === 0) return;
    const loader = new THREE.TextureLoader();
    const tryAt = (i: number): void => {
      if (i >= urls.length) return;
      loader.load(
        urls[i],
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
          apply(tex);
        },
        undefined,
        () => tryAt(i + 1),
      );
    };
    tryAt(0);
  }
}
