import * as THREE from "three";
import { assetPath } from "../lib/asset-path";

/* ARCHMAGE: RIFTBOUND — v3.0 Pixel Reforged sprite system.
   Every combatant is now a chibi pixel sprite (concept sheets p1–p3):
   canvas-drawn creature atlases with nearest-neighbor filtering, animated by
   frame-stepping, and billboarded into the 3D arena. The GLTF bestiary is
   retired — this file is the whole visual bestiary.

   Frame layout per sheet (single row):
   0 idleA · 1 idleB · 2 walkA · 3 walkB · 4 atkA · 5 atkB · 6 hurt · 7 deadA · 8 deadB · 9 deadC
   The player sheet (cropped from the reference board) uses its own layout. */

export type SpriteState = "idle" | "walk" | "attack" | "hurt" | "death";
export const STATE_FRAMES: Record<SpriteState, [number, number]> = {
  idle: [0, 2],
  walk: [2, 2],
  attack: [4, 2],
  hurt: [6, 1],
  death: [7, 3]
};
const FRAME_COUNT = 10;

export interface SpriteSheet {
  texture: THREE.Texture;
  frames: number;
  /** world-space size of one frame (the mesh is scaled to this) */
  worldW: number;
  worldH: number;
  /** frame duration in seconds for loop states */
  fps: number;
}

/* ------------------------------------------------------------------ */
/*  pixel painter's DSL                                                */
/* ------------------------------------------------------------------ */
type Ctx = CanvasRenderingContext2D;
const R = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};
/** outline a filled region by drawing it 1px bigger in the outline color
 *  first — the cheap pixel-art selective outline. */
const OR = (ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, outline = "#140d20") => {
  R(ctx, x - 1, y - 1, w + 2, h + 2, outline);
  R(ctx, x, y, w, h, fill);
};
/** diamond sparkle */
const SPARK = (ctx: Ctx, x: number, y: number, c: string, s = 3) => {
  for (let i = 0; i < s; i++) {
    const wdt = s * 2 - 1 - i * 2;
    R(ctx, x - wdt / 2, y + i, wdt, 1, c);
  }
};

type Pose = "idle" | "walkA" | "walkB" | "atk" | "hurt" | "deadA" | "deadB";

/* ------------------------------------------------------------------ */
/*  creature painters — one per kind, chibi style (big head, tiny feet) */
/*  canvas FW×FH per frame, feet at the bottom edge, facing RIGHT.      */
/* ------------------------------------------------------------------ */

interface Painter {
  fw: number;
  fh: number;
  draw: (ctx: Ctx, ox: number, oy: number, pose: Pose, t: { skin: string; dark: string; glow: string }) => void;
}

/* --- Skeleton Warrior (knight) — bone + rusty armor + curved blade --- */
const PAINT_KNIGHT: Painter = {
  fw: 36, fh: 44,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -1 : pose === "walkB" ? 1 : 0;
    if (pose === "deadB") { // flat bone pile
      R(ctx, ox + 4, oy + 36, 26, 4, "#8a8074"); R(ctx, ox + 8, oy + 34, 16, 3, "#e8e4d8");
      R(ctx, ox + 20, oy + 32, 6, 5, t.skin); R(ctx, ox + 2, oy + 35, 8, 2, "#8a5a3a"); return;
    }
    if (dead) { ctx.translate(ox + 14, oy + 30); ctx.rotate(-1.2); ctx.translate(-ox - 14, -oy - 30); }
    const y = oy + bob + (dead ? 4 : 0);
    // legs
    if (pose === "walkA") { OR(ctx, ox + 12, y + 32, 4, 8, t.skin); OR(ctx, ox + 20, y + 34, 4, 6, t.skin); }
    else if (pose === "walkB") { OR(ctx, ox + 12, y + 34, 4, 6, t.skin); OR(ctx, ox + 20, y + 32, 4, 8, t.skin); }
    else { OR(ctx, ox + 12, y + 32, 4, 8, t.skin); OR(ctx, ox + 20, y + 32, 4, 8, t.skin); }
    // ribcage torso + rusty chest plate
    OR(ctx, ox + 10, y + 20, 16, 13, t.skin);
    R(ctx, ox + 11, y + 21, 14, 6, t.dark);
    for (let i = 0; i < 3; i++) R(ctx, ox + 12, y + 22 + i * 2, 12, 1, "#c8c2b2");
    R(ctx, ox + 10, y + 20, 16, 3, "#8a5a3a"); R(ctx, ox + 10, y + 20, 3, 13, "#8a5a3a");
    // shield arm (left) — small round shield
    OR(ctx, ox + 5, y + 22, 7, 9, "#7040a0");
    R(ctx, ox + 6, y + 23, 5, 7, "#8a5ab8"); R(ctx, ox + 7, y + 25, 3, 3, "#e8b830");
    // weapon arm (right)
    if (pose === "atk") { // blade swung forward
      OR(ctx, ox + 26, y + 18, 4, 5, t.skin);
      OR(ctx, ox + 28, y + 10, 4, 16, "#c8ccd8");
      R(ctx, ox + 30, y + 4, 2, 8, "#eef2f8"); // slash glint
    } else {
      OR(ctx, ox + 26, y + 22, 4, 6, t.skin);
      OR(ctx, ox + 27, y + 8, 3, 14, "#c8ccd8");
    }
    // skull head
    OR(ctx, ox + 11, y + 6, 14, 13, t.skin);
    R(ctx, ox + 14, y + 10, 3, 3, "#1a1424"); R(ctx, ox + 20, y + 10, 3, 3, "#1a1424"); // eyes
    R(ctx, ox + 15, y + 11, 1, 1, t.glow); R(ctx, ox + 21, y + 11, 1, 1, t.glow);
    R(ctx, ox + 16, y + 15, 4, 2, "#1a1424"); // jaw
    R(ctx, ox + 12, y + 5, 12, 2, "#8a5a3a"); // rusty helm band
    if (pose === "hurt") { SPARK(ctx, ox + 26, y + 8, "#ffd97a"); R(ctx, ox + 8, y + 12, 3, 1, "#ff5a7a"); }
  }
};

