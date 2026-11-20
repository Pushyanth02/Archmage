/* ARCHMAGE: RIFTBOUND — title-screen bootstrap.
   Framework-free entry point: injects the semantic markup, spins up the
   Three.js MenuScene + the UIManager, owns the resize observer, the
   requestAnimationFrame loop and the SOLO RUN transition choreography.

   Under Next.js this is invoked by the thin client wrapper
   (src/components/TitleScreen.tsx). Under a plain Vite scaffold the same
   call is made from vite.index.html — this module is the app. */

import { MenuScene } from "@/scene/MenuScene";
import { SfxSynth, UIManager } from "@/ui/UIManager";
import type { SceneControls } from "@/scene/MenuScene";
import { TITLE_MARKUP } from "@/ui/markup";

export interface TitleApp {
  dispose(): void;
}

const NOOP_SCENE: SceneControls = {
  setParallax(): void { /* no WebGL — nothing to drive */ },
  setParticleDensity(): void { /* no WebGL — nothing to drive */ },
};

/** Piecewise smoothstep between two edges, for the veil fade curve. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function startTitleScreen(root: HTMLElement): TitleApp {
  root.innerHTML = TITLE_MARKUP;

  const stage = root.querySelector<HTMLElement>(".stage");
  const canvas = root.querySelector<HTMLCanvasElement>('[data-ui="canvas"]');
  const hud = root.querySelector<HTMLElement>('[data-ui="hud"]');
  const veil = root.querySelector<HTMLElement>('[data-ui="veil"]');
  if (!stage || !canvas || !hud || !veil) {
    throw new Error("startTitleScreen: markup contract violated (stage/canvas/hud/veil missing)");
  }

  const ac = new AbortController();
  const signal = { signal: ac.signal };

  /* The guard above narrows these to non-null; re-captured so the hoisted
     transition functions below keep the narrowed type. */
  const veilEl = veil;
  const stageEl = stage;
  const hudEl = hud;

  /* Scene — falls back to a painted CSS vista if WebGL is unavailable. */
  let scene: MenuScene | null = null;
  try {
    scene = new MenuScene({
      canvas,
      width: stageEl.clientWidth,
      height: stageEl.clientHeight,
      backgroundUrls: ["/assets/bg-clean.png"],
      wizardUrls: ["/assets/sprites/wizard-idle.png", "/assets/sprites/player-idle.png"],
      onReady: () => {
        stageEl.classList.add("ready");
        hudEl.classList.add("on");
      },
    });
  } catch {
    stageEl.classList.add("no-webgl", "ready");
    hudEl.classList.add("on");
  }

  const controls: SceneControls = scene ?? NOOP_SCENE;
  const sfx = new SfxSynth(ac.signal);

  const ui = new UIManager({
    root: hud,
    sfx,
    scene: controls,
    onStartRun: beginRun,
    onReturnToMenu: returnToMenu,
  });

  /* SOLO RUN: dolly into the portal, fade the veil, land on the splash. */
  let runBusy = false;
  function beginRun(seed: string): void {
    if (runBusy) return;
    runBusy = true;
    ui.setTransitionLock(true);
    veilEl.classList.add("active");
    const splashSeed = veilEl.querySelector<HTMLElement>('[data-ui="splash-seed"]');
    if (splashSeed) splashSeed.textContent = seed;

    const arrive = (): void => {
      veilEl.style.opacity = "1";
      veilEl.classList.add("arrived");
    };

    if (scene) {
      void scene
        .startRunTransition(1900, (t) => {
          veilEl.style.opacity = String(smoothstep(0.62, 0.98, t));
        })
        .then(arrive);
    } else {
      /* No-WebGL path: a plain timed fade. */
      let t = 0;
      const step = (): void => {
        t += 0.04;
        veilEl.style.opacity = String(Math.min(1, t));
        if (t < 1) requestAnimationFrame(step);
        else arrive();
      };
      step();
    }
  }

  /* Splash return: rewind the camera under cover of the veil. */
  function returnToMenu(): void {
    veilEl.classList.remove("arrived");
    window.requestAnimationFrame(() => {
      scene?.resetView();
      veilEl.style.opacity = "0";
      window.setTimeout(() => veilEl.classList.remove("active"), 560);
      ui.setTransitionLock(false);
      runBusy = false;
    });
  }

  /* Resize — keeps the renderer sized to the letterboxed stage. */
  const applySize = (): void => {
    scene?.resize(stageEl.clientWidth, stageEl.clientHeight);
  };
  const ro = new ResizeObserver(applySize);
  ro.observe(stageEl);
  window.addEventListener("resize", applySize, signal);
  window.addEventListener("orientationchange", applySize, signal);

  /* Pointer parallax, normalized to the stage. */
  stageEl.addEventListener(
    "pointermove",
    (ev) => {
      const r = stageEl.getBoundingClientRect();
      scene?.setPointer(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        ((ev.clientY - r.top) / r.height) * 2 - 1,
      );
    },
    signal,
  );

  /* The loop — delta clamped so tab-switches never fast-forward the rift. */
  let raf = 0;
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    scene?.update(dt);
    scene?.render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    dispose(): void {
      ac.abort();
      cancelAnimationFrame(raf);
      ro.disconnect();
      ui.dispose();
      scene?.dispose();
      sfx.dispose();
      root.innerHTML = "";
    },
  };
}
