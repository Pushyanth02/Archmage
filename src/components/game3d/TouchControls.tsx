"use client";


import { useRef, useState, useEffect } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Crosshair, Repeat, Sparkles, Wind, Zap } from "lucide-react";
import type { InputState } from "@/game3d/types";
import { cn } from "@/lib/utils";

/* ARCHMAGE: RIFTBOUND (3D Edition) — twin-thumb touch layer for mobile.
   Rendered only while `visible` (GameShell decides via touch detection).
   Mutates the shared InputState object directly — zero re-renders per frame;
   stick visuals update via DOM refs.
   Semantics of numeric props:
     surge   0..1  charge fraction (1 = ready)
     castCd  0..1  REMAINING cooldown fraction (0 = ready, 1 = just fired)
     blinkCd 0..1  readiness (1 = ready) — matches HudSnapshot.blinkCd */

const STICK_RADIUS = 52; // px — max knob travel
const STICK_BASE = 104; // px — base ring diameter
export interface TouchControlsProps {
  input: InputState;
  visible: boolean;
  /** Surge charge 0..1 (1 = ready). */
  surge: number;
  /** Cast cooldown remaining 0..1 (0 = ready). */
  castCd: number;
  /** Blink readiness 0..1 (1 = ready). */
  blinkCd: number;
  /** Mirror the thumb cluster for left-handed play (v2.2). */
  mirrored?: boolean;
  /** One-thumb mode: cast aims along the move stick's direction (v2.2). */
  tapToCast?: boolean;
}
/* InputState is a shared mutable object owned by the engine (see types.ts —
   "mutated by GameShell/TouchControls each frame"). Mutations are routed
   through these helpers so the prop itself is never written directly
   (react-hooks/immutability-safe). */