/* --- Cultist Mage (caster) — crimson hooded robe + magenta orb --- */
const PAINT_CASTER: Painter = {
  fw: 36, fh: 44,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -1 : pose === "walkB" ? 1 : 0;
    if (pose === "deadB") { R(ctx, ox + 6, oy + 36, 24, 5, t.dark); R(ctx, ox + 10, oy + 34, 14, 3, t.skin); return; }
    if (dead) { ctx.translate(ox + 16, oy + 32); ctx.rotate(1.3); ctx.translate(-ox - 16, -oy - 32); }
    const y = oy + bob;
    // robe (trapezoid via rows)
    for (let i = 0; i < 16; i++) R(ctx, ox + 13 - Math.floor(i * 0.35), y + 18 + i, 10 + Math.floor(i * 0.7), 1, i < 4 ? t.skin : t.dark);
    R(ctx, ox + 12, y + 18, 12, 16, t.skin);
    R(ctx, ox + 14, y + 26, 8, 8, t.dark);
    // hood + shadowed face
    OR(ctx, ox + 10, y + 6, 16, 14, t.skin);
    R(ctx, ox + 13, y + 10, 10, 7, "#160810");
    R(ctx, ox + 15, y + 12, 2, 2, t.glow); R(ctx, ox + 20, y + 12, 2, 2, t.glow); // glowing eyes
    R(ctx, ox + 9, y + 4, 18, 3, t.dark); // hood peak
    // staff + orb arm (right)
    const staffX = pose === "atk" ? ox + 27 : ox + 25;
    OR(ctx, staffX, y + 6, 3, 30, "#7a5a30");
    const orbY = pose === "atk" ? y + 2 : y + 5;
    OR(ctx, staffX - 2, orbY, 7, 7, t.glow);
    R(ctx, staffX, orbY + 2, 3, 3, "#ffe9f8");
    if (pose === "atk") { SPARK(ctx, staffX + 8, y + 4, t.glow, 4); SPARK(ctx, staffX - 5, y + 8, t.glow, 3); }
    if (pose === "hurt") { R(ctx, ox + 8, y + 12, 3, 1, "#ff5a7a"); SPARK(ctx, ox + 24, y + 6, "#ffd97a"); }
  }
};

/* --- Goblin Raider (brute) — green skin, yellow tunic, dagger --- */
const PAINT_BRUTE: Painter = {
  fw: 36, fh: 44,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -1 : pose === "walkB" ? 1 : 0;
    if (pose === "deadB") { R(ctx, ox + 6, oy + 36, 22, 4, t.dark); OR(ctx, ox + 18, oy + 32, 8, 6, t.skin); return; }
    if (dead) { ctx.translate(ox + 16, oy + 30); ctx.rotate(1.1); ctx.translate(-ox - 16, -oy - 30); }
    const y = oy + bob + 2;
    // legs
    if (pose === "walkA") { OR(ctx, ox + 12, y + 32, 4, 8, t.dark); OR(ctx, ox + 19, y + 34, 4, 6, t.dark); }
    else if (pose === "walkB") { OR(ctx, ox + 12, y + 34, 4, 6, t.dark); OR(ctx, ox + 19, y + 32, 4, 8, t.dark); }
    else { OR(ctx, ox + 12, y + 32, 4, 8, t.dark); OR(ctx, ox + 19, y + 32, 4, 8, t.dark); }
    // tunic torso
    OR(ctx, ox + 9, y + 19, 17, 14, t.skin);
    R(ctx, ox + 9, y + 19, 17, 4, "#e0c858");
    R(ctx, ox + 14, y + 24, 7, 6, t.dark);
    // arms + dagger (right)
    OR(ctx, ox + 25, y + 21, 5, 8, t.skin);
    if (pose === "atk") { OR(ctx, ox + 28, y + 12, 3, 12, "#b8bcc8"); SPARK(ctx, ox + 32, y + 10, "#fff", 4); }
    else OR(ctx, ox + 27, y + 14, 3, 10, "#b8bcc8");
    // head — big ears
    OR(ctx, ox + 10, y + 4, 16, 14, t.skin);
    OR(ctx, ox + 5, y + 8, 5, 6, t.skin); OR(ctx, ox + 26, y + 8, 5, 6, t.skin); // ears
    R(ctx, ox + 14, y + 9, 3, 3, "#1a1424"); R(ctx, ox + 20, y + 9, 3, 3, "#1a1424");
    R(ctx, ox + 16, y + 14, 5, 2, "#2a3a18"); // grin
    R(ctx, ox + 17, y + 14, 1, 2, "#e8e4d8"); // tooth
    if (pose === "hurt") { SPARK(ctx, ox + 26, y + 6, "#ffd97a"); R(ctx, ox + 8, y + 10, 3, 1, "#ff5a7a"); }
  }
};

