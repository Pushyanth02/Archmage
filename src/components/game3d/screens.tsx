"use client";


import { useState, useEffect, useSyncExternalStore, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, BookMarked, BookOpen, Clock, Copy, Crown, Dices, DoorOpen, Flame, Gauge, Gem, Heart, HeartPulse, House, Hourglass, Infinity, Music4, Play, RotateCcw, Scan, Settings, Skull, Sparkles, Star, Sun, Swords, Trash2, TriangleAlert, Trophy, Volume2, Wind, X, Zap } from "lucide-react";
import { useRiftStore, peekSlots } from "@/game3d/store";
import { sfx } from "@/game3d/audio";
import { FALLBACK_PACKS, fetchPackCredits } from "@/game3d/assets";
import { ACTS, computeBonuses, RELIQUARY, RELIQUARY_MAX_LEVEL, reliquaryCost, SPELL_ORDER, ALL_PAIRS, comboKey, COMBOS, SPELLS, ELITE_ORDER, ELITE_DEFS, ENEMY_ORDER, ENEMY_DEFS, BOSS_DEFS, CHANGELOG, GAME_VERSION, MERCY_MAX_TIER, mercyTierBase, VICTORY_WAVE, TERRAINS, biomeDeckFor, PALETTE_IDS, PALETTE_LABELS,
  type ReliquaryKey,
} from "@/game3d/content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { assetPath } from "@/lib/asset-path";
import { usePointerCoarse } from "@/game3d/capability";

export
/* ARCHMAGE: RIFTBOUND (3D Edition) — full-screen UI screens (menu / reliquary / arcanum /
   settings / game-over / victory credits / pause).
   Data source: useRiftStore. Engine actions arrive via the `ui` bridge below —
   GameShell assigns real handlers at mount. This module imports NO engine
   code; the game3d/assets import is data-only (manifest pack credits, P2-6). */

