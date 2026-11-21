"use client";

/* ARCHMAGE: RIFTBOUND — PixelArenaBackdrop: the ONE hub backdrop.
   A 2D canvas that draws the ACTUAL gameplay ground — the validated v3.1
   tileset atlases (cursed grove floor, crypt ruins, soul braziers) laid in
   a top-down 3/4 orthographic grid with drifting embers, on the master
   palette's canvas void (#171321). Nearest-neighbor only: the canvas never
   smooths (imageSmoothingEnabled = false), tiles are drawn at integer
   scales, and the whole surface renders behind the Title & Loadout Hub.

   This replaces the retired WebGL MenuScene AND the HD keyart JPEGs — the
   menu now sits on the same pixel art the runs use. */

import { useEffect, useRef } from "react";
import { assetPath } from "@/lib/asset-path";
import { PALETTE } from "@/game3d/palette";

/* the deployed tileset atlas (6 cols × 4 rows of 64px frames):
   row 0 floor tiles · rows 1-3 ruins, flora, crystals, braziers, portal  */
const TILESET_URL = assetPath("/assets/v31/tilesets/tileset_undead_crypt.png");
const FRAME = 64;

interface Ember {
  x: number;
  y: number;
  vy: number;
  vx: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export function PixelArenaBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    const img = new Image();
    img.src = TILESET_URL;

    /* ---- sizing: integer-scaled tiles, letterboxed to the viewport ---- */
    const TILE = 128; /* 64px atlas frame × 2 — the 2× block density */
    let cols = 0;
    let rows = 0;
    let offX = 0;
    let offY = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false; /* re-assert after resize (resets) */
      cols = Math.ceil(w / TILE) + 1;
      rows = Math.ceil(h / TILE) + 1;
      offX = 0;
      offY = 0;
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    /* ---- deterministic tile layout (stable between resizes) ---- */
    const hash = (x: number, y: number): number => {
      let h = (x * 374761393 + y * 668265263) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    /* row 0 columns 0-4 are the calm flagstones; keep 4 as the rare
       decorated variant. rows 2+ are props — sparse, on their own grid. */
    const floorTile = (cx: number, cy: number): number => {
      const r = hash(cx, cy);
      if (r > 0.94) return 4; /* decorated variant, sparse */
      return Math.floor(r * 4); /* 0..3 calm flagstones */
    };
    /* props (rows 2-3 of the sheet): pillars, crystals, braziers, statues.
       Placed on a 4-tile lattice so they never crowd; only some cells fire. */
    const propCell = (cx: number, cy: number): { row: number; col: number } | null => {
      const gx = Math.floor(cx / 3);
      const gy = Math.floor(cy / 3);
      if (gx * 3 !== cx || gy * 3 !== cy) return null; /* lattice anchor */
      const r = hash(gx * 7 + 3, gy * 11 + 5);
      if (r < 0.42) return null; /* most anchors stay empty */
      if (r < 0.62) return { row: 2, col: 2 }; /* teal crystal cluster */
      if (r < 0.8) return { row: 1, col: 4 }; /* broken tomb stone */
      if (r < 0.92) return { row: 2, col: 4 }; /* soul brazier */
      return { row: 3, col: 1 }; /* crypt statue */
    };

    /* ---- embers: rising sparks in the palette's fire/gold voices ---- */
    const EMBER_COLORS = [PALETTE.gold, PALETTE.goldHi, PALETTE.violetHi];
    const embers: Ember[] = [];
    const spawnEmber = (w: number, h: number): Ember => {
      const maxLife = 4 + Math.random() * 5;
      return {
        x: Math.random() * w,
        y: h + 8,
        vy: -(8 + Math.random() * 14),
        vx: (Math.random() - 0.5) * 6,
        life: 0,
        maxLife,
        size: Math.random() < 0.3 ? 3 : 2,
        color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
      };
    };

    /* ---- the frame ---- */
    let last = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = now / 1000;

      /* canvas void bed */
      ctx.fillStyle = PALETTE.void;
      ctx.fillRect(0, 0, w, h);

      if (img.complete && img.naturalWidth > 0) {
        /* subtle drift — the camera glides across the arena (parallax feel
           without breaking the orthographic grid) */
        const drift = Math.sin(t * 0.05) * TILE * 0.5;
        const driftY = Math.cos(t * 0.04) * TILE * 0.35;

        /* floor pass */
        for (let cy = -1; cy < rows; cy++) {
          for (let cx = -1; cx < cols; cx++) {
            const dx = Math.round(cx * TILE + offX + drift);
            const dy = Math.round(cy * TILE + offY + driftY);
            ctx.drawImage(img, floorTile(cx, cy) * FRAME, 0, FRAME, FRAME, dx, dy, TILE, TILE);
          }
        }
        /* veil the floor toward the palette void so the HUD reads */
        ctx.fillStyle = "rgba(23,19,33,0.35)";
        ctx.fillRect(0, 0, w, h);

        /* prop pass — drawn feet-anchored on the grid, after the veil so
           the ruins read bold against the dimmed flagstones */
        for (let cy = -1; cy < rows; cy++) {
          for (let cx = -1; cx < cols; cx++) {
            const prop = propCell(cx, cy);
            if (!prop) continue;
            const dx = Math.round(cx * TILE + offX + drift);
            const dy = Math.round(cy * TILE + offY + driftY);
            /* soft cast ground shadow under every prop (ellipse, ink) */
            ctx.fillStyle = "rgba(20,14,29,0.45)";
            ctx.beginPath();
            ctx.ellipse(dx + TILE / 2, dy + TILE - 14, TILE * 0.32, TILE * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(img, prop.col * FRAME, prop.row * FRAME, FRAME, FRAME, dx, dy, TILE, TILE);
          }
        }
      } else {
        /* pre-atlas bed: faint stone grid so first paint is never empty */
        ctx.strokeStyle = "rgba(61,49,82,0.4)";
        ctx.lineWidth = 1;
        for (let y = 0; y < h; y += TILE) {
          for (let x = 0; x < w; x += TILE) {
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          }
        }
      }

      /* embers */
      if (embers.length < 26 && Math.random() < 0.3) embers.push(spawnEmber(w, h));
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.life += dt;
        if (e.life >= e.maxLife || e.y < -8) {
          embers.splice(i, 1);
          continue;
        }
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const fade = 1 - e.life / e.maxLife;
        ctx.globalAlpha = Math.max(0, fade * 0.7);
        ctx.fillStyle = e.color;
        ctx.fillRect(Math.round(e.x), Math.round(e.y), e.size, e.size);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-pixel-canvas
      aria-hidden
      className="absolute inset-0 h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