/* --- Wraith — cyan spectral shroud, trailing tail --- */
const PAINT_WRAITH: Painter = {
  fw: 36, fh: 44,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -2 : pose === "walkB" ? 2 : 0;
    if (pose === "deadB") { R(ctx, ox + 10, oy + 38, 16, 3, t.dark); SPARK(ctx, ox + 18, oy + 34, t.glow); return; }
    if (dead) { ctx.translate(ox + 16, oy + 24); ctx.rotate(0.9); ctx.translate(-ox - 16, -oy - 24); }
    const y = oy + bob;
    // spectral tail (tattered)
    for (let i = 0; i < 12; i++) {
      const wdt = 16 - i;
      const sway = Math.sin(i * 1.2) * 2;
      R(ctx, ox + 18 - wdt / 2 + sway, y + 22 + i, wdt, 1, i > 8 ? t.dark : t.skin);
    }
    // shroud body
    OR(ctx, ox + 10, y + 12, 16, 12, t.skin);
    R(ctx, ox + 12, y + 14, 12, 8, t.dark);
    // hood + glowing eyes
    OR(ctx, ox + 11, y + 4, 14, 10, t.skin);
    R(ctx, ox + 14, y + 7, 3, 3, t.glow); R(ctx, ox + 20, y + 7, 3, 3, t.glow);
    // wispy claws (right)
    if (pose === "atk") { OR(ctx, ox + 26, y + 12, 6, 4, t.skin); SPARK(ctx, ox + 32, y + 10, t.glow, 4); }
    else R(ctx, ox + 25, y + 14, 5, 3, t.skin);
    if (pose === "hurt") SPARK(ctx, ox + 24, y + 4, "#ffffff");
  }
};

/* --- Rift Ooze (orb/swarmlet) — magenta blob with eyes --- */
function paintOoze(scale: number): Painter {
  return {
    fw: Math.round(30 * scale), fh: Math.round(30 * scale),
    draw(ctx, ox, oy, pose, t) {
      const s = scale;
      const dead = pose === "deadA" || pose === "deadB";
      const squish = pose === "walkA" ? 2 : pose === "walkB" ? -2 : 0;
      if (pose === "deadB") { R(ctx, ox + 3 * s, oy + 24 * s, 24 * s, 4 * s, t.dark); return; }
      if (dead) { ctx.translate(ox + 15 * s, oy + 20 * s); ctx.scale(1.15, 0.6); ctx.translate(-ox - 15 * s, -oy - 20 * s); }
      const y = oy + squish * 0.5;
      // blob body — dome
      for (let i = 0; i < 18 * s; i++) {
        const rr = (18 * s - i) / (18 * s);
        const wdt = Math.round(26 * s * Math.sqrt(Math.max(0, 1 - Math.pow(1 - i / (18 * s), 2))));
        R(ctx, ox + 15 * s - wdt / 2, y + (26 * s - i), wdt, 1, i > 14 * s ? t.dark : t.skin);
      }
      // shine
      R(ctx, ox + 9 * s, y + 10 * s, 4 * s, 2 * s, "#e8a8f0");
      // eyes
      R(ctx, ox + 10 * s, y + 14 * s, 3 * s, 3 * s, "#16081e"); R(ctx, ox + 17 * s, y + 14 * s, 3 * s, 3 * s, "#16081e");
      R(ctx, ox + 11 * s, y + 15 * s, 1, 1, "#ffe9ad"); R(ctx, ox + 18 * s, y + 15 * s, 1, 1, "#ffe9ad");
      if (pose === "atk") { // spiky burst
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          R(ctx, ox + 15 * s + Math.cos(a) * 15 * s, y + 18 * s + Math.sin(a) * 12 * s, 2 * s, 2 * s, t.glow);
        }
      }
      if (pose === "hurt") SPARK(ctx, ox + 22 * s, y + 6 * s, "#ffffff");
    }
  };
}

/* --- Rift Imp — magenta-red imp, horns + bat wings + tail --- */
const PAINT_IMP: Painter = {
  fw: 34, fh: 40,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -1 : pose === "walkB" ? 1 : 0;
    if (pose === "deadB") { R(ctx, ox + 6, oy + 34, 20, 4, t.dark); OR(ctx, ox + 16, oy + 30, 8, 6, t.skin); return; }
    if (dead) { ctx.translate(ox + 15, oy + 28); ctx.rotate(1.2); ctx.translate(-ox - 15, -oy - 28); }
    const y = oy + bob + 2;
    // wings (behind)
    const wingUp = pose === "atk" ? -4 : 0;
    for (const wx of [ox + 2, ox + 24]) {
      R(ctx, wx, y + 12 + wingUp, 8, 3, t.dark);
      R(ctx, wx + (wx < ox + 10 ? -1 : 3), y + 15 + wingUp, 6, 3, t.dark);
      R(ctx, wx + (wx < ox + 10 ? -1 : 3), y + 18 + wingUp, 4, 2, t.dark);
    }
    // tail
    R(ctx, ox + 8, y + 24, 2, 6, t.dark); R(ctx, ox + 6, y + 29, 3, 3, t.skin);
    // legs
    R(ctx, ox + 12, y + 30, 4, 6, t.dark); R(ctx, ox + 18, y + 30, 4, 6, t.dark);
    // body
    OR(ctx, ox + 10, y + 18, 14, 13, t.skin);
    R(ctx, ox + 12, y + 22, 10, 6, t.dark);
    // arms
    if (pose === "atk") { OR(ctx, ox + 23, y + 14, 5, 5, t.skin); OR(ctx, ox + 26, y + 6, 6, 6, t.glow); R(ctx, ox + 28, y + 8, 2, 2, "#fff"); }
    else OR(ctx, ox + 23, y + 20, 5, 7, t.skin);
    // head + horns + ears
    OR(ctx, ox + 11, y + 4, 13, 13, t.skin);
    R(ctx, ox + 12, y + 2, 3, 3, "#e8e4d8"); R(ctx, ox + 20, y + 2, 3, 3, "#e8e4d8"); // horns
    R(ctx, ox + 9, y + 8, 3, 2, t.skin); R(ctx, ox + 23, y + 8, 3, 2, t.skin); // ears
    R(ctx, ox + 14, y + 9, 3, 3, "#ffd24a"); R(ctx, ox + 19, y + 9, 3, 3, "#ffd24a"); // eyes
    R(ctx, ox + 16, y + 14, 4, 2, "#3a0a14"); // grin
    if (pose === "hurt") SPARK(ctx, ox + 24, y + 2, "#ffffff");
  }
};

