"use client";

/* ARCHMAGE: RIFTBOUND — 3D Edition — the single route. The game is fully
   client-side: the shell (canvas + WebGL) only mounts after hydration.

   v2.1.1: the leading block is prerendered into the static HTML and is
   screen-reader-only — it gives crawlers, AI agents and assistive tech a
   complete, honest description of the game WITHOUT executing JavaScript,
   and it carries the page's single primary <h1> (the visible menu renders
   <h2>s). The boot loader reads its version from lib/site — importing the
   game's content module here would pull the whole data layer into the
   first-paint chunk; the version strings are CI-locked to content.ts by
   scripts/validate-web.ts. */

import dynamic from "next/dynamic";
import { SITE_VERSION, SITE_VERSION_NAME, SITE_REPO, SITE_TAGLINE, SITE_URL } from "@/lib/site";

const GameShell = dynamic(() => import("@/components/game3d/GameShell"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0812] text-white">
      <div className="text-3xl font-black tracking-[0.25em] text-amber-200">ARCHMAGE</div>
      <div className="text-xs font-bold uppercase tracking-[0.35em] text-violet-300/70">Riftbound · 3D Edition</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-amber-200/50">Version {SITE_VERSION} · {SITE_VERSION_NAME}</div>
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
      {/* Crawlable, screen-reader-first summary — present in the static
          HTML, hidden from sighted players (the cinematic menu renders in
          its place). One <h1> per page, answer-focused sections, and the
          same entity facts the metadata, JSON-LD and llms.txt carry. */}
      <div className="sr-only" aria-label="About the game">
        <h1>ARCHMAGE: RIFTBOUND — a free 3D roguelike in your browser</h1>
        <p>{SITE_TAGLINE}</p>
        <h2>What is ARCHMAGE: RIFTBOUND?</h2>
        <p>
          A single-player 3D roguelike that runs entirely in your browser. Fifty waves stand between you and the sealed
          rift, with five act bands drawn from ten terrains and five tyrants. You bind spells from 13 elements into slots,
          discover 78 pair resonances by casting two elements within a breath, and after wave 12 a long-bound spell may
          be offered one of 22 evolutions: permanent trade-offs, never strict upgrades.
        </p>
        <h2>How do you play?</h2>
        <p>
          Pick or reroll a seed on the main menu and enter the rift. On desktop: WASD to move, mouse to aim, left click
          casts, right click volleys, Space blinks, F unleashes the surge, P pauses. On touch devices the game offers a
          left stick with action buttons, a left-hand mirror, one-thumb casting and an auto-immersive fullscreen
          landscape mode. Gamepads are supported.
        </p>
        <h2>Is every run the same for the same seed?</h2>
        <p>
          Yes. Every run is deterministic per seed: the same seed always walks the same ground — the biome itinerary,
          the enemies, the spell offers and the evolution drafts are all derived from it. Seeds are shareable: paste a
          friend&apos;s seed to replay their rift.
        </p>
        <h2>Is it really free? What about my data?</h2>
        <p>
          It is free, with no in-app purchases, no accounts, no ads and no analytics. Progress and settings are stored
          only in your browser&apos;s localStorage; the game sends no player data to any server — every spell, every
          wave and every save lives on your device. Terms of Service and a Privacy Policy are reachable from the main
          menu, and the full source code is available at{" "}
          <a href={SITE_REPO} tabIndex={-1}>the GitHub repository</a>.
        </p>
        <h2>Content facts</h2>
        <ul>
          <li>50 waves, 5 act bands from 10 terrains, 5 tyrants</li>
          <li>13 elements, 78 pair resonances, 22 spell evolutions</li>
          <li>Current version: {SITE_VERSION} — {SITE_VERSION_NAME}</li>
          <li>Play at {SITE_URL}</li>
        </ul>
      </div>
      <noscript>
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#0a0812] px-8 text-center text-white">
          <p className="text-2xl font-black tracking-[0.25em] text-amber-200">ARCHMAGE</p>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-300/70">Riftbound · 3D Edition</p>
          <p className="max-w-md text-sm leading-relaxed text-[#b9aee0]">
            The rift needs JavaScript and WebGL2 to open. ARCHMAGE: RIFTBOUND is a free 3D roguelike that runs entirely
            in your browser — 50 waves, 13 elements, 78 resonances, 22 spell evolutions, five tyrants. Enable
            JavaScript to play; nothing is installed and nothing is tracked.
          </p>
        </div>
      </noscript>
      <GameShell />
    </>
  );
}
