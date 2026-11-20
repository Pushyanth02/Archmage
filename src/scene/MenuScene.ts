/* ARCHMAGE: RIFTBOUND — MenuScene
   A layered 2.5D title-screen backdrop rendered with Three.js:

     Layer 0 (z = -9.0)  Rift tunnel — custom GLSL vortex with lightning
                          pulses, spiral arms and hyperspace streaks. It sits
                          hidden behind the painted backdrop and takes over
                          the frame during the SOLO RUN dive, as the painting
                          dissolves into the living rift.
     Layer 1 (z = -4.0)  Painted night vista — the V3.1 menu backdrop
                          (purple rift portal, floating islands, castle,
                          waterfalls, moon), cover-fitted to the frustum with
                          a slight overscan so pointer parallax and a slow
                          autonomous drift never reveal the edges. A
                          procedural fallback paints in if the texture fails.
     Layer 2 (z = -1.52) Golden rune circle — RingGeometry driven by a pulsing,
                          dash-tick shader, lying on the painted courtyard,
                          over a Lambert glow pool that catches the staff light.
     Layer 3 (z = -1.35) Stormcaller — the V3.1 animated sprite sheet
                          (idle-down row, 4 frames @ 6 fps, NearestFilter)
                          with a gentle bob and a warm-gold PointLight
                          pulsing from the staff orb.
     Layer 4             Foreground VFX — two GPU particle systems: purple
                          embers rising out of the painted portal and a wide
                          drift of golden arcane dust.

   Rendering contract: antialias off, pixelRatio capped, sprite textures on
   NearestFilter — crisp retro pixels; the painted backdrop alone uses linear
   sampling + mipmaps. The camera parallaxes subtly with the pointer and
   dives into the painted portal when a run starts. */

import * as THREE from "three";

export interface MenuSceneConfig {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Ordered candidate URLs for a painted midground — legacy fallbacks that
   *  sit behind the V3.1 backdrop. */
  backgroundUrls?: string[];
  /** Ordered candidate URLs for a single-frame wizard sprite — legacy
   *  fallback behind the V3.1 stormcaller sheet. */
  wizardUrls?: string[];
  /** Fired once after the first rendered frame — HUD reveal hook. */
  onReady?: () => void;
}

/** Adapter the UI settings modal drives (implemented by this scene). */
export interface SceneControls {
  setParallax(enabled: boolean): void;
  setParticleDensity(density: number): void;
}

/* ------------------------------------------------------------------ */
/* V3.1 asset wiring                                                   */
/* ------------------------------------------------------------------ */

/* The bootstrap (src/main.ts) still hands over the legacy candidate lists;
   the V3.1 painted backdrop + animated stormcaller sheet take priority and
   the legacy lists survive as graceful fallbacks. */
const BACKDROP_URL = "/assets/v31/menu-backdrop-clean.webp";
const MAGE_SHEET_URL = "/assets/v31/sprites/mage_stormcaller.png";

/* Sheet layout per /assets/v31/sprites/mage_stormcaller.json: 6 cols x 36
   rows of 64px frames; idle-down = row 0, cols 0-3 at 6 fps. */
const SHEET_COLS = 6;
const SHEET_ROWS = 36;
const IDLE_ROW = 0;
const IDLE_FRAMES = 4;
const IDLE_FPS = 6;

/* Landmarks of the painted composition, as UV fractions of the backdrop
   (grid-measured on menu-backdrop-clean.webp: portal rim spans u 0.35-0.65). */
const PORTAL_UV_X = 0.5;
const PORTAL_UV_Y = 0.4;

/* Sprite-space anchors inside one 64px stormcaller frame (idle-down row):
   the staff orb and the feet line, measured from the frame top. */
const STAFF_ORB_U = 49 / 64;
const STAFF_ORB_V = 30 / 64;
const FEET_V = 57 / 64;

/* Depth staging. */
const Z_SKY = -9;
const Z_BACKDROP = -4;
const Z_RING = -1.52;
const Z_MAGE = -1.35;