/* --- Thorn Mender (plant) — purple bulb on a stalk --- */
const PAINT_PLANT: Painter = {
  fw: 32, fh: 42,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const sway = pose === "idle" ? 0 : pose === "walkA" ? -2 : pose === "walkB" ? 2 : 0;
    if (pose === "deadB") { R(ctx, ox + 8, oy + 36, 16, 4, "#2e4a28"); R(ctx, ox + 12, oy + 33, 8, 3, t.dark); return; }
    if (dead) { ctx.translate(ox + 16, oy + 30); ctx.rotate(1.3); ctx.translate(-ox - 16, -oy - 30); }
    const y = oy;
    // stalk
    for (let i = 0; i < 16; i++) R(ctx, ox + 15 + Math.round(Math.sin(i * 0.3 + sway) * 1.5), y + 22 + i, 3, 1, i > 10 ? "#245030" : "#2e5e3e");
    // leaves
    R(ctx, ox + 8, y + 30, 7, 3, "#3a7a4a"); R(ctx, ox + 18, y + 33, 7, 3, "#3a7a4a");
    // bulb head
    OR(ctx, ox + 10, y + 8, 13, 15, t.skin);
    R(ctx, ox + 12, y + 12, 9, 7, t.dark);
    // teeth maw
    R(ctx, ox + 13, y + 14, 7, 4, "#16081e");
    for (let i = 0; i < 3; i++) R(ctx, ox + 13 + i * 3, y + 14, 1, 2, "#e8e4d8");
    // glowing spots
    R(ctx, ox + 12, y + 10, 2, 2, t.glow); R(ctx, ox + 19, y + 10, 2, 2, t.glow);
    if (pose === "atk") { // spit arc
      R(ctx, ox + 24, y + 10, 4, 3, t.glow); R(ctx, ox + 27, y + 6, 3, 3, t.glow);
    }
    if (pose === "hurt") SPARK(ctx, ox + 22, y + 6, "#ffffff");
  }
};

/* --- Bat (flyer variant of swarmlet) --- */
const PAINT_BAT: Painter = {
  fw: 32, fh: 26,
  draw(ctx, ox, oy, pose, t) {
    const flap = pose === "walkA" || pose === "idle" ? -3 : pose === "walkB" ? 2 : 0;
    if (pose === "deadB") { R(ctx, ox + 10, oy + 21, 12, 3, t.dark); return; }
    const y = oy + 2;
    // wings
    for (const s of [-1, 1]) {
      const wx = ox + 16 + s * 5;
      R(ctx, wx, y + 6 + flap, 6, 3, t.dark); R(ctx, wx + s * 4, y + 8 + flap, 5, 3, t.dark); R(ctx, wx + s * 7, y + 11 + flap, 4, 2, t.dark);
    }
    // body
    OR(ctx, ox + 12, y + 5, 9, 10, t.skin);
    R(ctx, ox + 14, y + 8, 2, 2, "#ff5a7a"); R(ctx, ox + 18, y + 8, 2, 2, "#ff5a7a");
    R(ctx, ox + 14, y + 12, 5, 1, "#16081e");
    R(ctx, ox + 13, y + 3, 2, 2, t.skin); R(ctx, ox + 18, y + 3, 2, 2, t.skin); // ears
    if (pose === "hurt") SPARK(ctx, ox + 22, y + 2, "#ffffff");
  }
};

/* ------------------------------------------------------------------ */
/*  boss painters — bigger canvases, same chibi language               */
/* ------------------------------------------------------------------ */

