"use client";


import { useState, useEffect, useSyncExternalStore, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Accessibility, AudioLines, BookMarked, BookOpen, Clock, Copy, Crown, Database, Dices, DoorOpen, Flame, Gamepad2, Gauge, Gem, Heart, HeartPulse, House, Hourglass, Infinity, Monitor, Music4, Pencil, Play, RotateCcw, Scan, Settings, Shuffle, Skull, Sparkles, Star, Sun, Swords, Trash2, TriangleAlert, Trophy, Users, Volume2, Wind, X, Zap } from "lucide-react";
import { PxPanel, PxDiamond, PxFiligree, PxHeader, PxHexButton, PxStarInArch, IconChest, IconTriquetra } from "@/components/game3d/pixel";
import { useRiftStore, peekSlots } from "@/game3d/store";
import { sfx } from "@/game3d/audio";
import { FALLBACK_PACKS, fetchPackCredits } from "@/game3d/assets";
import { ACTS, computeBonuses, RELIQUARY, RELIQUARY_MAX_LEVEL, reliquaryCost, SPELL_ORDER, ALL_PAIRS, comboKey, COMBOS, SPELLS, ELITE_ORDER, ELITE_DEFS, ENEMY_ORDER, ENEMY_DEFS, BOSS_DEFS, CHANGELOG, GAME_VERSION, MERCY_MAX_TIER, mercyTierBase, VICTORY_WAVE, TERRAINS, biomeDeckFor, PALETTE_IDS, PALETTE_LABELS, elementColor, elementGlow, DEFAULT_SETTINGS,
  type ReliquaryKey,
  type GameSettings,
} from "@/game3d/content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose as DialogPrimitiveClose } from "@/components/ui/dialog";
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
const ROMAN_ACTS = ["I", "II", "III", "IV", "V"];
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
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<div ref={parallaxRef} className="absolute inset-0 will-change-transform">{<img src={assetPath("/art/v3/menu-bg.jpg")} alt="" draggable={false} className="rift-kenburns h-full w-full object-cover object-center" />}</div>}{<div className="absolute inset-0 bg-gradient-to-b from-[#0a0812]/72 via-[#0a0812]/30 to-[#0a0812]/90" />}{<div className="rift-veil-breathe absolute inset-0" style={{
      background: "radial-gradient(1100px 700px at 50% 30%, rgba(122,63,212,0.26), transparent 62%)," + "radial-gradient(720px 520px at 14% 92%, rgba(199,125,255,0.12), transparent 60%)," + "radial-gradient(720px 520px at 88% 8%, rgba(232,180,75,0.08), transparent 60%)"
    }} />}{<div className="absolute inset-0" style={{
      background: "radial-gradient(ellipse at center, transparent 52%, rgba(10,7,18,0.66) 100%)"
    }} />}</div>;
}
/** Layer 1 — the ported MenuBackdrop: counter-rotating sigil rings, drifting
 *  motes, and rising rift embers (cinematic pass). */
