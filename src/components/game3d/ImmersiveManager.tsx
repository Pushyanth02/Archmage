"use client";

/* ARCHMAGE: RIFTBOUND (3D Edition) — v2.1 cross-device immersion layer.
 *
 * MISSION (product brief): "snap all devices to landscape mode upon opening
 * the game — no manual settings, no manual fullscreen, no manual rotate."
 *
 * HOW, per platform capability:
 *   1. TOUCH-PRIMARY DEVICES (pointer: coarse — phones & tablets):
 *      - The FIRST user gesture anywhere in the game triggers AUTO-IMMERSIVE:
 *        requestFullscreen() on the game root, then
 *        screen.orientation.lock("landscape"). On Android Chrome/Edge/Firefox
 *        this physically rotates + fullscreens the device in one tap —
 *        the "manual settings → fullscreen → rotate" ritual is gone.
 *      - Platforms that forbid the lock (iOS Safari has no
 *        screen.orientation.lock) get the PORTRAIT GATE: whenever the device
 *        holds the game in portrait, a full-screen "rotate to enter the rift"
 *        prompt takes over; a live run auto-pauses behind it and auto-resumes
 *        the moment the device returns to landscape.
 *   2. DESKTOP / FINE-POINTER DEVICES: untouched. Fullscreen stays a manual
 *      toggle in Settings (a laptop is already landscape; auto-locking the
 *      orientation of a non-rotating screen is meaningless).
 *   3. INSTALLED PWA: the manifest (public/manifest.webmanifest) declares
 *      display:"fullscreen" + orientation:"landscape", so an installed app
 *      opens pre-snapped on every platform — including iOS home-screen apps.
 *
 * Everything is opt-out: Settings → Display → "Auto immersive" (persisted per
 * save slot like every other setting). With it off, the game behaves exactly
 * as v2.0 did (responsive layout, manual fullscreen, no gate).
 *
 * Implementation notes:
 *   - Orientation + fullscreen state are tracked with useSyncExternalStore
 *     over matchMedia / fullscreenchange — no polling, SSR-safe snapshots.
 *   - requestImmersive() must run inside a user gesture (browsers demand it);
 *     it is idempotent and never throws (all failures resolve to the gate).
 *   - The engine is driven ONLY through its public phase-guarded pause() /
 *     resume(); we never poke the simulation directly.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { Maximize2, RotateCcw, Smartphone } from "lucide-react";
import type { RiftEngine } from "@/game3d/engine";
import { useRiftStore } from "@/game3d/store";
import { cn } from "@/lib/utils";

/* ------------------------- capability detection ------------------------- */

interface OrientationCapable {
  lock?: (orientation: "landscape" | "portrait" | "any") => Promise<void>;
  unlock?: () => void;
}
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  webkitIsFullScreen?: boolean;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** True when the PRIMARY pointer is coarse (finger) — phones & tablets.
 *  Touch-capable laptops with a mouse remain fine-pointer and are excluded
 *  from auto-immersive on purpose (their screens do not rotate). */
function subscribePointer(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function coarsePointerSnapshot(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribePointer,
    coarsePointerSnapshot,
    () => false, // SSR: assume desktop; the client snapshot corrects on hydrate
  );
}

/* --------------------------- orientation state -------------------------- */

function subscribeOrientation(cb: () => void) {
  const mq = window.matchMedia("(orientation: portrait)");
  mq.addEventListener("change", cb);
  /* Some browsers lag matchMedia on rotation; orientationchange + a delayed
   * re-check covers the stragglers (the callback is idempotent). */
  const recheck = () => {
    cb();
    window.setTimeout(cb, 120);
  };
  window.addEventListener("orientationchange", recheck);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("orientationchange", recheck);
  };
}
function portraitSnapshot(): boolean {
  return window.matchMedia("(orientation: portrait)").matches;
}
function usePortrait(): boolean {
  return useSyncExternalStore(
    subscribeOrientation,
    portraitSnapshot,
    () => false,
  );
}

/* --------------------------- fullscreen state ---------------------------- */

function fsElementLive(): boolean {
  const d = document as FullscreenDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement || d.webkitCurrentFullScreenElement || d.webkitIsFullScreen);
}
function subscribeFullscreen(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}
function useFullscreenActive(): boolean {
  return useSyncExternalStore(subscribeFullscreen, fsElementLive, () => false);
}

/* ------------------------------ the manager ----------------------------- */

export interface ImmersiveManagerProps {
  /** Live engine ref (pause/resume behind the portrait gate). */
  engineRef: RefObject<RiftEngine | null>;
}

