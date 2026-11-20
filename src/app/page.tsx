"use client";

/* ARCHMAGE: RIFTBOUND — the single route. This build mounts the modular
   title screen (Three.js MenuScene + vanilla-TS UIManager, see src/main.ts)
   client-side; the shell only appears after hydration.

   The leading block below is prerendered into the static HTML and is
   screen-reader-only — it gives crawlers, AI agents and assistive tech a
   complete, honest description of what this page is WITHOUT executing
   JavaScript, and carries the page's single primary <h1> (the visible
   wordmark renders as decorative text, aria-hidden). */

import dynamic from "next/dynamic";

const TitleScreen = dynamic(() => import("@/components/TitleScreen"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#05030c] text-white">
      <div className="text-3xl font-black tracking-[0.25em] text-amber-200">ARCHMAGE</div>
      <div className="text-xs font-bold uppercase tracking-[0.35em] text-violet-300/70">Riftbound</div>
      <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-[rift-load_1.2s_ease-in-out_infinite] rounded-full bg-amber-200/80" />
      </div>
      <style>{`@keyframes rift-load { 0% { transform: translateX(-120%);} 100% { transform: translateX(320%);} }`}</style>
    </div>
  ),
});

export default function Page() {
  return (
    <>
      <div className="sr-only" aria-label="About this page">
        <h1>ARCHMAGE: RIFTBOUND — fantasy roguelike title screen</h1>
        <p>
          A modular TypeScript + Three.js recreation of the ARCHMAGE: RIFTBOUND main menu: an
          animated 2.5D backdrop with a swirling rift portal, floating islands, a wizard on a
          glowing rune circle and rising embers, layered under a pixel-styled HUD.
        </p>
        <h2>What can you do on this screen?</h2>
        <ul>
          <li>SOLO RUN starts the run transition — the camera dives into the rift portal with the active seed.</li>
          <li>The seed bar generates shareable seeds in the word-digits format, editable inline.</li>
          <li>VAULT, RUNES, CODEX and SETTINGS open typed modal panels; settings toggle sound, camera parallax and particle density live.</li>
          <li>Gem and gold counters increment through the plus buttons with animated count-ups.</li>
        </ul>
        <h2>How is it built?</h2>
        <p>
          The scene (src/scene/MenuScene.ts) renders a GLSL vortex sky, a procedural midground
          vista with loader hooks for painted art, a shader rune ring, an idle-bobbing wizard
          sprite lit by a pulsing staff light, and two GPU particle systems. The UI layer
          (src/ui/UIManager.ts) owns typed state, seed forging, modals and Web Audio chimes.
          Everything runs locally in the browser; no accounts, no tracking.
        </p>
      </div>
      <noscript>
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#05030c] px-8 text-center text-white">
          <p className="text-2xl font-black tracking-[0.25em] text-amber-200">ARCHMAGE</p>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-300/70">Riftbound</p>
          <p className="max-w-md text-sm leading-relaxed text-[#b9aee0]">
            The rift needs JavaScript and WebGL to open. This title screen renders an animated
            Three.js backdrop with a pixel-styled game HUD. Enable JavaScript to enter the gate.
          </p>
        </div>
      </noscript>
      <TitleScreen />
    </>
  );
}