/* Screen anchors for the foreground stage (fractions of the viewport,
   0 = top edge). The compact variants engage when the stage is letterboxed
   very short (portrait phones) so the mage clears the HUD cluster.
   Ring staging is measured so the circle's near arc stays clear of the
   dock row (dock top ≈ 0.911 desktop / 0.854 compact): desktop ring spans
   screen y 0.69–0.86, compact 0.73–0.83. */
const RING_SCREEN_Y = 0.775;
const RING_SCREEN_Y_COMPACT = 0.77;
/** Ground-plane tilt: 8.6° shy of horizontal, so the ring reads as a
 *  perspective ellipse cut into the courtyard stone, never an upright hoop. */
const RING_TILT = -1.42;
const MAGE_FEET_SCREEN_Y = 0.828;
const MAGE_FEET_SCREEN_Y_COMPACT = 0.824;
/** The full 64px frame occupies this share of the viewport height; the
 *  character inside (49 of 64 px of body) reads at ~28%. */
const MAGE_PLANE_FRACTION = 0.36;
const MAGE_PLANE_FRACTION_COMPACT = 0.27;
/** Below this CSS-pixel stage height the portrait letterbox engages the
 *  compact courtyard staging. */
const COMPACT_STAGE_HEIGHT = 300;

/* The backdrop plane is drawn slightly larger than the frustum so pointer
   parallax and the slow drift never reveal the edges. */
const BACKDROP_OVERSCAN = 1.08;