export function ImmersiveManager({ engineRef }: ImmersiveManagerProps) {
  const coarse = useCoarsePointer();
  const portrait = usePortrait();
  const fsActive = useFullscreenActive();
  const autoImmersive = useRiftStore(s => s.meta.settings.autoImmersive ?? true);
  const [lockSupported] = useState<boolean>(() =>
    typeof screen !== "undefined" && typeof (screen.orientation as OrientationCapable | undefined)?.lock === "function",
  );
  /* Set when THIS component's gate paused a live run — only then may it
   * auto-resume (a player who paused manually stays paused after rotating). */
  const gatePausedRef = useRef(false);

  /** Fullscreen + landscape-lock attempt. MUST be called from a user gesture;
   *  every failure path is swallowed (the gate is the universal fallback). */
  const requestImmersive = useCallback(async () => {
    if (typeof document === "undefined") return;
    const doc = document as FullscreenDocument;
    if (!fsElementLive()) {
      const el = document.documentElement as FullscreenElement;
      try {
        if (typeof el.requestFullscreen === "function") {
          await el.requestFullscreen({ navigationUI: "hide" });
        } else if (typeof el.webkitRequestFullscreen === "function") {
          await el.webkitRequestFullscreen();
        }
      } catch {
        /* refused (iframe policy / iOS) — the gate covers portrait anyway */
      }
    }
    const so = typeof screen !== "undefined" ? (screen.orientation as OrientationCapable | undefined) : undefined;
    if (typeof so?.lock === "function") {
      try {
        await so.lock("landscape");
      } catch {
        /* not allowed / unsupported context — portrait gate remains armed */
      }
    }
  }, []);

  /* AUTO-IMMERSIVE: the first gesture on a touch-primary device snaps the
   * game into fullscreen landscape — this is the "open the game and play"
   * promise. Any pointerdown counts (menu tap, BEGIN, anywhere): browsers
   * only allow these APIs from inside a gesture, so we latch onto the first
   * one and never nag again (manual controls stay in Settings). */
  useEffect(() => {
    if (!coarse || !autoImmersive) return;
    const onFirstGesture = () => {
      void requestImmersive();
      /* one shot per mount — a refusal (e.g. iOS) must not spam retries on
       * every subsequent tap; the gate's button offers an explicit retry */
      window.removeEventListener("pointerdown", onFirstGesture, true);
      done = true;
    };
    let done = false;
    window.addEventListener("pointerdown", onFirstGesture, true);
    return () => {
      if (!done) window.removeEventListener("pointerdown", onFirstGesture, true);
    };
  }, [coarse, autoImmersive, requestImmersive]);

  /* Re-assert the snap whenever a fresh run starts while already touched-in
   * but not immersive (e.g. fullscreen was exited between runs on a phone):
   * startRun flows through user gestures (menu BEGIN / retry), so the call
   * is legally inside a gesture. */
  const phase = useRiftStore(s => s.phase);
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (prevPhaseRef.current !== "playing" && phase === "playing" && coarse && autoImmersive && !fsActive) {
      void requestImmersive();
    }
    prevPhaseRef.current = phase;
  }, [phase, coarse, autoImmersive, fsActive, requestImmersive]);

  /* ------------------------- portrait gate logic ------------------------ */
  const gateVisible = coarse && autoImmersive && portrait;

  /* Auto-pause a live run behind the gate; auto-resume on return to
   * landscape — but ONLY runs the gate itself paused. Engine calls are
   * phase-guarded on both sides, so double-fires are harmless. */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (gateVisible) {
      if (useRiftStore.getState().phase === "playing") {
        engine.pause();
        gatePausedRef.current = true;
      }
    } else if (gatePausedRef.current) {
      gatePausedRef.current = false;
      if (useRiftStore.getState().phase === "paused") engine.resume();
    }
  }, [gateVisible, engineRef]);

  /* Zero held inputs while gated — same contract as every other overlay
   * (a finger mid-cast when the device rotates must not strand input). */
  useEffect(() => {
    if (!gateVisible) return;
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
  }, [gateVisible, engineRef]);

  if (!gateVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-[#0a0812]/96 px-8 py-10 text-center backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-label="Rotate your device — the rift opens in landscape"
    >
      {/* ambient rift glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[54vh] w-[88vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9a7bff] opacity-[0.09] blur-[110px]" />
        <div className="absolute bottom-[-16%] right-[-8%] h-[36vh] w-[46vw] rounded-full bg-[#43e8d8] opacity-[0.05] blur-[120px]" />
      </div>

      {/* the rotating phone rite */}
      <div className="rift-rotate-hint relative flex h-28 w-28 items-center justify-center" aria-hidden>
        <div className="absolute inset-0 rounded-full border border-[#9a7bff]/25" />
        <div className="absolute inset-3 rounded-full border border-dashed border-[#f5c96b]/20" />
        <Smartphone className="size-12 text-[#f5c96b]" strokeWidth={1.5} />
      </div>

      <div className="relative">
        <div className="font-display text-xl font-black uppercase tracking-[0.3em] text-[#f5e3b3] [text-shadow:0_0_26px_rgba(245,201,107,0.45)] sm:text-2xl">
          Rotate to enter the rift
        </div>
        <p className="mx-auto mt-3 max-w-xs text-[11px] font-bold uppercase tracking-[0.22em] leading-relaxed text-[#9a7bff]">
          The rift opens wide — turn your device sideways
        </p>
      </div>

      <button
        type="button"
        onClick={() => void requestImmersive()}
        className={cn(
          "relative flex min-h-11 items-center gap-2.5 rounded-full border px-6 py-2.5",
          "border-[#43e8d8]/50 bg-[#43e8d8]/10 text-[11px] font-black uppercase tracking-[0.22em] text-[#43e8d8]",
          "transition-transform duration-75 active:scale-95 [-webkit-tap-highlight-color:transparent]",
        )}
        aria-label="Retry immersive fullscreen landscape mode"
      >
        {fsActive ? <RotateCcw className="size-4" /> : <Maximize2 className="size-4" />}
        {fsActive ? "Snap to landscape" : "Go immersive"}
      </button>

      <p className="relative max-w-xs text-[10px] leading-relaxed text-white/35">
        {lockSupported
          ? fsActive
            ? "Hold your device sideways to continue — the run resumes itself."
            : "Tap to fullscreen and lock landscape in one step. Your run pauses while portrait and resumes when you turn back."
          : "This browser will not lock orientation — turn sideways to continue. Add the game to your home screen for a landscape-first launch. The run pauses while portrait and resumes when you turn back."}
      </p>
    </div>
  );
}
