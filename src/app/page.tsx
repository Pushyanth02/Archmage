"use client";

/* ARCHMAGE: RIFTBOUND — the single route, the single boot gate.
   v3.2 "Rift Night" unification: ONE loading screen, ONE title hub.

   Boot flow (deterministic, two states only):
     booting → ready
   - `booting` paints the ONE RiftLoader (a static, first-paint HTML block —
     no flash, no second spinner inside any child).
   - GameShell mounts while the loader covers it, reports asset progress
     through the shared boot gate hook, and swaps to `ready` when the
     essential tier settles — the hub reveals once, fully formed.

   The legacy double boot (a dynamic-import placeholder spinner PLUS the
     in-shell "Summoning the Rift" veil PLUS the WebGL title's own ready
     fade) and BOTH legacy title screens (the vanilla-TS WebGL menu and the
     React MenuContent inside the shell) are deleted — the Title Hub in the
     shell is the only title screen the player can ever see.

   The leading block below is prerendered into the static HTML and is
     screen-reader-only — it gives crawlers, AI agents and assistive tech a
     complete, honest description of what this page is WITHOUT executing
     JavaScript, and carries the page's single primary <h1> (the visible
     wordmark renders as decorative text, aria-hidden). */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { RiftBootGate, type BootHandle } from "@/components/game3d/RiftBootGate";
import { assetPath } from "@/lib/asset-path";

/* The playable shell mounts immediately (no ssr) — it owns the ONE title
   hub, all screens, the engine and the ONE loading veil. Its bundle
   streams lazily; the RiftLoader covers the gap, so the loader is the
   ONLY thing on screen until the hub is ready. */
const GameShell = dynamic(() => import("@/components/game3d/GameShell"), {
  ssr: false,
});

export default function Page() {
  const [boot, setBoot] = useState<BootHandle>({ phase: "booting" });

  /* Belt-and-braces: if something catastrophic keeps the shell from ever
     reporting ready (blocked bundle, ancient browser), fall through to the
     hub after 12s — the game is fully playable on procedural art. */
  useEffect(() => {
    if (boot.phase === "ready") return;
    const t = window.setTimeout(() => setBoot({ phase: "ready" }), 12000);
    return () => window.clearTimeout(t);
  }, [boot.phase]);

  return (
    <>
      <div className="sr-only" aria-label="About this page">
        <h1>ARCHMAGE: RIFTBOUND — dark-fantasy pixel-art action roguelite</h1>
        <p>
          A top-down 3/4 perspective 2D pixel-art action roguelite rendered in one
          unified "Rift Night" art direction. A live pixel-art arena backs the Title
          &amp; Loadout Hub: enter Play to dive into a run, or open Vault, Runes,
          Codex and Settings — every screen shares the same panels, palette and
          pixel icons.
        </p>
        <h2>What can you do on this screen?</h2>
        <ul>
          <li>PLAY starts the run transition — the camera dives into the rift and the playable run begins with the active seed.</li>
          <li>The seed plate forges shareable seeds in the word-digits format, editable inline.</li>
          <li>VAULT, RUNES, CODEX and SETTINGS open the shared modal screens; settings toggle audio, visuals, accessibility and controls live.</li>
          <li>Aether-glyph and score counters track lifetime meta-progression.</li>
        </ul>
        <h2>How is it built?</h2>
        <p>
          The hub backdrop is a 2D canvas drawing the validated v3.1 tileset atlases
          (nearest-neighbor pixel rendering). Runs render through a Three.js engine
          driving the same v3.1 sprite sheets with 4-directional facing and cast
          ground shadows. Everything runs locally in the browser; no accounts, no
          tracking.
        </p>
      </div>
      <noscript>
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#171321] px-8 text-center text-white">
          <p className="font-display text-2xl font-black tracking-[0.25em] text-[#D9BA72]">ARCHMAGE</p>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#A991F7]/70">Riftbound</p>
          <p className="max-w-md text-sm leading-relaxed text-[#BFB5D4]">
            The rift needs JavaScript to open. This game renders a pixel-art arena
            and a full roguelite in your browser. Enable JavaScript to enter the gate.
          </p>
        </div>
      </noscript>
      <GameShell autoStartSeed={null} bootHandle={setBoot} />
      <RiftBootGate boot={boot} />
      <span aria-hidden className="hidden">{assetPath("/")}</span>
    </>
  );
}