const ui = {
  onStartRun: _seed => {},
  onGameOverRetry: _seed => {},
  onGameOverMenu: () => {},
  onCreditsReturn: () => {},
  onCreditsFight: () => {}
};
/* ------------------------------- tokens ---------------------------- */
const GOLD = "#f5c96b";
const VIOLET = "#9a7bff";
const TEAL = "#43e8d8";
const CRIMSON = "#ff4d6b";
const SCREEN_BG = "fixed inset-0 z-40 bg-[#0a0812]/95 backdrop-blur-md dark";
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec % 3600 / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(sec)}s`;
}
const fmtNum = n => n.toLocaleString("en-US");
const pct = mult => `+${Math.round((mult - 1) * 100)}%`;
/** Ambient radial glows shared by full-screen menus. */
function AmbientGlows({
  variant = "gold"
}) {
  const main = variant === "gold" ? GOLD : CRIMSON;
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<div className="absolute left-1/2 top-[-12%] h-[42vh] w-[85vw] -translate-x-1/2 rounded-full opacity-[0.07] blur-[120px]" style={{
      backgroundColor: main
    }} />}{<div className="absolute bottom-[-25%] left-[-12%] h-[55vh] w-[55vw] rounded-full bg-[#9a7bff] opacity-[0.07] blur-[130px]" />}{<div className="absolute right-[-12%] top-[15%] h-[45vh] w-[45vw] rounded-full bg-[#43e8d8] opacity-[0.05] blur-[130px]" />}</div>;
}
/** Tiny uppercase section label. */function SectionLabel({
  children,
  className
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40", className)}>{children}</div>;
}
/* ================================================================== */ /*  ASSET ATTRIBUTION (docs/AUDITS.md §8 — manifest packs[])      */ /* ================================================================== */const ATTRIBUTION_NOTE = "Credits are generated from the asset manifest (public/assets/manifests/assets.json). " + "Packs marked permission pending are not cleared for commercial distribution. " + "All other art, code, music and sound are synthesized in-engine. " + "Key art conjured by AI.";
/** Short license label for the badge (the manifest licenseId can be long-form). */
function licenseShort(p) {
  const id = p.licenseId;
  if (id.includes("CC0")) return "CC0";
  if (id.includes("QAL")) return "QAL";
  if (id.startsWith("No explicit license")) return "no explicit license";
  return id;
}
/** Status badge text: verified packs read "CC0/QAL/… · cleared"; pending packs
 *  are labeled demo-use-only (audit P1-4 / P2-6). */
function licenseBadge(p) {
  if (p.licenseStatus === "disallowed") return "disallowed — not shippable";
  if (p.licenseStatus === "permission-pending") return "permission pending — demo use only";
  if (p.licenseStatus !== "verified") return "license status unknown";
  return `${licenseShort(p)} · cleared`;
}
/** Compact one-line-per-pack attribution list (credits screen + menu dialog).
 *  Manifest-driven (audit P2-6): rows come from packs[] in the asset manifest
 *  via fetchPackCredits(); FALLBACK_PACKS — the single hard-coded mirror, kept
 *  in assets.ts — is the loading/fetch-failure state. Each pack name links to
 *  its exact source page. */
function AssetAttributionList({
  className
}: {
  className?: string;
}) {
  const [packs, setPacks] = useState(FALLBACK_PACKS);
  useEffect(() => {
    let alive = true;
    fetchPackCredits().then(p => {
      if (alive && p.length > 0) setPacks(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return <div className={cn("flex flex-col", className)}>{packs.map(p => {
      const cleared = p.licenseStatus === "verified";
      return <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-white/5 py-1.5 last:border-b-0" key={p.id}>{<a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 text-[11px] font-semibold text-white/75 underline decoration-white/40 underline-offset-2 transition-colors hover:text-[#ffe9ad]">{p.pack}</a>}{<span className="text-[10px] text-white/45">{p.author}</span>}{<span className={cn("rounded-full border px-2 py-px text-[9px] font-bold uppercase tracking-wide", cleared ? "border-[#43e8d8]/40 bg-[#43e8d8]/10 text-[#43e8d8]" : "border-[#f5c96b]/50 bg-[#f5c96b]/10 text-[#f5c96b]")}>{licenseBadge(p)}</span>}</div>;
    })}{<p className="mt-2.5 text-[10px] leading-relaxed text-white/40">{ATTRIBUTION_NOTE}</p>}</div>;
}
export function MainMenu() {
  const screen = useRiftStore(s => s.screen);
  const phase = useRiftStore(s => s.phase);
  const show = screen === "menu" && phase === "menu";
  return <>{<AnimatePresence>{show && <MenuContent key={"main-menu"} />}</AnimatePresence>}{<CodexScreen />}</>;
}
/** The menu teaches the rite the CURRENT device actually uses (pointer:
 *  coarse ⇒ touch rite). Subscribed reactively, no effect-setState.
 * v2.2: delegates to the shared capability service (capability.ts) — one
 * live pointer:coarse detector for the whole game (scope report §4.3). */
function useIsTouch() {
  return usePointerCoarse();
}
/* shared panel chrome for the landing's rune panels */
const PANEL = "border border-[#9a7bff]/25 bg-[#100a1f]/70 backdrop-blur-sm";
/** Layer 0 — keyart with a living ken-burns drift (24s, alternating pan —
 *  9-d) under breathing dusk veils. A wrapper div carries a subtle pointer
 *  parallax (desktop fine-pointer only, ≤8px, rAF-throttled, transform-only)
 *  so it never fights the img's CSS ken-burns on the same element. */
function KeyartBackdrop() {
  const parallaxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = parallaxRef.current;
    if (!el) return;
    /* OFF for coarse pointers (touch) and under prefers-reduced-motion;
    passive listener on window — never touches the content-scroll column
    (the backdrop layers sit behind it, z-order unchanged). */
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    const step = () => {
      raf = 0;
      cx += (tx - cx) * 0.09; // ease toward the target; ~0 at rest
      cy += (ty - cy) * 0.09;
      el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
      if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) raf = requestAnimationFrame(step);
    };
    const onMove = ev => {
      if (ev.pointerType !== "mouse") return;
      const nx = ev.clientX / window.innerWidth * 2 - 1; // -1..1 from center
      const ny = ev.clientY / window.innerHeight * 2 - 1;
      /* counter-drift: the keyart leans OPPOSITE to the pointer, ≤8px */
      tx = Math.max(-8, Math.min(8, -nx * 8));
      ty = Math.max(-8, Math.min(8, -ny * 8));
      if (!raf) raf = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, {
      passive: true
    });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<div ref={parallaxRef} className="absolute inset-0 will-change-transform">{<img src={assetPath("/art/keyart.jpg")} alt="" draggable={false} className="rift-kenburns h-full w-full object-cover object-center" />}</div>}{<div className="absolute inset-0 bg-gradient-to-b from-[#0a0812]/75 via-[#0a0812]/40 to-[#0a0812]/92" />}{<div className="rift-veil-breathe absolute inset-0" style={{
      background: "radial-gradient(1100px 700px at 50% 34%, rgba(88,58,160,0.30), transparent 62%)," + "radial-gradient(720px 520px at 16% 88%, rgba(208,91,255,0.12), transparent 60%)," + "radial-gradient(720px 520px at 86% 10%, rgba(67,232,216,0.09), transparent 60%)"
    }} />}{<div className="absolute inset-0" style={{
      background: "radial-gradient(ellipse at center, transparent 55%, rgba(5,3,12,0.62) 100%)"
    }} />}</div>;
}
/** Layer 1 — the ported MenuBackdrop: counter-rotating sigil rings, drifting
 *  motes, and rising rift embers (cinematic pass). */
function MenuBackdrop() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<svg className="rift-sigil-spin absolute left-1/2 top-1/2 h-[min(112vw,760px)] w-[min(112vw,760px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.15]" viewBox="0 0 760 760" fill="none">{<circle cx="380" cy="380" r="360" stroke="#f5c96b" strokeWidth="1.5" strokeDasharray="16 12" />}{<circle cx="380" cy="380" r="238" stroke="#f5c96b" strokeWidth="1" />}{Array.from({
        length: 8
      }).map((_, i) => {
        const a = i / 8 * Math.PI * 2;
        const x = 380 + Math.cos(a) * 330;
        const y = 380 + Math.sin(a) * 330;
        return <rect x={x - 9} y={y - 9} width="18" height="18" transform={`rotate(45 ${x} ${y})`} stroke="#f5c96b" strokeWidth="1.4" key={i} />;
      })}</svg>}{<svg className="rift-sigil-spin-rev absolute left-1/2 top-1/2 h-[min(88vw,600px)] w-[min(88vw,600px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.13]" viewBox="0 0 760 760" fill="none">{<circle cx="380" cy="380" r="300" stroke="#9a7bff" strokeWidth="1" strokeDasharray="4 16" />}{Array.from({
        length: 6
      }).map((_, i) => {
        const a = i / 6 * Math.PI * 2 + Math.PI / 6;
        const x = 380 + Math.cos(a) * 300;
        const y = 380 + Math.sin(a) * 300;
        return <circle cx={x} cy={y} r="3" fill="#9a7bff" key={i} />;
      })}</svg>}{Array.from({
      length: 26
    }).map((_, i) => <span className="rift-mote absolute rounded-full" style={{
      left: `${i * 37 % 100}%`,
      top: `${i * 53 % 100}%`,
      animationDelay: `${i % 10 * 0.7}s`,
      width: `${2 + i % 3}px`,
      height: `${2 + i % 3}px`,
      backgroundColor: i % 3 === 0 ? "#f5c96b" : "#b9aee0",
      "--mote-dur": `${5 + i % 6 * 2}s`,
      "--mote-op": 0.28 + i % 4 * 0.12
    } as React.CSSProperties} key={i} />)}{Array.from({
      length: 12
    }).map((_, i) => <span className="rift-ember absolute bottom-[-2vh] rounded-full bg-[#f5c96b] blur-[1.5px]" style={{
      left: `${i * 83 % 100}%`,
      width: `${2.5 + i % 3}px`,
      height: `${2.5 + i % 3}px`,
      animationDelay: `${i % 7 * 1.6}s`,
      "--ember-dur": `${7 + i % 5 * 2}s`,
      "--ember-x": `${(i % 2 === 0 ? 1 : -1) * (22 + i % 4 * 12)}px`
    } as React.CSSProperties} key={i} />)}</div>;
}
/** Rune-frame corner brackets around the whole viewport. */function RuneCorners() {
  const c = "pointer-events-none absolute size-10 border-[#f5c96b]/45";
  return <div aria-hidden className="pointer-events-none absolute inset-0">{<div className={`${c} left-3 top-3 border-l-2 border-t-2`} />}{<div className={`${c} right-3 top-3 border-r-2 border-t-2`} />}{<div className={`${c} bottom-3 left-3 border-b-2 border-l-2`} />}{<div className={`${c} bottom-3 right-3 border-b-2 border-r-2`} />}</div>;
}
/** Cinematic letterbox bars — collapse in from full-bleed on load. */function LetterboxBars() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 z-20">{<div className="rift-lb rift-lb-top absolute inset-x-0 top-0 h-6 bg-[#050308]" />}{<div className="rift-lb rift-lb-bot absolute inset-x-0 bottom-0 h-6 bg-[#050308]" />}</div>;
}
function KeyRow({
  keys,
  label
}) {
  return <div className="flex items-center justify-between gap-4 py-1">{<span className="flex gap-1">{keys.map(k => <span className="rift-keycap" key={k}>{k}</span>)}</span>}{<span className="font-body text-[13px] text-[#b9aee0]">{label}</span>}</div>;
}
function TouchRow({
  badge,
  label
}) {
  return <div className="flex items-center justify-between gap-4 py-1">{<span className="rift-touch-chip">{badge}</span>}{<span className="font-body text-[13px] text-[#b9aee0]">{label}</span>}</div>;
}
function MenuContent() {
  const seed = useRiftStore(s => s.seed);
  const meta = useRiftStore(s => s.meta);
  const setSeed = useRiftStore(s => s.setSeed);
  const randomizeSeed = useRiftStore(s => s.randomizeSeed);
  const setScreen = useRiftStore(s => s.setScreen);
  const openSettings = useRiftStore(s => s.openSettings);
  const patchSettings = useRiftStore(s => s.patchSettings);
  const [seedCopied, setSeedCopied] = useState(false);
  /* touch-primary devices get a one-line gesture note under the begin rite */
  const isTouch = useIsTouch();
  /* v2.1.1: the legal documents (Terms / Privacy) open from the footer row. */
  const [legal, setLegal] = useState<null | "terms" | "privacy">(null);
  /* F-06 (audit): the menu seed is the NEXT run's seed — the deterministic
   *  itinerary preview is derived from THIS seed (a prediction, never a
   *  live terrain selector; the deck is frozen the moment the run starts). */
  const itinerary = useMemo(() => biomeDeckFor(seed).slice(0, 5).map(id => TERRAINS.find(t => t.id === id)?.name ?? id), [seed]);
  const copySeed = async () => {
    sfx.click();
    try {
      await navigator.clipboard.writeText(seed);
    } catch {
      /* clipboard denied (permissions/old browser) — select the input text
       *  as a visible fallback so the player can still copy manually */
      (document.getElementById("rift-seed") as HTMLInputElement | null)?.select();
    }
    setSeedCopied(true);
    window.setTimeout(() => setSeedCopied(false), 1400);
  };
  /* the next horizon: which biome the rift opens onto, from lifetime progress */
  const act = ACTS[Math.min(ACTS.length - 1, Math.floor(Math.max(0, meta.bestWave) / 10))];
  const hover = () => sfx.hover();
  return <motion.div className="fixed inset-0 z-40 overflow-hidden bg-[#0a0812]" initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0,
    transition: {
      duration: 0.45
    }
  }} transition={{
    duration: 0.5
  }}>{<KeyartBackdrop />}{<MenuBackdrop />}{<div aria-hidden className="rift-grain pointer-events-none absolute inset-0 z-10" />}{<RuneCorners />}{<LetterboxBars />}{<div className="rift-scroll safe-x relative z-10 h-full overflow-y-auto">{<div className="font-body flex min-h-full flex-col items-center px-4 pb-14 pt-12 text-center sm:pt-16 [@media(max-height:540px)]:pb-8 [@media(max-height:540px)]:pt-5">{<motion.div className="flex items-center gap-3 text-[#9a7bff]" initial={{
          opacity: 0,
          y: 14
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 0.15,
          duration: 0.5
        }}>{<span className="h-px w-14 bg-gradient-to-r from-transparent to-[#9a7bff] sm:w-20" />}{<span className="text-[11px] font-bold uppercase tracking-[0.42em] sm:text-xs">Riftbound · 3D Edition</span>}{<span className="h-px w-14 bg-gradient-to-l from-transparent to-[#9a7bff] sm:w-20" />}</motion.div>}{<motion.h2 className="font-display mt-4 text-[clamp(52px,9vw,110px)] font-black leading-none tracking-[0.08em] [@media(max-height:540px)]:mt-2 [@media(max-height:540px)]:text-[clamp(40px,7vw,84px)] text-[#f5e3b3] [text-shadow:0_0_34px_rgba(245,201,107,0.5),0_0_90px_rgba(154,123,255,0.35)]" initial={{
          opacity: 0,
          y: 26,
          filter: "blur(10px)"
        }} animate={{
          opacity: 1,
          y: 0,
          filter: "blur(0px)"
        }} transition={{
          delay: 0.3,
          duration: 0.8,
          ease: [0.22, 0.9, 0.3, 1]
        }}>ARCHMAGE</motion.h2>}{<motion.div className="mt-3 flex flex-wrap items-center justify-center gap-2.5" initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 0.55,
          duration: 0.5
        }} aria-label={`Version ${GAME_VERSION} — ${CHANGELOG[0].name}`}>{<span className="border border-[#f5c96b]/65 bg-[#f5c96b]/10 px-3.5 py-1 text-[11px] font-black uppercase tracking-[0.26em] text-[#f5c96b]">Version {GAME_VERSION}</span>}{<span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9a7bff]">{CHANGELOG[0].name}</span>}</motion.div>}{<motion.p className="mt-4 max-w-xl text-[15px] leading-relaxed italic text-[#b9aee0] [@media(max-height:540px)]:hidden" initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 0.7,
          duration: 0.5
        }}>Fifty waves stand between you and the sealed rift. Thirteen elements, twenty-two evolutions, seventy-eight resonances, five tyrants that shuffle with every seed — weave fast enough, and the abyss learns your name.</motion.p>}{<motion.div className={`mt-5 flex items-center gap-4 px-6 py-2.5 text-left ${PANEL} [@media(max-height:540px)]:mt-2.5 [@media(max-height:540px)]:py-1.5`} initial={{
          opacity: 0,
          y: 14
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 0.8,
          duration: 0.45
        }}>{<DoorOpen className="size-5 shrink-0 text-[#f5c96b]" />}{<div>{<div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#6bf0c2]">Current biome</div>}{<div className="font-display text-lg font-bold leading-tight text-[#f0e8ff]">{act.name}</div>}{<div className="text-[11px] italic text-[#8f7bff]">{act.subtitle}</div>}</div>}{meta.victories > 0 && <div className="ml-2 border-l border-[#f5c96b]/35 pl-4 text-left">{<div className="font-display text-2xl font-black text-[#ffe9ad]">{meta.victories}</div>}{<div className="text-[9px] uppercase tracking-[0.18em] text-[#8f7bff]">seals</div>}</div>}</motion.div>}{<motion.div className="mt-4 flex items-center gap-2" initial={{
          opacity: 0,
          y: 12
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 0.9,
          duration: 0.4
        }}>{<label htmlFor="rift-seed" className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#8f7bff]" title="The seed for the run you are about to start — reroll or type one to explore a different rift">Next rift seed</label>}{<input id="rift-seed" value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => {
            if (e.key === "Enter") {
              sfx.resume();
              sfx.click();
              ui.onStartRun(seed);
            }
          }} spellCheck={false} maxLength={24} className="min-h-11 w-40 border border-[#9a7bff]/32 bg-[#120b24]/90 px-3 py-1.5 text-center text-sm font-bold tracking-widest text-[#ffe9ad] outline-none transition-all focus:border-[#f5c96b] focus:ring-2 focus:ring-[#f5c96b]/50" />}{<button className="flex size-11 items-center justify-center border border-[#9a7bff]/32 bg-[#120b24]/90 text-[#43e8d8] transition-colors hover:border-[#43e8d8]/60 hover:text-[#6bf0c2]" title="Reroll — draws a fresh seed for the NEXT run only" aria-label="Reroll seed" onClick={randomizeSeed} onMouseEnter={hover}>{<Dices className="size-4" />}</button>}{<button className="flex size-11 items-center justify-center border border-[#9a7bff]/32 bg-[#120b24]/90 transition-colors hover:border-[#f5c96b]/60" title="Copy this seed — paste it back any time to replay the same rift" aria-label="Copy seed" onClick={copySeed} onMouseEnter={hover}>{seedCopied ? <span className="text-[10px] font-black uppercase tracking-widest text-[#6bf0c2]">Copied</span> : <Copy className="size-4 text-[#f5c96b]" />}</button>}</motion.div>}{<motion.div className="mt-2.5 flex flex-col items-center gap-1 [@media(max-height:540px)]:hidden" initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 0.95,
          duration: 0.4
        }}>{<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-[#8f7bff]" aria-label="Predicted biome itinerary for this seed">{<span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#6bf0c2]">Itinerary</span>}{itinerary.map((name, i) => <span key={i} className="flex items-center gap-2"><span className="text-white/25">·</span><span className={i === 0 ? "font-bold text-[#ffe9ad]" : "text-[#b9aee0]"}>{name}</span></span>)}</div>}{<p className="text-[10px] italic text-white/50">Derived from this seed — the same seed always walks the same ground.</p>}</motion.div>}{<motion.button className="font-display group relative mt-4 flex items-center gap-3 border border-[#f5c96b]/60 [@media(max-height:540px)]:mt-2.5 bg-[#f5c96b]/12 px-12 py-4 text-lg font-bold uppercase tracking-[0.22em] text-[#ffe9ad] shadow-[0_0_35px_rgba(245,201,107,0.2)] transition-all hover:bg-[#f5c96b]/22 hover:shadow-[0_0_60px_rgba(245,201,107,0.4)] active:scale-[0.98]" initial={{
          opacity: 0,
          y: 16
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 1.0,
          duration: 0.45
        }} onClick={() => {
          sfx.resume();
          sfx.click();
          ui.onStartRun(seed);
        }} onMouseEnter={hover}>{<DoorOpen className="size-5 text-[#f5c96b] transition-transform group-hover:scale-110" />}Enter the Rift</motion.button>}{isTouch ? <p className="mt-2 text-center text-[10px] uppercase tracking-[0.22em] text-white/50">One tap — fullscreen · landscape · the rift</p> : <p className="mt-2 text-center text-[10px] uppercase tracking-[0.22em] text-white/50">WASD move · LMB cast · RMB volley · Space blink · F surge</p>}{<motion.div className="mt-4 flex flex-wrap items-center justify-center gap-3" initial={{
          opacity: 0,
          y: 12
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 1.1,
          duration: 0.4
        }}>{<button onClick={() => setScreen("reliquary")} onMouseEnter={hover} className={`flex min-h-11 items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#e9e2ff] transition-colors hover:text-[#ffe9ad] ${PANEL}`} title="The Vault — permanent upgrades bought with aether glyphs">{<Gem className="size-4 text-[#f5c96b]" />}Vault{<span className="font-display font-black text-[#ffe9ad]">{fmtNum(meta.shards)}</span>}</button>}{<button onClick={() => setScreen("arcanum")} onMouseEnter={hover} className={`flex min-h-11 items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#e9e2ff] transition-colors hover:text-[#ffe9ad] ${PANEL}`}>{<BookOpen className="size-4 text-[#9a7bff]" />}Runes{<span className="font-display font-black text-[#ffe9ad]">{meta.combosFound.length}</span>}</button>}{<button onClick={() => setScreen("codex")} onMouseEnter={hover} className={`flex min-h-11 items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#e9e2ff] transition-colors hover:text-[#ffe9ad] ${PANEL}`} title="Codex — how to play and what changed">{<BookMarked className="size-4 text-[#d05bff]" />}Codex</button>}{<button onClick={openSettings} onMouseEnter={hover} className={`flex min-h-11 items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#e9e2ff] transition-colors hover:text-[#ffe9ad] ${PANEL}`}>{<Settings className="size-4 text-[#43e8d8]" />}Settings</button>}</motion.div>}{<motion.div className="mt-5 w-full max-w-2xl px-7 py-4 text-left [@media(max-height:540px)]:hidden" initial={{
          opacity: 0,
          y: 14
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 1.2,
          duration: 0.45
        }}>{<div>{<div className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b]">Records</div>}{<div className="mx-auto grid max-w-xl grid-cols-2 gap-x-8 gap-y-2 py-2 text-center sm:grid-cols-4">{<div>{<div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.bestWave}</div>}{<div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Best wave</div>}</div>}{<div>{<div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.runs}</div>}{<div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Trials</div>}</div>}{<div>{<div className="font-display text-2xl font-bold text-[#ffe9ad]">{fmtNum(meta.totalKills)}</div>}{<div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Foes felled</div>}</div>}{<div>{<div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.combosFound.length}</div>}{<div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Resonances</div>}</div>}</div>}{<p className="mx-auto max-w-md text-balance text-center text-[12px] italic text-[#8f7bff]">Cast two elements within a breath to discover a resonance. Fell a tyrant — or touch a rift shrine — to transmute a spell forever.</p>}</div>}</motion.div>}{<motion.div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.18em]" initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 1.3,
          duration: 0.4
        }}>{<span className="sr-only">Legal</span>}{<button onClick={() => setLegal("terms")} className="min-h-11 px-2 py-2 font-bold text-white/50 transition-colors hover:text-[#f5c96b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c96b]">Terms of Service</button>}{<span aria-hidden className="text-white/20">·</span>}{<button onClick={() => setLegal("privacy")} className="min-h-11 px-2 py-2 font-bold text-white/50 transition-colors hover:text-[#f5c96b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c96b]">Privacy Policy</button>}</motion.div>}</div>}</div>}{<div className="safe-b safe-x pointer-events-none absolute bottom-8 right-4 z-30 text-[9px] uppercase tracking-[0.25em] text-white/45">v{GAME_VERSION} · {CHANGELOG[0].name}</div>}{<LegalDialog which={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />}</motion.div>;
}
/* ------------------------------------------------------------------ */ /*  LEGAL — Terms of Service / Privacy Policy (v2.1.1).                */ /*  One dialog, two documents, reachable from the main menu row. The    */ /*  copy states exactly what the game does: zero collection,           */ /*  localStorage-only saves, clipboard-only crash snapshots.            */ /* ------------------------------------------------------------------ */const LEGAL_UPDATED = "2026-10-27";
const LEGAL_TERMS: [string, string][] = [["The game", "ARCHMAGE: RIFTBOUND is a free 3D roguelike that runs entirely in your browser. It is provided as-is, for enjoyment, without warranty of any kind."], ["Your progress", "The game has no accounts. Progress, unlocks and settings live in your browser's local storage — they never leave your device, and clearing your browser data erases them. Nothing is backed up anywhere."], ["Seeds and fair play", "Every run is deterministic per seed. Sharing seeds is encouraged; exploiting bugs is between you and the rift."], ["The art and the code", "The game's code is by The Last Archmage. The mage, the bestiary, the terrains, the spell icons and the particles come from open-source art packs, credited in full in the in-game Codex."], ["Changes", "The game and these terms may change between versions; the in-game Codex carries the changelog."], ["Contact", "File issues at the source repository: github.com/Pushyanth02/Archmage."]];
const LEGAL_PRIVACY: [string, string][] = [["What we collect", "Nothing. No accounts, no analytics, no advertising, no cookies, no tracking pixels. The game cannot identify you."], ["What stays on your device", "Progress and settings are written to your browser's local storage. They are never transmitted; the game runs entirely on your device. Clearing your browser data deletes them."], ["The crash snapshot", "If the game breaks, it offers to copy a diagnostic snapshot (seed, settings, version) to your clipboard. It is never uploaded anywhere."], ["Third parties", "One kind of request leaves your browser: the page and its files (typefaces included — they are part of the game itself) are fetched from GitHub Pages, which sees standard web-server request logs (IP address, user agent). Nothing else is shared with anyone — there is nothing else to share."], ["Children", "No data is collected from anyone, of any age."], ["Changes", "This policy may change between versions; material changes will be noted in the in-game changelog."], ["Contact", "github.com/Pushyanth02/Archmage — issues."]];
function LegalDialog({ which, onClose, onSwitch }: { which: null | "terms" | "privacy"; onClose: () => void; onSwitch: (w: "terms" | "privacy") => void }) {
  const isTerms = which === "terms";
  const doc = isTerms ? LEGAL_TERMS : LEGAL_PRIVACY;
  return <Dialog open={which !== null} onOpenChange={open => {
    if (!open) onClose();
  }}>{<DialogContent className="dark flex flex-col gap-4 overflow-hidden border-white/10 bg-[#14101f]/95 p-4 text-white/90 backdrop-blur-xl sm:max-w-lg sm:p-5">{<div className="shrink-0 text-center">{<DialogTitle className="font-serif text-lg font-bold uppercase tracking-[0.25em] text-[#f5c96b]">{isTerms ? "Terms of Service" : "Privacy Policy"}</DialogTitle>}{<DialogDescription className="mt-1 text-xs text-white/40">ARCHMAGE: RIFTBOUND — v{GAME_VERSION} · updated {LEGAL_UPDATED}</DialogDescription>}</div>}{<div className="rift-scroll min-h-0 flex-1 overflow-y-auto pr-2">{<div className="flex flex-col gap-4">{doc.map(([h, body]) => <section key={h}>{<h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-[#9a7bff]">{h}</h3>}{<p className="mt-1.5 text-[13px] leading-relaxed text-[#c9bdf0]">{body}</p>}</section>)}</div>}</div>}{<div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-white/10 pt-3" role="tablist" aria-label="Legal documents">{<button role="tab" aria-selected={isTerms} disabled={isTerms} onClick={() => onSwitch("terms")} className="min-h-11 rounded-md border border-white/10 bg-black/40 px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-[#f5c96b] disabled:border-[#f5c96b]/50 disabled:bg-[#f5c96b]/10 disabled:text-[#f5c96b]">Terms of Service</button>}{<button role="tab" aria-selected={!isTerms} disabled={!isTerms} onClick={() => onSwitch("privacy")} className="min-h-11 rounded-md border border-white/10 bg-black/40 px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-[#f5c96b] disabled:border-[#f5c96b]/50 disabled:bg-[#f5c96b]/10 disabled:text-[#f5c96b]">Privacy Policy</button>}</div>}</DialogContent>}</Dialog>;
}
/* ================================================================== */ /*  RELIQUARY                                                          */ /* ================================================================== */const RELIC_ICONS = {
  vitality: Heart,
  power: Flame,
  focus: Sparkles,
  swiftness: Zap
};
export function ReliquaryScreen() {
  const screen = useRiftStore(s => s.screen);
  return <AnimatePresence>{screen === "reliquary" && <ReliquaryContent key={"reliquary"} />}</AnimatePresence>;
}
function ReliquaryContent() {
  const meta = useRiftStore(s => s.meta);
  const buyUpgrade = useRiftStore(s => s.buyUpgrade);
  const setScreen = useRiftStore(s => s.setScreen);
  const bonuses = computeBonuses(meta.upgrades);
  return <motion.div className={SCREEN_BG} initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0
  }} transition={{
    duration: 0.25
  }}>{<AmbientGlows />}{<div className="relative mx-auto flex h-full w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">{<header className="flex shrink-0 items-center justify-between gap-3">{<Button variant="ghost" size="icon" aria-label="Back to menu" onClick={() => setScreen("menu")} className="min-h-11 min-w-11 rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white">{<X />}</Button>}{<div className="text-center">{<h2 className="font-serif text-2xl font-bold uppercase tracking-[0.22em] text-[#f5c96b] [text-shadow:0_0_24px_rgba(245,201,107,0.35)] sm:text-3xl">The Vault</h2>}{<SectionLabel>Spend glyphs · bind power</SectionLabel>}</div>}{<div className="flex items-center gap-1.5 rounded-full border border-[#f5c96b]/30 bg-[#f5c96b]/10 px-3 py-1.5">{<Gem className="size-3.5 text-[#f5c96b]" />}{<span className="font-mono text-sm font-bold text-[#f5c96b]">{fmtNum(meta.shards)}</span>}</div>}</header>}{<div className="rift-scroll grid flex-1 grid-cols-1 content-start gap-3 overflow-y-auto pb-1 sm:grid-cols-2 lg:grid-cols-3">{RELIQUARY.map(def => <RelicCard def={def} level={meta.upgrades[def.key]} shards={meta.shards} onBuy={() => buyUpgrade(def.key as ReliquaryKey)} key={def.key} />)}</div>}{<footer className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-center text-[11px] uppercase tracking-[0.15em] text-white/50 backdrop-blur-md">{"Attuned "}{<span className="font-bold text-[#ff8fa3]">{pct(bonuses.hpMult)}{" HP"}</span>}{<span className="mx-1.5 text-white/20">·</span>}{<span className="font-bold text-[#ff7847]">{pct(bonuses.dmgMult)}{" DMG"}</span>}{<span className="mx-1.5 text-white/20">·</span>}{<span className="font-bold text-[#9a7bff]">{pct(bonuses.aetherMult)}{" Aether"}</span>}{<span className="mx-1.5 text-white/20">·</span>}{<span className="font-bold text-[#6bf0c2]">{pct(bonuses.speedMult)}{" Speed"}</span>}</footer>}</div>}</motion.div>;
}
function RelicCard({
  def,
  level,
  shards,
  onBuy
}: {
  def: { key: string; name: string; desc: string; color: string; icon: string; perLevel: string };
  level: number;
  shards: number;
  onBuy: () => void;
}) {
  const Icon = RELIC_ICONS[def.key];
  const maxed = level >= RELIQUARY_MAX_LEVEL;
  const cost = reliquaryCost(level);
  const afford = shards >= cost;
  return <div className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md" style={{
    boxShadow: `inset 0 30px 60px -40px ${def.color}44`
  }}>{<div aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-15 blur-2xl" style={{
      backgroundColor: def.color
    }} />}{<div className="flex items-start justify-between gap-3">{<div className="flex items-center gap-3">{<div className="flex size-11 shrink-0 items-center justify-center rounded-lg border" style={{
          borderColor: `${def.color}55`,
          backgroundColor: `${def.color}14`,
          color: def.color
        }}>{<Icon className="size-5" />}</div>}{<div>{<h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white/90">{def.name}</h3>}{<p className="mt-0.5 text-xs leading-snug text-white/45">{def.desc}</p>}</div>}</div>}{<Badge variant="outline" className="shrink-0 border-white/10 font-mono text-[10px] text-white/60">{def.perLevel}</Badge>}</div>}{<div className="flex gap-1.5">{Array.from({
        length: RELIQUARY_MAX_LEVEL
      }, (_, i) => <div className="h-1.5 flex-1 rounded-full transition-colors" style={{
        backgroundColor: i < level ? def.color : "rgba(255,255,255,0.08)",
        boxShadow: i < level ? `0 0 8px ${def.color}66` : undefined
      }} key={i} />)}</div>}{<div className="flex items-center justify-between gap-3">{<span className="flex items-center gap-1.5 text-xs text-white/45">{maxed ? <span className="font-semibold uppercase tracking-wider text-[#43e8d8]">Fully attuned</span> : <>{<Gem className={cn("size-3.5", afford ? "text-[#f5c96b]" : "text-white/30")} />}{<span className={cn("font-mono font-bold", afford ? "text-[#f5c96b]" : "text-white/35")}>{cost}</span>}{<span className="text-white/30">glyphs</span>}</>}</span>}{<Button size="sm" disabled={maxed || !afford} onClick={onBuy} className="min-h-11 rounded-md border border-white/15 bg-white/5 px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-white/85 transition-colors hover:border-[#f5c96b]/50 hover:bg-[#f5c96b]/15 hover:text-[#f5c96b] disabled:opacity-40">{maxed ? "Maxed" : "Buy"}</Button>}</div>}</div>;
}
export function ArcanumScreen() {
  const screen = useRiftStore(s => s.screen);
  return <AnimatePresence>{screen === "arcanum" && <ArcanumContent key={"arcanum"} />}</AnimatePresence>;
}
function ArcanumContent() {
  const meta = useRiftStore(s => s.meta);
  const setScreen = useRiftStore(s => s.setScreen);
  const tabCls = "h-9 rounded-md px-3 text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors data-[state=active]:bg-white/10 data-[state=active]:text-[#f5c96b]";
  return <motion.div className={SCREEN_BG} initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0
  }} transition={{
    duration: 0.25
  }}>{<AmbientGlows />}{<div className="relative mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">{<header className="flex shrink-0 items-center justify-between gap-3">{<Button variant="ghost" size="icon" aria-label="Back to menu" onClick={() => setScreen("menu")} className="min-h-11 min-w-11 rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white">{<X />}</Button>}{<div className="text-center">{<h2 className="font-serif text-2xl font-bold uppercase tracking-[0.22em] text-[#f5c96b] [text-shadow:0_0_24px_rgba(245,201,107,0.35)] sm:text-3xl">The Runes</h2>}{<SectionLabel>The rune codex</SectionLabel>}</div>}{<div className="w-10" aria-hidden />}</header>}{<Tabs defaultValue="spellbook" className="flex min-h-0 flex-1 flex-col gap-4">{<TabsList className="h-auto w-full shrink-0 flex-wrap justify-start gap-1 rounded-lg border border-white/10 bg-black/40 p-1 backdrop-blur-md">{<TabsTrigger value="spellbook" className={tabCls}>Spellbook</TabsTrigger>}{<TabsTrigger value="resonances" className={tabCls}>Resonances</TabsTrigger>}{<TabsTrigger value="bestiary" className={tabCls}>Bestiary</TabsTrigger>}{<TabsTrigger value="tyrants" className={tabCls}>Tyrants</TabsTrigger>}{<TabsTrigger value="records" className={tabCls}>Records</TabsTrigger>}</TabsList>}{<TabsContent value="spellbook" className="min-h-0 flex-1">{<ScrollArea className="h-full">{SPELL_ORDER.filter(id => meta.seenSpells.includes(id)).length === 0 ? <p className="px-1 py-8 text-center text-[11px] italic leading-relaxed text-white/35">No spells bound yet. Enter the rift — every spell you hold appears here.</p> : <div className="grid grid-cols-1 gap-3 pb-4 pr-3 sm:grid-cols-2 lg:grid-cols-3">{SPELL_ORDER.filter(id => meta.seenSpells.includes(id)).map(id => <SpellCodexCard id={id} key={id} />)}</div>}</ScrollArea>}</TabsContent>}{<TabsContent value="resonances" className="flex min-h-0 flex-1 flex-col gap-3">{<div className="shrink-0">{<div className="flex items-baseline justify-between">{<SectionLabel>Resonances woven</SectionLabel>}{<span className="font-mono text-xs text-white/60">{<span className="font-bold text-[#9a7bff]">{meta.combosFound.length}</span>}</span>}</div>}</div>}{<div className="rift-scroll min-h-0 flex-1 overflow-y-auto pr-0.5 max-h-96 lg:max-h-[34rem]">{ALL_PAIRS.filter(([a, b]) => meta.combosFound.includes(comboKey(a, b))).length === 0 ? <p className="px-1 py-8 text-center text-[11px] italic leading-relaxed text-white/35">Nothing woven yet. Cast two different elements back to back to weave a resonance.</p> : <div className="grid grid-cols-2 gap-2 pb-4 pr-3 sm:grid-cols-3 lg:grid-cols-4">{ALL_PAIRS.filter(([a, b]) => meta.combosFound.includes(comboKey(a, b))).map(([a, b]) => {
                const key = comboKey(a, b);
                const combo = COMBOS[key];
                const ca = SPELLS[a].color;
                const cb = SPELLS[b].color;
                /* P2-2: the list is pre-filtered to discovered resonances —
                   every card here is woven, so no locked rendering exists. */
                return <div className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-white/10 bg-black/40 p-3 backdrop-blur-md transition-colors" style={{
                  boxShadow: `inset 0 24px 40px -34px ${ca}, inset 0 24px 40px -34px ${cb}`
                }} key={key}>{<div className="flex items-center gap-1.5">{<span className="rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.15em]" style={{
                      color: ca,
                      borderColor: `${ca}55`,
                      backgroundColor: `${ca}12`
                    }}>{a}</span>}{<span className="text-[9px] text-white/25">+</span>}{<span className="rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.15em]" style={{
                      color: cb,
                      borderColor: `${cb}55`,
                      backgroundColor: `${cb}12`
                    }}>{b}</span>}</div>}{combo ? <>{<div className="text-xs font-bold leading-tight text-white/90">{combo.name}</div>}{<p className="text-[10px] leading-snug text-white/40">{combo.lore}</p>}</> : null}</div>;
              })}</div>}</div>}</TabsContent>}{<TabsContent value="bestiary" className="flex min-h-0 flex-1 flex-col gap-3">{<div className="flex shrink-0 flex-wrap items-center gap-2">{<SectionLabel className="mr-1">Elite affixes</SectionLabel>}{ELITE_ORDER.map(affix => {
              const e = ELITE_DEFS[affix];
              return <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] text-white/55" key={affix}>{<span className="size-2 rounded-full" style={{
                  backgroundColor: e.color,
                  boxShadow: `0 0 6px ${e.color}`
                }} />}{<span className="font-semibold uppercase tracking-wider" style={{
                  color: e.color
                }}>{e.name}</span>}{<span className="font-mono text-white/35">×{e.hpMult}hp ×{e.spdMult}spd{e.resist > 0 ? ` ${Math.round(e.resist * 100)}%res` : ""}</span>}</span>;
            })}</div>}{<div className="rift-scroll min-h-0 flex-1 overflow-y-auto pr-0.5 max-h-96 lg:max-h-[34rem]">{ENEMY_ORDER.filter(type => meta.seenEnemies.includes(type)).length === 0 ? <p className="px-1 py-8 text-center text-[11px] italic leading-relaxed text-white/35">No foes recorded yet. Every enemy you meet in the rift is recorded here.</p> : <div className="grid grid-cols-1 gap-3 pb-4 pr-3 sm:grid-cols-2 lg:grid-cols-3">{ENEMY_ORDER.filter(type => meta.seenEnemies.includes(type)).map(type => {
                const d = ENEMY_DEFS[type];
                /* P2-2: the list is pre-filtered to foes actually met —
                   every card renders its full record; no hidden previews. */
                return <div className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md" key={type}>{<div aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-15 blur-2xl" style={{
                    backgroundColor: d.color
                  }} />}{<div className="flex items-center justify-between gap-2">{<div className="flex items-center gap-2.5">{<span className="size-3 shrink-0 rounded-full" style={{
                        backgroundColor: d.color,
                        boxShadow: `0 0 10px ${d.color}`
                      }} />}{<h3 className="text-sm font-bold uppercase tracking-[0.15em] text-white/90">{d.name}</h3>}</div>}{<span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/30">W{d.unlockWave}</span>}</div>}{<>{<p className="text-[10px] uppercase tracking-[0.2em] text-white/35">{d.brain}{" · "}{d.flying ? "flying" : "ground"}{" · "}{d.score}{" pts"}</p>}{<div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-2 text-center">{<div>{<div className="text-[9px] uppercase tracking-wider text-white/30">HP</div>}{<div className="font-mono text-sm font-bold text-[#ff8fa3]">{d.hp}</div>}</div>}{<div>{<div className="text-[9px] uppercase tracking-wider text-white/30">DMG</div>}{<div className="font-mono text-sm font-bold text-[#ff7847]">{d.damage}</div>}</div>}{<div>{<div className="text-[9px] uppercase tracking-wider text-white/30">SPD</div>}{<div className="font-mono text-sm font-bold text-[#6bf0c2]">{d.speed}</div>}</div>}</div>}</>}</div>;
              })}</div>}</div>}</TabsContent>}{<TabsContent value="tyrants" className="min-h-0 flex-1">{<ScrollArea className="h-full">{BOSS_DEFS.filter(boss => meta.seenBosses.includes(boss.id)).length === 0 ? <p className="px-1 py-8 text-center text-[11px] italic leading-relaxed text-white/35">No tyrants faced yet. Survive to a wave-10 multiple and one will find you.</p> : <div className="grid grid-cols-1 gap-3 pb-4 pr-3 md:grid-cols-2">{BOSS_DEFS.filter(boss => meta.seenBosses.includes(boss.id)).map((boss, i) => {
                /* P2-2: only tyrants actually faced render — no locked
                   silhouettes, no wave hints for the unmet. */
                return <div className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md" style={{
                  boxShadow: `inset 0 40px 70px -50px ${boss.color}`
                }} key={boss.id}>{<div className="flex items-start justify-between gap-3">{<div>{<SectionLabel>{"Wave "}{10 * (i + 1)}</SectionLabel>}{<h3 className="mt-1 font-serif text-xl font-bold" style={{
                        color: boss.color,
                        textShadow: `0 0 18px ${boss.color}55`
                      }}>{boss.name}</h3>}{<p className="text-xs italic text-white/50">{boss.title}</p>}</div>}{<Crown className="size-5 shrink-0" style={{
                      color: boss.color
                    }} />}</div>}{<>{<p className="text-xs leading-relaxed text-white/55">{boss.mechanics}</p>}{<div className="mt-1 flex gap-4 border-t border-white/5 pt-2 font-mono text-xs">{<span className="text-[#ff8fa3]">{"HP "}{boss.hp}</span>}{<span className="text-[#ff7847]">{"DMG "}{boss.damage}</span>}</div>}</>}</div>;
              })}</div>}</ScrollArea>}</TabsContent>}{<TabsContent value="records" className="min-h-0 flex-1">{<ScrollArea className="h-full">{<div className="grid grid-cols-2 gap-3 pb-4 pr-3 sm:grid-cols-3">{[{
                label: "Best Wave",
                value: String(meta.bestWave),
                icon: Trophy,
                color: GOLD
              }, {
                label: "Best Score",
                value: fmtNum(meta.bestScore),
                icon: Star,
                color: GOLD
              }, {
                label: "Best Endless",
                value: String(meta.bestEndless),
                icon: Infinity,
                color: VIOLET
              }, {
                label: "Runs",
                value: fmtNum(meta.runs),
                icon: RotateCcw,
                color: TEAL
              }, {
                label: "Victories",
                value: fmtNum(meta.victories),
                icon: Crown,
                color: GOLD
              }, {
                label: "Total Kills",
                value: fmtNum(meta.totalKills),
                icon: Swords,
                color: CRIMSON
              }, {
                label: "Total Damage",
                value: fmtNum(meta.totalDamage),
                icon: Flame,
                color: "#ff7847"
              }, {
                label: "Time in the Rift",
                value: fmtDuration(meta.totalTimeSec),
                icon: Clock,
                color: TEAL
              }, {
                label: "Mercy Banked",
                value: `${meta.mercyDeaths} falls`,
                icon: HeartPulse,
                color: "#ff8fa3"
              }].map(r => <div className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 p-4 text-center backdrop-blur-md" key={r.label}>{<r.icon className="size-4" style={{
                  color: r.color
                }} />}{<div className="font-serif text-lg font-bold text-white/90">{r.value}</div>}{<SectionLabel>{r.label}</SectionLabel>}</div>)}</div>}</ScrollArea>}</TabsContent>}</Tabs>}</div>}</motion.div>;
}
function SpellCodexCard({
  id
}) {
  const s = SPELLS[id];
  return <div className="relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">{<div aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-15 blur-2xl" style={{
      backgroundColor: s.color
    }} />}{<div className="flex items-start justify-between gap-2">{<div className="flex min-w-0 items-center gap-3">{<img src={assetPath(`/assets/icons/element-${id}.png`)} alt="" width={38} height={38} className="h-[38px] w-[38px] shrink-0 [image-rendering:pixelated]" style={{
          filter: `drop-shadow(0 0 8px ${s.color}aa)`
        }} />}{<div className="min-w-0">{<h3 className="font-serif text-lg font-bold leading-tight text-white/95">{s.name}</h3>}{<p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{
            color: s.color
          }}>{s.tagline}</p>}</div>}</div>}{<span className="shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em]" style={{
        color: s.color,
        borderColor: `${s.color}55`,
        backgroundColor: `${s.color}12`
      }}>{id}</span>}</div>}{<p className="mt-2 flex-1 text-xs leading-relaxed text-white/50">{s.desc}</p>}{<div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">{<div>{<div className="text-[9px] uppercase tracking-wider text-white/30">Aether</div>}{<div className="font-mono text-sm font-bold" style={{
          color: s.color
        }}>{s.manaCost}</div>}</div>}{<div>{<div className="text-[9px] uppercase tracking-wider text-white/30">Cooldown</div>}{<div className="font-mono text-sm font-bold text-white/80">{s.cooldown}s</div>}</div>}{<div>{<div className="text-[9px] uppercase tracking-wider text-white/30">Damage</div>}{<div className="font-mono text-sm font-bold text-white/80">{s.baseDamage > 0 ? s.baseDamage : "—"}</div>}</div>}</div>}</div>;
}
export function CodexScreen() {
  const screen = useRiftStore(s => s.screen);
  return <AnimatePresence>{screen === "codex" && <CodexContent key={"codex"} />}</AnimatePresence>;
}
function CodexContent() {
  const setScreen = useRiftStore(s => s.setScreen);
  const isTouch = useIsTouch();
  const tabCls = "min-h-11 rounded-md px-4 text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors data-[state=active]:bg-white/10 data-[state=active]:text-[#f5c96b]";
  return <motion.div className={SCREEN_BG} initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0
  }} transition={{
    duration: 0.25
  }}>{<AmbientGlows />}{<div className="relative mx-auto flex h-full w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">{<header className="flex shrink-0 items-center justify-between gap-3">{<Button variant="ghost" size="icon" aria-label="Back to menu" onClick={() => setScreen("menu")} className="min-h-11 min-w-11 rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white">{<X />}</Button>}{<div className="text-center">{<h2 className="font-serif text-2xl font-bold uppercase tracking-[0.22em] text-[#f5c96b] [text-shadow:0_0_24px_rgba(245,201,107,0.35)] sm:text-3xl">The Codex</h2>}{<SectionLabel>How to play · what changed · who made it</SectionLabel>}</div>}{<div className="w-10" aria-hidden />}</header>}{<Tabs defaultValue="controls" className="flex min-h-0 flex-1 flex-col gap-4">{<TabsList className="h-auto w-full shrink-0 flex-wrap justify-start gap-1 rounded-lg border border-white/10 bg-black/40 p-1 backdrop-blur-md">{<TabsTrigger value="controls" className={tabCls}>Controls</TabsTrigger>}{<TabsTrigger value="changelog" className={tabCls}>Changelog</TabsTrigger>}{<TabsTrigger value="credits" className={tabCls}>Credits</TabsTrigger>}</TabsList>}{<TabsContent value="controls" className="min-h-0 flex-1">{<ScrollArea className="h-full">{<div className="grid grid-cols-1 gap-3 pb-4 pr-3 sm:grid-cols-2 lg:grid-cols-3">{isTouch ? <>{<ControlsPane title="Touch" now>{<TouchRow badge="LEFT STICK" label="Drag anywhere — move the Archmage" />}{<TouchRow badge="HOLD CAST" label="Auto-target spell — hold to keep attacking" />}{<TouchRow badge="VOLLEY" label="Arcane bolts seek the nearest foe" />}{<TouchRow badge="BLINK" label="Blink step — brief immunity" />}{<TouchRow badge="SURGE" label="Unleash the Surge when full" />}{<TouchRow badge="SPELL" label="Cycle the spell slots" />}</ControlsPane>}{<ControlsPane title="Keyboard & Mouse">{<KbmRows />}</ControlsPane>}</> : <>{<ControlsPane title="Keyboard & Mouse" now>{<KbmRows />}</ControlsPane>}{<ControlsPane title="Touch">{<TouchRow badge="LEFT STICK" label="Drag anywhere — move the Archmage" />}{<TouchRow badge="HOLD CAST" label="Auto-target spell — hold to keep attacking" />}{<TouchRow badge="VOLLEY" label="Arcane bolts seek the nearest foe" />}{<TouchRow badge="BLINK" label="Blink step — brief immunity" />}{<TouchRow badge="SURGE" label="Unleash the Surge when full" />}{<TouchRow badge="SPELL" label="Cycle the spell slots" />}</ControlsPane>}</>}{<ControlsPane title="Gamepad">{<KeyRow keys={["LS"]} label="Move the Archmage" />}{<KeyRow keys={["RS"]} label="Aim the spell" />}{<KeyRow keys={["RT"]} label="Cast — hold to keep casting" />}{<KeyRow keys={["LT"]} label="Volley — hold for bolts" />}{<KeyRow keys={["A"]} label="Blink step — brief immunity" />}{<KeyRow keys={["Y"]} label="Unleash the Surge when full" />}{<KeyRow keys={["X"]} label="Cycle spells" />}{<KeyRow keys={["LB", "RB"]} label="Cycle spells both ways" />}{<KeyRow keys={["D-PAD"]} label="Pick a spell slot" />}{<KeyRow keys={["B", "START"]} label="Pause the trial" />}</ControlsPane>}</div>}</ScrollArea>}</TabsContent>}{<TabsContent value="changelog" className="min-h-0 flex-1">{<ScrollArea className="h-full">{<div className="flex flex-col gap-3 pb-4 pr-3">{CHANGELOG.map(entry => <article className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md" key={entry.version}>{<div aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-[#f5c96b] opacity-[0.1] blur-2xl" />}{<header className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">{<span className="rounded-full border border-[#f5c96b]/40 bg-[#f5c96b]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#f5c96b]">v{entry.version}</span>}{<h3 className="font-serif text-lg font-bold leading-tight text-[#f0e8ff]">{entry.name}</h3>}{<span className="ml-auto font-mono text-[11px] text-white/40">{entry.date}</span>}</header>}{<ul className="relative mt-3 flex flex-col gap-1.5">{entry.notes.map((note, i) => <li className="flex gap-2 text-[13px] leading-relaxed text-[#c9bdf0]" key={i}>{<span className="text-[#f5c96b]">◆</span>}{note}</li>)}</ul>}</article>)}{<CodexHonors />}</div>}</ScrollArea>}</TabsContent>}{<TabsContent value="credits" className="min-h-0 flex-1">{<ScrollArea className="h-full">{<div className="flex flex-col gap-4 pb-4 pr-3">{<p className="text-[12px] leading-relaxed text-[#c9bdf0]">The mage, the bestiary, the terrains, the spell icons and the particle effects come from generous open-source packs, shared freely for game makers — our gratitude goes to their authors. The rest of the game is conjured in code.</p>}{<AssetAttributionList />}</div>}</ScrollArea>}</TabsContent>}</Tabs>}</div>}</motion.div>;
}
/** The changelog's honorary section (10-f): packs + authors from the same
 *  manifest source as the Credits tab, rendered as a roll of honor. */
function CodexHonors() {
  const [packs, setPacks] = useState(FALLBACK_PACKS);
  useEffect(() => {
    fetchPackCredits().then(setPacks).catch(() => {});
  }, []);
  return <section className="relative overflow-hidden rounded-xl border border-[#43e8d8]/25 bg-[#43e8d8]/[0.04] p-5 backdrop-blur-md">{<div aria-hidden className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-[#43e8d8] opacity-[0.08] blur-2xl" />}{<header className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">{<span className="rounded-full border border-[#43e8d8]/40 bg-[#43e8d8]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#43e8d8]">Honors</span>}{<h3 className="font-serif text-lg font-bold leading-tight text-[#f0e8ff]">The rift honors its makers</h3>}</header>}{<ul className="relative mt-3 flex flex-col gap-1.5">{packs.map(p => <li className="flex flex-wrap gap-x-2 text-[13px] leading-relaxed text-[#c9bdf0]" key={p.id}>{<span className="text-[#43e8d8]">◆</span>}{<span className="font-semibold text-[#f0e8ff]">{p.pack}</span>}{<span className="text-white/35">by</span>}{<span>{p.author}</span>}{<span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{p.licenseId}</span>}</li>)}{<li className="flex gap-2 pt-1 text-[12px] italic text-[#8f7bff]">{<span className="text-[#43e8d8]">◆</span>}Shared freely so worlds like this one can exist — thank you, all of you.</li>}</ul>}</section>;
}
/** One device pane in the Codex controls tab. `now` marks the CURRENT
 *  device — its rite is listed first on every layout. */
function ControlsPane({
  title,
  now = false,
  children
}) {
  return <div className="relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">{<div className="mb-2 flex items-center gap-2">{<div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b]">{title}</div>}{now && <span className="rounded-full border border-[#43e8d8]/40 bg-[#43e8d8]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-[#43e8d8]">This device</span>}</div>}{children}</div>;
}
/** Keyboard & mouse rite — mirrors GameShell.tsx's actual mappings
 *  (WASD/arrows, LMB/RMB, Space, F, P, Q/E, 1/2/3, wheel, M, F3). */
function KbmRows() {
  return <>{<KeyRow keys={["W", "A", "S", "D"]} label="Move — arrow keys work too" />}{<KeyRow keys={["LMB"]} label="Cast — hold to keep casting" />}{<KeyRow keys={["RMB"]} label="Volley — bolts seek on their own" />}{<KeyRow keys={["SPACE"]} label="Blink step — brief immunity" />}{<KeyRow keys={["F"]} label="Unleash the Surge when full" />}{<KeyRow keys={["P"]} label="Pause the trial" />}{<KeyRow keys={["Q", "E"]} label="Cycle spells both ways" />}{<KeyRow keys={["1", "2", "3"]} label="Pick a spell slot" />}{<KeyRow keys={["WHEEL"]} label="Cycle spells during a run" />}{<KeyRow keys={["F3"]} label="Telemetry overlay" />}{<KeyRow keys={["M"]} label="Mute all audio" />}</>;
}
/* ================================================================== */ /*  SETTINGS                                                           */ /* ================================================================== */ /*  11-c — the panel is four tabs (Audio / Video & Graphics / Rift Mercy /
                                                                                                                                                                                                                            Save Slots) over the exact store wiring the old single column had:
                                                                                                                                                                                                                            every control still calls patchSettings / setMercyTier / the slot
                                                                                                                                                                                                                            actions. Only the layout changed. The dialog's open/close flow
                                                                                                                                                                                                                            (settingsOpen + the built-in Close button) is untouched. */ /** Shared scroll classes for a tab body. The dialog frame is fixed
                                                                                                                                                                                                                                                                                        *  (h-[85vh]) so every tab renders at the same height and the tab bar
                                                                                                                                                                                                                                                                                        *  never moves; each body scrolls inside. */const SETTINGS_TAB_SCROLL = "rift-scroll min-h-0 flex-1 overflow-y-auto pr-1 pb-1";
/** Live fullscreen state for the Video tab's Display mode row (11-c).
 *  Reflects the document's REAL fullscreen element — never a stored setting —
 *  and surfaces environments that refuse the request (sandboxed previews).
 *  Component-level: the listener outlives dialog open/close and is removed
 *  on unmount. */
function useFullscreenLive() {
  const [isFs, setIsFs] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const sync = () => {
      const live = !!document.fullscreenElement;
      setIsFs(live);
      if (live) setBlocked(false); // a success clears any stale refusal
    };
    const onError = () => setBlocked(true);
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("fullscreenerror", onError);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("fullscreenerror", onError);
    };
  }, []);
  /** Call only from a click handler — browsers demand a user gesture.
  *  Refusals (iframe sandbox, missing API) surface as `blocked`; nothing
  *  is ever thrown to the console. */
  const toggle = () => {
    setBlocked(false);
    try {
      if (document.fullscreenElement) {
        Promise.resolve(document.exitFullscreen()).catch(() => setBlocked(true));
      } else {
        Promise.resolve(document.documentElement.requestFullscreen()).catch(() => setBlocked(true));
      }
    } catch {
      setBlocked(true);
    }
  };
  return {
    isFs,
    blocked,
    toggle
  };
}
export function SettingsModal() {
  const settingsOpen = useRiftStore(s => s.settingsOpen);
  const closeSettings = useRiftStore(s => s.closeSettings);
  const meta = useRiftStore(s => s.meta);
  const patchSettings = useRiftStore(s => s.patchSettings);
  const setMercyTier = useRiftStore(s => s.setMercyTier);
  const st = meta.settings;
  const maxTier = Math.min(MERCY_MAX_TIER, meta.mercyDeaths);
  const fs = useFullscreenLive();
  /** Patch a setting AND push volumes to the audio synth live. */
  const apply = patch => {
    patchSettings(patch);
    const next = {
      ...st,
      ...patch
    };
    sfx.setMuted(next.muted);
    sfx.setVolumes(next.master, next.music, next.sfx, next.ambience);
  };
  const tabCls = "min-h-11 rounded-md px-4 text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors data-[state=active]:bg-white/10 data-[state=active]:text-[#f5c96b]";
  return <Dialog open={settingsOpen} onOpenChange={o => {
    if (!o) closeSettings();
  }}>{<DialogContent className="dark flex h-[85vh] max-h-[85vh] flex-col gap-4 overflow-hidden border-white/10 bg-[#14101f]/95 p-4 safe-b-5 text-white/90 backdrop-blur-xl sm:max-w-xl sm:p-5">{<div className="shrink-0">{<DialogTitle className="font-serif text-lg font-bold uppercase tracking-[0.25em] text-[#f5c96b]">Settings</DialogTitle>}{<DialogDescription className="mt-1 text-xs text-white/40">Tune the ritual to your liking.</DialogDescription>}</div>}{<Tabs defaultValue="audio" className="flex min-h-0 flex-1 flex-col gap-3">{<TabsList className="h-auto w-full shrink-0 flex-wrap justify-center gap-1 rounded-lg border border-white/10 bg-black/40 p-1 backdrop-blur-md">{<TabsTrigger value="audio" className={tabCls}>Audio</TabsTrigger>}{<TabsTrigger value="video" className={tabCls}>Video & Graphics</TabsTrigger>}{<TabsTrigger value="mercy" className={tabCls}>Rift Mercy</TabsTrigger>}{<TabsTrigger value="saves" className={tabCls}>Save Slots</TabsTrigger>}</TabsList>}{<TabsContent value="audio" className={SETTINGS_TAB_SCROLL}>{<div className="flex flex-col gap-4">{<p className="text-[11px] leading-relaxed text-white/45">Balance the voices of the rift — music, ambience and spellwork each carry their own weight.</p>}{<SliderRow label="Master" icon={Volume2} value={st.master} disabled={st.muted} onChange={v => apply({
              master: v
            })} />}{<SliderRow label="Music" icon={Music4} value={st.music} disabled={st.muted} onChange={v => apply({
              music: v
            })} />}{<SliderRow label="Ambience" icon={Wind} value={st.ambience} disabled={st.muted} step={5} onChange={v => apply({
              ambience: v
            })} />}{<SliderRow label="Effects" icon={AudioLines} value={st.sfx} disabled={st.muted} onChange={v => apply({
              sfx: v
            })} />}{<div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3">{<div>{<div className="text-xs uppercase tracking-wider text-white/70">Mute all</div>}{<div className="text-[10px] text-white/35">Silence every channel at once</div>}</div>}{<Switch checked={st.muted} onCheckedChange={v => apply({
                muted: v
              })} aria-label="Mute all audio" className="data-[state=checked]:bg-[#ff4d6b]" />}</div>}{st.muted && <p role="status" className="rounded-lg border border-[#f5c96b]/25 bg-[#f5c96b]/[0.07] px-3 py-2 text-[11px] leading-relaxed text-[#f5c96b]/90">All sound is muted. The sliders hold their levels and return the moment you unmute.</p>}</div>}</TabsContent>}{<TabsContent value="video" className={SETTINGS_TAB_SCROLL}>{<div className="flex flex-col gap-4">{<p className="text-[11px] leading-relaxed text-white/45">Shape what you see, how it moves, and how hard the engine works for it.</p>}{<section className="flex flex-col gap-2">{<SectionLabel>Feel</SectionLabel>}{<ToggleRow label="Screen shake" hint="The world trembles on impact" checked={st.screenShake} onChange={v => apply({
                screenShake: v
              })} />}{<ToggleRow label="Damage numbers" hint="Show floating damage digits" checked={st.damageNumbers} onChange={v => apply({
                damageNumbers: v
              })} />}{<ToggleRow label="Reduce flashes" hint="Softer strobes and pulses" checked={st.reduceFlashes} onChange={v => apply({
                reduceFlashes: v
              })} />}{<ToggleRow label="Aim assist" hint="Gentle pull toward nearby foes" checked={st.aimAssist} onChange={v => apply({
                aimAssist: v
              })} />}</section>}{<section className="flex flex-col gap-2">{<SectionLabel>Picture</SectionLabel>}{<div className="flex min-h-11 items-center gap-3">{<Gauge className="size-4 shrink-0 text-white/40" />}{<span className="w-20 shrink-0 text-xs uppercase tracking-wider text-white/60">Quality</span>}{<Slider value={[Math.round(st.quality * 100)]} min={50} max={100} step={5} aria-label="Render quality" onValueChange={v => apply({
                  quality: v[0] / 100
                })} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-[#43e8d8] [&_[data-slot=slider-thumb]]:border-[#43e8d8] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />}{<span className="w-9 text-right font-mono text-xs text-[#43e8d8]">{Math.round(st.quality * 100)}</span>}</div>}{<div className="flex min-h-11 items-center gap-3">{<Sun className="size-4 shrink-0 text-white/40" />}{<span className="w-20 shrink-0 text-xs uppercase tracking-wider text-white/60">Brightness</span>}{<Slider value={[st.brightness]} min={50} max={250} step={5} aria-label="Brightness" onValueChange={v => apply({
                  brightness: v[0]
                })} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-[#f5c96b] [&_[data-slot=slider-thumb]]:border-[#f5c96b] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />}{<span className="w-9 text-right font-mono text-xs text-[#f5c96b]">{st.brightness}</span>}</div>}{<div className="flex min-h-11 items-center gap-3">{<Scan className="size-4 shrink-0 text-white/40" />}{<span className="w-20 shrink-0 text-xs uppercase tracking-wider text-white/60">Field of view</span>}{<Slider value={[st.fov]} min={45} max={80} step={1} aria-label="Field of view in degrees" onValueChange={v => apply({
                  fov: v[0]
                })} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-[#43e8d8] [&_[data-slot=slider-thumb]]:border-[#43e8d8] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />}{<span className="w-9 text-right font-mono text-xs text-[#43e8d8]">{st.fov}°</span>}</div>}</section>}{<section className="flex flex-col gap-2">{<SectionLabel>Performance</SectionLabel>}{<ToggleRow label="Auto performance" hint="Eases resolution to target 60 fps" checked={st.autoQuality} onChange={v => apply({
                autoQuality: v
              })} />}{<ToggleRow label="Performance overlay" hint="FPS and render telemetry · F3" checked={st.perfOverlay} onChange={v => apply({
                perfOverlay: v
              })} />}{<div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">{<div className="text-xs uppercase tracking-wider text-white/70">Frame-rate cap</div>}{<div className="mt-1 text-[10px] text-white/35">Gentler on hot phones and low batteries</div>}{<div className="mt-2 flex flex-wrap gap-2">{([[0, "Uncapped"], [30, "30 fps"], [60, "60 fps"]] as [number, string][]).map(([v, label]) => <MercyChip key={v} active={st.fpsCap === v} onClick={() => apply({
                fpsCap: v
              })}>{label}</MercyChip>)}</div>}</div>}{<ToggleRow label="Battery saver" hint="Below 20% charge: ease quality and cap 30 fps" checked={st.batterySaver} onChange={v => apply({
                batterySaver: v
              })} />}</section>}{<section className="flex flex-col gap-2">{<SectionLabel>Display</SectionLabel>}{<ToggleRow label="Auto immersive" hint="Touch devices snap to fullscreen landscape" checked={st.autoImmersive} onChange={v => apply({
                autoImmersive: v
              })} />}{<div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">{<div className="flex min-h-11 items-center justify-between gap-3">{<div>{<div className="text-xs uppercase tracking-wider text-white/70">Display mode</div>}{<div className="text-[10px] text-white/35">Fullscreen — the whole screen, edge to edge</div>}</div>}{<Switch checked={fs.isFs} onCheckedChange={fs.toggle} aria-label="Toggle fullscreen" className="data-[state=checked]:bg-[#43e8d8]" />}</div>}{<p className={`mt-1 text-[10px] leading-relaxed ${fs.blocked ? "text-[#ff4d6b]/90" : "text-white/35"}`}>{fs.blocked ? "Fullscreen is blocked here — this view will not hand over the screen." : "A live view state, not a saved setting — your browser asks for a tap each visit, so it stays out of your save."}</p>}</div>}{<div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">{<div className="text-xs uppercase tracking-wider text-white/70">Element palette</div>}{<div className="mt-1 text-[10px] text-white/35">Colorblind-safe hues for every spell — shape and name cues always carry identity too</div>}{<div className="mt-2 flex flex-wrap gap-2">{PALETTE_IDS.map(p => <MercyChip key={p} active={st.palette === p} onClick={() => apply({
                palette: p
              })}>{PALETTE_LABELS[p]}</MercyChip>)}</div>}</div>}{<div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">{<div className="text-xs uppercase tracking-wider text-white/70">HUD density</div>}{<div className="mt-1 text-[10px] text-white/35">Compact hides the optional chrome; Expanded breathes</div>}{<div className="mt-2 flex flex-wrap gap-2">{([["compact", "Compact"], ["standard", "Standard"], ["expanded", "Expanded"]] as [string, string][]).map(([v, label]) => <MercyChip key={v} active={st.hudDensity === v} onClick={() => apply({
                hudDensity: v
              })}>{label}</MercyChip>)}</div>}</div>}{<div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">{<div className="text-xs uppercase tracking-wider text-white/70">Low-HP vignette</div>}{<div className="mt-1 text-[10px] text-white/35">The crimson edge when vitality runs low — independent of Reduce flashes</div>}{<div className="mt-2 flex flex-wrap gap-2">{([[0, "Off"], [0.35, "Low"], [0.7, "Medium"], [1, "High"]] as [number, string][]).map(([v, label]) => <MercyChip key={label} active={Math.abs(st.vignette - v) < 0.01} onClick={() => apply({
                vignette: v
              })}>{label}</MercyChip>)}</div>}</div>}</section>}{<section className="flex flex-col gap-2">{<SectionLabel>Touch & Comfort</SectionLabel>}{<ToggleRow label="Left-handed layout" hint="Mirror the thumb cluster for left-thumb play" checked={st.leftHanded} onChange={v => apply({
                leftHanded: v
              })} />}{<ToggleRow label="One-thumb casting" hint="Cast toward your move stick's direction" checked={st.tapToCast} onChange={v => apply({
                tapToCast: v
              })} />}{<ToggleRow label="Haptic cues" hint="A pulse when spells ready, hits land, tyrants arrive" checked={st.haptics} onChange={v => apply({
                haptics: v
              })} />}{<ToggleRow label="Resume countdown" hint="A 3-2-1 breath before the rift moves again" checked={st.resumeCountdown} onChange={v => apply({
                resumeCountdown: v
              })} />}</section>}</div>}</TabsContent>}{<TabsContent value="mercy" className={SETTINGS_TAB_SCROLL}>{<div className="flex flex-col gap-4">{<p className="text-[11px] leading-relaxed text-white/45">The rift relents for the fallen. AUTO spends your banked falls ({meta.mercyDeaths}{" banked) and softens each return. Locked tiers unlock as you fall — tier 1 grants 2% mercy, +4% per tier beyond."}</p>}{<div className="flex flex-wrap gap-2">{<MercyChip active={meta.mercyTierSel === -1} onClick={() => setMercyTier(-1)}>Auto</MercyChip>}{Array.from({
                length: maxTier
              }, (_, i) => i + 1).map(t => <MercyChip active={meta.mercyTierSel === t} onClick={() => setMercyTier(t)} key={t}>{t}{<span className="ml-1 font-mono text-[9px] opacity-60">{Math.round(mercyTierBase(t) * 100)}%</span>}</MercyChip>)}{maxTier === 0 && <span className="self-center text-[10px] italic text-white/30">No tiers unlocked — fall once to earn mercy.</span>}</div>}{<p className="rounded-lg border border-[#6bf0c2]/25 bg-[#6bf0c2]/[0.06] px-3 py-2 text-[11px] leading-relaxed text-[#6bf0c2]/90">{meta.mercyTierSel === -1 ? "AUTO: the rift spends your banked falls for you." : `Tier ${meta.mercyTierSel} is locked in — ${Math.round(mercyTierBase(meta.mercyTierSel) * 100)}% base mercy, growing a little each wave.`}</p>}</div>}</TabsContent>}{<TabsContent value="saves" className={SETTINGS_TAB_SCROLL}>{<SaveSlots />}</TabsContent>}</Tabs>}</DialogContent>}</Dialog>;
}
/** Save-slot cards (10-g, restyled 11-c): three slots, switch or overwrite,
 *  menu-only. Summaries re-read from localStorage whenever the active slot or
 *  meta changes (peekSlots is a plain read — no subscription needed).
 *
 *  Destructive acts use a TWO-STEP arm (11-c): the first click arms a red
 *  strip ("Replace slot N?" / "Unmake everything?") with a Cancel affordance;
 *  the second click performs the unchanged store action. A transient status
 *  line then confirms what happened and clears itself (~2.5s). */