/* --- Bone Regent — skeletal lich: gold crown, robe, crystal staff --- */
const PAINT_REGENT: Painter = {
  fw: 60, fh: 72,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -2 : pose === "walkB" ? 2 : 0;
    if (pose === "deadB") {
      R(ctx, ox + 8, oy + 62, 44, 6, t.dark); R(ctx, ox + 16, oy + 58, 24, 4, t.skin);
      R(ctx, ox + 40, oy + 54, 10, 8, "#e8b830"); return;
    }
    if (dead) { ctx.translate(ox + 28, oy + 52); ctx.rotate(-1.1); ctx.translate(-ox - 28, -oy - 52); }
    const y = oy + bob;
    // robe sweep
    for (let i = 0; i < 26; i++) {
      const wdt = 26 + Math.floor(i * 0.8);
      R(ctx, ox + 30 - wdt / 2, y + 30 + i, wdt, 1, i > 18 ? t.dark : t.skin);
    }
    R(ctx, ox + 16, y + 30, 28, 20, t.skin);
    R(ctx, ox + 22, y + 36, 16, 14, t.dark);
    // pauldrons
    OR(ctx, ox + 10, y + 26, 9, 7, "#8a5a3a"); OR(ctx, ox + 41, y + 26, 9, 7, "#8a5a3a");
    // staff (right) + magenta crystal
    OR(ctx, ox + 48, y + 8, 4, 50, "#5a4028");
    OR(ctx, ox + 45, y + 2, 10, 10, t.glow);
    R(ctx, ox + 48, y + 5, 4, 4, "#ffe9f8");
    if (pose === "atk") { SPARK(ctx, ox + 58, y + 2, t.glow, 6); SPARK(ctx, ox + 40, y + 6, t.glow, 4); }
    // skull head
    OR(ctx, ox + 20, y + 8, 20, 18, "#e8e0d0");
    R(ctx, ox + 25, y + 14, 4, 4, "#1a1424"); R(ctx, ox + 33, y + 14, 4, 4, "#1a1424");
    R(ctx, ox + 26, y + 15, 2, 2, t.glow); R(ctx, ox + 34, y + 15, 2, 2, t.glow);
    R(ctx, ox + 27, y + 21, 7, 3, "#1a1424");
    // gold crown
    R(ctx, ox + 19, y + 2, 22, 6, "#e8b830");
    for (let i = 0; i < 4; i++) R(ctx, ox + 20 + i * 6, y - 2, 3, 5, "#e8b830");
    R(ctx, ox + 28, y + 3, 4, 3, "#c040e0");
    if (pose === "hurt") { SPARK(ctx, ox + 44, y + 4, "#ffffff", 5); }
  }
};

/* --- Rift Colossus — rock golem with purple crystal growths --- */
const PAINT_COLOSSUS: Painter = {
  fw: 60, fh: 72,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -2 : pose === "walkB" ? 2 : 0;
    if (pose === "deadB") { R(ctx, ox + 6, oy + 60, 48, 8, t.dark); R(ctx, ox + 16, oy + 54, 20, 6, t.skin); R(ctx, ox + 40, oy + 56, 10, 6, t.glow); return; }
    if (dead) { ctx.translate(ox + 30, oy + 50); ctx.rotate(0.8); ctx.translate(-ox - 30, -oy - 50); }
    const y = oy + bob;
    // legs — massive stumps
    OR(ctx, ox + 14, y + 46, 12, 18, t.dark); OR(ctx, ox + 34, y + 46, 12, 18, t.dark);
    // torso boulder
    OR(ctx, ox + 10, y + 18, 40, 30, t.skin);
    R(ctx, ox + 14, y + 24, 32, 18, t.dark);
    // crystal growths
    for (const [cx2, cy2, s] of [[16, 20, 6], [40, 24, 5], [28, 14, 7], [48, 34, 4]] as [number, number, number][]) {
      R(ctx, ox + cx2, y + cy2, s, s, t.glow);
      R(ctx, ox + cx2 + 1, y + cy2 + 1, s - 2, s - 2, "#e0c0ff");
    }
    // gold crack veins
    R(ctx, ox + 22, y + 30, 10, 1, "#d0a040"); R(ctx, ox + 26, y + 31, 1, 8, "#d0a040");
    // arms — huge fists
    const fistY = pose === "atk" ? y + 8 : y + 24;
    OR(ctx, ox + 2, y + 20, 10, 22, t.skin); OR(ctx, ox + 48, fistY, 10, 22, t.skin);
    if (pose === "atk") SPARK(ctx, ox + 54, y + 4, t.glow, 6);
    // head — embedded in shoulders
    OR(ctx, ox + 22, y + 6, 16, 13, t.skin);
    R(ctx, ox + 26, y + 10, 3, 3, t.glow); R(ctx, ox + 33, y + 10, 3, 3, t.glow);
    R(ctx, ox + 24, y + 4, 12, 3, t.glow); // crystal crest
    if (pose === "hurt") SPARK(ctx, ox + 46, y + 2, "#ffffff", 5);
  }
};

/* --- Void Seraph — winged skull angel with a gold halo --- */
const PAINT_SERAPH: Painter = {
  fw: 64, fh: 72,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? -1 : pose === "walkA" ? -3 : pose === "walkB" ? 1 : 0;
    if (pose === "deadB") { R(ctx, ox + 14, oy + 64, 36, 4, t.dark); SPARK(ctx, ox + 32, oy + 58, t.glow, 5); return; }
    if (dead) { ctx.translate(ox + 32, oy + 40); ctx.rotate(0.7); ctx.translate(-ox - 32, -oy - 40); }
    const y = oy + bob;
    // wings — layered feathers
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const wy = y + 10 + i * 7;
        const wx = ox + 32 + s * (10 + i * 2);
        R(ctx, wx, wy, s * 12, 6, i % 2 ? t.dark : "#8a2ec0");
        R(ctx, wx + s * 10, wy + 3, s * 6, 4, t.dark);
      }
    }
    // gown body
    for (let i = 0; i < 22; i++) {
      const wdt = 14 + Math.floor(i * 0.7);
      R(ctx, ox + 32 - wdt / 2, y + 26 + i, wdt, 1, i > 15 ? t.dark : "#3a2050");
    }
    // skull head
    OR(ctx, ox + 25, y + 8, 15, 16, "#ece6da");
    R(ctx, ox + 29, y + 13, 3, 4, "#1a1424"); R(ctx, ox + 34, y + 13, 3, 4, "#1a1424");
    R(ctx, ox + 30, y + 14, 1, 2, t.glow); R(ctx, ox + 35, y + 14, 1, 2, t.glow);
    R(ctx, ox + 30, y + 20, 5, 2, "#1a1424");
    // gold halo
    R(ctx, ox + 22, y + 2, 21, 2, "#e0b040"); R(ctx, ox + 20, y - 1, 3, 2, "#ffd97a"); R(ctx, ox + 42, y - 1, 3, 2, "#ffd97a");
    if (pose === "atk") { // cross burst
      R(ctx, ox + 30, y - 8, 4, 18, t.glow); R(ctx, ox + 22, y, 20, 4, t.glow);
      R(ctx, ox + 31, y - 6, 2, 14, "#fff");
    }
    if (pose === "hurt") SPARK(ctx, ox + 44, y + 6, "#ffffff", 5);
  }
};