const CAMERA_BASE = new THREE.Vector3(0, 1.15, 7.5);
const CAMERA_LOOK = new THREE.Vector3(0, 0.65, -1);

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
  uniform float uAspect;  // viewport width / height, keeps the vortex round
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
  uniform float uFade;    // 0..1, dissolves the ring during the dive

  void main() {
    float r = length(vLocal);
    float a = atan(vLocal.y, vLocal.x);

    /* Engraved channel: a dark annulus cut into the courtyard stone, so the
       ring holds up against the bright painted floor instead of washing out
       (the old additive pass dissolved into the plaza glow). A radial
       gradient inside the channel fakes a bevel. */
    float channel = smoothstep(0.93, 0.98, r) * (1.0 - smoothstep(1.42, 1.50, r));
    vec3 channelCol = mix(vec3(0.07, 0.04, 0.13), vec3(0.14, 0.08, 0.23),
                           smoothstep(0.96, 1.44, r));

    // Angular rune ticks: long dash, gap, short dash, gap — slowly orbiting.
    float seg = fract(a * 2.5465 + uTime * 0.06);
    float tick = (seg < 0.16 || (seg > 0.30 && seg < 0.36)) ? 1.0 : 0.22;

    float pulse = 0.65 + 0.35 * sin(uTime * 1.7 - r * 3.0);
    vec3 gold = mix(vec3(0.85, 0.62, 0.20), vec3(1.00, 0.88, 0.50), pulse);

    // Molten gold inlay, inset inside the channel.
    float band = smoothstep(0.99, 1.03, r) * (1.0 - smoothstep(1.36, 1.41, r));
    float goldA = band * tick * pulse;

    // Composite: gold inlay over the dark channel.
    vec3 col = mix(channelCol, gold * 1.18, goldA);
    float alpha = channel * 0.68;

    // Thin bright rim chasing the outer edge.
    float rim = smoothstep(1.435, 1.462, r) * (1.0 - smoothstep(1.478, 1.50, r));
    col = mix(col, vec3(1.0, 0.91, 0.58), rim * pulse);
    alpha = max(alpha, rim * 0.75);

    gl_FragColor = vec4(col, alpha * uFade);
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
  uniform float uRise;      // world units climbed over one life
  uniform float uLift;      // vertical offset at life = 0
  varying float vLife;
  varying float vSeed;

  void main() {
    vSeed = aSeed;
    float life = fract(aOffset + uTime * aSpeed);
    vLife = life;

    vec3 pos = position;
    pos.y += life * uRise + uLift;
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

/** Fallback mage: a blocky hooded spellcaster with a glowing staff orb. */
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

/** Soft elliptical contact shadow that anchors the mage to the courtyard
    (the sprite's own 4px drop shadow alone gets lost on the glow pool). */
function createContactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable for contact shadow");
  const grad = g.createRadialGradient(64, 32, 4, 64, 32, 60);
  grad.addColorStop(0, "rgba(5, 3, 10, 0.95)");
  grad.addColorStop(0.55, "rgba(5, 3, 10, 0.5)");
  grad.addColorStop(1, "rgba(5, 3, 10, 0)");
  g.save();
  g.translate(64, 32);
  g.scale(1, 0.5);
  g.translate(-64, -32);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial backlight that lifts the stormcaller's dark robe off the
    painted portal — additive violet-gold aura, tinted by the staff light's
    own palette so the silhouette always reads, even over the vortex core. */
function createMageBacklightTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable for mage backlight");
  const grad = g.createRadialGradient(64, 60, 6, 64, 64, 62);
  grad.addColorStop(0, "rgba(255, 214, 140, 0.5)");
  grad.addColorStop(0.42, "rgba(196, 128, 255, 0.3)");
  grad.addColorStop(0.72, "rgba(120, 68, 210, 0.14)");
  grad.addColorStop(1, "rgba(80, 40, 160, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* MenuScene                                                           */
/* ------------------------------------------------------------------ */

interface ParticleSystem {
  points: THREE.Points;
  uniforms: {
    uTime: { value: number };
    uDensity: { value: number };
    uScale: { value: number };
    uRise: { value: number };
    uLift: { value: number };
  };
}

/** Spawn volume of a particle system, expressed in its object space. */
interface ParticleSpawn {
  x: number;
  y0: number;
  y1: number;
  z: number;
  rise: number;
  lift: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
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
  private readonly ringUniforms: { uTime: { value: number }; uFade: { value: number } };
  private readonly ember: ParticleSystem;
  private readonly dust: ParticleSystem;

  private readonly backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  private readonly pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private readonly contactShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly mage: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** additive backlight plane riding the mage — lifts the robe silhouette
   *  off the painted portal (v3.1 cohesion polish). */
  private mageGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly staffLight: THREE.PointLight;

  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly onReady?: () => void;

  private pointer = { x: 0, y: 0 };
  private parallaxEnabled = true;
  private driftEnabled = true;
  private time = 0;
  private flash = 0;
  private nextFlash = 2.4;
  private readyFired = false;
  private transitioning = false;
  private staffGlow = 1;
  private compact = false;

  /* Layout state, recomputed by layout(). */
  private backdropAspect = 16 / 9;
  private readonly backdropBase = new THREE.Vector3();
  private readonly portalFocus = new THREE.Vector3(0, 1.7, Z_BACKDROP);
  private readonly runEnd = new THREE.Vector3(0, 1.55, 3.3);
  private mageCenterY = -0.6;
  private magePlaneH = 3.3;

  /* Stormcaller sheet state. */
  private mageSheet: THREE.Texture | null = null;
  private mageAspect = 1;
  private mageFrame = -1;
  private mageAnimTime = 0;

  constructor(config: MenuSceneConfig) {
    this.onReady = config.onReady;

    /* Reduced motion: no pointer parallax, no autonomous drift, sparse
       particles — the painting carries the scene on its own. */
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reducedMotion) {
      this.parallaxEnabled = false;
      this.driftEnabled = false;
    }

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

    /* Lights — they only feed the Lambert glow pool now: dusk ambient, a
       violet rim from the portal direction, and the warm staff orb. */
    const ambient = new THREE.AmbientLight(0x5a4880, 1.2);
    const rim = new THREE.DirectionalLight(0x8a4fd0, 0.85);
    rim.position.set(0, 4, -8);
    this.staffLight = new THREE.PointLight(0xffc46a, 14, 9, 2);
    this.scene.add(ambient, rim, this.staffLight);

    /* Layer 0 — rift tunnel sky (hidden behind the painting until dive). */
    this.skyUniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uZoom: { value: 0 },
      uAspect: { value: 16 / 9 },
      uCenter: { value: new THREE.Vector2(0.5, 0.6) },
    };
    const skyGeo = new THREE.PlaneGeometry(34, 19.5);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.skyUniforms,
      depthWrite: true,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.set(0, 0.4, Z_SKY);
    sky.renderOrder = 0;
    this.scene.add(sky);
    this.disposables.push(skyGeo, skyMat);

    /* Layer 1 — painted backdrop (procedural fallback + loader hook). */
    const bdGeo = new THREE.PlaneGeometry(1, 1);
    const bdMat = new THREE.MeshBasicMaterial({
      map: createProceduralBackground(),
      transparent: true,
      depthWrite: false,
    });
    this.disposables.push(bdGeo, bdMat, bdMat.map!);
    this.backdrop = new THREE.Mesh(bdGeo, bdMat);
    this.backdrop.renderOrder = 1;
    this.scene.add(this.backdrop);
    this.loadBackdrop([BACKDROP_URL, ...(config.backgroundUrls ?? [])]);

    /* Layer 2 — golden rune circle + glow pool on the painted courtyard.
       Normal blending: the shader cuts a dark engraved channel into the
       floor and lays molten gold ticks inside it, so the circle stays legible
       over the bright painted plaza. */
    const ringGeo = new THREE.RingGeometry(0.95, 1.5, 96, 1);
    this.ringUniforms = { uTime: { value: 0 }, uFade: { value: 1 } };
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: this.ringUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = RING_TILT;
    this.ring.renderOrder = 3;
    this.scene.add(this.ring);
    this.disposables.push(ringGeo, ringMat);

    const poolGeo = new THREE.PlaneGeometry(4.6, 2.6);
    const poolMat = new THREE.MeshLambertMaterial({
      color: 0x241436,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pool = new THREE.Mesh(poolGeo, poolMat);
    this.pool.rotation.x = RING_TILT;
    this.pool.renderOrder = 2;
    this.scene.add(this.pool);
    this.disposables.push(poolGeo, poolMat);

    /* Contact shadow — grounds the stormcaller on the courtyard. Wide
       enough to spill past the robe on both sides; the glow pool beneath
       is deliberately tighter than the shadow so the dark reads through. */
    const shadowGeo = new THREE.PlaneGeometry(3.2, 1.7);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.rotation.x = RING_TILT;
    this.contactShadow.renderOrder = 2.5;
    this.scene.add(this.contactShadow);
    this.disposables.push(shadowGeo, shadowMat, shadowMat.map!);

    /* Layer 3 — the stormcaller, idle-bobbing on the rune circle. Unit
       plane; the sheet frames are square (64x64) so the sheet maps 1:1,
       while legacy single-frame fallbacks keep their true aspect. */
    const mageGeo = new THREE.PlaneGeometry(1, 1);
    const mageMat = new THREE.MeshBasicMaterial({
      map: createProceduralWizard(),
      transparent: true,
      depthWrite: false,
    });
    this.disposables.push(mageGeo, mageMat, mageMat.map!);
    this.mage = new THREE.Mesh(mageGeo, mageMat);
    this.mage.renderOrder = 4;
    this.scene.add(this.mage);
    /* Backlight — a soft additive aura just behind the mage (renderOrder
       3.6, between the rune ring and the sprite). Sized from the mage plane
       each layout(); rides the idle bob so the aura breathes with it. */
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      map: createMageBacklightTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
    });
    this.mageGlow = new THREE.Mesh(glowGeo, glowMat);
    this.mageGlow.renderOrder = 3.6;
    this.scene.add(this.mageGlow);
    this.disposables.push(glowGeo, glowMat, glowMat.map!);
    this.loadMage(config.wizardUrls ?? []);

    /* Layer 4 — foreground particle systems: embers rise out of the
       painted portal, gold dust drifts across the courtyard. Counts and the
       resting density stay deliberately below max so the painting reads
       through the VFX. */
    this.ember = this.buildParticles(
      120, new THREE.Color("#8b46f0"), new THREE.Color("#e2a9ff"),
      9, 20, 0.05, 0.12,
      { x: 2.7, y0: 0.0, y1: 1.1, z: 0.9, rise: 3.2, lift: 0 },
    );
    this.dust = this.buildParticles(
      70, new THREE.Color("#e8c56a"), new THREE.Color("#fff0b8"),
      5, 11, 0.03, 0.07,
      { x: 6.5, y0: -1.6, y1: 0.4, z: 1.9, rise: 4.4, lift: -0.6 },
    );
    this.ember.points.renderOrder = 5;
    this.dust.points.renderOrder = 5;
    this.scene.add(this.ember.points, this.dust.points);

    /* Resting density — tuned down so the painted portal carries the frame. */
    if (reducedMotion) this.setParticleDensity(0.35);
    else this.setParticleDensity(0.75);

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
    this.compact = height < COMPACT_STAGE_HEIGHT;
    this.layout();
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

    /* Stormcaller idle stepping: 4 frames at 6 fps, forever. */
    if (this.mageSheet) {
      this.mageAnimTime += dt;
      const frame = Math.floor(this.mageAnimTime * IDLE_FPS) % IDLE_FRAMES;
      if (frame !== this.mageFrame) {
        this.mageFrame = frame;
        this.mageSheet.offset.set(frame / SHEET_COLS, 1 - (IDLE_ROW + 1) / SHEET_ROWS);
      }
    }

    if (!this.transitioning) {
      /* Idle bob + slow sway. */
      this.mage.position.y = this.mageCenterY + Math.sin(t * 1.5) * 0.035;
      this.mage.rotation.z = Math.sin(t * 0.8) * 0.012;
      /* backlight rides the mage: same bob, slight lag + swell so the aura
       * reads as the staff's light breathing rather than a static halo */
      this.mageGlow.position.set(this.mage.position.x, this.mage.position.y - 0.01, this.mage.position.z - 0.01);
      this.mageGlow.scale.setScalar(this.mage.scale.x * 1.55 + Math.sin(t * 1.5 + 0.6) * 0.04);
      this.mageGlow.material.opacity = 0.5 + Math.sin(t * 1.2) * 0.1;

      /* Staff light: warm pulse, sharpened by lightning. */
      this.staffLight.intensity = (13 + Math.sin(t * 2.3) * 4 + this.flash * 7) * this.staffGlow;

      /* Rune circle slow rotation. */
      this.ring.rotation.z = t * 0.05;

      /* Backdrop: slow autonomous drift inside the overscan margin. */
      this.backdrop.position.x = this.backdropBase.x + (this.driftEnabled ? Math.sin(t * 0.05) * 0.16 : 0);
      this.backdrop.position.y = this.backdropBase.y + (this.driftEnabled ? Math.cos(t * 0.04) * 0.09 : 0);

      /* Camera: parallax lerp, skipped while the dolly owns the camera. */
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

  /** Arc up and into the painted portal. Resolves when fully inside;
      onProgress is 0..1. As the camera commits, the painting and the
      courtyard stage dissolve and the shader rift takes the frame. */
  startRunTransition(durationMs = 1900, onProgress?: (t: number) => void): Promise<void> {
    this.transitioning = true;
    const start = performance.now();
    const look = new THREE.Vector3();
    return new Promise((resolve) => {
      const step = () => {
        const raw = Math.min(1, (performance.now() - start) / durationMs);
        const e = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        this.camera.position.lerpVectors(CAMERA_BASE, this.runEnd, e);
        /* The gaze swings from the courtyard up to the painted portal, so
           the rift swells to fill the frame instead of sliding below it. */
        look.lerpVectors(CAMERA_LOOK, this.portalFocus, e);
        this.camera.lookAt(look);
        this.skyUniforms.uZoom.value = e;
        this.setSwallow(e);
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
    this.setSwallow(0);
    this.transitioning = false;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* ---------------- internals ---------------- */

  /** The rift swallowing the stage: 0 = calm menu, 1 = fully inside. The
      mage dissolves a beat BEFORE the painting reveals the dive tunnel, so
      the vortex never draws over the character (V3.1 critique). */
  private setSwallow(v: number): void {
    this.backdrop.material.opacity = 1 - clamp01((v - 0.3) / 0.35);
    const stageOut = clamp01((v - 0.15) / 0.35);
    this.mage.material.opacity = 1 - stageOut;
    this.mageGlow.material.opacity = 0.62 * (1 - clamp01((v - 0.1) / 0.3));
    this.ringUniforms.uFade.value = 1 - stageOut;
    this.pool.material.opacity = 0.5 * (1 - clamp01((v - 0.2) / 0.3));
    this.contactShadow.material.opacity = 0.9 * (1 - clamp01((v - 0.2) / 0.3));
    this.staffGlow = 1 - clamp01((v - 0.25) / 0.35);
  }

  /** Screen fraction (0..1, y down) to world point on plane z = zPlane. */
  private screenToWorld(fx: number, fy: number, zPlane: number): THREE.Vector3 {
    const ndc = new THREE.Vector3(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = (zPlane - this.camera.position.z) / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(t));
  }

  /** Axis-aligned frustum rectangle on plane z = zPlane. */
  private frustumAt(zPlane: number): { cx: number; cy: number; w: number; h: number } {
    const tl = this.screenToWorld(0, 0, zPlane);
    const br = this.screenToWorld(1, 1, zPlane);
    return { cx: (tl.x + br.x) / 2, cy: (tl.y + br.y) / 2, w: br.x - tl.x, h: tl.y - br.y };
  }

  /** Re-derive every painting-anchored position: the backdrop cover-fit,
      the painted portal (dive target + ember hearth + vortex eye), and the
      screen-anchored courtyard stage (ring, pool, mage, staff light). */
  private layout(): void {
    this.camera.updateMatrixWorld();

    /* Backdrop: cover the frustum at its depth, undistorted, overscanned. */
    const view = this.frustumAt(Z_BACKDROP);
    const viewAspect = view.w / view.h;
    const coverX = Math.max(1, viewAspect / this.backdropAspect);
    const coverY = Math.max(1, this.backdropAspect / viewAspect);
    const pw = view.w * coverX * BACKDROP_OVERSCAN;
    const ph = view.h * coverY * BACKDROP_OVERSCAN;
    this.backdrop.scale.set(pw, ph, 1);
    this.backdrop.position.set(view.cx, view.cy, Z_BACKDROP);
    this.backdropBase.copy(this.backdrop.position);

    /* The painted portal, in world space. */
    this.portalFocus.set(
      view.cx + (PORTAL_UV_X - 0.5) * pw,
      view.cy + (0.5 - PORTAL_UV_Y) * ph,
      Z_BACKDROP,
    );

    /* Sky vortex eye: project the painted portal onto the sky plane so the
       dive tunnel opens exactly where the painting painted it. */
    const ndc = this.portalFocus.clone().project(this.camera);
    const eye = this.screenToWorld((ndc.x + 1) / 2, (1 - ndc.y) / 2, Z_SKY);
    this.skyUniforms.uCenter.value.set(0.5 + eye.x / 34, 0.5 + (eye.y - 0.4) / 19.5);
    this.skyUniforms.uAspect.value = this.camera.aspect;

    /* Courtyard stage — ring + glow pool on the painted circle. */
    const ringAt = this.screenToWorld(0.5, this.compact ? RING_SCREEN_Y_COMPACT : RING_SCREEN_Y, Z_RING);
    this.ring.position.set(ringAt.x, ringAt.y, Z_RING);
    this.pool.position.set(ringAt.x, ringAt.y + 0.05, Z_RING + 0.06);
    this.ring.scale.setScalar(this.compact ? 0.68 : 0.95);
    this.pool.scale.setScalar(this.compact ? 0.5 : 0.62);

    /* Contact shadow under the mage's feet, on the same ground plane —
       wide enough to spill past the robe and sell the footing. */
    const feetY = this.compact ? MAGE_FEET_SCREEN_Y_COMPACT : MAGE_FEET_SCREEN_Y;
    const shadowAt = this.screenToWorld(0.5, feetY + 0.008, Z_RING + 0.05);
    this.contactShadow.position.set(shadowAt.x, shadowAt.y, Z_RING + 0.05);
    this.contactShadow.scale.setScalar(this.compact ? 0.78 : 1);

    /* Stormcaller — feet planted on the courtyard, sized to the viewport. */
    const mageView = this.frustumAt(Z_MAGE);
    this.magePlaneH = mageView.h * (this.compact ? MAGE_PLANE_FRACTION_COMPACT : MAGE_PLANE_FRACTION);
    const feet = this.screenToWorld(0.5, feetY, Z_MAGE);
    this.mageCenterY = feet.y + (FEET_V - 0.5) * this.magePlaneH;
    this.applyMageTransform();

    /* Staff orb — the PointLight rides the sprite's staff. */
    const w = this.magePlaneH * this.mageAspect;
    this.staffLight.position.set(
      (STAFF_ORB_U - 0.5) * w,
      this.mageCenterY + (0.5 - STAFF_ORB_V) * this.magePlaneH,
      Z_MAGE + 0.05,
    );

    /* Embers rise out of the painted portal. */
    this.ember.points.position.set(
      this.portalFocus.x,
      this.portalFocus.y - 0.85,
      Z_BACKDROP + 0.15,
    );

    /* The dive ends short of the portal, on its axis. */
    this.runEnd.set(this.portalFocus.x * 0.35, Math.max(1.2, this.portalFocus.y - 0.15), 3.3);
  }

  private applyMageTransform(): void {
    const h = this.magePlaneH;
    this.mage.scale.set(h * this.mageAspect, h, 1);
    this.mage.position.set(0, this.mageCenterY, Z_MAGE);
  }

  private loadBackdrop(urls: string[]): void {
    this.loadFirstAvailable(urls, (tex) => {
      const img = tex.image as { width: number; height: number };
      this.backdropAspect = img.width / img.height;
      /* Painted art — unlike the pixel sprites, this wants linear sampling
         + mipmaps (the plane minifies on hi-dpi screens). The shared loader
         applies NearestFilter for sprites; re-derive here. */
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      const old = this.backdrop.material.map;
      this.backdrop.material.map = tex;
      this.backdrop.material.needsUpdate = true;
      old?.dispose();
      this.disposables.push(tex);
      this.layout();
    });
  }

  private loadMage(fallbackUrls: string[]): void {
    const loader = new THREE.TextureLoader();
    loader.load(
      MAGE_SHEET_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.repeat.set(1 / SHEET_COLS, 1 / SHEET_ROWS);
        tex.offset.set(0, 1 - (IDLE_ROW + 1) / SHEET_ROWS);
        this.mageSheet = tex;
        this.mageAspect = 1; // 64x64 frames
        this.mageFrame = -1;
        this.swapMageMap(tex);
        this.layout();
      },
      undefined,
      () => {
        /* Sheet unavailable — fall back to the legacy single-frame art. */
        this.loadFirstAvailable(fallbackUrls, (tex) => {
          const img = tex.image as { width: number; height: number };
          this.mageAspect = img.width / img.height;
          this.swapMageMap(tex);
          this.layout();
        });
      },
    );
  }

  private swapMageMap(tex: THREE.Texture): void {
    const old = this.mage.material.map;
    this.mage.material.map = tex;
    this.mage.material.needsUpdate = true;
    old?.dispose();
    this.disposables.push(tex);
  }

  private buildParticles(
    count: number,
    colorA: THREE.Color,
    colorB: THREE.Color,
    minSize: number,
    maxSize: number,
    minSpeed: number,
    maxSpeed: number,
    spawn: ParticleSpawn,
  ): ParticleSystem {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2 * spawn.x;
      pos[i * 3 + 1] = spawn.y0 + Math.random() * (spawn.y1 - spawn.y0);
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * spawn.z;
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
      uRise: { value: spawn.rise },
      uLift: { value: spawn.lift },
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