function SaveSlots() {
  const activeSlot = useRiftStore(s => s.activeSlot);
  const switchSlot = useRiftStore(s => s.switchSlot);
  const overwriteSlot = useRiftStore(s => s.overwriteSlot);
  const resetProgress = useRiftStore(s => s.resetProgress);
  const phase = useRiftStore(s => s.phase);
  const meta = useRiftStore(s => s.meta);
  /* bump: a local counter nudging the peek refresh after THIS component's own
   actions (overwrite writes another slot's key without touching the store's
   meta/activeSlot — the memo keys alone would go stale). */
  const [bump, setBump] = useState(0);
  /* armedOver: the slot whose Overwrite was clicked once (null = none).
   armedReset: Reset progress was clicked once. Arming one disarms the
   other — only one live confirmation at a time. */
  const [armedOver, setArmedOver] = useState<number | null>(null);
  const [armedReset, setArmedReset] = useState(false);
  /* transient feedback — the game UI has no toast system, so 11-c uses an
   inline status line that clears itself. */
  const [notice, setNotice] = useState<string | null>(null);
  /* plain localStorage reads, recomputed when the slot, meta or a local
   action changes — idempotent + client-only (this modal renders solely on
   user action) */
  const peeks = useMemo(() => peekSlots(), [activeSlot, meta, bump]);
  const inRun = phase !== "menu";
  /* the status line clears itself after ~2.5s */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);
  const done = msg => {
    setBump(b => b + 1);
    setNotice(msg);
  };
  return <div className="flex flex-col gap-4">{<p className="text-[11px] leading-relaxed text-white/45">Three mages may live on this device. Switch loads a slot's whole story: relics, records and discoveries; Overwrite copies your current mage onto a slot. Both work from the menu only — a live trial keeps its own slot.</p>}{notice && <p role="status" aria-live="polite" className="rounded-lg border border-[#6bf0c2]/30 bg-[#6bf0c2]/[0.08] px-3 py-2 text-[11px] leading-relaxed text-[#6bf0c2]">{notice}</p>}{peeks.map((peek, i) => {
      const active = i === activeSlot;
      const armed = armedOver === i;
      return <div className={`flex flex-col gap-2.5 rounded-lg border px-3 py-2.5 ${armed ? "border-[#ff4d6b]/50 bg-[#ff4d6b]/[0.07]" : active ? "border-[#9a7bff]/45 bg-[#9a7bff]/[0.08]" : "border-white/10 bg-black/30"}`} key={i}>{<div className="min-w-0">{<div className="flex items-center gap-2">{<span className="text-xs font-bold uppercase tracking-wider text-white/80">{"Slot "}{i + 1}</span>}{active && <span className="rounded-full border border-[#9a7bff]/50 bg-[#9a7bff]/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-[#c9b8ff]">Playing</span>}</div>}{<div className="mt-0.5 truncate text-[11px] text-white/50">{peek ? `Best wave ${peek.bestWave} · ${fmtNum(peek.shards)} glyphs · ${peek.runs} trials` : "Empty — a fresh mage"}</div>}</div>}{armed ? /* step two — the armed strip (red) */<div className="flex flex-col gap-2 rounded-md border border-[#ff4d6b]/40 bg-[#ff4d6b]/10 p-2.5">{<p className="text-[11px] font-bold uppercase tracking-wider text-[#ff4d6b]">{"Replace slot "}{i + 1}?</p>}{<p className="text-[11px] leading-relaxed text-white/60">{peek ? "Their relics, records and discoveries become a copy of your current mage. There is no way back through the rift." : "The empty slot fills with a copy of your current mage. Nothing is lost."}</p>}{<div className="flex flex-wrap gap-2">{<Button variant="outline" onClick={() => setArmedOver(null)} className="h-11 rounded-md border-white/15 bg-transparent px-4 text-[11px] font-bold uppercase tracking-wider text-white/70 hover:bg-white/5 hover:text-white">Cancel</Button>}{<Button variant="outline" onClick={() => {
              overwriteSlot(i);
              setArmedOver(null);
              done(`Slot ${i + 1} now holds a copy of your current mage.`);
            }} className="h-11 rounded-md border-[#ff4d6b]/50 bg-[#ff4d6b]/15 px-4 text-[11px] font-bold uppercase tracking-wider text-[#ff4d6b] hover:bg-[#ff4d6b] hover:text-white">Replace</Button>}</div>}</div> : /* step one — the plain actions */<div className="flex flex-wrap gap-2">{<Button variant="outline" disabled={active || inRun} onClick={() => {
            switchSlot(i);
            done(`Now playing slot ${i + 1} — their whole story is live.`);
          }} title={inRun ? "Finish or leave the trial first" : `Load slot ${i + 1}`} className="h-11 rounded-md border-white/15 bg-transparent px-4 text-[11px] font-bold uppercase tracking-wider text-white/75 hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30">{<Play className="size-3.5" />}{" Switch"}</Button>}{<Button variant="outline" disabled={active || inRun} onClick={() => {
            setArmedOver(i);
            setArmedReset(false);
          }} title={inRun ? "Finish or leave the trial first" : `Copy the current mage onto slot ${i + 1}`} className="h-11 rounded-md border-white/15 bg-transparent px-4 text-[11px] font-bold uppercase tracking-wider text-white/75 hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30">{<Copy className="size-3.5" />}{" Overwrite"}</Button>}</div>}</div>;
    })}{inRun && <p className="text-[10px] italic text-white/35">Slot switching unlocks from the menu — a live trial keeps its slot.</p>}{<section className="flex flex-col gap-3 rounded-lg border border-[#ff4d6b]/25 bg-[#ff4d6b]/[0.05] p-3">{<SectionLabel className="flex items-center gap-2 !text-[#ff4d6b]/80">{<TriangleAlert className="size-3.5" />}{" Danger Zone"}</SectionLabel>}{<p className="text-[11px] leading-relaxed text-white/45">Erase THIS SLOT's shards, relics, records and codex discoveries — the other save slots are untouched. Settings are kept.</p>}{armedReset ? <div className="flex flex-col gap-2 rounded-md border border-[#ff4d6b]/40 bg-[#ff4d6b]/10 p-2.5">{<p className="text-[11px] font-bold uppercase tracking-wider text-[#ff4d6b]">Unmake everything?</p>}{<p className="text-[11px] leading-relaxed text-white/60">All shards, relics, records and codex discoveries return to dust. There is no way back through the rift.</p>}{<div className="flex flex-wrap gap-2">{<Button variant="outline" onClick={() => setArmedReset(false)} className="h-11 rounded-md border-white/15 bg-transparent px-4 text-[11px] font-bold uppercase tracking-wider text-white/70 hover:bg-white/5 hover:text-white">Keep my progress</Button>}{<Button variant="outline" onClick={() => {
            resetProgress();
            setArmedReset(false);
            done("Progress unmade — this slot starts fresh. Settings were kept.");
          }} className="h-11 rounded-md border-[#ff4d6b]/50 bg-[#ff4d6b]/15 px-4 text-[11px] font-bold uppercase tracking-wider text-[#ff4d6b] hover:bg-[#ff4d6b] hover:text-white">Unmake it all</Button>}</div>}</div> : <Button variant="outline" onClick={() => {
        setArmedReset(true);
        setArmedOver(null);
      }} className="h-11 w-fit rounded-md border-[#ff4d6b]/40 bg-transparent px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff4d6b] hover:bg-[#ff4d6b]/10 hover:text-[#ff4d6b]">{<Trash2 />}{" Reset progress"}</Button>}</section>}</div>;
}
function SliderRow({
  label,
  icon: Icon,
  value,
  onChange,
  disabled,
  step = 1
}) {
  return (
    /* 44px-tall row; the slider root is h-11 so its whole strip is a touch
    target (the thumb keeps the app-wide 16px bead). */
    <div className="flex min-h-11 items-center gap-3">{<Icon className="size-4 shrink-0 text-white/40" />}{<span className="w-16 shrink-0 text-xs uppercase tracking-wider text-white/60">{label}</span>}{<Slider value={[Math.round(value * 100)]} min={0} max={100} step={step} disabled={disabled} aria-label={`${label} volume`} onValueChange={v => onChange(v[0] / 100)} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-[#f5c96b] [&_[data-slot=slider-thumb]]:border-[#f5c96b] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />}{<span className="w-8 text-right font-mono text-xs text-[#f5c96b]">{Math.round(value * 100)}</span>}</div>
  );
}
function ToggleRow({
  label,
  hint,
  checked,
  onChange
}) {
  return <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">{<div>{<div className="text-xs uppercase tracking-wider text-white/70">{label}</div>}{<div className="text-[10px] text-white/35">{hint}</div>}</div>}{<Switch checked={checked} onCheckedChange={onChange} aria-label={label} className="data-[state=checked]:bg-[#f5c96b]" />}</div>;
}
function MercyChip({
  active,
  onClick,
  children
}: {
  active?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return <button type="button" onClick={onClick} className={cn("min-h-11 rounded-md border px-3 text-xs font-bold uppercase tracking-wider transition-colors", active ? "border-[#6bf0c2]/60 bg-[#6bf0c2]/15 text-[#6bf0c2] shadow-[0_0_14px_rgba(107,240,194,0.2)]" : "border-white/10 bg-black/30 text-white/45 hover:border-white/25 hover:text-white/75")}>{children}</button>;
}
export function GameOverScreen() {
  const phase = useRiftStore(s => s.phase);
  const stats = useRiftStore(s => s.stats);
  const show = phase === "gameover" && !!stats && !stats.triumph;
  return <AnimatePresence>{show && <GameOverContent key={"gameover"} />}</AnimatePresence>;
}
function GameOverContent() {
  const stats = useRiftStore(s => s.stats);
  if (!stats) return null;
  /* payout comes from the milestone result (single source of truth — the
   store banks exactly this number; audit P1-1). For an endless death the
   cumulative glyphs were already banked at 100% by the victory milestone,
   so the row shows the post-victory DELTA glyphs the 25% tithe applies to. */
  const payout = stats.payout;
  const earned = stats.delta ? stats.delta.glyphs : stats.glyphs;
  return <motion.div className="dark fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-md" initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0
  }} transition={{
    duration: 0.3
  }}>{<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<div className="absolute left-1/2 top-1/2 h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.08] blur-[120px]" style={{
        backgroundColor: CRIMSON
      }} />}</div>}{<motion.div className="relative my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-[#ff4d6b]/25 bg-[#14080f]/95 p-6 shadow-[0_0_70px_rgba(255,77,107,0.14)] sm:p-8" initial={{
      opacity: 0,
      y: 24,
      scale: 0.97
    }} animate={{
      opacity: 1,
      y: 0,
      scale: 1
    }} transition={{
      duration: 0.35,
      ease: "easeOut"
    }}>{<div className="text-center">{<Skull className="mx-auto size-6 text-[#ff4d6b]/70" />}{<h2 className="mt-2 text-balance font-serif text-2xl font-bold uppercase tracking-[0.1em] text-[#ff4d6b] [text-shadow:0_0_32px_rgba(255,77,107,0.5)] sm:text-3xl sm:tracking-[0.14em] md:text-4xl">The Rift Claims You</h2>}{stats.endless && <Badge className="mt-3 border-[#9a7bff]/40 bg-[#9a7bff]/10 text-[10px] uppercase tracking-[0.2em] text-[#9a7bff]">Fallen in the Endless Echo</Badge>}{<div className="mt-4 flex items-baseline justify-center gap-3">{<span className="text-[10px] uppercase tracking-[0.3em] text-white/40">Fell at wave</span>}{<span className="font-serif text-6xl font-bold leading-none text-white [text-shadow:0_0_28px_rgba(255,255,255,0.25)]">{stats.wave}</span>}</div>}{<p className="mt-2 text-xs italic text-white/40">{stats.wave >= VICTORY_WAVE - 5 ? "So close to the seal. The rift remembers." : "The rift remembers. Return stronger."}</p>}</div>}{(stats.killedBy || (stats.lastHits && stats.lastHits.length > 0)) && <div className="mt-4 rounded-lg border border-[#ff4d6b]/20 bg-black/30 px-4 py-3">{<div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#ff4d6b]/70">Slain by {stats.killedBy ?? "the rift's aftermath"}</div>}{stats.lastHits && stats.lastHits.length > 0 && <ul className="mt-2 flex flex-col gap-1">{stats.lastHits.map((h, i) => <li key={i} className="flex items-baseline justify-between gap-4 text-[11px] text-white/50">{<span className="truncate">{h.cause}</span>}{<span className="shrink-0 font-mono font-bold text-[#ff8fa3]">−{h.amount}</span>}</li>)}</ul>}</div>}{<Separator className="my-6 bg-white/10" />}{<div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">{[["Score", fmtNum(stats.score)], ["Kills", fmtNum(stats.kills)], ["Damage Dealt", fmtNum(Math.round(stats.damage))], ["Time Survived", fmtTime(stats.timeSec)], ["Resonances Woven", String(stats.newCombos.length)], ["Tyrants Slain", String(stats.bossesSlain.length)]].map(([label, value]) => <div className="text-center" key={label}>{<div className="font-serif text-xl font-bold text-[#f5c96b]">{value}</div>}{<SectionLabel className="mt-1">{label}</SectionLabel>}</div>)}</div>}{earned > 0 && <div className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-[#f5c96b]/20 bg-[#f5c96b]/5 px-4 py-3 text-xs text-white/60">{<Gem className="size-3.5 text-[#f5c96b]" />}{<span>{<span className="font-mono font-bold text-[#f5c96b]">{earned}</span>}{" aether glyphs earned ·"}{" "}{<span className="font-mono font-bold text-[#f5c96b]">{payout}</span>}{" banked"}{<span className="text-white/35">{" (75% paid to the rift)"}</span>}</span>}</div>}{<p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">{"seed · "}{stats.seed}</p>}{<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">{<Button onClick={() => {
          sfx.click();
          ui.onGameOverRetry(stats.seed);
        }} className="h-12 rounded-lg border border-[#f5c96b]/50 bg-[#f5c96b]/10 text-sm font-bold uppercase tracking-[0.25em] text-[#f5c96b] hover:bg-[#f5c96b]/20 active:scale-[0.98]">{<RotateCcw />}{" Re-Enter Same Rift"}</Button>}{<Button variant="outline" onClick={() => {
          sfx.click();
          ui.onGameOverMenu();
        }} className="h-12 rounded-lg border-white/15 bg-black/30 text-sm font-bold uppercase tracking-[0.25em] text-white/70 hover:bg-white/5 hover:text-white active:scale-[0.98]">{<House />}{" Return"}</Button>}{<p className="col-span-full text-center text-[10px] uppercase tracking-[0.22em] text-white/40">Re-Enter replays the same seed, from wave 1</p>}</div>}</motion.div>}</motion.div>;
}
export function VictoryCredits() {
  const phase = useRiftStore(s => s.phase);
  const stats = useRiftStore(s => s.stats);
  const show = phase === "credits" && !!stats;
  return <AnimatePresence>{show && <CreditsContent key={"credits"} />}</AnimatePresence>;
}
function CreditsContent() {
  const stats = useRiftStore(s => s.stats);
  if (!stats) return null;
  const deeds = [["Waves Survived", String(stats.wave)], ["Foes Unmade", fmtNum(stats.kills)], ["Damage Dealt", fmtNum(Math.round(stats.damage))], ["New Resonances", String(stats.newCombos.length)], ["Tyrants Slain", String(stats.bossesSlain.length)], ["Time in the Rift", fmtTime(stats.timeSec)], ["Aether Glyphs", `${fmtNum(stats.payout)} · 100% banked on triumph`]];
  return <motion.div className={cn(SCREEN_BG, "z-50 overflow-y-auto")} initial={{
    opacity: 0
  }} animate={{
    opacity: 1
  }} exit={{
    opacity: 0
  }} transition={{
    duration: 0.4
  }}>{<AmbientGlows />}{<div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-8 px-4 py-12">{<div className="relative text-center">{<div aria-hidden className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-[90px]" style={{
          backgroundColor: GOLD
        }} />}{<motion.p className="relative text-[10px] font-semibold uppercase tracking-[0.5em] text-[#43e8d8]" initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 0.1,
          duration: 0.4
        }}>Victory</motion.p>}{<motion.h2 className="relative mt-2 text-balance font-serif text-3xl font-bold uppercase tracking-[0.08em] text-[#f5c96b] [text-shadow:0_0_40px_rgba(245,201,107,0.5)] sm:text-4xl sm:tracking-[0.12em] md:text-5xl" initial={{
          opacity: 0,
          y: 16
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 0.25,
          duration: 0.5,
          ease: "easeOut"
        }}>The Rift Is Sealed</motion.h2>}{<motion.p className="relative mt-3 text-sm italic text-white/50" initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} transition={{
          delay: 0.5,
          duration: 0.4
        }}>The fifty-first dawn belongs to you alone.</motion.p>}</div>}{<div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-md sm:p-6">{<SectionLabel className="text-center">Deeds of the final archmage</SectionLabel>}{<div className="mt-4 flex flex-col gap-2.5">{deeds.map(([label, value], i) => <motion.div className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-b-0" initial={{
            opacity: 0,
            x: -14
          }} animate={{
            opacity: 1,
            x: 0
          }} transition={{
            delay: 0.65 + i * 0.14,
            duration: 0.35
          }} key={label}>{<span className="text-[11px] uppercase tracking-[0.2em] text-white/45">{label}</span>}{<span className="font-mono text-sm font-bold text-[#f5c96b]">{value}</span>}</motion.div>)}</div>}</div>}{<motion.div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-md sm:p-6" initial={{
        opacity: 0,
        y: 14
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 1.6,
        duration: 0.4
      }}>{<SectionLabel className="text-center">Asset attribution</SectionLabel>}{<div className="mt-3">{<AssetAttributionList />}</div>}</motion.div>}{<motion.div className="grid w-full gap-3 sm:grid-cols-2" initial={{
        opacity: 0,
        y: 18
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 1.75,
        duration: 0.4
      }}>{<Button variant="outline" onClick={() => {
          sfx.click();
          ui.onCreditsReturn();
        }} className="h-auto flex-col items-start gap-1.5 rounded-xl border-[#f5c96b]/40 bg-[#f5c96b]/5 px-5 py-4 text-left hover:bg-[#f5c96b]/15 active:scale-[0.98]">{<span className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-[#f5c96b] sm:tracking-[0.25em]">{<House className="size-4" />}{" Return"}</span>}{<span className="text-[10px] normal-case tracking-normal text-white/45">{"Bank "}{fmtNum(stats.payout)}{" glyphs · seal the weave forever"}</span>}</Button>}{<Button variant="outline" onClick={() => {
          sfx.click();
          ui.onCreditsFight();
        }} className="h-auto flex-col items-start gap-1.5 rounded-xl border-[#ff4d6b]/40 bg-[#ff4d6b]/5 px-5 py-4 text-left hover:bg-[#ff4d6b]/15 active:scale-[0.98]">{<span className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-[#ff4d6b] sm:tracking-[0.25em]">{<Infinity className="size-4" />}{" Fight — the Endless Echo"}</span>}{<span className="text-[10px] normal-case tracking-normal text-white/45">Waves 51+ with escalating pressure</span>}</Button>}</motion.div>}</div>}</motion.div>;
}
export function PauseOverlay({
  onResume,
  onAbandon,
  onSettings,
  hud
}) {
  const phase = useRiftStore(s => s.phase);
  return <AnimatePresence>{phase === "paused" && <motion.div className="dark fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" initial={{
      opacity: 0
    }} animate={{
      opacity: 1
    }} exit={{
      opacity: 0
    }} transition={{
      duration: 0.2
    }} key={"pause"}>{<motion.div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#14101f]/95 p-6 text-center shadow-[0_0_50px_rgba(0,0,0,0.6)]" initial={{
        opacity: 0,
        y: 16,
        scale: 0.97
      }} animate={{
        opacity: 1,
        y: 0,
        scale: 1
      }} exit={{
        opacity: 0,
        y: 8,
        scale: 0.98
      }} transition={{
        duration: 0.25,
        ease: "easeOut"
      }}>{<div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-32 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[60px]" style={{
          backgroundColor: GOLD
        }} />}{<Hourglass className="relative mx-auto size-6 text-[#f5c96b]" />}{<h2 className="relative mt-3 text-balance font-serif text-lg font-bold uppercase tracking-[0.1em] text-[#f5c96b] [text-shadow:0_0_22px_rgba(245,201,107,0.35)] sm:text-2xl sm:tracking-[0.18em]">The Rift Sleeps</h2>}{<p className="relative mt-2 text-xs italic text-white/40">It waits, impatient.</p>}{/* F-06 (audit): the FROZEN active-run identity — this seed + this biome
          are what the run is ACTUALLY using; the menu's next-run seed can
          never leak into this display. */}{hud && <div className="relative mt-4 rounded-lg border border-[#9a7bff]/25 bg-[#120b24]/70 px-4 py-2.5" aria-label="Active run identity">{<div className="flex items-center justify-center gap-2">{<span className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#6bf0c2]">Active rift seed</span>}{<span className="font-mono text-sm font-bold tracking-widest text-[#ffe9ad]">{hud.seed}</span>}</div>}{hud.biomeName && <div className="mt-1 text-center text-[10px] uppercase tracking-[0.22em] text-white/40">{"Current ground · "}<span className="font-bold text-[#b9aee0]">{hud.biomeName}</span></div>}</div>}{<div className="relative mt-6 flex flex-col gap-2.5">{<Button onClick={() => {
            sfx.click();
            onResume();
          }} className="h-11 rounded-lg border border-[#f5c96b]/50 bg-[#f5c96b]/10 text-xs font-bold uppercase tracking-[0.3em] text-[#f5c96b] hover:bg-[#f5c96b]/20 active:scale-[0.98]">{<Play />}{" Resume"}</Button>}{<Button variant="outline" onClick={() => {
            sfx.click();
            onSettings();
          }} className="h-11 rounded-lg border-white/15 bg-black/30 text-xs font-bold uppercase tracking-[0.3em] text-white/70 hover:bg-white/5 hover:text-white active:scale-[0.98]">{<Settings />}{" Settings"}</Button>}{<Button variant="outline" onClick={() => {
            sfx.click();
            onAbandon();
          }} className="h-11 rounded-lg border-[#ff4d6b]/35 bg-transparent text-xs font-bold uppercase tracking-[0.3em] text-[#ff4d6b]/90 hover:bg-[#ff4d6b]/10 hover:text-[#ff4d6b] active:scale-[0.98]">{<DoorOpen />}{" Abandon Run"}</Button>}</div>}</motion.div>}</motion.div>}</AnimatePresence>;
}