/* --- Frost Leviathan — serpentine ice wyrm --- */
const PAINT_LEVIATHAN: Painter = {
  fw: 64, fh: 72,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const sway = pose === "walkA" ? 3 : pose === "walkB" ? -3 : 0;
    if (pose === "deadB") { for (let i = 0; i < 7; i++) R(ctx, ox + 6 + i * 8, oy + 64, 6, 5, t.glow); return; }
    if (dead) { ctx.translate(ox + 32, oy + 48); ctx.rotate(0.6); ctx.translate(-ox - 32, -oy - 48); }
    const y = oy;
    // serpentine body — S curve of segments
    const segs: [number, number, number][] = [[14, 56, 11], [20, 46, 12], [26, 38, 12], [31, 30, 11], [34, 22, 9]];
    segs.forEach(([sx, sy, sr], i) => {
      const wig = Math.sin(i * 1.4 + sway * 0.2) * 3 + sway * (1 - i / 5);
      OR(ctx, ox + sx + wig, y + sy, sr, sr, i === segs.length - 1 ? "#a0d8ff" : t.skin);
      R(ctx, ox + sx + wig + 2, y + sy + 2, 3, 3, t.glow); // ice glints
    });
    // head — open jaw
    const hx = ox + 33 + sway * 0.4, hy = y + 6;
    OR(ctx, hx - 2, hy, 20, 14, t.skin);
    R(ctx, hx + 12, hy + 2, 6, 4, "#d8f0ff"); // jaw
    R(ctx, hx + 14, hy + 6, 4, 3, "#d8f0ff");
    R(ctx, hx + 3, hy + 3, 3, 3, "#0a2030"); R(ctx, hx + 9, hy + 3, 3, 3, "#0a2030"); // eyes
    // horns
    R(ctx, hx - 4, hy - 3, 3, 5, "#d8f0ff"); R(ctx, hx + 4, hy - 4, 3, 5, "#d8f0ff");
    if (pose === "atk") { // frost breath
      for (let i = 0; i < 5; i++) R(ctx, hx + 20 + i * 5, hy + 2 - i * 2, 4, 4, i % 2 ? t.glow : "#d8f0ff");
    }
    if (pose === "hurt") SPARK(ctx, hx + 16, hy - 4, "#ffffff", 5);
  }
};

/* --- Pyre Behemoth — hulking fire golem, molten cracks --- */
const PAINT_BEHEMOTH: Painter = {
  fw: 60, fh: 72,
  draw(ctx, ox, oy, pose, t) {
    const dead = pose === "deadA" || pose === "deadB";
    const bob = pose === "idle" ? 0 : pose === "walkA" ? -2 : pose === "walkB" ? 2 : 0;
    if (pose === "deadB") { R(ctx, ox + 8, oy + 62, 44, 7, "#241a18"); for (let i = 0; i < 5; i++) R(ctx, ox + 12 + i * 9, oy + 58, 4, 3, t.glow); return; }
    if (dead) { ctx.translate(ox + 30, oy + 50); ctx.rotate(-0.8); ctx.translate(-ox - 30, -oy - 50); }
    const y = oy + bob;
    // legs
    OR(ctx, ox + 15, y + 48, 11, 16, t.dark); OR(ctx, ox + 34, y + 48, 11, 16, t.dark);
    // hunched torso
    OR(ctx, ox + 11, y + 20, 38, 30, t.skin);
    R(ctx, ox + 15, y + 26, 30, 20, t.dark);
    // molten cracks + core
    R(ctx, ox + 24, y + 30, 12, 8, t.glow);
    R(ctx, ox + 20, y + 34, 3, 10, t.glow); R(ctx, ox + 38, y + 28, 3, 8, t.glow);
    R(ctx, ox + 26, y + 32, 8, 4, "#fff0b0");
    // shoulders — smoldering mounds
    OR(ctx, ox + 6, y + 16, 11, 10, t.skin); OR(ctx, ox + 43, y + 16, 11, 10, t.skin);
    R(ctx, ox + 9, y + 18, 5, 4, t.glow); R(ctx, ox + 46, y + 18, 5, 4, t.glow);
    // arms + fists
    const fy = pose === "atk" ? y + 2 : y + 26;
    OR(ctx, ox + 1, y + 22, 9, 24, t.skin); OR(ctx, ox + 50, fy, 9, 24, t.skin);
    if (pose === "atk") { SPARK(ctx, ox + 54, y - 2, t.glow, 6); R(ctx, ox + 52, y + 2, 5, 5, "#ffc040"); }
    // head — sunk into the chest, fire crown
    OR(ctx, ox + 23, y + 8, 14, 12, t.skin);
    R(ctx, ox + 26, y + 12, 3, 3, t.glow); R(ctx, ox + 32, y + 12, 3, 3, t.glow);
    for (let i = 0; i < 4; i++) R(ctx, ox + 24 + i * 4, y + 3 - (i % 2) * 2, 3, 6, t.glow); // flame crest
    if (pose === "hurt") SPARK(ctx, ox + 46, y + 4, "#ffffff", 5);
  }
};

