"use client";


import { useRef, useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { RiftEngine } from "@/game3d/engine";
import { sfx } from "@/game3d/audio";
import { useRiftStore, currentBonuses } from "@/game3d/store";
import { randomSeedString } from "@/game3d/content";
import type { HudSnapshot, InputState } from "@/game3d/types";
import type { ElementId } from "@/game3d/content";
import { HUD, type HudApply } from "@/components/game3d/HUD";
import { Banner, TributeGateOverlay, SpellOfferOverlay, MergeOverlay, EvolveOverlay } from "@/components/game3d/overlays";
import { ui, PauseOverlay, MainMenu, ReliquaryScreen, ArcanumScreen, GameOverScreen, VictoryCredits, SettingsModal } from "@/components/game3d/screens";
import { TouchControls } from "@/components/game3d/TouchControls";
import { ImmersiveManager } from "@/components/game3d/ImmersiveManager";
import { CrashSnapshot } from "@/components/game3d/CrashSnapshot";
import { usePointerCoarse } from "@/game3d/capability";

/* ARCHMAGE: RIFTBOUND (3D Edition) — the GameShell.
   Owns the canvas, the engine lifecycle, keyboard/mouse input, the 30 Hz HUD
   registration and every screen/overlay. The engine speaks only through
   callbacks; the store is the single source of truth for UI state. */

/* ------------------------- input scoping (audit P2-4) -------------------- */ /** True when the event originated inside a real editable control: form
                                                                                *  fields (the seed input is the shipped case) or a contenteditable host.
                                                                                *  These targets own their keys — the global handlers must never
                                                                                *  preventDefault, toggle mute or cast spells on their behalf. */function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  /* contenteditable="" is also "true" per HTML; closest() covers hosts that
   delegate editing to descendant nodes */
  return t.closest('[contenteditable="true"], [contenteditable=""]') !== null;
}
/** True when a wheel event is a GAMEPLAY gesture: a run is live (phase
 *  "playing") AND the event originates on the gameplay surface. Context
 *  menus are now suppressed game-wide (R-06 below) — this predicate only
 *  gates spell-cycling, which must stay a play-only interaction so menus,
 *  dialogs and codex panes keep native scrolling. */
