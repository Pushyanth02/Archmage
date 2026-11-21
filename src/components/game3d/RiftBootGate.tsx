"use client";

/* ARCHMAGE: RIFTBOUND — RiftBootGate: the ONE loading screen.
   Two deterministic states, booting → ready. While `booting`, a single
   full-viewport gate holds the reveal: pixel sigil, byte-accurate progress
   from the asset pipeline, and the Rift Night palette. No other spinner,
   splash or preloader exists anywhere in the app (the legacy dynamic-import
   placeholders and the in-shell double veil are deleted).

   The gate is SERVER-RENDERABLE first-paint HTML (no dynamic import), so on
   a cold boot it is the very first frame the player sees — one screen, zero
   flashes, until the shell reports the hub ready. */

import { useEffect, useState } from "react";
import { PALETTE } from "@/game3d/palette";

export interface BootHandle {
  phase: "booting" | "ready";
  /** 0..1 asset progress when known. */
  progress?: number | null;
  /** bytes streamed / total when the manifest reports them. */
  loadedBytes?: number;
  totalBytes?: number;
}

/** The static sigil — a pixel-art rune wheel drawn with crisp rects only. */
function RiftSigil() {
  /* a 13×13 "pixel" grid rendered as one SVG with shape-rendering crispEdges;
     reads as a cut-stone arcane sigil, never a smooth vector ring */
  const cells: Array<[number, number, string]> = [
    // center diamond (gold)
    [6, 6, PALETTE.gold], [6, 5, PALETTE.gold], [6, 7, PALETTE.gold],
    [5, 6, PALETTE.gold], [7, 6, PALETTE.gold],
    // inner ring (violet)
    [4, 6, PALETTE.violet], [8, 6, PALETTE.violet],
    [6, 4, PALETTE.violet], [6, 8, PALETTE.violet],
    [4, 4, PALETTE.violet], [5, 5, PALETTE.violet],
    [8, 8, PALETTE.violet], [7, 7, PALETTE.violet],
    [4, 8, PALETTE.violet], [5, 7, PALETTE.violet],
    [8, 4, PALETTE.violet], [7, 5, PALETTE.violet],
    // outer cardinal points (gold hi)
    [6, 2, PALETTE.goldHi], [6, 10, PALETTE.goldHi],
    [2, 6, PALETTE.goldHi], [10, 6, PALETTE.goldHi],
    // outer diagonals (stone rim)
    [3, 3, PALETTE.stoneRim], [9, 3, PALETTE.stoneRim],
    [3, 9, PALETTE.stoneRim], [9, 9, PALETTE.stoneRim],
  ];
  return (
    <svg
      viewBox="0 0 13 13"
      width="78"
      height="78"
      shapeRendering="crispEdges"
      aria-hidden
      className="rn-sigil-pulse"
    >
      {cells.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill={c} />
      ))}
    </svg>
  );
}

export function RiftBootGate({ boot }: { boot: BootHandle }) {
  /* local reveal fade: when phase flips to ready, fade the gate out over
     450ms then unmount — the hub is already mounted beneath it.
     (setFading during render — the legal "adjust state when a prop
     changes" pattern — avoids a cascading effect render.) */
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  if (boot.phase === "ready" && !fading && !gone) setFading(true);
  useEffect(() => {
    if (!fading) return;
    const t = window.setTimeout(() => setGone(true), 480);
    return () => window.clearTimeout(t);
  }, [fading]);
  if (gone) return null;

  const known = typeof boot.progress === "number" && !Number.isNaN(boot.progress);
  const pct = known ? Math.round(Math.max(0, Math.min(1, boot.progress as number)) * 100) : null;
  const mb = typeof boot.totalBytes === "number" && boot.totalBytes > 0
    ? `${((boot.loadedBytes ?? 0) / 1048576).toFixed(1)} / ${(boot.totalBytes / 1048576).toFixed(1)} MB`
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Opening the rift — loading the essentials"
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-[#171321] px-6 transition-opacity duration-500"
      style={{ opacity: fading ? 0 : 1, pointerEvents: fading ? "none" : "auto" }}
    >
      {/* ambient rift glows — palette voices only, heavily veiled */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[52vh] w-[82vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#A991F7] opacity-[0.07] blur-[120px]" />
        <div className="absolute bottom-[-18%] right-[-10%] h-[42vh] w-[52vw] rounded-full bg-[#58D6C2] opacity-[0.04] blur-[130px]" />
      </div>
      <div className="relative flex w-full max-w-xs flex-col items-center gap-6 text-center">
        <RiftSigil />
        <div>
          <div className="font-display text-lg font-black uppercase tracking-[0.28em] text-[#F8E7BF] [text-shadow:0_0_26px_rgba(217,186,114,0.4)] sm:text-xl">
            ARCHMAGE
          </div>
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-[#A991F7]">
            Riftbound · opening the rift
          </div>
        </div>
        {/* the bar: gold fill, ink bed, 1px stone border */}
        <div className="w-full">
          <div
            className="h-1.5 w-full overflow-hidden rounded-[3px] border border-[#3D3152] bg-[#140E1D]"
            aria-hidden
          >
            {pct !== null ? (
              <div
                className="h-full rounded-[2px] bg-[#D9BA72] transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="rn-boot-pulse h-full w-full bg-[#D9BA72]/50" />
            )}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.24em] tabular-nums text-[#9E93B5]">
            {pct !== null ? (
              <span>
                {pct}%
                {mb && <span className="text-[#9E93B5]/60"> · {mb}</span>}
              </span>
            ) : (
              "channeling…"
            )}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes rn-boot-pulse {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.85; }
        }
        .rn-boot-pulse {
          animation: rn-boot-pulse 1.6s ease-in-out infinite;
        }
        @keyframes rn-sigil-pulse {
          0%, 100% { opacity: 0.75; }
          50% { opacity: 1; }
        }
        .rn-sigil-pulse {
          animation: rn-sigil-pulse 2.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .rn-boot-pulse,
          .rn-sigil-pulse {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