/* ------------------------------------------------------------------ */
/*  kind registry                                                      */
/* ------------------------------------------------------------------ */
export type PixelKind =
  | "knight" | "caster" | "brute" | "wraith" | "ooze" | "swarm" | "imp" | "plant" | "bat"
  | "regent" | "colossus" | "seraph" | "leviathan" | "behemoth";

const PAINTERS: Record<PixelKind, Painter> = {
  knight: PAINT_KNIGHT,
  caster: PAINT_CASTER,
  brute: PAINT_BRUTE,
  wraith: PAINT_WRAITH,
  ooze: paintOoze(1),
  swarm: paintOoze(0.62),
  imp: PAINT_IMP,
  plant: PAINT_PLANT,
  bat: PAINT_BAT,
  regent: PAINT_REGENT,
  colossus: PAINT_COLOSSUS,
  seraph: PAINT_SERAPH,
  leviathan: PAINT_LEVIATHAN,
  behemoth: PAINT_BEHEMOTH
};

/** per-kind palettes (concept sheets p2/p3) — skin = main fill, dark =
 *  shadow/deep tone, glow = eyes/magic accents. */
const KIND_TONES: Record<PixelKind, { skin: string; dark: string; glow: string }> = {
  knight: { skin: "#e8e4d8", dark: "#a8a294", glow: "#9a7bff" },
  caster: { skin: "#a02030", dark: "#6a1420", glow: "#e060f0" },
  brute: { skin: "#5a8a3a", dark: "#3a5a24", glow: "#c8e858" },
  wraith: { skin: "#60c0e0", dark: "#2a6a9a", glow: "#d8f8ff" },
  ooze: { skin: "#b040c0", dark: "#6a1860", glow: "#e8a8f0" },
  swarm: { skin: "#8a3098", dark: "#4a1250", glow: "#d888e8" },
  imp: { skin: "#c03050", dark: "#7a1830", glow: "#d060e0" },
  plant: { skin: "#7a3aa8", dark: "#4a2060", glow: "#c8ff58" },
  bat: { skin: "#5a4a6a", dark: "#382c48", glow: "#ff5a7a" },
  regent: { skin: "#3a2050", dark: "#241238", glow: "#c040e0" },
  colossus: { skin: "#7a6a8a", dark: "#4a3e5c", glow: "#c050f0" },
  seraph: { skin: "#a030d0", dark: "#7020a0", glow: "#ff40c8" },
  leviathan: { skin: "#3878d8", dark: "#1e4a98", glow: "#50c0ff" },
  behemoth: { skin: "#4a3030", dark: "#2a1818", glow: "#ff7818" }
};

/* ------------------------------------------------------------------ */
/*  sheet cache + build                                                */
/* ------------------------------------------------------------------ */
const sheetCache = new Map<string, SpriteSheet>();

/** Headless environments (the validate-enemy-motion harness) have no DOM —
 *  serve a 2×2 white placeholder so the sim path still constructs bodies. */
function headlessSheet(): SpriteSheet {
  const data = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return { texture: tex, frames: 1, worldW: 1, worldH: 1, fps: 1 };
}
const IS_HEADLESS = typeof document === "undefined";

/** Build (or fetch) the sprite sheet for a pixel kind. `tint` shifts the
 *  palette hue for elite/variant recolors (a hex css color or null). */