function MenuBackdrop() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">{<svg className="rift-sigil-spin absolute left-1/2 top-1/2 h-[min(112vw,760px)] w-[min(112vw,760px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.09]" viewBox="0 0 760 760" fill="none">{<circle cx="380" cy="380" r="360" stroke="#f5c96b" strokeWidth="1.5" strokeDasharray="16 12" />}{<circle cx="380" cy="380" r="238" stroke="#f5c96b" strokeWidth="1" />}{Array.from({
        length: 8
      }).map((_, i) => {
        const a = i / 8 * Math.PI * 2;
        const x = 380 + Math.cos(a) * 330;
        const y = 380 + Math.sin(a) * 330;
        return <rect x={x - 9} y={y - 9} width="18" height="18" transform={`rotate(45 ${x} ${y})`} stroke="#f5c96b" strokeWidth="1.4" key={i} />;
      })}</svg>}{<svg className="rift-sigil-spin-rev absolute left-1/2 top-1/2 h-[min(88vw,600px)] w-[min(88vw,600px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.08]" viewBox="0 0 760 760" fill="none">{<circle cx="380" cy="380" r="300" stroke="#9a7bff" strokeWidth="1" strokeDasharray="4 16" />}{Array.from({
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
  const [seedCopied, setSeedCopied] = useState(false);
  const [editingSeed, setEditingSeed] = useState(false);
  const [partyNotice, setPartyNotice] = useState(false);
  /* touch-primary devices get a one-line gesture note under the begin rite */
  const isTouch = useIsTouch();
  /* v2.1.1: the legal documents (Terms / Privacy) open from the footer row. */
  const [legal, setLegal] = useState<null | "terms" | "privacy">(null);
  const copySeed = async () => {
    sfx.click();
    try {
      await navigator.clipboard.writeText(seed);
    } catch {
      (document.getElementById("rift-seed") as HTMLInputElement | null)?.select();
    }
    setSeedCopied(true);
    window.setTimeout(() => setSeedCopied(false), 1400);
  };
  /* the rift level — a lifetime progress metric distilled from real meta:
   * waves, foes, resonances, seals. Deterministic, no new save fields. */
  const xp = meta.totalKills * 2 + meta.bestWave * 30 + meta.combosFound.length * 120 + meta.victories * 800 + meta.runs * 40;
  const level = Math.floor(xp / 1000) + 1;
  const xpPct = Math.min(100, (xp % 1000) / 10);
  const hover = () => sfx.hover();
  const startRun = () => {
    sfx.resume();
    sfx.click();
    ui.onStartRun(seed);
  };
  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-hidden bg-[#0a0812]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45 } }}
      transition={{ duration: 0.5 }}
    >
      <KeyartBackdrop />
      <MenuBackdrop />
      <div aria-hidden className="rift-grain pointer-events-none absolute inset-0 z-10" />
      <div className="rift-scroll safe-x relative z-10 h-full overflow-y-auto">
        <div className="font-body relative flex min-h-full flex-col items-center px-4 pb-8 pt-4 sm:pt-6">
          {/* ---- top bar: player card left, currency cluster right ---- */}
          <div className="flex w-full max-w-6xl flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
              <PxPanel className="flex items-center gap-3 px-3 py-2">
                <span aria-hidden className="relative block size-14 shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#f0c060] to-[#b8822e] p-[2px]">
                  <span className="block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#1e1430]">
                    <img
                      src={assetPath("/assets/sprites/player-idle.png")}
                      alt=""
                      width={56}
                      height={56}
                      draggable={false}
                      className="size-full scale-[1.65] object-contain [image-rendering:pixelated]"
                      style={{ objectPosition: "50% 20%" }}
                    />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="font-display block truncate text-base font-bold leading-tight text-[#f2e8c9]">Archmage</span>
                  <span className="block text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#f0c060]">Lv. {level}</span>
                  <span className="mt-1 block h-1.5 w-32 overflow-hidden rounded-full border border-[#3a2c52] bg-[#0a0712]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#8a4fe0] to-[#c9a0ff]" style={{ width: `${xpPct}%` }} />
                  </span>
                </span>
              </PxPanel>
            </motion.div>
            <motion.div className="flex items-center gap-2" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.28, duration: 0.5 }}>
              <PxPanel className="flex items-center gap-2 px-3 py-2">
                <Gem className="size-4 text-[#c9a0ff] [filter:drop-shadow(0_0_6px_#a66bf0)]" />
                <span className="font-display text-sm font-bold tabular-nums text-[#f2e8c9]">{fmtNum(meta.shards)}</span>
                <button
                  className="flex size-7 items-center justify-center rounded-md border-2 border-[#d9a441]/80 bg-[#3a2a55] text-sm font-black text-[#ffd97a] transition-colors hover:border-[#f0c060] hover:bg-[#4a3a68]"
                  title="Spend glyphs in the Vault"
                  aria-label="Open the Vault"
                  onClick={() => { sfx.click(); setScreen("reliquary"); }}
                >
                  <span className="-mt-0.5">+</span>
                </button>
              </PxPanel>
              <PxPanel className="flex items-center gap-2 px-3 py-2">
                <span aria-hidden className="block size-3 rotate-45 bg-[#ffd24a] shadow-[0_0_8px_#f0c030]" />
                <span className="font-display text-sm font-bold tabular-nums text-[#f2e8c9]">{fmtNum(meta.totalKills)}</span>
                <button
                  className="flex size-7 items-center justify-center rounded-md border-2 border-[#d9a441]/80 bg-[#3a2a55] text-sm font-black text-[#ffd97a] transition-colors hover:border-[#f0c060] hover:bg-[#4a3a68]"
                  title="Foes felled across every run"
                  aria-label="Open the Runes"
                  onClick={() => { sfx.click(); setScreen("arcanum"); }}
                >
                  <span className="-mt-0.5">+</span>
                </button>
              </PxPanel>
            </motion.div>
          </div>

          {/* ---- title block ---- */}
          <div className="mt-4 flex flex-col items-center sm:mt-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.6 }}>
              <PxStarInArch className="h-14 w-auto drop-shadow-[0_0_14px_rgba(255,217,122,0.35)] sm:h-16" />
            </motion.div>
            <motion.h2
              className="font-display px-gold-text mt-1 text-[clamp(54px,10vw,118px)] font-black leading-none tracking-[0.06em]"
              initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.45, duration: 0.8, ease: [0.22, 0.9, 0.3, 1] }}
            >
              ARCHMAGE
            </motion.h2>
            <motion.div className="mt-2 flex items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65, duration: 0.5 }}>
              <PxFiligree width="w-14 sm:w-24" />
              <span className="text-[clamp(12px,1.6vw,16px)] font-bold uppercase tracking-[0.5em] text-[#c9b8e8] [text-shadow:0_0_16px_rgba(154,123,255,0.45)]">Riftbound</span>
              <PxFiligree width="w-14 sm:w-24" />
            </motion.div>
            <motion.div className="mt-2 flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.78, duration: 0.4 }} aria-label={`Version ${GAME_VERSION} — ${CHANGELOG[0].name}`}>
              <span className="border border-[#d9a441]/60 bg-[#241a3a]/80 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.24em] text-[#f0c060]">Version {GAME_VERSION}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#a66bf0]">{CHANGELOG[0].name}</span>
            </motion.div>
          </div>

          {/* ---- the two rift calls ---- */}
          <div className="mt-6 flex w-full max-w-3xl flex-col items-stretch justify-center gap-7 sm:mt-10 sm:flex-row sm:items-center sm:gap-10">
            <motion.div className="w-full sm:max-w-[300px]" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.5 }}>
              <PxHexButton glow="gold" className="px-breathe w-full" tabIcon={<Swords className="size-6" />} onClick={startRun} onMouseEnter={hover}>
                Solo Run
              </PxHexButton>
            </motion.div>
            <motion.div className="w-full sm:max-w-[300px]" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.5 }}>
              <PxHexButton
                glow="violet"
                className="w-full"
                tabIcon={<Users className="size-6" />}
                onClick={() => { sfx.click(); setPartyNotice(true); window.setTimeout(() => setPartyNotice(false), 3200); }}
                onMouseEnter={hover}
              >
                Online Party
              </PxHexButton>
            </motion.div>
          </div>
          {/* party notice — honest: no netcode in a zero-backend game */}
          <AnimatePresence>
            {partyNotice && (
              <motion.p
                className="mt-3 rounded-md border border-[#a66bf0]/40 bg-[#241740]/85 px-4 py-1.5 text-[11px] italic text-[#d8cfe8]"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                The party channels are still being woven — the rift answers solo calls for now.
              </motion.p>
            )}
          </AnimatePresence>

          {/* ---- seed bar ---- */}
          <motion.div className="mt-5 flex flex-wrap items-center justify-center gap-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: 0.4 }}>
            <PxPanel className="flex items-center gap-2.5 px-4 py-2">
              <Dices className="size-4 text-[#f0c060]" />
              {editingSeed ? (
                <input
                  id="rift-seed"
                  value={seed}
                  onChange={e => setSeed(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { setEditingSeed(false); sfx.click(); }
                    if (e.key === "Escape") setEditingSeed(false);
                  }}
                  onBlur={() => setEditingSeed(false)}
                  autoFocus
                  spellCheck={false}
                  maxLength={24}
                  className="w-36 border border-[#a66bf0]/40 bg-[#0a0712]/90 px-2 py-0.5 text-center text-sm font-bold tracking-widest text-[#ffe9ad] outline-none focus:border-[#f0c060]"
                />
              ) : (
                <button className="flex min-h-11 items-center text-sm tracking-wider" title="Click to edit the seed" onClick={() => { sfx.click(); setEditingSeed(true); }}>
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9a8fb5]">Seed:</span>
                  <span className="ml-1.5 font-bold text-[#f2e8c9]">{seed}</span>
                </button>
              )}
              <button className="flex size-8 items-center justify-center rounded-md border border-[#d9a441]/50 text-[#f0c060] transition-colors hover:border-[#f0c060]" title="Edit seed" aria-label="Edit seed" onClick={() => { sfx.click(); setEditingSeed(true); }}>
                <Pencil className="size-3.5" />
              </button>
              <button className="flex size-8 items-center justify-center rounded-md border border-[#d9a441]/50 text-[#f0c060] transition-colors hover:border-[#f0c060]" title="Copy this seed — paste it back any time to replay the same rift" aria-label="Copy seed" onClick={copySeed}>
                {seedCopied ? <span className="text-[9px] font-black uppercase tracking-widest text-[#6bf0c2]">Copied</span> : <Copy className="size-3.5" />}
              </button>
            </PxPanel>
            <PxPanel className="flex items-center px-2.5 py-2" corners={false}>
              <button
                className="flex size-8 items-center justify-center rounded-md text-[#c9a0ff] transition-transform hover:scale-110"
                title="Reroll — draws a fresh seed for the NEXT run only"
                aria-label="Reroll seed"
                onClick={() => { sfx.click(); randomizeSeed(); }}
              >
                <Shuffle className="size-4" />
              </button>
            </PxPanel>
          </motion.div>
          {isTouch ? (
            <p className="mt-3 text-center text-[10px] uppercase tracking-[0.22em] text-white/60 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">One tap — fullscreen · landscape · the rift</p>
          ) : (
            <p className="mt-3 text-center text-[10px] uppercase tracking-[0.22em] text-white/60 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">WASD move · LMB cast · RMB volley · Space blink · F surge</p>
          )}

          {/* ---- bottom nav + records + legal ---- */}
          <motion.div className="mt-auto w-full pt-8" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.15, duration: 0.45 }}>
            <div className="mx-auto flex w-full max-w-3xl flex-wrap items-stretch justify-center gap-2.5 sm:gap-3.5">
              <button
                onClick={() => { sfx.click(); setScreen("reliquary"); }}
                onMouseEnter={hover}
                className="px-panel px-corners flex min-h-11 flex-1 basis-32 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.18em] text-[#f0c060] transition-all hover:-translate-y-0.5 hover:text-[#ffd97a] sm:text-[13px]"
                title="The Vault — permanent upgrades bought with aether glyphs"
              >
                <IconChest className="size-[18px]" />Vault
              </button>
              <button
                onClick={() => { sfx.click(); setScreen("arcanum"); }}
                onMouseEnter={hover}
                className="px-panel px-corners flex min-h-11 flex-1 basis-32 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.18em] text-[#f0c060] transition-all hover:-translate-y-0.5 hover:text-[#ffd97a] sm:text-[13px]"
              >
                <IconTriquetra className="size-[18px]" />Runes
              </button>
              <button
                onClick={() => { sfx.click(); setScreen("codex"); }}
                onMouseEnter={hover}
                className="px-panel px-corners flex min-h-11 flex-1 basis-32 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.18em] text-[#f0c060] transition-all hover:-translate-y-0.5 hover:text-[#ffd97a] sm:text-[13px]"
                title="Codex — how to play and what changed"
              >
                <BookOpen className="size-[18px]" />Codex
              </button>
              <button
                onClick={() => { sfx.click(); openSettings(); }}
                onMouseEnter={hover}
                className="px-panel px-corners flex min-h-11 flex-1 basis-32 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.18em] text-[#f0c060] transition-all hover:-translate-y-0.5 hover:text-[#ffd97a] sm:text-[13px]"
              >
                <Settings className="size-[18px]" />Settings
              </button>
            </div>
            {/* records — subtle lifetime strip under the nav */}
            <div className="mx-auto mt-3 flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-[#9a8fb5]" aria-label="Lifetime records">
              <span><span className="font-bold text-[#f0c060]">{meta.bestWave}</span> best wave</span>
              <PxDiamond small className="opacity-50" />
              <span><span className="font-bold text-[#f0c060]">{meta.runs}</span> trials</span>
              <PxDiamond small className="opacity-50" />
              <span><span className="font-bold text-[#f0c060]">{meta.combosFound.length}</span> resonances</span>
              {meta.victories > 0 && (
                <>
                  <PxDiamond small className="opacity-50" />
                  <span><span className="font-bold text-[#f0c060]">{meta.victories}</span> seals</span>
                </>
              )}
            </div>
            {/* legal footer */}
            <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[9px] uppercase tracking-[0.18em]">
              <button onClick={() => setLegal("terms")} className="min-h-11 px-2 py-1 font-bold text-white/40 transition-colors hover:text-[#f0c060] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c060]">Terms of Service</button>
              <span aria-hidden className="text-white/20">·</span>
              <button onClick={() => setLegal("privacy")} className="min-h-11 px-2 py-1 font-bold text-white/40 transition-colors hover:text-[#f0c060] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c060]">Privacy Policy</button>
            </div>
          </motion.div>
        </div>
      </div>
      <div className="safe-b safe-x pointer-events-none absolute bottom-2 right-3 z-30 text-[9px] uppercase tracking-[0.25em] text-white/40">v{GAME_VERSION} · {CHANGELOG[0].name}</div>
      <LegalDialog which={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />
    </motion.div>
  );
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
/** Touch rite rows — mirrors TouchControls.tsx's actual cluster. */
function TouchRows() {
  return <>{<TouchRow badge="STICK" label="Left thumb — move (up is away)" />}{<TouchRow badge="CAST" label="Right cluster — hold to keep casting" />}{<TouchRow badge="VOLLEY" label="Right cluster — seeking bolts" />}{<TouchRow badge="BLINK" label="Right cluster — tap, brief immunity" />}{<TouchRow badge="SURGE" label="Right cluster — tap when full" />}{<TouchRow badge="SWAP" label="Cycle spell slots" />}</>;
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
  /* v3.0 concept-11 layout: nav rail + center panel + right column +
   * bottom action bar. Settings still apply LIVE; the action bar is honest:
   * Discard restores the snapshot taken when the dialog opened, Save commits
   * (persisted immediately, as ever) and closes, Reset restores defaults. */
  const [nav, setNav] = useState<"audio" | "video" | "controls" | "gameplay" | "touch" | "data">("audio");
  /* the Discard baseline is snapshotted by the store the moment the dialog
   * opens (settings still apply live — Discard just restores the snapshot) */
  const baseline = useRiftStore(s => s.settingsBaseline) ?? st;
  /** Patch a setting AND push volumes to the audio synth live. */
  const apply = (patch: Partial<GameSettings>) => {
    patchSettings(patch);
    const next = { ...st, ...patch };
    sfx.setMuted(next.muted);
    sfx.setVolumes(next.master, next.music, next.sfx, next.ambience);
  };
  const NAV: [typeof nav, string, React.ComponentType<{ className?: string }>][] = [
    ["audio", "Audio", Volume2],
    ["video", "Video", Scan],
    ["controls", "Controls", Gamepad2],
    ["gameplay", "Gameplay", Swords],
    ["touch", "Touch", Accessibility],
    ["data", "Data", Database]
  ];
  return (
    <Dialog open={settingsOpen} onOpenChange={o => { if (!o) closeSettings(); }}>
      <DialogContent showCloseButton={false} className="dark flex h-[88vh] max-h-[88vh] w-full max-w-5xl sm:max-w-5xl flex-col gap-0 overflow-hidden border-2 border-[#d9a441]/80 bg-[#120a1e]/96 p-0 text-white/90 backdrop-blur-xl">
        {/* background: the nebula ruins vista (concept 11) */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <img src={assetPath("/art/v3/settings-bg.jpg")} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#120a1e]/70 to-[#0a0712]/90" />
        </div>
        {/* top bar: lockup + title + close */}
        <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-[#d9a441]/30 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden shrink-0 text-left sm:block">
              <div className="font-display text-sm font-black uppercase tracking-[0.2em] text-[#f0c060]">Archmage</div>
              <div className="text-[8px] font-bold uppercase tracking-[0.34em] text-[#a66bf0]">Riftbound</div>
            </div>
            <div className="min-w-0 text-center sm:text-left">
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <PxDiamond small />
                <DialogTitle className="font-serif text-base font-bold uppercase tracking-[0.22em] text-[#f2e8c9]">Settings</DialogTitle>
                <PxDiamond small />
              </div>
              <DialogDescription className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.24em] text-[#9a8fb5]">Tune your rift experience</DialogDescription>
            </div>
          </div>
          <DialogPrimitiveClose
            aria-label="Close settings"
            onClick={() => sfx.click()}
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[#d9a441]/60 bg-[#1e1430] text-[#c9a0ff] transition-colors hover:border-[#c9a0ff] hover:text-white"
          >
            <X className="size-4" />
          </DialogPrimitiveClose>
        </div>
        {/* body: nav rail + center + right column */}
        <div className="relative flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* nav rail */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#d9a441]/20 p-2 sm:w-40 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r" aria-label="Settings sections">
            {NAV.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => { sfx.hover(); setNav(id); }}
                aria-current={nav === id}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-all",
                  nav === id
                    ? "border-[#c9a0ff]/70 bg-gradient-to-r from-[#3a2460] to-[#241740] text-[#e9d5ff] shadow-[0_0_14px_rgba(166,107,240,0.3)]"
                    : "border-transparent text-[#9a8fb5] hover:border-[#3a2c52] hover:text-[#d8cfe8]"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
                {nav === id && <span aria-hidden className="ml-auto hidden size-1.5 rotate-45 bg-[#c9a0ff] sm:block" />}
              </button>
            ))}
            {/* the hanging banner ornament (concept 11) */}
            <div aria-hidden className="relative mx-auto mt-3 hidden w-16 sm:block">
              <div className="h-6 w-1.5 bg-[#d9a441]/60" />
              <div className="flex h-12 items-start justify-center border-2 border-[#d9a441]/70 bg-gradient-to-b from-[#6a3aa8] to-[#4a2680] pt-1.5">
                <PxDiamond small />
              </div>
            </div>
          </nav>
          {/* center panel */}
          <div className="rift-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {nav === "audio" && (
              <div className="flex flex-col gap-4">
                <PxHeader icon={<Volume2 className="size-3.5" />}>Audio</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9a8fb5]">Balance the voices of the rift — music, ambience and spellwork each carry their own weight.</p>
                <SliderRow label="Master" icon={Volume2} value={st.master} disabled={st.muted} onChange={v => apply({ master: v })} />
                <SliderRow label="Music" icon={Music4} value={st.music} disabled={st.muted} onChange={v => apply({ music: v })} />
                <SliderRow label="Ambience" icon={Wind} value={st.ambience} disabled={st.muted} step={5} onChange={v => apply({ ambience: v })} />
                <SliderRow label="Effects" icon={AudioLines} value={st.sfx} disabled={st.muted} onChange={v => apply({ sfx: v })} />
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#3a2c52] bg-[#0e0817]/80 px-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-[#d8cfe8]">Mute all</div>
                    <div className="text-[10px] text-[#9a8fb5]">Silence every channel at once</div>
                  </div>
                  <Switch checked={st.muted} onCheckedChange={v => apply({ muted: v })} aria-label="Mute all audio" className="data-[state=checked]:bg-[#f0c060]" />
                </div>
              </div>
            )}
            {nav === "video" && (
              <div className="flex flex-col gap-4">
                <PxHeader icon={<Scan className="size-3.5" />}>Video & Graphics</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9a8fb5]">Shape what you see, how it moves, and how hard the engine works for it.</p>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Picture</SectionLabel>
                  <div className="flex min-h-11 items-center gap-3">
                    <Gauge className="size-4 shrink-0 text-[#9a8fb5]" />
                    <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-[#d8cfe8]">Quality</span>
                    <Slider value={[Math.round(st.quality * 100)]} min={50} max={100} step={5} aria-label="Render quality" onValueChange={v => apply({ quality: v[0] / 100 })} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-[#3a2c52] [&_[data-slot=slider-range]]:bg-[#58d6c2] [&_[data-slot=slider-thumb]]:border-[#58d6c2] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />
                    <span className="w-9 text-right font-mono text-xs text-[#58d6c2]">{Math.round(st.quality * 100)}</span>
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    <Sun className="size-4 shrink-0 text-[#9a8fb5]" />
                    <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-[#d8cfe8]">Brightness</span>
                    <Slider value={[st.brightness]} min={50} max={250} step={5} aria-label="Brightness" onValueChange={v => apply({ brightness: v[0] })} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-[#3a2c52] [&_[data-slot=slider-range]]:bg-[#f0c060] [&_[data-slot=slider-thumb]]:border-[#f0c060] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />
                    <span className="w-9 text-right font-mono text-xs text-[#f0c060]">{st.brightness}</span>
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    <Scan className="size-4 shrink-0 text-[#9a8fb5]" />
                    <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-[#d8cfe8]">Field of view</span>
                    <Slider value={[st.fov]} min={45} max={80} step={1} aria-label="Field of view in degrees" onValueChange={v => apply({ fov: v[0] })} className="h-11 flex-1 [&_[data-slot=slider-track]]:bg-[#3a2c52] [&_[data-slot=slider-range]]:bg-[#58d6c2] [&_[data-slot=slider-thumb]]:border-[#58d6c2] [&_[data-slot=slider-thumb]]:bg-[#14101f]" />
                    <span className="w-9 text-right font-mono text-xs text-[#58d6c2]">{st.fov}°</span>
                  </div>
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Performance</SectionLabel>
                  <ToggleRow label="Auto performance" hint="Eases resolution to target 60 fps" checked={st.autoQuality} onChange={v => apply({ autoQuality: v })} />
                  <ToggleRow label="Performance overlay" hint="FPS and render telemetry · F3" checked={st.perfOverlay} onChange={v => apply({ perfOverlay: v })} />
                  <div className="rounded-lg border border-[#3a2c52] bg-[#0e0817]/80 px-3 py-2.5">
                    <div className="text-xs uppercase tracking-wider text-[#d8cfe8]">Frame-rate cap</div>
                    <div className="mt-1 text-[10px] text-[#9a8fb5]">Gentler on hot phones and low batteries</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([[0, "Uncapped"], [30, "30 fps"], [60, "60 fps"]] as [number, string][]).map(([v, label]) => (
                        <MercyChip key={v} active={st.fpsCap === v} onClick={() => apply({ fpsCap: v })}>{label}</MercyChip>
                      ))}
                    </div>
                  </div>
                  <ToggleRow label="Battery saver" hint="Below 20% charge: ease quality and cap 30 fps" checked={st.batterySaver} onChange={v => apply({ batterySaver: v })} />
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Display</SectionLabel>
                  <div className="rounded-lg border border-[#3a2c52] bg-[#0e0817]/80 px-3 py-2.5">
                    <div className="flex min-h-11 items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-[#d8cfe8]">Display mode</div>
                        <div className="text-[10px] text-[#9a8fb5]">Fullscreen — the whole screen, edge to edge</div>
                      </div>
                      <Switch checked={fs.isFs} onCheckedChange={fs.toggle} aria-label="Toggle fullscreen" className="data-[state=checked]:bg-[#58d6c2]" />
                    </div>
                    <p className={`mt-1 text-[10px] leading-relaxed ${fs.blocked ? "text-[#ff8fa3]" : "text-[#9a8fb5]"}`}>
                      {fs.blocked ? "Fullscreen is blocked here — this view will not hand over the screen." : "A live view state, not a saved setting — your browser asks for a tap each visit."}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#3a2c52] bg-[#0e0817]/80 px-3 py-2.5">
                    <div className="text-xs uppercase tracking-wider text-[#d8cfe8]">Low-HP vignette</div>
                    <div className="mt-1 text-[10px] text-[#9a8fb5]">The crimson edge when vitality runs low — independent of Reduce flashes</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([[0, "Off"], [0.35, "Low"], [0.7, "Medium"], [1, "High"]] as [number, string][]).map(([v, label]) => (
                        <MercyChip key={label} active={Math.abs(st.vignette - v) < 0.01} onClick={() => apply({ vignette: v })}>{label}</MercyChip>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            )}
            {nav === "controls" && (
              <div className="flex flex-col gap-4">
                <PxHeader icon={<Gamepad2 className="size-3.5" />}>Controls</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9a8fb5]">The rite this device actually uses — keyboard and mouse below; touch controls follow.</p>
                <div className="rounded-lg border border-[#3a2c52] bg-[#0e0817]/80 px-4 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="px-keycap">Default</span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9a8fb5]">preset · fixed bindings in this build</span>
                  </div>
                  <KbmRows />
                </div>
                <div className="rounded-lg border border-[#3a2c52] bg-[#0e0817]/80 px-4 py-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#9a8fb5]">Touch rite (coarse-pointer devices)</div>
                  <TouchRows />
                </div>
              </div>
            )}
            {nav === "gameplay" && (
              <div className="flex flex-col gap-4">
                <PxHeader icon={<Swords className="size-3.5" />}>Gameplay</PxHeader>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Feel</SectionLabel>
                  <ToggleRow label="Screen shake" hint="The world trembles on impact" checked={st.screenShake} onChange={v => apply({ screenShake: v })} />
                  <ToggleRow label="Damage numbers" hint="Show floating damage digits" checked={st.damageNumbers} onChange={v => apply({ damageNumbers: v })} />
                  <ToggleRow label="Aim assist" hint="Gentle pull toward nearby foes" checked={st.aimAssist} onChange={v => apply({ aimAssist: v })} />
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Rift Mercy</SectionLabel>
                  <p className="text-[11px] leading-relaxed text-[#9a8fb5]">
                    The rift relents for the fallen. AUTO spends your banked falls ({meta.mercyDeaths} banked) and softens each return. Tier 1 grants 2% mercy, +4% per tier beyond.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <MercyChip active={meta.mercyTierSel === -1} onClick={() => setMercyTier(-1)}>Auto</MercyChip>
                    {Array.from({ length: maxTier }, (_, i) => i + 1).map(t => (
                      <MercyChip active={meta.mercyTierSel === t} onClick={() => setMercyTier(t)} key={t}>
                        {t}<span className="ml-1 font-mono text-[9px] opacity-60">{Math.round(mercyTierBase(t) * 100)}%</span>
                      </MercyChip>
                    ))}
                    {maxTier === 0 && <span className="self-center text-[10px] italic text-[#9a8fb5]/60">No tiers unlocked — fall once to earn mercy.</span>}
                  </div>
                  <p className="rounded-lg border border-[#58d6c2]/25 bg-[#58d6c2]/5 px-3 py-2 text-[11px] leading-relaxed text-[#58d6c2]">
                    {meta.mercyTierSel === -1 ? "AUTO: the rift spends your banked falls for you." : `Tier ${meta.mercyTierSel} is locked in — ${Math.round(mercyTierBase(meta.mercyTierSel) * 100)}% base mercy, growing a little each wave.`}
                  </p>
                </section>
              </div>
            )}
            {nav === "touch" && (
              <div className="flex flex-col gap-4">
                <PxHeader icon={<Accessibility className="size-3.5" />}>Touch & Comfort</PxHeader>
                <ToggleRow label="Left-handed layout" hint="Mirror the thumb cluster for left-thumb play" checked={st.leftHanded} onChange={v => apply({ leftHanded: v })} />
                <ToggleRow label="One-thumb casting" hint="Cast toward your move stick's direction" checked={st.tapToCast} onChange={v => apply({ tapToCast: v })} />
                <ToggleRow label="Haptic cues" hint="A pulse when spells ready, hits land, tyrants arrive" checked={st.haptics} onChange={v => apply({ haptics: v })} />
                <ToggleRow label="Resume countdown" hint="A 3-2-1 breath before the rift moves again" checked={st.resumeCountdown} onChange={v => apply({ resumeCountdown: v })} />
                <ToggleRow label="Auto immersive" hint="Touch devices snap to fullscreen landscape" checked={st.autoImmersive} onChange={v => apply({ autoImmersive: v })} />
              </div>
            )}
            {nav === "data" && (
              <div className="flex flex-col gap-4">
                <PxHeader icon={<Database className="size-3.5" />}>Data</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9a8fb5]">Everything lives in this browser's local storage — three save slots, switchable from the menu.</p>
                <SaveSlots />
              </div>
            )}
          </div>
          {/* right column: HUD & interface / colorblind / reduced flashing */}
          <div className="rift-scroll hidden w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-[#d9a441]/20 p-3 lg:flex">
            <PxPanel className="p-3" corners={false}>
              <PxHeader className="text-[10px]!">HUD & Interface</PxHeader>
              <div className="mt-2 text-[10px] text-[#9a8fb5]">HUD density — Compact hides the optional chrome</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {([["compact", "Compact"], ["standard", "Standard"], ["expanded", "Expanded"]] as [string, string][]).map(([v, label]) => (
                  <MercyChip key={v} active={st.hudDensity === v} onClick={() => apply({ hudDensity: v })}>{label}</MercyChip>
                ))}
              </div>
              {/* HUD preview mock (concept 11) */}
              <div className="mt-3 rounded-md border border-[#d9a441]/40 bg-[#0e0817]/90 p-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="block size-9 overflow-hidden rounded-md border border-[#a66bf0]/60 bg-[#1e1430]">
                    <img src={assetPath("/assets/sprites/player-idle.png")} alt="" width={36} height={36} className="size-full object-contain [image-rendering:pixelated]" />
                  </span>
                  <span className="flex-1 space-y-1">
                    <span className="block h-1.5 w-full rounded-full bg-[#0a0712]"><span className="block h-full w-5/6 rounded-full bg-gradient-to-r from-[#e02040] to-[#ff5a7a]" /></span>
                    <span className="block h-1.5 w-full rounded-full bg-[#0a0712]"><span className="block h-full w-3/4 rounded-full bg-gradient-to-r from-[#2a6ff0] to-[#6fa8ff]" /></span>
                    <span className="block h-1.5 w-full rounded-full bg-[#0a0712]"><span className="block h-full w-1/2 rounded-full bg-gradient-to-r from-[#e8940a] to-[#ffd24a]" /></span>
                  </span>
                </div>
                <div className="mt-2 flex justify-center gap-1.5">
                  {["fire", "ice", "lightning"].map(el => (
                    <span key={el} className="flex size-8 items-center justify-center rounded-md border border-[#d9a441]/50 bg-[#171026]">
                      <img src={assetPath(`/assets/icons/element-${el}.png`)} alt="" width={22} height={22} className="size-[22px] [image-rendering:pixelated]" />
                    </span>
                  ))}
                </div>
              </div>
            </PxPanel>
            <PxPanel className="p-3" corners={false}>
              <PxHeader className="text-[10px]!">Colorblind Support</PxHeader>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PALETTE_IDS.map(p => (
                  <MercyChip key={p} active={st.palette === p} onClick={() => apply({ palette: p })}>{PALETTE_LABELS[p]}</MercyChip>
                ))}
              </div>
              {/* palette swatches (concept 11 — split-diagonal squares) */}
              <div className="mt-2.5 flex gap-2">
                {["fire", "ice", "lightning", "void"].map(el => (
                  <span key={el} aria-hidden className="block size-7 rounded-md border border-[#3a2c52]" style={{ background: `linear-gradient(135deg, ${elementColor(el)} 0 50%, ${elementGlow(el)} 50% 100%)` }} />
                ))}
              </div>
            </PxPanel>
            <PxPanel className="p-3" corners={false}>
              <PxHeader className="text-[10px]!">Reduced Flashing</PxHeader>
              <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
                <div className="text-[10px] leading-snug text-[#9a8fb5]">Softer strobes and pulses</div>
                <Switch checked={st.reduceFlashes} onCheckedChange={v => apply({ reduceFlashes: v })} aria-label="Reduce flashes" className="data-[state=checked]:bg-[#f0c060]" />
              </div>
            </PxPanel>
          </div>
        </div>
        {/* bottom action bar (concept 11) */}
        <div className="relative flex shrink-0 items-center justify-end gap-2 border-t border-[#d9a441]/30 bg-[#0e0817]/80 px-4 py-3 safe-b-5 sm:px-5">
          <button type="button" onClick={() => { sfx.click(); apply(DEFAULT_SETTINGS); }} className="px-btn px-btn--ghost h-10 text-[10px]!">
            <RotateCcw className="size-3.5" />Reset to Default
          </button>
          <button type="button" onClick={() => { sfx.click(); patchSettings(baseline); sfx.setMuted(baseline.muted); sfx.setVolumes(baseline.master, baseline.music, baseline.sfx, baseline.ambience); closeSettings(); }} className="px-btn px-btn--ghost h-10 text-[10px]!">
            <X className="size-3.5" />Discard Changes
          </button>
          <button type="button" onClick={() => { sfx.click(); closeSettings(); }} className="px-btn px-btn--primary h-10 text-[10px]!">
            <span className="text-[#4ae87a]">✓</span>Save Changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
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
  const actIdx = Math.min(4, Math.floor(Math.max(1, stats.wave - 1) / 10));
  const act = ACTS[actIdx];
  const lastHit = stats.lastHits && stats.lastHits.length > 0 ? stats.lastHits[stats.lastHits.length - 1] : null;
  const remix = () => {
    sfx.click();
    useRiftStore.getState().randomizeSeed();
    ui.onGameOverRetry(useRiftStore.getState().seed);
  };
  return (
    <motion.div
      className="dark fixed inset-0 z-50 overflow-y-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* the blood-moon vista (concept 09 — defeat) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <img src={assetPath("/art/v3/defeat-bg.jpg")} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0d0512]/78 via-[#0d0512]/62 to-[#0a0510]/92" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(10,5,16,0.8) 100%)" }} />
      </div>
      <div className="rift-scroll relative mx-auto flex min-h-full w-full max-w-5xl flex-col items-center gap-4 px-4 py-8 safe-b-4">
        {/* title block */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-[0.42em] text-[#f2e8da]/85">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#b08aa0]/70" />
            Archmage
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#b08aa0]/70" />
          </div>
          <motion.h2
            className="font-display px-crimson-text mt-1 text-[clamp(56px,11vw,120px)] font-black leading-none tracking-[0.05em]"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease: [0.2, 0.9, 0.3, 1.15] }}
          >
            DEFEAT
          </motion.h2>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.34em] text-[#d87878]">
            {stats.endless ? "The endless echo swallowed you" : "The rift overwhelmed you"}
          </div>
        </div>
        {/* cause of death + fell at */}
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <PxPanel variant="crimson" className="flex flex-1 items-center gap-3 p-3 sm:p-4">
            <span className="px-socket !size-11 border-2 border-[#e05060]/50" style={{ boxShadow: "0 0 14px rgba(224,80,96,0.35)" }}>
              <Skull className="size-5 text-[#e05060]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.24em] text-[#e05060]">Cause of Death</span>
              <span className="font-serif mt-0.5 block truncate text-lg font-bold text-[#f2ead8]">Slain by {stats.killedBy ?? "the rift's aftermath"}</span>
              {lastHit && (
                <span className="mt-0.5 block text-[11px] leading-snug text-[#a898b0]">
                  A final strike that dealt <span className="font-bold text-[#e84858]">{lastHit.amount}</span> damage.
                </span>
              )}
            </span>
          </PxPanel>
          <PxPanel className="flex items-center gap-3 p-3 sm:w-64 sm:p-4">
            <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-[#e05060]" fill="currentColor"><path d="M6 3 L6 21 M6 4 C9 3.2 12 3.6 15 5 C13.4 7.4 12.8 9.8 13.4 12.4 C10.8 11.4 8.4 11.6 6 12.8 Z" /></svg>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.24em] text-[#9a8fb5]">Fell At</span>
              <span className="font-display block text-2xl font-black leading-tight text-[#f0c060]">WAVE {stats.wave}</span>
              <span className="block truncate text-[10px] uppercase tracking-[0.18em] text-[#a898b0]">Act {ROMAN_ACTS[actIdx]} · {act?.name}</span>
            </span>
          </PxPanel>
        </div>
        {/* your build */}
        <PxPanel className="w-full p-3 sm:p-4">
          <PxHeader icon={<Sparkles className="size-3.5" />}>Your Build</PxHeader>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="block size-12 overflow-hidden rounded-md border-2 border-[#a66bf0]/60 bg-[#1e1430]">
                <img src={assetPath("/assets/sprites/player-idle.png")} alt="" width={48} height={48} className="size-full object-contain [image-rendering:pixelated]" />
              </span>
              <span>
                <span className="font-serif block text-base font-bold text-[#f2ead8]">Archmage</span>
                <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#f0c060]">The Last Magus</span>
              </span>
            </div>
            <span aria-hidden className="hidden h-10 w-px bg-[#3a2545] sm:block" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c8b8d0]">Spells</div>
              <div className="mt-1 flex gap-2">
                {[0, 1, 2].map(i => {
                  const slot = stats.equipped?.[i];
                  const el = typeof slot === "string" ? slot : slot ? slot.merged[0] : null;
                  return (
                    <span key={i} className="flex size-11 items-center justify-center rounded-md border bg-[#1a0e22]" style={{ borderColor: el ? `${elementColor(el)}66` : "rgba(58,37,69,0.9)" }}>
                      {el ? <img src={assetPath(`/assets/icons/element-${el}.png`)} alt="" width={30} height={30} className="h-[30px] w-[30px] [image-rendering:pixelated]" /> : <span className="text-lg font-black text-white/15">+</span>}
                    </span>
                  );
                })}
              </div>
            </div>
            <span aria-hidden className="hidden h-10 w-px bg-[#3a2545] sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c8b8d0]">Resonances ({stats.newCombos.length})</div>
              <div className="mt-1 flex max-w-xs flex-wrap gap-1.5">
                {stats.newCombos.length === 0 ? (
                  <span className="text-[11px] italic text-[#a898b0]/70">None woven this run</span>
                ) : (
                  stats.newCombos.slice(0, 6).map(k => (
                    <span key={k} className="rounded-md border border-[#a66bf0]/40 bg-[#241740]/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#c9a0ff]">
                      {COMBOS[k]?.name ?? k}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </PxPanel>
        {/* stats strip */}
        <PxPanel className="grid w-full grid-cols-3 gap-px overflow-hidden !rounded-lg sm:grid-cols-6" corners={false}>
          {[
            ["Damage Dealt", fmtNum(Math.round(stats.damage)), Swords],
            ["Kills", fmtNum(stats.kills), Skull],
            ["Score", fmtNum(stats.score), Trophy],
            ["Time Survived", fmtTime(stats.timeSec), Clock],
            ["Resonances", String(stats.newCombos.length), Sparkles],
            ["Tyrants Slain", String(stats.bossesSlain.length), Crown]
          ].map(([label, value, Icon]) => {
            const I = Icon as typeof Swords;
            return (
              <div key={label as string} className="flex items-center gap-2 bg-[#160e22]/80 px-2.5 py-2.5">
                <I className="size-4 shrink-0 text-[#f0c060]" />
                <span className="min-w-0">
                  <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[#a898b0]">{label as string}</span>
                  <span className="font-display block text-base font-black leading-tight text-[#f2ead8]">{value as string}</span>
                </span>
              </div>
            );
          })}
        </PxPanel>
        {/* run summary */}
        <PxPanel className="w-full p-3 sm:p-4">
          <PxHeader icon={<BookOpen className="size-3.5" />}>Run Summary</PxHeader>
          <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {[
              ["Waves Cleared", `${Math.max(0, stats.wave - 1)} / ${VICTORY_WAVE}`],
              ["Resonances Woven", String(stats.newCombos.length)],
              ["Tyrants Slain", String(stats.bossesSlain.length)],
              ["Glyphs Collected", fmtNum(stats.glyphs)]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-[#2a1835] py-1 last:border-b-0">
                <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#c8b8d0]"><PxDiamond small className="opacity-60" />{label}</span>
                <span className="text-sm font-bold tabular-nums text-[#f2ead8]">{value}</span>
              </div>
            ))}
          </div>
          {earned > 0 && (
            <div className="mt-2 flex items-center justify-center gap-2 rounded-md border border-[#f0c060]/30 bg-[#f0c060]/5 px-3 py-2 text-[11px] text-[#d8cfe8]">
              <Gem className="size-3.5 text-[#f0c060]" />
              <span><span className="font-bold text-[#f0c060]">{earned}</span> glyphs earned · <span className="font-bold text-[#f0c060]">{payout}</span> banked<span className="text-[#9a8fb5]"> (75% paid to the rift)</span></span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#9a8fb5]">
            Seed
            <span className="font-mono font-bold tracking-widest text-[#f0c060]">{stats.seed}</span>
            <button
              className="flex size-6 items-center justify-center rounded-md border border-[#3a2c52] text-[#c8b8d0] transition-colors hover:border-[#f0c060] hover:text-[#f0c060]"
              aria-label="Copy seed"
              onClick={async () => { try { await navigator.clipboard.writeText(stats.seed); sfx.click(); } catch { /* clipboard denied */ } }}
            >
              <Copy className="size-3" />
            </button>
          </div>
        </PxPanel>
        {/* actions */}
        <div className="mt-1 grid w-full max-w-2xl grid-cols-1 gap-3 pb-4 sm:grid-cols-3">
          <button type="button" onClick={() => { sfx.click(); ui.onGameOverMenu(); }} className="px-btn px-btn--ghost h-14 flex-col !tracking-[0.16em]">
            <span className="flex items-center gap-2"><House className="size-4" />Return</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-60">to hub</span>
          </button>
          <button type="button" onClick={() => { sfx.click(); ui.onGameOverRetry(stats.seed); }} className="px-btn px-btn--primary px-breathe h-14 flex-col">
            <span className="flex items-center gap-2"><RotateCcw className="size-4" />Replay</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-70">(same seed · from wave 1)</span>
          </button>
          <button type="button" onClick={remix} className="px-btn px-btn--purple h-14 flex-col">
            <span className="flex items-center gap-2"><Swords className="size-4" />Rematch</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-60">(new run)</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
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
  return (
    <motion.div
      className="dark fixed inset-0 z-50 overflow-y-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* the golden portal vista (concept 09 — victory) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <img src={assetPath("/art/v3/victory-bg.jpg")} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1a0a28]/72 via-[#150a18]/55 to-[#0a0510]/90" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 44%, rgba(10,5,16,0.78) 100%)" }} />
      </div>
      <div className="rift-scroll relative mx-auto flex min-h-full w-full max-w-5xl flex-col items-center gap-4 px-4 py-8 safe-b-4">
        {/* title block with laurels */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-[0.42em] text-[#f2e8da]/90">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#f0d0a0]/70" />
            Archmage
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#f0d0a0]/70" />
          </div>
          <div className="mt-1 flex items-center justify-center gap-3 sm:gap-5">
            <svg viewBox="0 0 64 88" className="h-16 w-auto sm:h-20" fill="none" aria-hidden>
              <path d="M52 6 C30 12 16 30 14 56 C13 68 16 78 22 86" stroke="#e8b040" strokeWidth="3.2" strokeLinecap="round" />
              {[0, 1, 2, 3, 4, 5, 6].map(i => {
                const t = i / 6;
                const x = 52 - t * 36, y = 8 + t * 74;
                return <ellipse key={i} cx={x} cy={y} rx="6.5" ry="3.2" transform={`rotate(${-38 + i * 9} ${x} ${y})`} fill="#e8b040" stroke="#b8822e" strokeWidth="0.8" />;
              })}
            </svg>
            <motion.h2
              className="font-display px-gold-text text-[clamp(48px,9.5vw,104px)] font-black leading-none tracking-[0.05em]"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.2, 0.9, 0.3, 1.15] }}
            >
              VICTORY
            </motion.h2>
            <svg viewBox="0 0 64 88" className="h-16 w-auto scale-x-[-1] sm:h-20" fill="none" aria-hidden>
              <path d="M52 6 C30 12 16 30 14 56 C13 68 16 78 22 86" stroke="#e8b040" strokeWidth="3.2" strokeLinecap="round" />
              {[0, 1, 2, 3, 4, 5, 6].map(i => {
                const t = i / 6;
                const x = 52 - t * 36, y = 8 + t * 74;
                return <ellipse key={i} cx={x} cy={y} rx="6.5" ry="3.2" transform={`rotate(${-38 + i * 9} ${x} ${y})`} fill="#e8b040" stroke="#b8822e" strokeWidth="0.8" />;
              })}
            </svg>
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.34em] text-[#f0d0a0]">The rift has been sealed</div>
        </div>
        {/* run-complete banner row */}
        <PxPanel className="grid w-full grid-cols-2 gap-px overflow-hidden sm:grid-cols-4" corners={false}>
          {[
            { icon: <Trophy className="size-4 text-[#f0c060]" />, label: "Run Complete", value: `Wave ${stats.wave} / ${VICTORY_WAVE}` },
            { icon: <Crown className="size-4 text-[#e070a0]" />, label: "Final Act", value: `Act ${ROMAN_ACTS[Math.min(4, Math.floor((stats.wave - 1) / 10))]}` },
            { icon: <Clock className="size-4 text-[#f0c060]" />, label: "Clear Time", value: fmtTime(stats.timeSec) },
            { icon: <Sparkles className="size-4 text-[#f0c060]" />, label: "Seed", value: stats.seed }
          ].map((c, i) => (
            <div key={c.label} className="flex items-center gap-2.5 bg-[#160e22]/85 px-3 py-2.5">
              {c.icon}
              <span className="min-w-0">
                <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-[#a898b0]">{c.label}</span>
                <span className="font-display block truncate text-sm font-black leading-tight text-[#f2ead8]">{c.value}</span>
              </span>
              {i === 3 && (
                <button
                  className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md border border-[#3a2c52] text-[#c8b8d0] transition-colors hover:border-[#f0c060] hover:text-[#f0c060]"
                  aria-label="Copy seed"
                  onClick={async () => { try { await navigator.clipboard.writeText(stats.seed); sfx.click(); } catch { /* clipboard denied */ } }}
                >
                  <Copy className="size-3" />
                </button>
              )}
            </div>
          ))}
        </PxPanel>
        {/* your build */}
        <PxPanel className="w-full p-3 sm:p-4">
          <PxHeader icon={<Sparkles className="size-3.5" />}>Your Build</PxHeader>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="block size-12 overflow-hidden rounded-md border-2 border-[#f0c060]/70 bg-[#1e1430]">
                <img src={assetPath("/assets/sprites/player-idle.png")} alt="" width={48} height={48} className="size-full object-contain [image-rendering:pixelated]" />
              </span>
              <span>
                <span className="font-serif block text-base font-bold text-[#f2ead8]">Archmage</span>
                <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#f0c060]">Rift Sealer</span>
              </span>
            </div>
            <span aria-hidden className="hidden h-10 w-px bg-[#3a2545] sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c8b8d0]">Spells</div>
              <div className="mt-1 flex gap-2">
                {[0, 1, 2].map(i => {
                  const slot = stats.equipped?.[i];
                  const el = typeof slot === "string" ? slot : slot ? slot.merged[0] : null;
                  return (
                    <span key={i} className="flex size-11 items-center justify-center rounded-md border bg-[#1a0e22]" style={{ borderColor: el ? `${elementColor(el)}66` : "rgba(58,37,69,0.9)" }}>
                      {el ? <img src={assetPath(`/assets/icons/element-${el}.png`)} alt="" width={30} height={30} className="h-[30px] w-[30px] [image-rendering:pixelated]" /> : <span className="text-lg font-black text-white/15">+</span>}
                    </span>
                  );
                })}
              </div>
            </div>
            <span aria-hidden className="hidden h-10 w-px bg-[#3a2545] sm:block" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c8b8d0]">Resonances ({stats.newCombos.length})</div>
              <div className="mt-1 flex max-w-md flex-wrap gap-1.5">
                {stats.newCombos.length === 0 ? (
                  <span className="text-[11px] italic text-[#a898b0]/70">None woven this run</span>
                ) : (
                  stats.newCombos.map(k => (
                    <span key={k} className="rounded-md border border-[#a66bf0]/40 bg-[#241740]/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#c9a0ff]">
                      {COMBOS[k]?.name ?? k}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </PxPanel>
        {/* stats strip */}
        <PxPanel className="grid w-full grid-cols-3 gap-px overflow-hidden sm:grid-cols-6" corners={false}>
          {[
            ["Damage Dealt", fmtNum(Math.round(stats.damage)), Swords],
            ["Kills", fmtNum(stats.kills), Skull],
            ["Score", fmtNum(stats.score), Trophy],
            ["Tyrants Slain", String(stats.bossesSlain.length), Crown],
            ["Time in the Rift", fmtTime(stats.timeSec), Clock],
            ["New Resonances", String(stats.newCombos.length), Sparkles]
          ].map(([label, value, Icon]) => {
            const I = Icon as typeof Swords;
            return (
              <div key={label as string} className="flex items-center gap-2 bg-[#160e22]/85 px-2.5 py-2.5">
                <I className="size-4 shrink-0 text-[#f0c060]" />
                <span className="min-w-0">
                  <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[#a898b0]">{label as string}</span>
                  <span className="font-display block text-base font-black leading-tight text-[#f2ead8]">{value as string}</span>
                </span>
              </div>
            );
          })}
        </PxPanel>
        {/* rewards */}
        <PxPanel className="w-full p-3 sm:p-4">
          <PxHeader icon={<Crown className="size-3.5" />}>Rewards</PxHeader>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 rounded-md border border-[#b060d0]/50 bg-[#1a0e22] px-3 py-2">
              <Gem className="size-5 text-[#c9a0ff] [filter:drop-shadow(0_0_6px_#a66bf0)]" />
              <span className="font-display text-lg font-black tabular-nums text-[#f2ead8]">×{fmtNum(stats.payout)}</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#a898b0]">aether glyphs · 100% banked</span>
            </span>
            {stats.bossesSlain.length > 0 && (
              <span className="flex items-center gap-2 rounded-md border border-[#f0c060]/40 bg-[#1a0e22] px-3 py-2">
                <Crown className="size-4 text-[#f0c060]" />
                <span className="text-[11px] font-bold text-[#d8cfe8]">{stats.bossesSlain.length} tyrant{stats.bossesSlain.length > 1 ? "s" : ""} unmade</span>
              </span>
            )}
          </div>
          {stats.newCombos.length > 0 && (
            <div className="mt-3">
              <PxHeader icon={<BookMarked className="size-3.5" />} className="!text-[#c9a0ff]">Unlocked</PxHeader>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {stats.newCombos.map(k => (
                  <span key={k} className="flex items-center gap-1.5 text-[11px] text-[#c8b8d0]">
                    <PxDiamond small />
                    New Resonance: <span className="font-bold text-[#c9a0ff]">{COMBOS[k]?.name ?? k}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </PxPanel>
        {/* actions */}
        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => { sfx.click(); ui.onCreditsReturn(); }} className="px-btn px-btn--ghost h-14 flex-col !tracking-[0.16em]">
            <span className="flex items-center gap-2"><House className="size-4" />Return</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-60">Bank {fmtNum(stats.payout)} glyphs · seal the weave</span>
          </button>
          <button type="button" onClick={() => { sfx.click(); ui.onCreditsFight(); }} className="px-btn px-btn--primary px-breathe h-14 flex-col">
            <span className="flex items-center gap-2"><Infinity className="size-4" />Fight — the Endless Echo</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-70">waves 51+ · escalating pressure</span>
          </button>
        </div>
        {/* asset attribution — kept honest and compact */}
        <details className="w-full max-w-3xl pb-6">
          <summary className="cursor-pointer text-center text-[10px] font-bold uppercase tracking-[0.24em] text-[#9a8fb5]/70 transition-colors hover:text-[#d8cfe8]">Asset attribution</summary>
          <PxPanel className="mt-2 p-4">
            <AssetAttributionList />
          </PxPanel>
        </details>
      </div>
    </motion.div>
  );
}
export function PauseOverlay({
  onResume,
  onAbandon,
  onSettings,
  hud
}) {
  const phase = useRiftStore(s => s.phase);
  return <AnimatePresence>{phase === "paused" && <motion.div className="dark fixed inset-0 z-40 flex items-center justify-center bg-[#0a0712]/70 p-4 backdrop-blur-sm" initial={{
      opacity: 0
    }} animate={{
      opacity: 1
    }} exit={{
      opacity: 0
    }} transition={{
      duration: 0.2
    }} key={"pause"}>{<motion.div className="px-panel px-corners relative w-full max-w-sm p-6 text-center" initial={{
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
        }} />}{<Hourglass className="relative mx-auto size-6 text-[#f0c060]" />}{<h2 className="font-display relative mt-3 text-balance text-lg font-black uppercase tracking-[0.14em] text-[#f0c060] [text-shadow:0_0_22px_rgba(240,192,96,0.35)] sm:text-2xl">The Rift Sleeps</h2>}{<div className="relative mt-1.5 flex items-center justify-center gap-2">{<PxDiamond small />}{<span className="text-[9px] font-bold uppercase tracking-[0.3em] text-[#9a8fb5]">it waits, impatient</span>}{<PxDiamond small />}</div>}{hud && <div className="relative mt-4 rounded-lg border border-[#a66bf0]/25 bg-[#120b24]/70 px-4 py-2.5" aria-label="Active run identity">{<div className="flex items-center justify-center gap-2">{<span className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#6bf0c2]">Active rift seed</span>}{<span className="font-mono text-sm font-bold tracking-widest text-[#ffe9ad]">{hud.seed}</span>}</div>}{hud.biomeName && <div className="mt-1 text-center text-[10px] uppercase tracking-[0.22em] text-white/40">{"Current ground · "}<span className="font-bold text-[#b9aee0]">{hud.biomeName}</span></div>}</div>}{<div className="relative mt-6 flex flex-col gap-2.5">{<button type="button" onClick={() => {
            sfx.click();
            onResume();
          }} className="px-btn px-btn--primary w-full">{<Play className="size-4" />}{" Resume"}</button>}{<button type="button" onClick={() => {
            sfx.click();
            onSettings();
          }} className="px-btn w-full">{<Settings className="size-4" />}{" Settings"}</button>}{<button type="button" onClick={() => {
            sfx.click();
            onAbandon();
          }} className="px-btn w-full" style={{ borderColor: "rgba(224,32,64,0.5)", color: "#ff8fa3" }}>{<DoorOpen className="size-4" />}{" Abandon Run"}</button>}</div>}</motion.div>}</motion.div>}</AnimatePresence>;
}