function setMove(inp: InputState, x: number, z: number): void {
  inp.moveX = x;
  inp.moveZ = z;
}
function setHeld(inp: InputState, key: "castHeld" | "volleyHeld", v: boolean): void {
  inp[key] = v;
}
function zeroInput(inp: InputState): void {
  setMove(inp, 0, 0);
  setHeld(inp, "castHeld", false);
  setHeld(inp, "volleyHeld", false);
}
function fireEdge(inp: InputState, key: "blink" | "surge"): void {
  inp[key] = true; // engine clears edge flags each frame
}
function fireCycle(inp: InputState): void {
  inp.cycle = 1;
}
function setAimFromMove(inp: InputState, v: boolean): void {
  inp.aimFromMove = v;
}
export function TouchControls({
  input,
  visible,
  surge,
  castCd,
  blinkCd,
  mirrored = false,
  tapToCast = false
}: TouchControlsProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickElRef = useRef<HTMLDivElement>(null);
  const hintElRef = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const origin = useRef({
    x: 0,
    y: 0
  });
  const [stickPos, setStickPos] = useState({
    x: 84,
    y: 260
  }); // relative to zone
  /* Safety: zero held inputs whenever the layer hides or unmounts. */
  useEffect(() => {
    if (!visible) {
      zeroInput(input);
      stickPointer.current = null;
    }
  }, [visible, input]);
  useEffect(() => () => zeroInput(input), [input]);
  /* v2.2 one-thumb mode: flag lives on the shared InputState — the engine
     derives aim = player + moveDir*5 each step while this is true. */
  useEffect(() => {
    setAimFromMove(input, !!tapToCast);
    return () => {
      setAimFromMove(input, false);
    };
  }, [input, tapToCast]);
  /* ------------------------- left analog stick ------------------------ */
  const moveStick = (cx: number, cy: number) => {
    const dx = cx - origin.current.x;
    const dy = cy - origin.current.y;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, STICK_RADIUS);
    const nx = len === 0 ? 0 : dx / len * clamped;
    const ny = len === 0 ? 0 : dy / len * clamped;
    // Screen up (dy < 0) → moveZ -1 (forward). Screen right → moveX +1.
    setMove(input, nx / STICK_RADIUS, ny / STICK_RADIUS);
    if (knobRef.current) knobRef.current.style.transform = `translate(${nx}px, ${ny}px)`;
  };
  const onStickDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stickPointer.current !== null) return; // one anchor at a time
    e.preventDefault();
    stickPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = {
      x: e.clientX,
      y: e.clientY
    };
    const rect = zoneRef.current?.getBoundingClientRect();
    if (rect) setStickPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    if (stickElRef.current) stickElRef.current.style.opacity = "1";
    if (hintElRef.current) hintElRef.current.style.opacity = "0";
    moveStick(e.clientX, e.clientY);
  };
  const onStickMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickPointer.current) return;
    e.preventDefault();
    moveStick(e.clientX, e.clientY);
  };
  const releaseStick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickPointer.current) return;
    stickPointer.current = null;
    setMove(input, 0, 0);
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    if (stickElRef.current) stickElRef.current.style.opacity = "0";
    if (hintElRef.current) hintElRef.current.style.opacity = "1";
  };
  /* --------------------------- button helpers ------------------------- */ /** Hold-to-activate (cast / volley). Pointer capture keeps the press
                                                                             bound to this button even if the finger drifts off. */
  const holdHandlers = (key: "castHeld" | "volleyHeld") => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setHeld(input, key, true);
    },
    onPointerUp: () => {
      setHeld(input, key, false);
    },
    onPointerCancel: () => {
      setHeld(input, key, false);
    },
    onLostPointerCapture: () => {
      setHeld(input, key, false);
    }
  });
  /** One-shot edge-triggered tap (blink / surge / cycle). */
  const tapHandlers = (fire: () => void) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      fire();
    }
  });
  if (!visible) return null;
  const surgeReady = surge >= 1;
  const veil = Math.min(1, Math.max(0, castCd));
  /* v2.1 cross-device layout: every button's size AND position derives from
     the --tc-* viewport-scaled custom properties (globals.css §v2.1) so the
     cluster breathes with the device — compact on short landscape phones
     (~56-72px targets), chunkier on tall tablets (~74-96px), and always
     inset past env(safe-area-inset-*) for notched/home-bar edges. calc()+
     env() live in inline styles on purpose: Tailwind v4 cannot compile the
     env() fallback comma inside arbitrary values (globals.css footnote). */
  const EDGE = "var(--tc-edge)";
  const SAFE_B = "env(safe-area-inset-bottom, 0px)";
  const SAFE_R = "env(safe-area-inset-right, 0px)";
  const COL2 = `calc(${EDGE} + var(--tc-cast) + var(--tc-gap))`; // x of the second column
  return <div className="tc-root safe-b safe-x fixed inset-0 z-20 select-none [-webkit-touch-callout:none]" data-mirrored={mirrored ? "1" : "0"} onContextMenu={e => e.preventDefault()}>{<div ref={zoneRef} className="pointer-events-auto absolute bottom-0 left-0 h-[45%] w-[40%] touch-none" onPointerDown={onStickDown} onPointerMove={onStickMove} onPointerUp={releaseStick} onPointerCancel={releaseStick}>{<div ref={hintElRef} className="pointer-events-none absolute bottom-16 left-6 flex items-center justify-center rounded-full border border-dashed border-white/15 opacity-100 transition-opacity duration-300" style={{
        width: "var(--tc-hint)",
        height: "var(--tc-hint)"
      }}>{<span className="text-[9px] uppercase tracking-[0.35em] text-white/25">{tapToCast ? "Move · Aim" : "Move"}</span>}</div>}{<div ref={stickElRef} className="pointer-events-none absolute opacity-0 transition-opacity duration-200" style={{
        left: stickPos.x - STICK_BASE / 2,
        top: stickPos.y - STICK_BASE / 2,
        width: STICK_BASE,
        height: STICK_BASE
      }}>{<div className="flex h-full w-full items-center justify-center rounded-full border border-white/25 bg-black/55 shadow-[0_0_24px_rgba(0,0,0,0.5)]" style={{
          transform: "scale(var(--tc-stick, 1))"
        }}>{<div ref={knobRef} className="size-12 rounded-full border border-[#f5c96b]/70 bg-[#f5c96b]/25 shadow-[0_0_18px_rgba(245,201,107,0.4)]" />}</div>}</div>}</div>}{<div className="pointer-events-none absolute bottom-0 right-0 h-[58%] w-[60%]">{<TouchButton label="Hold to cast" title={tapToCast ? "Casts toward your move direction" : undefined} className="border-[#f5c96b]/60" style={{
        right: `calc(${EDGE} + ${SAFE_R})`,
        bottom: `calc(${EDGE} + ${SAFE_B})`,
        width: "var(--tc-cast)",
        height: "var(--tc-cast)"
      }} {...holdHandlers("castHeld")}>{<div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">{<div className="absolute inset-x-0 top-0 rounded-full bg-black/75" style={{
            height: `${veil * 100}%`,
            opacity: veil > 0.02 ? 1 : 0
          }} />}</div>}{<Crosshair className="relative size-8 text-[#f5c96b]" />}{<span className="relative text-[8px] font-bold uppercase tracking-[0.2em] text-[#f5c96b]/80">Cast</span>}</TouchButton>}{<TouchButton label="Hold to volley" className="border-[#9a7bff]/60" style={{
        right: `calc(${COL2} + ${SAFE_R})`,
        bottom: `calc(${EDGE} + 4px + ${SAFE_B})`,
        width: "var(--tc-btn)",
        height: "var(--tc-btn)"
      }} {...holdHandlers("volleyHeld")}>{<Zap className="size-6 text-[#9a7bff]" />}{<span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#9a7bff]/80">Volley</span>}</TouchButton>}{<TouchButton label="Blink" className="border-[#43e8d8]/60" style={{
        right: `calc(${EDGE} + ${SAFE_R})`,
        bottom: `calc(${EDGE} + var(--tc-cast) + 14px + ${SAFE_B})`,
        width: "var(--tc-btn)",
        height: "var(--tc-btn)",
        opacity: blinkCd >= 1 ? 1 : 0.4
      }} {...tapHandlers(() => {
        fireEdge(input, "blink");
      })}>{<Wind className="size-6 text-[#43e8d8]" />}{<span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#43e8d8]/80">Blink</span>}</TouchButton>}{<TouchButton label="Surge" className={cn("border-white/10", surgeReady && "border-[#43e8d8]/70 shadow-[0_0_26px_rgba(67,232,216,0.35)]")} style={{
        right: `calc(${COL2} + ${SAFE_R})`,
        bottom: `calc(${EDGE} + var(--tc-cast) + 20px + ${SAFE_B})`,
        width: "var(--tc-btn)",
        height: "var(--tc-btn)"
      }} {...tapHandlers(() => {
        fireEdge(input, "surge");
      })}>{<svg viewBox="0 0 68 68" className="pointer-events-none absolute inset-0 -rotate-90">{<circle cx="34" cy="34" r="30" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />}{<circle cx="34" cy="34" r="30" fill="none" stroke="#43e8d8" strokeWidth="3" strokeLinecap="round" strokeDasharray={2 * Math.PI * 30} strokeDashoffset={2 * Math.PI * 30 * (1 - Math.min(1, Math.max(0, surge)))} style={{
            filter: surgeReady ? "drop-shadow(0 0 6px #43e8d8)" : undefined
          }} />}</svg>}{<Sparkles className={cn("relative size-6 text-[#43e8d8]", surgeReady && "animate-pulse")} />}{<span className="relative text-[8px] font-bold uppercase tracking-[0.2em] text-[#43e8d8]/80">Surge</span>}</TouchButton>}{<TouchButton label="Cycle spell" className="border-white/25" style={{
        right: `calc(${COL2} + ${SAFE_R})`,
        bottom: `calc(${EDGE} + var(--tc-cast) + var(--tc-btn) + 34px + ${SAFE_B})`,
        width: "var(--tc-mini)",
        height: "var(--tc-mini)"
      }} {...tapHandlers(() => {
        fireCycle(input);
      })}>{<Repeat className="size-5 text-white/70" />}{<span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/50">Spell</span>}</TouchButton>}</div>}</div>;
}
/** Round translucent touch button — ≥56px target, scales down while active. */function TouchButton({
  className,
  style,
  label,
  children,
  ...rest
}: React.ComponentProps<"button"> & { label: string }) {
  return <button type="button" aria-label={label} className={cn("pointer-events-auto absolute flex touch-none select-none flex-col items-center justify-center gap-0.5 rounded-full border bg-black/70 [-webkit-tap-highlight-color:transparent] transition-transform duration-75 active:scale-90 active:brightness-125", className)} style={style} {...rest}>{children}</button>;
}