function isGameplayGesture(t: EventTarget | null): boolean {
  if (useRiftStore.getState().phase !== "playing") return false;
  return t instanceof HTMLElement && t.closest("[data-game-surface]") !== null;
}
export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RiftEngine | null>(null);
  const damageLayerRef = useRef<HTMLDivElement>(null);
  const hudApplyRef = useRef<HudApply | null>(null);
  const [touchLatched, setTouchLatched] = useState(false); // one-shot hybrid-laptop upgrade latch (see unified touch detection)
  const [gamepadOn, setGamepadOn] = useState(false);
  const [hudTick, setHudTick] = useState<HudSnapshot | null>(null); // for TouchControls meters (low rate)
  const [engineInput, setEngineInput] = useState<InputState | null>(null);
  const phase = useRiftStore(s => s.phase);
  const screen = useRiftStore(s => s.screen);
  const gateOffer = useRiftStore(s => s.gateOffer);
  const spellOffer = useRiftStore(s => s.spellOffer);
  const mergeOffer = useRiftStore(s => s.mergeOffer);
  const evolveOffer = useRiftStore(s => s.evolveOffer);
  const hudDensity = useRiftStore(s => s.meta.settings.hudDensity);
  const vignette = useRiftStore(s => s.meta.settings.vignette);
  const leftHanded = useRiftStore(s => s.meta.settings.leftHanded);
  const tapToCast = useRiftStore(s => s.meta.settings.tapToCast);
  const registerHud = useCallback((apply: HudApply | null) => {
    hudApplyRef.current = apply;
  }, []);
  /* ------------------------- pre-run loading veil -------------------------- */ /* v2.2: the veil is now TWO gates. (1) BOOT — on mount, while the
                                                                                  essential tier (sprites + the player's models + the clip bank)
                                                                                  streams, a "Summoning the Rift" veil holds the reveal so the menu
                                                                                  never paints over a parse storm; capped at 6s so a stalled network
                                                                                  still reaches the (procedural-safe) menu. (2) RUN — clicking Enter
                                                                                  the Rift while relics still stream holds the click behind "Attuning
                                                                                  the Rift" with byte-accurate progress; the ceiling is 30s (was 8s —
                                                                                  slow devices used to fall through to fallback art while their assets
                                                                                  were seconds from landing). */
  const [veil, setVeil] = useState<{ progress: number | null; indeterminate: boolean; boot?: boolean; loadedBytes?: number; totalBytes?: number } | null>(null);
  const veilPollRef = useRef<number | null>(null);
  const veilTimeoutRef = useRef<number | null>(null);
  const veilSeedRef = useRef("");
  /* v2.2: the boot veil's interval+cap teardown, handed to the engine-boot
  *  effect's cleanup (fast unmount strands nothing). */
  const bootTimersRef = useRef<(() => void) | null>(null);
  const veilStallRef = useRef({
    last: -1,
    at: 0
  });
  const readAssetGate = (): { ready?: boolean; progress?: number; essentialsReady?: boolean; loadedBytes?: number; totalBytes?: number } | null => {
    const engine = engineRef.current;
    if (!engine) return null;
    return (engine as unknown as { assets?: { ready?: boolean; progress?: number; essentialsReady?: boolean; loadedBytes?: number; totalBytes?: number } }).assets ?? null;
  };
  /* ------------------------------ run control ----------------------------- */
  const launchRun = useCallback((seed: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    sfx.resume();
    const meta = useRiftStore.getState().meta;
    useRiftStore.getState().clearRunState();
    lastHudSnapshot = null; // stale wave data must not leak into the new run
    engine.startRun(seed, {
      bonuses: currentBonuses(meta),
      mercyTier: meta.mercyTierSel,
      mercyDeaths: meta.mercyDeaths
    });
  }, []);
  /** Entry point for BOTH run starts (menu BEGIN + game-over RE-ENTER — both
    funnel through the `ui` bridge). Intercepts only while relics stream. */
  const startRun = useCallback((seed: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const assets = readAssetGate();
    /* already summoned (typical: assets cached/local) → zero-friction start,
    no veil flash */
    if (!assets || assets.ready !== false) {
      launchRun(seed);
      return;
    }
    /* relics still streaming → veil with live byte progress + 30s ceiling */
    sfx.resume();
    veilSeedRef.current = seed;
    const p0 = typeof assets.progress === "number" ? assets.progress : null;
    veilStallRef.current = {
      last: p0 ?? -1,
      at: performance.now()
    };
    setVeil({
      progress: p0,
      indeterminate: p0 === null,
      loadedBytes: assets.loadedBytes,
      totalBytes: assets.totalBytes
    });
    if (veilPollRef.current) window.clearInterval(veilPollRef.current);
    if (veilTimeoutRef.current) window.clearTimeout(veilTimeoutRef.current);
    const finish = (timedOut: boolean) => {
      if (veilPollRef.current) {
        window.clearInterval(veilPollRef.current);
        veilPollRef.current = null;
      }
      if (veilTimeoutRef.current) {
        window.clearTimeout(veilTimeoutRef.current);
        veilTimeoutRef.current = null;
      }
      /* v2.2: build the run BEHIND the veil, then fade it two frames
      *  later — arena construction + the first (shader-compiling) render
      *  used to jank visibly right as the veil faded; now the veil
      *  absorbs them. */
      launchRun(veilSeedRef.current);
      requestAnimationFrame(() => requestAnimationFrame(() => setVeil(null)));
      if (timedOut) {
        useRiftStore.getState().showBanner("FALLBACK RAIMENT", "Some relics slumber — procedural art carries the run", "#f5c96b");
      }
    };
    veilPollRef.current = window.setInterval(() => {
      const a = readAssetGate();
      if (!a || a.ready === true) {
        finish(false);
        return;
      }
      if (typeof a.progress === "number") {
        const now = performance.now();
        if (a.progress !== veilStallRef.current.last) {
          veilStallRef.current = {
            last: a.progress,
            at: now
          };
        }
        const stuck = now - veilStallRef.current.at > 2500; // not moving → pulse
        setVeil(v => v && (v.progress !== a.progress || v.indeterminate !== stuck || v.loadedBytes !== a.loadedBytes) ? {
          progress: a.progress as number,
          indeterminate: stuck,
          loadedBytes: a.loadedBytes,
          totalBytes: a.totalBytes
        } : v);
      } else {
        setVeil(v => v && !v.indeterminate ? {
          ...v,
          indeterminate: true
        } : v);
      }
    }, 120);
    veilTimeoutRef.current = window.setTimeout(() => finish(true), 30000);
  }, [launchRun]);
  /* veil timers never outlive the shell */
  useEffect(() => () => {
    if (veilPollRef.current) window.clearInterval(veilPollRef.current);
    if (veilTimeoutRef.current) window.clearTimeout(veilTimeoutRef.current);
  }, []);
  const toMenu = useCallback(() => {
    engineRef.current?.stopRun();
    const st = useRiftStore.getState();
    st.setScreen("menu");
    st.clearRunState();
    sfx.musicMenu();
  }, []);
  /* ------------------------------ engine boot ----------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const store = useRiftStore.getState();
    const engine = new RiftEngine(canvas, {
      callbacks: {
        onPhase: p => useRiftStore.getState().setPhase(p),
        onHud: snap => {
          lastHudSnapshot = snap;
          hudApplyRef.current?.(snap);
          /* v2.2: touch meters + ambience wave tracking ride the SAME 30 Hz
          push, throttled to ~4 Hz — the retired 250 ms interval poll is gone
          (scope report §4.4: event-driven, no redundant renders when idle,
          strictly fresher than the poll it replaces). */
          const now = performance.now();
          if (now - lastHudTickAt >= 250) {
            lastHudTickAt = now;
            setHudTick(snap);
          }
          /* crash-snapshot wave telemetry (v2.2) */
          (window as unknown as { __archmageLastWave?: number }).__archmageLastWave = snap.wave;
        },
        onBanner: (title, sub, color) => useRiftStore.getState().showBanner(title, sub, color),
        onGate: offer => useRiftStore.getState().setGateOffer(offer),
        onSpellOffer: offer => useRiftStore.getState().setSpellOffer(offer),
        onMerge: offer => useRiftStore.getState().setMergeOffer(offer),
        onEvolve: offer => useRiftStore.getState().setEvolveOffer(offer),
        onStats: stats => useRiftStore.getState().applyRunResult(stats),
        onCombo: key => useRiftStore.getState().addComboFound(key),
        onEnemySeen: type => useRiftStore.getState().addEnemySeen(type),
        onBossSeen: id => useRiftStore.getState().addBossSeen(id),
        onSpellSeen: id => useRiftStore.getState().addSpellSeen(id)
      },
      sfx: sfx,
      settings: store.meta.settings
    });
    engine.setSettings(store.meta.settings);
    engineRef.current = engine;
    setEngineInput(engine.input);
    if (damageLayerRef.current) engine.attachDamageLayer(damageLayerRef.current);
    /* v2.2 BOOT VEIL: hold the reveal behind "Summoning the Rift" while the
    *  essential tier (sprites + the player's models + the clip bank) streams
    *  — the menu never paints over a GLB parse storm, and slow first visits
    *  get an honest, byte-accurate loading screen instead of a silent fill.
    *  Falls through at 6s (the game is fully playable procedurally) and the
    *  tier gate itself settles in well under a second on warm caches. */
    const gate = (engine as unknown as { assets?: { essentialsReady?: boolean; progress?: number; loadedBytes?: number; totalBytes?: number } }).assets;
    if (gate && gate.essentialsReady !== true) {
      setVeil({
        progress: typeof gate.progress === "number" ? gate.progress : null,
        indeterminate: typeof gate.progress !== "number",
        boot: true,
        loadedBytes: gate.loadedBytes,
        totalBytes: gate.totalBytes
      });
      const bootPoll = window.setInterval(() => {
        const g = (engineRef.current as unknown as { assets?: { essentialsReady?: boolean; progress?: number; loadedBytes?: number; totalBytes?: number } } | null)?.assets;
        if (!g || g.essentialsReady === true) {
          window.clearInterval(bootPoll);
          window.clearTimeout(bootCap);
          setVeil(v => v?.boot ? null : v);
        } else if (typeof g.progress === "number") {
          setVeil(v => v?.boot && (v.progress !== g.progress || v.loadedBytes !== g.loadedBytes) ? {
            ...v,
            progress: g.progress as number,
            loadedBytes: g.loadedBytes,
            totalBytes: g.totalBytes
          } : v);
        }
      }, 120);
      const bootCap = window.setTimeout(() => {
        window.clearInterval(bootPoll);
        setVeil(v => v?.boot ? null : v);
      }, 6000);
      /* the engine-boot effect's cleanup disposes the engine; the two boot
      *  timers are cleaned here so a fast unmount strands nothing. */
      bootTimersRef.current = () => {
        window.clearInterval(bootPoll);
        window.clearTimeout(bootCap);
      };
    }
    /* ui bridge handlers (screens.tsx exports the mutable `ui` object) */
    ui.onStartRun = seed => {
      startRun(seed);
      /* 10-a — proper randomization for each run: once a rift is entered, the
      seed field rolls the NEXT rift (a fresh shuffle → fresh ground every
      act in auto mode). Game-over Retry keeps its seed: a deliberate replay. */
      useRiftStore.getState().setSeed(randomSeedString());
    };
    ui.onGameOverRetry = seed => startRun(seed);
    ui.onGameOverMenu = () => toMenu();
    ui.onCreditsReturn = () => {
      engine.continueEndless(false);
      toMenu();
    };
    ui.onCreditsFight = () => {
      engine.continueEndless(true);
      useRiftStore.getState().clearRunState();
    };
    /* R-03 (v2.0): apply the PERSISTED mute state before the first music
       request — a game muted in a previous session must stay silent through
       the first post-reload gesture (the Sfx entry-point guards then keep
       every later request gated until unmute). */
    sfx.setMuted(store.meta.settings.muted);
    sfx.musicMenu();
    return () => {
      bootTimersRef.current?.();
      bootTimersRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);
  /* --------------------- HUD mirror (v2.2: event-driven) ------------------ */ /* The old 250 ms interval poll is retired: the touch meters, ambience
                                                                                  act tracking and the pause HUD all read `hudTick`, which now updates
                                                                                  from the engine's 30 Hz push throttled to ~4 Hz (see onHud above).
                                                                                  Identical update budget, zero idle renders, fresher data. */
  /* ------------------------------ settings sync --------------------------- */
  const settings = useRiftStore(s => s.meta.settings);
  useEffect(() => {
    engineRef.current?.setSettings(settings);
    /* R-03: every settings change re-asserts mute FIRST (idempotent inside
       Sfx) so volume sliders can never bypass it, and the M-key toggle lands
       here through patchSettings like the modal switch does. */
    sfx.setMuted(settings.muted);
    sfx.setVolumes(settings.master, settings.music, settings.sfx, settings.ambience);
  }, [settings]);
  /* ------------------------------ ambience mood --------------------------- */ /* Biome wind follows the run: act index derived from the HUD wave mirror
                                                                                 (content.ts ACTS bands: waves 1-10 → 0 … 51+ → 5 — identical to
                                                                                 actForWave().id-1). Menu = soft act-0 wind; death/credits = stillness.
                                                                                 Pure store/audio wiring — no engine changes. */
  const ambienceActRef = useRef<number | null>(null);
  /* ------------------------- v2.2 overlay music ducking ------------------- */
  /* Duck the music ≈−6 dB whenever an in-run overlay is open (gate / offer /
     merge / evolve / pause) and restore on resume — one factor inside the
     audio synth, so toggling never stacks envelopes (scope report §7). */
  useEffect(() => {
    const overlayOpen = phase === "gate" || phase === "offer" || phase === "merge" || phase === "evolve" || phase === "paused";
    sfx.duckMusic(overlayOpen);
  }, [phase]);
  useEffect(() => {
    const running = phase === "playing" || phase === "paused" || phase === "gate" || phase === "offer" || phase === "merge" || phase === "evolve";
    if (running) {
      const wave = hudTick?.wave ?? 1;
      const act = Math.min(5, Math.max(0, Math.floor((Math.max(1, wave) - 1) / 10)));
      if (ambienceActRef.current !== act) {
        ambienceActRef.current = act;
        sfx.setAmbienceMood(act);
      }
    } else if (phase === "menu") {
      if (ambienceActRef.current !== -2) {
        ambienceActRef.current = -2;
        sfx.setAmbienceMood(0, 0.55); // soft menu wind (act-0 preset, lower level)
      }
    } else if (phase === "gameover" || phase === "credits") {
      if (ambienceActRef.current !== -1) {
        ambienceActRef.current = -1;
        sfx.setAmbienceMood(null); // the rift falls silent
      }
    }
  }, [phase, hudTick]);
  /* ------------------------------ input wiring ---------------------------- */
  useEffect(() => {
    const keyState = new Set<string>();
    const syncMove = () => {
      const e = engineRef.current;
      if (!e) return;
      const x = (keyState.has("d") || keyState.has("arrowright") ? 1 : 0) - (keyState.has("a") || keyState.has("arrowleft") ? 1 : 0);
      const z = (keyState.has("s") || keyState.has("arrowdown") ? 1 : 0) - (keyState.has("w") || keyState.has("arrowup") ? 1 : 0);
      e.input.moveX = x;
      e.input.moveZ = z;
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      if (!e) return;
      /* Editable controls own their keys (audit P2-4): bail BEFORE any
      preventDefault or game action, so caret movement works in the seed
      field and typing "m"/"1"/"q"/"e"/"f"/space never toggles mute, selects
      spells or blinks. Escape is deliberately NOT special-cased: while
      typing, the game's pause/escape branch is simply skipped — press
      Escape again after leaving the field to pause. Because keydown never
      adds to keyState for these targets, keyup has nothing to strand. */
      if (isEditableTarget(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "f3"].includes(k)) ev.preventDefault();
      /* F3 — performance overlay (plan §9 HUD #6). Fixed debug key: works in
      menus AND during a run, lives outside any remap UI, and flips the SAME
      persisted setting as the Settings row (patchSettings → engine
      setSettings creates/destroys the panel live — no run restart). */
      if (k === "f3") {
        if (ev.repeat) return;
        sfx.resume();
        const st = useRiftStore.getState();
        st.patchSettings({
          perfOverlay: !st.meta.settings.perfOverlay
        });
        sfx.click();
        return;
      }
      if (ev.repeat) {
        syncMove();
        return;
      }
      sfx.resume();
      if (k === "p" || k === "escape") {
        /* R-06: while a modal dialog is open (Settings, save-slot confirm),
        its own Escape handling closes the dialog — the global pause toggle
        must NOT leak through the modal and unpause the run behind it. */
        if (typeof document !== "undefined" && document.querySelector('[role="dialog"]')) return;
        const ph = useRiftStore.getState().phase;
        if (ph === "playing" || ph === "paused") {
          /* direct call — input edges are only consumed while the sim steps,
          which would deadlock the unpause path */
          e.togglePause();
        }
        return;
      }
      if (k === "m") {
        const st = useRiftStore.getState();
        st.patchSettings({
          muted: !st.meta.settings.muted
        });
        return;
      }
      keyState.add(k);
      syncMove();
      /* R-06: one-shot gameplay edges arm ONLY while actually playing — a
      key pressed in a menu, pause or overlay can never queue a cast/blink/
      cycle that fires the instant the run resumes. Movement keys stay
      tracked (holding W through an overlay is natural); held-state leaks
      are cleared by the phase-transition effect below. */
      if (useRiftStore.getState().phase !== "playing") return;
      if (k === "1") e.input.select = 0;
      if (k === "2") e.input.select = 1;
      if (k === "3") e.input.select = 2;
      if (k === "q") e.input.cycle = -1;
      if (k === "e") e.input.cycle = 1;
      if (k === " ") e.input.blink = true;
      if (k === "f") e.input.surge = true;
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      /* Always release the key (audit P2-4). Keys typed into an editable
      control were never added to keyState (keydown early-returns for those
      targets), so this delete is a no-op for them — and if focus entered a
      control WHILE a movement key was held, this still clears it instead
      of stranding the player. keyup triggers no game actions, so no
      editable-target guard is needed here. */
      keyState.delete(ev.key.toLowerCase());
      syncMove();
    };
    const onBlur = () => {
      keyState.clear();
      const e = engineRef.current;
      if (e) {
        e.input.moveX = 0;
        e.input.moveZ = 0;
        e.input.castHeld = false;
        e.input.volleyHeld = false;
        e.input.blink = false;
        e.input.surge = false;
        e.input.cycle = 0;
        e.input.select = -1;
      }
    };
    /* R-06: tab hidden → same full release (the engine separately
    auto-pauses a live run). Pointer cancellation (touch interrupted by a
    system gesture) → drop the held cast/volley so the mage does not keep
    firing after the finger is gone. */
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
    const onPointerCancel = () => {
      const e = engineRef.current;
      if (e) {
        e.input.castHeld = false;
        e.input.volleyHeld = false;
      }
    };
    const onMouseMove = (ev: MouseEvent) => {
      const e = engineRef.current;
      if (!e) return;
      const p = e.screenToGround(ev.clientX, ev.clientY);
      e.input.aimX = p.x;
      e.input.aimZ = p.z;
      e.noteMouseAim();
    };
    const onMouseDown = (ev: MouseEvent) => {
      const e = engineRef.current;
      if (!e) return;
      sfx.resume();
      /* R-06: button holds are gameplay input — only arm them while a run
      is live; a click that lands on a paused/overlay backdrop must not
      queue a cast that fires on resume. */
      if (useRiftStore.getState().phase !== "playing") return;
      if (ev.button === 0) e.input.castHeld = true;
      if (ev.button === 2) e.input.volleyHeld = true;
    };
    const onMouseUp = (ev: MouseEvent) => {
      const e = engineRef.current;
      if (!e) return;
      if (ev.button === 0) e.input.castHeld = false;
      if (ev.button === 2) e.input.volleyHeld = false;
    };
    /* R-06: the context menu is suppressed across the WHOLE game root —
    title, menus, play, pause, gate/offer/merge overlays, game over and
    credits (the game root is the fixed viewport, so this is effectively
    the entire document of the single-route app). The ONLY exception is a
    real editable control (seed input, dialogs): those keep their native
    clipboard/spell-check menu. This cannot and does not attempt to block
    OS/browser shortcuts or tab close — those stay with the user. */
    const onContext = (ev: MouseEvent) => {
      if (isEditableTarget(ev.target)) return;
      ev.preventDefault();
    };
    /* R-06: accidental drags (spell icons, GLB thumbnails) go nowhere. */
    const onDragStart = (ev: DragEvent) => {
      if (isEditableTarget(ev.target)) return;
      ev.preventDefault();
    };
    const onWheel = (ev: WheelEvent) => {
      const e = engineRef.current;
      if (!e) return;
      /* Spell cycling via wheel is a gameplay gesture only (audit P2-4):
      intercept (preventDefault + cycle) while a run is live AND the cursor
      is over the gameplay surface; everywhere else the wheel keeps its
      native meaning — menus/dialogs/codices scroll again. */
      if (!isGameplayGesture(ev.target)) return;
      ev.preventDefault();
      e.input.cycle = ev.deltaY > 0 ? 1 : -1;
    };
    const onTouchStart = () => setTouchLatched(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("wheel", onWheel, {
      passive: false
    });
    window.addEventListener("touchstart", onTouchStart, {
      passive: true
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("dragstart", onDragStart);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("dragstart", onDragStart);
    };
  }, []);
  /* --------------------- phase-transition input reset (R-06) -------------- */ /* Whenever the game LEAVES active play — an overlay opens, pause, death,
                                                                                *  abandon — every held/queued input on the engine is dropped so nothing
                                                                                *  can leak through the modal and fire on resume. The engine's own input
                                                                                *  edges are one-shot; clearing them here makes a stale Space/Q/E press
                                                                                *  harmless. */
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (prevPhaseRef.current === "playing" && phase !== "playing") {
      const e = engineRef.current;
      if (e) {
        e.input.moveX = 0;
        e.input.moveZ = 0;
        e.input.castHeld = false;
        e.input.volleyHeld = false;
        e.input.blink = false;
        e.input.surge = false;
        e.input.cycle = 0;
        e.input.select = -1;
      }
    }
    prevPhaseRef.current = phase;
  }, [phase]);
  /* --------------------- unified touch detection (v2.2) ------------------ */ /* ONE live pointer:coarse capability service (capability.ts) composed with
                                                                                  a one-shot touchstart latch — the latch is the hybrid-laptop upgrade
                                                                                  path (touchscreen attached, mouse primary): the first real touch
                                                                                  flips the thumb layer on without waiting for an OS pointer switch.
                                                                                  The divergent latched-only detector is retired (scope report §4.3). */
  const coarsePointer = usePointerCoarse();
  const touchMode = coarsePointer || touchLatched;
  /* ------------------------------ gamepad aware --------------------------- */ /* The engine polls pads itself every frame; the shell only tracks presence
                                                                                 for the hint strip + banner feedback (a pad counts once the user presses
                                                                                 a button on it — that's when browsers fire gamepadconnected). */
  useEffect(() => {
    const onPadConnect = () => {
      setGamepadOn(true);
      sfx.resume();
      sfx.play("offer", {
        intensity: 0.6
      });
      useRiftStore.getState().showBanner("GAMEPAD BOUND", "Sticks move & aim · RT cast · LT volley · A blink · X spell · Y surge · Start pause", "#43e8d8");
    };
    const onPadDisconnect = () => {
      /* another pad may still be connected — ask the browser, don't assume */const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() ?? [] : [];
      const stillOn = Array.from(pads).some(p => !!p);
      setGamepadOn(stillOn);
      if (!stillOn) {
        useRiftStore.getState().showBanner("GAMEPAD LOST", "The pad goes silent — keys & mouse stand ready", "#ff4d6b");
      }
    };
    window.addEventListener("gamepadconnected", onPadConnect);
    window.addEventListener("gamepaddisconnected", onPadDisconnect);
    return () => {
      window.removeEventListener("gamepadconnected", onPadConnect);
      window.removeEventListener("gamepaddisconnected", onPadDisconnect);
    };
  }, []);
  const inRun = phase === "playing" || phase === "paused" || phase === "gate" || phase === "offer" || phase === "merge" || phase === "evolve";
  return (
    /* tabIndex makes the game root an explicit focusable game-control region
    (audit P2-4 recommended fix): keyboard users get a clear anchor for the
    bindings; the browser's own :focus-visible heuristic keeps the outline
    keyboard-only, so it never clashes with the design on click.
    v2.1.1: MotionConfig(reducedMotion:"user") wraps the whole tree — framer
    disables transform animations (staggered entrances, lifts) for
    prefers-reduced-motion users while keeping opacity fades; CSS loops were
    already gated in globals.css. */
    <MotionConfig reducedMotion="user">
    <div data-hud-density={hudDensity} className="fixed inset-0 overflow-hidden bg-[#0a0812] text-white" tabIndex={0} data-archmage-game-root aria-label="ARCHMAGE: RIFTBOUND — 3D Edition game view — WASD move, mouse aim, left click cast, right click volley, Space blink, F surge, P pause">{<canvas ref={canvasRef} data-game-surface className="absolute inset-0 h-full w-full touch-none" />}{<div ref={damageLayerRef} className="pointer-events-none absolute inset-0" />}{inRun && <HUD register={registerHud} vignetteScale={vignette} />}{<Banner />}{gateOffer && <TributeGateOverlay choices={gateOffer.choices} wave={gateOffer.wave} onPick={id => engineRef.current?.resolveGate(id)} />}{spellOffer && <SpellOfferOverlay pool={spellOffer.pool} equipped={spellOffer.equipped} onPick={(el, slot) => engineRef.current?.resolveSpellOffer(el as ElementId, slot)} onSkip={() => engineRef.current?.resolveSpellOffer(null, -1)} />}{mergeOffer && <MergeOverlay offer={mergeOffer} onMerge={(a, b) => engineRef.current?.resolveMerge(a, b)} />}{evolveOffer && <EvolveOverlay offer={evolveOffer} onPick={evoId => engineRef.current?.resolveEvolution(evoId)} />}{phase === "paused" && <PauseOverlay hud={hudTick ?? undefined} onResume={() => engineRef.current?.resume()} onAbandon={toMenu} onSettings={() => useRiftStore.getState().openSettings()} />}{touchMode && inRun && phase === "playing" && engineInput && <TouchControls input={engineInput} visible mirrored={leftHanded} tapToCast={tapToCast} surge={hudTick?.surge ?? 0} castCd={hudTick ? 1 - (hudTick.cooldowns[hudTick.selected] ?? 0) : 0} blinkCd={hudTick?.blinkCd ?? 1} />}{<MainMenu />}{<ReliquaryScreen />}{<ArcanumScreen />}{<GameOverScreen />}{<VictoryCredits />}{<SettingsModal />}{<ImmersiveManager engineRef={engineRef} />}{<CrashSnapshot />}{<AnimatePresence>{veil && <LoadingVeil progress={veil.progress} indeterminate={veil.indeterminate} boot={veil.boot} loadedBytes={veil.loadedBytes} totalBytes={veil.totalBytes} key={"veil"} />}</AnimatePresence>}{phase === "playing" && !touchMode && (gamepadOn ? <div className="safe-b pointer-events-none absolute bottom-1.5 left-1/2 hidden -translate-x-1/2 gap-2 text-[10px] font-bold uppercase tracking-widest text-white/50 sm:flex">{<span>Sticks move/aim</span>}{<span>·</span>}{<span>RT cast</span>}{<span>·</span>}{<span>LT volley</span>}{<span>·</span>}{<span>A blink</span>}{<span>·</span>}{<span>X spell</span>}{<span>·</span>}{<span>Y surge</span>}{<span>·</span>}{<span>Start pause</span>}</div> : <div className="safe-b pointer-events-none absolute bottom-1.5 left-1/2 hidden -translate-x-1/2 gap-2 text-[10px] font-bold uppercase tracking-widest text-white/50 sm:flex">{<span>WASD move</span>}{<span>·</span>}{<span>LMB cast</span>}{<span>·</span>}{<span>RMB volley</span>}{<span>·</span>}{<span>Space blink</span>}{<span>·</span>}{<span>F surge</span>}{<span>·</span>}{<span>P pause</span>}</div>)}</div>
    </MotionConfig>
  );
}
/* ------------------------------------------------------------------ */ /*  LOADING VEIL (v2.2) — two stages, one look:                       */ /*  · BOOT  "Summoning the Rift" — holds the menu reveal while the     */ /*    essential asset tier streams (byte-accurate, 6s cap).           */ /*  · RUN   "Attuning the Rift" — holds a run click while the rest    */ /*    of the relics stream (30s ceiling, then procedural fallback).    */ /*  Rune spinner halts under prefers-reduced-motion (globals.css kills */ /*  .animate-spin → static sigil); the indeterminate bar pulses via    */ /*  .rift-pulse-gold (also reduced-motion aware). Fits 390px.          */ /* ------------------------------------------------------------------ */function LoadingVeil({
  progress,
  indeterminate,
  boot,
  loadedBytes,
  totalBytes
}: {
  progress: number | null;
  indeterminate: boolean;
  boot?: boolean;
  loadedBytes?: number;
  totalBytes?: number;
}) {
  const shown = !indeterminate && typeof progress === "number" ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;
  const mb = typeof loadedBytes === "number" && typeof totalBytes === "number" && totalBytes > 0 ? `${(loadedBytes / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB` : null;
  return <motion.div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-[#0a0812] px-6" initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0,
    transition: {
      duration: 0.35
    }
  }} transition={{
    duration: 0.2
  }} role="status" aria-live="polite" aria-label={boot ? "Summoning the rift — loading the essentials" : "Attuning the rift — summoning relics"}>{<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<div className="absolute left-1/2 top-1/2 h-[52vh] w-[82vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9a7bff] opacity-[0.08] blur-[120px]" />}{<div className="absolute bottom-[-18%] right-[-10%] h-[42vh] w-[52vw] rounded-full bg-[#43e8d8] opacity-[0.05] blur-[130px]" />}{<div className="absolute left-[-12%] top-[-14%] h-[38vh] w-[48vw] rounded-full bg-[#d05bff] opacity-[0.05] blur-[130px]" />}</div>}{<div className="safe-b-4 relative flex w-full max-w-xs flex-col items-center gap-6 py-10 text-center">{<svg className="size-16 animate-spin text-[#f5c96b]" viewBox="0 0 64 64" fill="none" aria-hidden>{<circle cx="32" cy="32" r="29" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />}{<path d="M32 3a29 29 0 0 1 29 29" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />}{<circle cx="32" cy="32" r="13" stroke="#9a7bff" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="3 6" />}{<circle cx="32" cy="32" r="4.5" fill="#f5c96b" fillOpacity="0.75" />}</svg>}{<div>{<div className="font-display text-lg font-black uppercase tracking-[0.28em] text-[#f5e3b3] [text-shadow:0_0_26px_rgba(245,201,107,0.45)] sm:text-xl">{boot ? "Summoning the Rift" : "Attuning the Rift"}</div>}{<div className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.3em] text-[#9a7bff]">{boot ? "The essentials arrive" : "Summoning relics"}</div>}{<div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">{boot ? "sprites · the mage · the clip bank" : "mage · staff · bestiary · spell icons"}</div>}</div>}{<div className="w-full">{<div className="h-1 w-full overflow-hidden rounded-full bg-white/10">{shown !== null ? <div className="h-full rounded-full bg-[#f5c96b] shadow-[0_0_12px_rgba(245,201,107,0.55)] transition-[width] duration-200" style={{
            width: `${shown}%`
          }} /> : <div className="rift-pulse-gold h-full w-full rounded-full bg-[#f5c96b]/60" />}</div>}{<div className="mt-2 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">{shown !== null ? <span>{shown}%{mb && <span className="text-white/30">{` · ${mb}`}</span>}</span> : "channeling…"}</div>}</div>}</div>}</motion.div>;
}
/* the engine pushes snapshots at 30 Hz through callbacks; keep the last one
   around for the low-rate touch meter mirror */
let lastHudSnapshot: HudSnapshot | null = null;
/* v2.2: throttle timestamp for the event-driven hudTick mirror (see onHud). */
let lastHudTickAt = 0;