export function getSheet(kind: PixelKind, tint?: string | null): SpriteSheet {
  if (IS_HEADLESS) return headlessSheet();
  const key = kind + (tint ?? "");
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const painter = PAINTERS[kind];
  const tones = tint ? recolorTones(KIND_TONES[kind], tint) : KIND_TONES[kind];
  const cvs = document.createElement("canvas");
  cvs.width = painter.fw * FRAME_COUNT;
  cvs.height = painter.fh;
  const ctx = cvs.getContext("2d")!;
  const poses: Pose[] = ["idle", "idle", "walkA", "walkB", "atk", "atk", "hurt", "deadA", "deadA", "deadB"];
  for (let f = 0; f < FRAME_COUNT; f++) {
    ctx.save();
    painter.draw(ctx, f * painter.fw, 0, poses[f], tones);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(cvs);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  const sheet: SpriteSheet = {
    texture,
    frames: FRAME_COUNT,
    worldW: painter.fw / 18,
    worldH: painter.fh / 18,
    fps: 7
  };
  sheetCache.set(key, sheet);
  return sheet;
}

/** Elite/variant recolor: lerp the kind's tones toward the tint hex. */
function recolorTones(base: { skin: string; dark: string; glow: string }, tint: string) {
  const t = new THREE.Color(tint);
  const mix = (hex: string, amt: number) => {
    const c = new THREE.Color(hex).lerp(t, amt);
    return `#${c.getHexString()}`;
  };
  return { skin: mix(base.skin, 0.62), dark: mix(base.dark, 0.5), glow: base.glow };
}

/* ------------------------------------------------------------------ */
/*  BillboardSprite — the entity visual                                */
/* ------------------------------------------------------------------ */
export class BillboardSprite {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private sheet: SpriteSheet;
  private frame = 0;
  private animT = 0;
  /** base (unflipped) scale factors, tracked so facing flips compose cleanly */
  private baseScaleX = 1;
  private baseScaleY = 1;
  state: SpriteState = "idle";
  /** 0..1 white flash (hit reaction) */
  flash = 0;
  /** desired world facing: +1 = faces world +X (screen right), -1 = left */
  face: 1 | -1 = 1;
  private baseColor = new THREE.Color(0xffffff);

  constructor(sheet: SpriteSheet, worldHeight?: number) {
    this.sheet = sheet;
    const img = sheet.texture.image as HTMLCanvasElement | HTMLImageElement;
    const fw = img.width / sheet.frames;
    const h = worldHeight ?? sheet.worldH;
    const w = h * (fw / img.height);
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0); // feet anchor
    this.material = new THREE.MeshBasicMaterial({
      map: sheet.texture,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      fog: true
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.applyFrameUV();
  }

  /** retexture (elite recolor etc.) keeping the current pose. */
  setSheet(sheet: SpriteSheet, worldHeight?: number): void {
    const img = sheet.texture.image as HTMLCanvasElement | HTMLImageElement;
    const fw = img.width / sheet.frames;
    const h = worldHeight ?? sheet.worldH;
    const w = h * (fw / img.height);
    const old = this.mesh.geometry as THREE.PlaneGeometry;
    const oldH = old.parameters.height;
    const oldW = old.parameters.width;
    this.sheet = sheet;
    this.material.map = sheet.texture;
    this.material.needsUpdate = true;
    this.baseScaleX = w / oldW;
    this.baseScaleY = h / oldH;
    this.applyFrameUV();
  }

  tint(color: string | number): void {
    this.baseColor.set(color as THREE.ColorRepresentation);
  }

  private applyFrameUV(): void {
    const tex = this.sheet.texture;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1 / this.sheet.frames, 1);
    tex.offset.x = this.frame / this.sheet.frames;
  }

  private setFrame(f: number): void {
    if (f === this.frame) return;
    this.frame = f;
    this.sheet.texture.offset.x = f / this.sheet.frames;
  }

  /** advance the animation; call once per frame with dt. */
  update(dt: number): void {
    const [start, count] = STATE_FRAMES[this.state];
    this.animT += dt * this.sheet.fps;
    const span = Math.max(1, count);
    let idx = Math.floor(this.animT) % span;
    if (this.state === "death") idx = Math.min(span - 1, Math.floor(this.animT)); // death plays once, holds last
    if (this.state === "hurt") idx = 0;
    this.setFrame(start + idx);
    // tint: base color lerped toward white by the hit flash
    this.material.color.copy(this.baseColor);
    if (this.flash > 0) this.material.color.lerp(WHITE, Math.min(1, this.flash));
  }

  /** cylinder billboard toward the camera + horizontal facing flip.
   *  The plane is yawed to face the camera; its local +X then maps to world
   *  (cos yaw, 0, -sin yaw). The sprite art faces local +X, so the mesh is
   *  mirrored whenever the desired world facing opposes that axis. */
  faceCamera(camPos: THREE.Vector3, meshPos: THREE.Vector3): void {
    const yaw = Math.atan2(camPos.x - meshPos.x, camPos.z - meshPos.z);
    this.mesh.rotation.set(0, yaw, 0);
    const axisX = Math.cos(yaw); // world-X component of local +X
    const mirror = this.face * axisX < 0 ? -1 : 1;
    this.mesh.scale.set(this.baseScaleX * mirror, this.baseScaleY, 1);
  }

  /** extra squash/stretch (spawn-in, slime hop) composes with the flip. */
  setSquash(x: number, y: number): void {
    this.baseScaleX = Math.abs(this.baseScaleX) * x;
    this.baseScaleY = Math.abs(this.baseScaleY) * y;
  }

  setOpacity(o: number): void {
    this.material.opacity = o;
    this.material.transparent = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const WHITE = new THREE.Color(0xffffff);

/* ------------------------------------------------------------------ */
/*  the player sheet — cropped from the v3 reference board (p1, purple  */
/*  variant). 8 frames: idle windup runA runB cast castfx hurt ko.       */
/* ------------------------------------------------------------------ */
const PLAYER_FRAMES = 8;
let playerSheet: SpriteSheet | null = null;
let playerLoading: Promise<SpriteSheet> | null = null;

export function loadPlayerSheet(worldH = 3.4): Promise<SpriteSheet> {
  if (IS_HEADLESS) return Promise.resolve(headlessSheet());
  if (playerSheet) return Promise.resolve(playerSheet);
  if (playerLoading) return playerLoading;
  playerLoading = new Promise(resolve => {
    new THREE.TextureLoader().load(assetPath("/assets/sprites/player.png"), tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      playerSheet = { texture: tex, frames: PLAYER_FRAMES, worldW: 3.4 * (1600 / 8) / 179, worldH, fps: 7 };
      resolve(playerSheet);
    }, undefined, () => {
      // fallback: procedural imp sheet keeps the game playable
      playerSheet = getSheet("imp");
      resolve(playerSheet);
    });
  });
  return playerLoading;
}

/** player state → frame (single-action poses, no loops except idle/run). */
export function playerFrameFor(state: SpriteState, t: number): number {
  switch (state) {
    case "idle": return Math.floor(t * 2) % 2 === 0 ? 0 : 1;
    case "walk": return Math.floor(t * 8) % 2 === 0 ? 2 : 3;
    case "attack": return 4; // cast raise (release flash handled by VFX)
    case "hurt": return 6;
    case "death": return 7;
  }
}
