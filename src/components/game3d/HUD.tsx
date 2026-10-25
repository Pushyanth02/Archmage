"use client";


import { useRef, useEffect } from "react";
import type { HudSnapshot } from "@/game3d/types";
import { elementColor } from "@/game3d/content";
import { assetPath } from "@/lib/asset-path";

export type HudApply = (snap: HudSnapshot) => void;

/* ARCHMAGE: RIFTBOUND (3D Edition) — the in-game HUD.
   Zero re-renders on the hot path: the shell registers our `apply` callback
   and pushes HudSnapshots at ~30 Hz straight into DOM refs. */

const SLOT_KEYS = ["1", "2", "3"];
/* 3 static off-screen threat markers (v2.2) — boss first, max 3 at once */
const THREAT_MARKER_KEYS = [0, 1, 2];
export function HUD({
  register,
  vignetteScale = 1
}: {
  register: (apply: HudApply | null) => void;
  /* v2.2: low-HP/hit-flash vignette intensity (settings.vignette, 0..1) */
  vignetteScale?: number;
}) {
  const hpFill = useRef<HTMLDivElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const aeFill = useRef<HTMLDivElement>(null);
  const aeText = useRef<HTMLSpanElement>(null);
  const surgeFill = useRef<HTMLDivElement>(null);
  const surgeWrap = useRef<HTMLDivElement>(null);
  const surgeLabel = useRef<HTMLSpanElement>(null);
  const mercyBadge = useRef<HTMLDivElement>(null);
  const waveNum = useRef<HTMLSpanElement>(null);
  const waveBar = useRef<HTMLDivElement>(null);
  const biomeName = useRef<HTMLSpanElement>(null);
  const bossWrap = useRef<HTMLDivElement>(null);
  const bossName = useRef<HTMLSpanElement>(null);
  const bossTitle = useRef<HTMLSpanElement>(null);
  const bossFill = useRef<HTMLDivElement>(null);
  const scoreText = useRef<HTMLSpanElement>(null);
  const glyphText = useRef<HTMLSpanElement>(null);
  const foesText = useRef<HTMLSpanElement>(null);
  const slotRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const slotCd = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const weaveWrap = useRef<HTMLDivElement>(null);
  const weaveFill = useRef<HTMLDivElement>(null);
  const blinkPip = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const surgeGlow = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<HTMLDivElement>(null);
  /* v2.2: off-screen threat markers — 3 static arrows, driven purely by
   * style writes from the ~30 Hz snapshot stream (zero re-renders) */
  const threatRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  useEffect(() => {
    const scale = vignetteScale;
    let lastHp = Infinity;
    let vignetteT = 0;
    const apply: HudApply = (s) => {
      /* vitals */if (hpFill.current) hpFill.current.style.width = `${Math.max(0, s.hp / s.hpMax * 100)}%`;
      if (hpText.current) hpText.current.textContent = `${Math.ceil(Math.max(0, s.hp))} / ${Math.round(s.hpMax)}`;
      if (aeFill.current) aeFill.current.style.width = `${s.aether / s.aetherMax * 100}%`;
      if (aeText.current) aeText.current.textContent = `${Math.floor(s.aether)}`;
      if (surgeFill.current) surgeFill.current.style.width = `${s.surge * 100}%`;
      if (surgeWrap.current) {
        const ready = s.surge >= 1;
        surgeWrap.current.dataset.ready = ready ? "1" : "0";
        surgeWrap.current.style.opacity = s.surgeActive > 0 ? "0.45" : "1";
      }
      if (surgeLabel.current) {
        surgeLabel.current.textContent = s.surgeActive > 0 ? `SURGING ${s.surgeActive.toFixed(1)}s` : s.surge >= 1 ? "SURGE READY [F]" : "SURGE";
      }
      if (surgeGlow.current) {
        surgeGlow.current.style.opacity = s.surgeActive > 0 ? `${0.25 + Math.min(0.2, s.surgeActive * 0.05)}` : "0";
      }
      if (mercyBadge.current) {
        mercyBadge.current.style.display = s.mercy > 0.001 ? "flex" : "none";
        mercyBadge.current.textContent = `RIFT MERCY ${Math.round(s.mercy * 100)}%`;
      }
      /* hurt vignette */
      if (s.hp < lastHp - 0.5) vignetteT = 1;
      lastHp = s.hp;
      /* low-vitality heartbeat — a slow crimson pulse while under 30% hp */
      const lowHp = s.hp > 0 && s.hp / s.hpMax < 0.3;
      if (lowHp && vignette.current) {
        vignette.current.style.opacity = `${(0.18 + 0.16 * Math.sin(performance.now() / 260)) * scale}`;
      } else if (vignetteT > 0 && vignette.current) {
        vignetteT = Math.max(0, vignetteT - 0.1);
        vignette.current.style.opacity = `${vignetteT * 0.55 * scale}`;
      } else if (vignette.current && vignette.current.style.opacity !== "0") {
        vignette.current.style.opacity = "0";
      }
      /* wave */
      if (waveNum.current) waveNum.current.textContent = `${Math.max(1, s.wave)}`; // v2.2: no "Wave 0" during the opening countdown
      if (waveBar.current) waveBar.current.style.width = `${s.waveProgress * 100}%`;
      /* F-06: the current ground's name rides the wave pill — the world
       *  actually generated, not the menu's prospective next seed */
      if (biomeName.current) biomeName.current.textContent = s.biomeName ?? "";
      if (bossWrap.current) {
        const boss = s.boss;
        bossWrap.current.style.display = boss ? "flex" : "none";
        if (boss) {
          if (bossName.current) bossName.current.textContent = boss.name.toUpperCase();
          if (bossTitle.current) bossTitle.current.textContent = boss.title;
          if (bossFill.current) {
            bossFill.current.style.width = `${Math.max(0, boss.hp / boss.hpMax * 100)}%`;
            bossFill.current.style.background = boss.color;
          }
        }
      }
      /* score cluster */
      if (scoreText.current) scoreText.current.textContent = s.score.toLocaleString();
      if (glyphText.current) glyphText.current.textContent = s.glyphs.toLocaleString();
      if (foesText.current) foesText.current.textContent = `${s.enemiesLeft}`;
      /* spell slots */
      for (let i = 0; i < 3; i++) {
        const slot = slotRefs[i].current;
        const cd = slotCd[i].current;
        if (!slot || !cd) continue;
        const selected = s.selected === i;
        slot.dataset.sel = selected ? "1" : "0";
        slot.dataset.empty = s.spellIds[i] ? "0" : "1";
        slot.style.borderColor = selected ? s.spellColors[i] : "rgba(255,255,255,0.12)";
        slot.style.boxShadow = selected ? `0 0 18px ${s.spellColors[i]}55` : "none";
        const nameEl = slot.querySelector("[data-slot-name]") as HTMLElement | null;
        if (nameEl && nameEl.textContent !== s.spellNames[i]) nameEl.textContent = s.spellNames[i];
        /* acquired dunpixel element icon (docs/AUDITS.md §3) — merged
        slots show the primary component's sigil */
        const iconEl = slot.querySelector("[data-slot-icon]") as HTMLImageElement | null;
        if (iconEl) {
          const el = (s.spellIds[i] || "").split("+")[0];
          if (iconEl.dataset.el !== el) {
            iconEl.dataset.el = el;
            iconEl.src = el ? assetPath(`/assets/icons/element-${el}.png`) : "";
            iconEl.style.visibility = el ? "visible" : "hidden";
          }
        }
        const colEl = slot.querySelector("[data-slot-dot]") as HTMLElement | null;
        if (colEl) colEl.style.background = s.spellColors[i];
        cd.style.height = `${(1 - s.cooldowns[i]) * 100}%`;
        /* R-02 (v2.0): numeric cooldown + READY, straight from the simulation
        clock (cooldownSeconds is the engine's authoritative remaining time —
        correct for merged slots, Surge and cd-multipliers). Text is only
        touched when it changes, so the 30 Hz path stays allocation-free;
        >=3s shows ceil'd whole seconds, sub-3s shows one decimal, <=0.1s is
        READY — the exact instant the engine accepts the cast. */
        const cdTextEl = slot.querySelector("[data-slot-cd]") as HTMLElement | null;
        const hasSpell = !!s.spellIds[i];
        const secs = s.cooldownSeconds?.[i] ?? 0;
        const txt = !hasSpell ? "" : secs > 0.1 ? (secs >= 3 ? `${Math.ceil(secs)}` : secs.toFixed(1)) : "READY";
        if (cdTextEl) {
          if (cdTextEl.textContent !== txt) {
            cdTextEl.textContent = txt;
            cdTextEl.style.color = txt === "READY" ? "#ffd97a" : "rgba(255,255,255,0.92)";
          }
        }
        /* accessible slot status — rewritten only on phrase change (the
        string compare throttles the 30 Hz stream; READY↔cooldown transitions
        are what a screen reader needs, not every tick) */
        const aria = !hasSpell ? `Spell slot ${i + 1}, empty` : txt === "READY" ? `Spell slot ${i + 1}, ${s.spellNames[i]}, ready` : `Spell slot ${i + 1}, ${s.spellNames[i]}, cooldown ${txt} seconds`;
        if (slot.getAttribute("aria-label") !== aria) slot.setAttribute("aria-label", aria);
        /* v2.2: evolution badge — a gold star once this slot's spell has
         * taken its final form (visibility write only, allocation-free) */
        const evoEl = slot.querySelector("[data-slot-evo]") as HTMLElement | null;
        if (evoEl) evoEl.style.visibility = s.spellEvolved?.[i] ? "visible" : "hidden";
      }
      /* resonance weave window */
      if (weaveWrap.current && weaveFill.current) {
        const active = s.castWindow > 0;
        weaveWrap.current.style.opacity = active ? "1" : "0";
        if (active) {
          weaveFill.current.style.width = `${s.castWindow * 100}%`;
          const last = s.lastCastElement;
          weaveWrap.current.style.borderColor = last ? elementColor(last) : "#f5c96b";
        }
      }
      /* blink pip */
      if (blinkPip.current) {
        blinkPip.current.style.height = `${Math.max(0.06, s.blinkCd) * 100}%`;
        blinkPip.current.style.background = s.blinkCd >= 1 ? "#f5c96b" : "rgba(245,201,107,0.4)";
      }
      /* v2.2: resume countdown — the engine holds the sim frozen while this
       * is > 0; ceil(c - 0.2) flips the digit a beat early so it never rests
       * on a number already spent */
      if (countdownRef.current) {
        const c = s.countdown ?? 0;
        countdownRef.current.style.display = c > 0 ? "block" : "none";
        if (c > 0) {
          const el = countdownRef.current.firstElementChild;
          if (el) el.textContent = String(Math.ceil(c - 0.2));
        }
      }
      /* v2.2: off-screen threat markers — the outer div rotates to the
       * threat's bearing (0 = up, clockwise); the inner arrow rides the
       * rotated axis out to a 32vh radius around screen center, pointing
       * outward at what looms beyond the view */
      const threats = s.threats ?? [];
      for (let i = 0; i < 3; i++) {
        const r = threatRefs[i].current;
        if (!r) continue;
        const t = threats[i];
        if (!t) {
          r.style.display = "none";
          continue;
        }
        r.style.display = "block";
        r.style.color = t.kind === "boss" ? "#ff4d6b" : "#9a7bff";
        r.style.transform = `rotate(${t.angle}deg)`;
        r.dataset.threatKind = t.kind;
      }
    };
    register(apply);
    return () => register(null);
  }, [register, vignetteScale]);
  return <div data-hud-root className="pointer-events-none absolute inset-0 select-none font-sans text-white">{<div ref={surgeGlow} className="absolute inset-0 opacity-0 transition-opacity duration-300" style={{
      background: "radial-gradient(ellipse at center, transparent 55%, rgba(245,201,107,0.5) 100%)"
    }} />}{<div ref={vignette} className="absolute inset-0 opacity-0" style={{
      background: "radial-gradient(ellipse at center, transparent 45%, rgba(255,45,80,0.65) 100%)",
      transition: "opacity 0.12s linear"
    }} />}{<div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">{THREAT_MARKER_KEYS.map(i => <div key={i} ref={threatRefs[i]} style={{
      display: "none",
      position: "absolute",
      left: "50%",
      top: "50%"
    }}>{<div className="flex flex-col items-center" style={{
      transform: "translate(-50%, -50%)"
    }}>{<div className="tc-threat-arrow" style={{
      transform: "translateY(-32vh)"
    }}>{<svg viewBox="0 0 24 24" className="size-5 drop-shadow-[0_0_6px_rgba(0,0,0,0.8)]"><path d="M12 3 L20 19 L12 15 L4 19 Z" fill="currentColor" /></svg>}</div>}</div>}</div>)}</div>}{<div ref={countdownRef} style={{
      display: "none"
    }} className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 text-center" aria-live="polite">{<span className="font-serif text-7xl font-black text-white/90 [text-shadow:0_0_40px_rgba(245,201,107,0.6)]">3</span>}</div>}{<div className="safe-t safe-x absolute left-3 top-3 w-48 space-y-1.5 sm:left-5 sm:top-5 sm:w-56 lg:w-72">{<div className="rounded-lg border border-white/10 bg-black/70 px-3 py-2">{<div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/60">{<span>Vitality</span>}{<span ref={hpText} className="text-[11px] tabular-nums text-white/90">100 / 100</span>}</div>}{<div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10">{<div ref={hpFill} className="h-full rounded-full transition-[width] duration-150" style={{
            width: "100%",
            background: "linear-gradient(90deg,#ff4d6b,#ff8fa3)"
          }} />}</div>}{<div className="mt-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/60">{<span>Aether</span>}{<span ref={aeText} className="text-[11px] tabular-nums text-white/90">100</span>}</div>}{<div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">{<div ref={aeFill} className="h-full rounded-full" style={{
            width: "100%",
            background: "linear-gradient(90deg,#9a7bff,#c9baff)"
          }} />}</div>}{<div ref={surgeWrap} className="mt-2 group" data-ready="0">{<div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">{<span ref={surgeLabel} className="text-white/60 group-data-[ready=1]:animate-pulse group-data-[ready=1]:text-amber-300">SURGE</span>}</div>}{<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">{<div ref={surgeFill} className="h-full rounded-full" style={{
              width: "0%",
              background: "linear-gradient(90deg,#b8860b,#f5c96b)"
            }} />}</div>}</div>}</div>}{<div ref={mercyBadge} style={{
        display: "none"
      }} className="hidden w-fit items-center rounded-md border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300">RIFT MERCY</div>}</div>}{<div data-hud-wave className="safe-t absolute left-1/2 top-4 -translate-x-1/2 text-center">{<div className="rounded-lg border border-white/10 bg-black/70 px-3 py-1.5 sm:px-4">{<div className="flex items-baseline justify-center gap-2">{<span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/50">Wave</span>}{<span ref={waveNum} className="text-lg font-black tabular-nums text-amber-200 sm:text-xl lg:text-2xl">1</span>}{<span ref={biomeName} data-hud-optional className="ml-1 max-w-36 truncate text-[9px] font-bold uppercase tracking-[0.2em] text-white/55 sm:max-w-48" aria-label="Current biome" />}</div>}{<div className="mx-auto mt-1 h-1 w-24 overflow-hidden rounded-full bg-white/10 sm:w-28 lg:w-36">{<div ref={waveBar} className="h-full rounded-full bg-amber-200/80" style={{
            width: "0%"
          }} />}</div>}</div>}{<div ref={bossWrap} style={{
        display: "none"
      }} className="mt-2 w-72 max-w-[calc(100vw_-_1.5rem)] flex-col items-center sm:w-96">{<div className="flex w-full items-baseline justify-center gap-2">{<span ref={bossName} className="text-sm font-black uppercase tracking-[0.2em] text-rose-300" />}{<span ref={bossTitle} className="text-[10px] italic text-white/50" />}</div>}{<div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border border-white/15 bg-black/60">{<div ref={bossFill} className="h-full transition-[width] duration-150" style={{
            width: "100%",
            background: "#ff4d6b"
          }} />}</div>}</div>}</div>}{<div className="safe-t safe-x absolute right-3 top-3 flex flex-col items-end gap-1 text-right sm:right-5 sm:top-5">{<div className="rounded-lg border border-white/10 bg-black/70 px-3 py-1.5">{<div className="text-[9px] font-bold uppercase tracking-widest text-white/40">Score</div>}{<span ref={scoreText} className="text-base font-black tabular-nums text-white lg:text-lg">0</span>}</div>}{<div className="flex gap-1">{<div className="flex items-center gap-1 rounded-md border border-amber-200/20 bg-black/70 px-2 py-1">{<span className="inline-block h-2 w-2 rotate-45 bg-amber-300 shadow-[0_0_6px_#f5c96b]" />}{<span ref={glyphText} className="text-xs font-bold tabular-nums text-amber-200">0</span>}</div>}{<div className="flex items-center gap-1 rounded-md border border-rose-300/20 bg-black/70 px-2 py-1">{<span className="text-[9px] font-bold uppercase text-rose-300/70">Foes</span>}{<span ref={foesText} className="text-xs font-bold tabular-nums text-rose-200">0</span>}</div>}</div>}</div>}{<div data-hud-slots className="safe-b absolute bottom-5 left-1/2 -translate-x-1/2">{<div className="flex items-end gap-2 sm:gap-3 lg:gap-4">{SLOT_KEYS.map((key, i) => <div ref={slotRefs[i]} data-sel="0" data-empty="0" className="relative h-16 w-16 overflow-hidden rounded-xl border bg-black/70 transition-all duration-100 sm:h-[4.5rem] sm:w-24 lg:h-20 lg:w-28 data-[sel=1]:scale-105 data-[empty=1]:opacity-40" key={key}>{<span data-slot-evo style={{
              visibility: "hidden"
            }} aria-hidden="true" className="absolute left-1 top-0.5 text-[9px] font-black text-[#ffd97a]">✦</span>}{<div className="absolute inset-0 flex flex-col items-center justify-center px-1">{<img data-slot-icon alt="" width={28} height={28} className="mb-1 h-7 w-7 [image-rendering:pixelated] opacity-95" style={{
              visibility: "hidden",
              filter: "drop-shadow(0 0 6px rgba(255,255,255,0.35))"
            }} />}{<span data-slot-name className="max-w-full truncate text-[10px] font-bold uppercase tracking-wider text-white/85">—</span>}{<span className="text-[9px] font-bold text-white/35">{key}</span>}</div>}{<div ref={slotCd[i]} className="absolute bottom-0 left-0 right-0 bg-black/65" style={{
            height: "100%"
          }} />}{<span data-slot-cd aria-hidden="true" className="absolute right-1 top-0.5 rounded bg-black/70 px-1 text-[9px] font-black tabular-nums tracking-wide text-white/90" style={{
            textShadow: "0 1px 2px rgba(0,0,0,0.95)"
          }}>{""}</span>}</div>)}{<div className="flex flex-col items-center gap-1.5 pb-1">{<div ref={weaveWrap} style={{
            opacity: 0
          }} className="flex h-16 w-24 flex-col justify-center rounded-xl border-2 px-2 transition-opacity duration-150 sm:h-[4.5rem] lg:h-20 lg:w-28">{<span className="text-center text-[8px] font-black uppercase tracking-[0.2em] text-white/70">Weave</span>}{<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15">{<div ref={weaveFill} className="h-full rounded-full bg-white" style={{
                width: "0%"
              }} />}</div>}{<span data-hud-optional className="mt-0.5 text-center text-[8px] font-bold uppercase tracking-widest text-white/45">resonance pending</span>}</div>}{<div data-hud-optional className="flex items-center gap-1.5">{<span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Blink</span>}{<div className="h-6 w-2 overflow-hidden rounded-full border border-white/15 bg-black/50">{<div ref={blinkPip} className="w-full rounded-full" style={{
                height: "100%",
                background: "#f5c96b"
              }} />}</div>}</div>}</div>}</div>}</div>}</div>;
}