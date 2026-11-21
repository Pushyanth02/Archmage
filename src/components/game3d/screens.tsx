"use client";

/* ARCHMAGE: RIFTBOUND — "Rift Night" unified UI screens.
   v3.2 full unification pass: ONE Title & Loadout Hub (the only title
   screen — the legacy WebGL menu is deleted), and Vault / Runes / Codex /
   Settings all render through the shared RiftScreen shell with the master
   palette, the unified pixel-icon registry (src/game3d/palette.ts) and
   mono tabular-nums numerics. Data source: useRiftStore; engine actions
   arrive via the `ui` bridge below — GameShell assigns real handlers at
   mount. This module imports NO engine code; the assets import is
   data-only (manifest pack credits, P2-6). */

import { useState, useEffect, useSyncExternalStore, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Copy, Dices, DoorOpen, Gamepad2, House, Infinity as InfinityIcon, Play, RotateCcw, Shuffle, Skull, Swords, Users } from "lucide-react";
import { PxPanel, PxDiamond, PxFiligree, PxHeader, PxHexButton, PxStarInArch } from "@/components/game3d/pixel";
import { ScreenShell, TabStrip, CurrencyCluster, type TabDef } from "@/components/game3d/RiftScreen";
import { PixelArenaBackdrop } from "@/components/game3d/PixelArenaBackdrop";
import { PALETTE, ICON, PORTRAIT, RELIC, RELIQUARY_ICON, PREVIEW, BIOME_TILE, BIOME_FAMILY, ENEMY_PREVIEW, BOSS_PREVIEW, CLASS_PREVIEW, RARITY, elementIcon, bossPortrait, PIXELATED, type RarityKey } from "@/game3d/palette";
import { useRiftStore, peekSlots } from "@/game3d/store";
import { sfx } from "@/game3d/audio";
import { FALLBACK_PACKS, fetchPackCredits } from "@/game3d/assets";
import { ACTS, computeBonuses, RELIQUARY, RELIQUARY_MAX_LEVEL, reliquaryCost, SPELL_ORDER, ALL_PAIRS, comboKey, COMBOS, SPELLS, ELITE_ORDER, ELITE_DEFS, ENEMY_ORDER, ENEMY_DEFS, BOSS_DEFS, CHANGELOG, GAME_VERSION, MERCY_MAX_TIER, mercyTierBase, VICTORY_WAVE, TERRAINS, biomeDeckFor, PALETTE_IDS, PALETTE_LABELS, elementColor, elementGlow, DEFAULT_SETTINGS, type ReliquaryKey, type GameSettings } from "@/game3d/content";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { assetPath } from "@/lib/asset-path";
import { usePointerCoarse } from "@/game3d/capability";

export
/* ------------------------------------------------------------------ */
/*  the ui bridge — GameShell assigns real handlers at mount           */
/* ------------------------------------------------------------------ */
const ui = {
  onStartRun: (_seed: string) => {},
  onGameOverRetry: (_seed: string) => {},
  onGameOverMenu: () => {},
  onCreditsReturn: () => {},
  onCreditsFight: () => {},
};

/* ------------------------------- tokens ---------------------------- */
const GOLD = PALETTE.gold;
const VIOLET = PALETTE.violet;
const TEAL = PALETTE.teal;
const CRIMSON = PALETTE.crimson;
const SCREEN_BG = "fixed inset-0 z-40 bg-[#171321]/96 backdrop-blur-md dark";
const ROMAN_ACTS = ["I", "II", "III", "IV", "V"];
function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(sec)}s`;
}
const fmtNum = (n: number) => n.toLocaleString("en-US");
const pct = (mult: number) => `+${Math.round((mult - 1) * 100)}%`;
/* Gold diamond-thumb slider skin — one class string shared by every
 * settings slider: gold range, beveled diamond thumb on the track. */
const GOLD_SLIDER = "h-11 flex-1 [&_[data-slot=slider-track]]:bg-[#3D3152] [&_[data-slot=slider-range]]:bg-[#D9BA72] [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:rounded-[3px] [&_[data-slot=slider-thumb]]:rotate-45 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-[#9E854F] [&_[data-slot=slider-thumb]]:bg-[#D9BA72] [&_[data-slot=slider-thumb]]:shadow-[0_0_10px_rgba(217,186,114,0.5)]";

/** The player's class identity: the stormcaller brand mage. */
const PLAYER_CLASS = { name: "Stormcaller", epithet: "Voice of the Rift" };

/* ================================================================== */
/*  SHARED PIECES                                                      */
/* ================================================================== */
/** One equipped spell as an ornate tile — pixel icon, element rim, optional
 *  fused pair. Shared by the results screens' build panel. */
function SpellTile({ slot, size = 46 }: { slot: string | { merged: string[] } | null; size?: number }) {
  const el = typeof slot === "string" ? slot : slot ? slot.merged[0] : null;
  const el2 = slot && typeof slot !== "string" ? slot.merged[1] ?? null : null;
  const col = el ? elementColor(el) : PALETTE.textMuted;
  if (!el) {
    return (
      <span className="flex flex-col items-center gap-1">
        <span className="flex items-center justify-center rounded-md border border-[#3D3152] bg-[#1B1528]" style={{ width: size, height: size }}>
          <span className="text-lg font-black text-white/15">+</span>
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#9E93B5]/50">Empty</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-center gap-1">
      <span
        className="relative flex items-center justify-center rounded-md border-2 bg-[#1B1528]"
        style={{ width: size, height: size, borderColor: `${col}66`, boxShadow: `0 0 14px ${col}22` }}
      >
        <img src={elementIcon(el)} alt="" width={size - 14} height={size - 14} draggable={false} className={PIXELATED} style={{ width: size - 14, height: size - 14, filter: `drop-shadow(0 0 6px ${col}aa)` }} />
        {el2 && (
          <img src={elementIcon(el2)} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "absolute -bottom-1 -right-1 rounded border border-[#D9BA72]/70 bg-[#140E1D] p-[2px]")} style={{ width: 18, height: 18 }} />
        )}
      </span>
      <span className="max-w-[72px] truncate text-[9px] font-bold uppercase tracking-[0.1em] text-[#BFB5D4]/80">
        {el2 ? "Fused" : SPELLS[el as keyof typeof SPELLS]?.name ?? el}
      </span>
    </span>
  );
}
/** YOUR BUILD panel — stormcaller bust + three spell tiles + the run's
 *  resonances as element-pair chips. */
function BuildPanel({ stats, epithet, icon }: { stats: { equipped: (string | { merged: string[] } | null)[]; newCombos: string[] }; epithet: string; icon: React.ReactNode }) {
  return (
    <PxPanel className="w-full p-3 sm:p-4">
      <PxHeader icon={icon}>Your Build</PxHeader>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="relative block size-[52px] shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#D9BA72] to-[#9E854F] p-[2px]">
            <span className="block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#241C33]">
              <img src={PORTRAIT.player()} alt="" width={52} height={52} draggable={false} className={cn(PIXELATED, "size-full object-cover")} />
            </span>
          </span>
          <span>
            <span className="font-display block text-base font-bold text-[#EFEAF7]">{PLAYER_CLASS.name}</span>
            <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#D9BA72]">{epithet}</span>
          </span>
        </div>
        <span aria-hidden className="hidden h-10 w-px bg-[#3D3152] sm:block" />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#BFB5D4]">Spells</div>
          <div className="mt-1 flex gap-2.5">
            {[0, 1, 2].map(i => <SpellTile key={i} slot={stats.equipped?.[i] ?? null} />)}
          </div>
        </div>
        <span aria-hidden className="hidden h-10 w-px bg-[#3D3152] sm:block" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#BFB5D4]">Resonances ({stats.newCombos.length})</div>
          <div className="mt-1 flex max-w-md flex-wrap gap-1.5">
            {stats.newCombos.length === 0 ? (
              <span className="rounded-md border border-dashed border-[#3D3152] px-2.5 py-1 text-[10px] italic text-[#9E93B5]">None woven this run</span>
            ) : (
              stats.newCombos.slice(0, 6).map(k => {
                const parts = k.split("+");
                return (
                  <span key={k} className="flex items-center gap-1.5 rounded-md border border-[#A991F7]/40 bg-[#241C33]/80 py-0.5 pl-1 pr-2">
                    {parts[0] && <img src={elementIcon(parts[0])} alt="" width={16} height={16} draggable={false} className={cn(PIXELATED, "size-4")} />}
                    {parts[1] && <img src={elementIcon(parts[1])} alt="" width={16} height={16} draggable={false} className={cn(PIXELATED, "size-4")} />}
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#E8D6FF]">{COMBOS[k]?.name ?? k}</span>
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>
    </PxPanel>
  );
}
/** One results-screen stat cell — pixel/relic icon + tracked caps + value. */
function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-[#1B1528]/85 px-2.5 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[#D9BA72]/35 bg-[#140E1D]/90">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[#9E93B5]">{label}</span>
        <span className="font-display block truncate text-base font-black leading-tight text-[#EFEAF7]">{value}</span>
      </span>
    </div>
  );
}
/** A reward tile — pixel relic art with a ×N badge. */
function RewardTile({ src, count, label, tone = "gold" }: { src: string; count: string; label: string; tone?: "gold" | "violet" }) {
  const col = tone === "gold" ? PALETTE.gold : PALETTE.violet;
  return (
    <span className="relative flex flex-col items-center gap-1 rounded-lg border bg-[#1B1528] px-3 pb-2 pt-2.5" style={{ borderColor: `${col}55`, boxShadow: `0 0 16px ${col}18` }}>
      <span className="relative">
        <img src={src} alt="" width={36} height={36} draggable={false} className={cn(PIXELATED, "size-9")} style={{ filter: `drop-shadow(0 0 8px ${col}88)` }} />
        <span className="absolute -bottom-1.5 -right-2 rounded border px-1 font-mono text-[9px] font-black leading-tight tabular-nums" style={{ borderColor: `${col}88`, background: "#140E1D", color: col }}>×{count}</span>
      </span>
      <span className="max-w-[86px] text-center text-[8px] font-bold uppercase leading-tight tracking-[0.12em] text-[#9E93B5]">{label}</span>
    </span>
  );
}
/** Ambient radial glows shared by full-screen menus (palette voices only). */
function AmbientGlows({ variant = "gold" }: { variant?: "gold" | "crimson" }) {
  const main = variant === "gold" ? GOLD : CRIMSON;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-12%] h-[42vh] w-[85vw] -translate-x-1/2 rounded-full opacity-[0.07] blur-[120px]" style={{ backgroundColor: main }} />
      <div className="absolute bottom-[-25%] left-[-12%] h-[55vh] w-[55vw] rounded-full bg-[#A991F7] opacity-[0.07] blur-[130px]" />
      <div className="absolute right-[-12%] top-[15%] h-[45vh] w-[45vw] rounded-full bg-[#58D6C2] opacity-[0.05] blur-[130px]" />
    </div>
  );
}
/** Tiny uppercase section label. */
function SectionLabel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn("text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40", className)}>{children}</div>;
}

/* ================================================================== */
/*  ASSET ATTRIBUTION (manifest packs[])                               */
/* ================================================================== */
const ATTRIBUTION_NOTE = "Credits are generated from the asset manifest (public/assets/manifests/assets.json). " +
  "Packs marked permission pending are not cleared for commercial distribution. " +
  "All other art, code, music and sound are synthesized in-engine. " +
  "Key art conjured by AI.";
function licenseShort(p: { licenseId: string }) {
  const id = p.licenseId;
  if (id.includes("CC0")) return "CC0";
  if (id.includes("QAL")) return "QAL";
  if (id.startsWith("No explicit license")) return "no explicit license";
  return id;
}
function licenseBadge(p: { licenseId: string; licenseStatus: string }) {
  if (p.licenseStatus === "disallowed") return "disallowed — not shippable";
  if (p.licenseStatus === "permission-pending") return "permission pending — demo use only";
  if (p.licenseStatus !== "verified") return "license status unknown";
  return `${licenseShort(p)} · cleared`;
}
function AssetAttributionList({ className }: { className?: string }) {
  const [packs, setPacks] = useState(FALLBACK_PACKS);
  useEffect(() => {
    let alive = true;
    fetchPackCredits().then(p => {
      if (alive && p.length > 0) setPacks(p);
    });
    return () => { alive = false; };
  }, []);
  return (
    <div className={cn("flex flex-col", className)}>
      {packs.map(p => {
        const cleared = p.licenseStatus === "verified";
        return (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-white/5 py-1.5 last:border-b-0" key={p.id}>
            <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 text-[11px] font-semibold text-white/75 underline decoration-white/40 underline-offset-2 transition-colors hover:text-[#F8E7BF]">{p.pack}</a>
            <span className="text-[10px] text-white/45">{p.author}</span>
            <span className={cn("rounded-full border px-2 py-px text-[9px] font-bold uppercase tracking-wide", cleared ? "border-[#58D6C2]/40 bg-[#58D6C2]/10 text-[#58D6C2]" : "border-[#D9BA72]/50 bg-[#D9BA72]/10 text-[#D9BA72]")}>{licenseBadge(p)}</span>
          </div>
        );
      })}
      <p className="mt-2.5 text-[10px] leading-relaxed text-white/40">{ATTRIBUTION_NOTE}</p>
    </div>
  );
}

/* ================================================================== */
/*  THE TITLE & LOADOUT HUB — the ONE title screen                     */
/* ================================================================== */
export function MainMenu() {
  const screen = useRiftStore(s => s.screen);
  const phase = useRiftStore(s => s.phase);
  const show = screen === "menu" && phase === "menu";
  return (
    <>
      <AnimatePresence>{show && <MenuContent key="main-menu" />}</AnimatePresence>
      <CodexScreen />
    </>
  );
}
function useIsTouch() {
  return usePointerCoarse();
}
function KeyRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="flex gap-1">{keys.map(k => <span className="rift-keycap" key={k}>{k}</span>)}</span>
      <span className="font-body text-[13px] text-[#BFB5D4]">{label}</span>
    </div>
  );
}
function TouchRow({ badge, label }: { badge: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="rift-touch-chip">{badge}</span>
      <span className="font-body text-[13px] text-[#BFB5D4]">{label}</span>
    </div>
  );
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
  const isTouch = useIsTouch();
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
  /* the rift level — lifetime progress from real meta */
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
      className="fixed inset-0 z-40 overflow-hidden bg-[#171321]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45 } }}
      transition={{ duration: 0.5 }}
    >
      {/* THE backdrop: the live pixel-art arena (same atlases as runs) */}
      <PixelArenaBackdrop />
      {/* readability veil + corner brackets + letterbox */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(23,19,33,0.25) 30%, rgba(23,19,33,0.88) 100%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-60">
        <div className="rift-sigil-spin absolute left-1/2 top-1/2 h-[min(112vw,760px)] w-[min(112vw,760px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]" />
      </div>
      <RuneCorners />
      <LetterboxBars />
      <div className="rift-scroll safe-x relative z-10 h-full overflow-y-auto">
        <div className="font-body relative flex min-h-full flex-col items-center px-4 pb-8 pt-4 sm:pt-6">
          {/* ---- top bar: player card left, currency cluster right ---- */}
          <div className="flex w-full max-w-6xl flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
              <PxPanel className="flex items-center gap-3 px-3 py-2">
                <span aria-hidden className="relative block size-14 shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#D9BA72] to-[#9E854F] p-[2px]">
                  <span className="block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#241C33]">
                    <img src={PORTRAIT.player()} alt="" width={56} height={56} draggable={false} className={cn(PIXELATED, "size-full object-cover")} />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="font-display block truncate text-base font-bold leading-tight text-[#EFEAF7]">Archmage</span>
                  <span className="block text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#D9BA72]">Lv. {level}</span>
                  <span className="mt-1 block h-1.5 w-32 overflow-hidden rounded-full border border-[#3D3152] bg-[#140E1D]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#A991F7] to-[#E8D6FF]" style={{ width: `${xpPct}%` }} />
                  </span>
                </span>
              </PxPanel>
            </motion.div>
            <motion.div className="flex items-center gap-2" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.28, duration: 0.5 }}>
              <CurrencyCluster shards={meta.shards} score={meta.bestScore} />
            </motion.div>
          </div>

          {/* ---- title block ---- */}
          <div className="mt-4 flex flex-col items-center sm:mt-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.6 }}>
              <PxStarInArch className="h-14 w-auto drop-shadow-[0_0_14px_rgba(248,231,191,0.35)] sm:h-16" />
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
              <span className="text-[clamp(12px,1.6vw,16px)] font-bold uppercase tracking-[0.5em] text-[#E8D6FF] [text-shadow:0_0_16px_rgba(169,145,247,0.45)]">Riftbound</span>
              <PxFiligree width="w-14 sm:w-24" />
            </motion.div>
            <motion.div className="mt-2 flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.78, duration: 0.4 }} aria-label={`Version ${GAME_VERSION} — ${CHANGELOG[0].name}`}>
              <span className="border border-[#D9BA72]/60 bg-[#241C33]/80 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.24em] text-[#D9BA72]">Version {GAME_VERSION}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#A991F7]">{CHANGELOG[0].name}</span>
            </motion.div>
          </div>

          {/* ---- the two rift calls ---- */}
          <div className="mt-6 flex w-full max-w-3xl flex-col items-stretch justify-center gap-7 sm:mt-10 sm:flex-row sm:items-center sm:gap-10">
            <motion.div className="w-full sm:max-w-[300px]" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.5 }}>
              <PxHexButton glow="gold" className="px-breathe w-full" tabIcon={<img src={RELIC.staff("storm")} alt="" width={26} height={26} draggable={false} className={cn(PIXELATED, "size-[26px]")} />} onClick={startRun} onMouseEnter={hover}>
                Play
              </PxHexButton>
            </motion.div>
            <motion.div className="w-full sm:max-w-[300px]" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.5 }}>
              <PxHexButton
                glow="violet"
                className="w-full"
                tabIcon={<img src={assetPath("/assets/v31/icons/school_vortex.png")} alt="" width={26} height={26} draggable={false} className={cn(PIXELATED, "size-[26px]")} />}
                onClick={() => { sfx.click(); setPartyNotice(true); window.setTimeout(() => setPartyNotice(false), 3200); }}
                onMouseEnter={hover}
              >
                Online Party
              </PxHexButton>
            </motion.div>
          </div>
          <AnimatePresence>
            {partyNotice && (
              <motion.p
                className="mt-3 rounded-md border border-[#A991F7]/40 bg-[#241C33]/85 px-4 py-1.5 text-[11px] italic text-[#BFB5D4]"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                The party channels are still being woven — the rift answers solo calls for now.
              </motion.p>
            )}
          </AnimatePresence>

          {/* ---- seed plate ---- */}
          <motion.div className="mt-5 flex flex-wrap items-center justify-center gap-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: 0.4 }}>
            <PxPanel className="flex items-center gap-2.5 px-4 py-2">
              <img src={ICON.crystal()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />
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
                  className="w-36 border border-[#A991F7]/40 bg-[#140E1D]/90 px-2 py-0.5 text-center font-mono text-sm font-bold tracking-widest tabular-nums text-[#F8E7BF] outline-none focus:border-[#D9BA72]"
                />
              ) : (
                <button className="flex min-h-11 items-center text-sm tracking-wider" title="Click to edit the seed" onClick={() => { sfx.click(); setEditingSeed(true); }}>
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9E93B5]">Seed:</span>
                  <span className="ml-1.5 font-mono font-bold tabular-nums tracking-widest text-[#EFEAF7]">{seed}</span>
                </button>
              )}
              <button className="flex size-8 items-center justify-center rounded-md border border-[#D9BA72]/50 text-[#D9BA72] transition-colors hover:border-[#D9BA72]" title="Copy this seed — paste it back any time to replay the same rift" aria-label="Copy seed" onClick={copySeed}>
                {seedCopied ? <span className="text-[9px] font-black uppercase tracking-widest text-[#58D6C2]">Copied</span> : <Copy className="size-3.5" />}
              </button>
              <button className="flex size-8 items-center justify-center rounded-md border border-[#D9BA72]/50 text-[#D9BA72] transition-colors hover:border-[#D9BA72]" title="Reroll — draws a fresh seed for the NEXT run only" aria-label="Reroll seed" onClick={() => { sfx.click(); randomizeSeed(); }}>
                <Shuffle className="size-3.5" />
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
              {[
                { label: "Vault", icon: ICON.chest(), act: () => setScreen("reliquary"), title: "The Vault — permanent upgrades bought with aether glyphs" },
                { label: "Runes", icon: RELIC.amulet(), act: () => setScreen("arcanum"), title: "The Runes — spellbook, resonances and the bestiary" },
                { label: "Codex", icon: RELIC.grimoire(), act: () => setScreen("codex"), title: "The Codex — how to play and what changed" },
                { label: "Settings", icon: RELIC.tome(), act: () => openSettings(), title: "Settings — audio, visuals, controls, data" },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => { sfx.click(); item.act(); }}
                  onMouseEnter={hover}
                  className="px-panel px-corners flex min-h-11 flex-1 basis-32 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.18em] text-[#D9BA72] transition-all hover:-translate-y-0.5 hover:text-[#F8E7BF] sm:text-[13px]"
                  title={item.title}
                >
                  <img src={item.icon} alt="" width={20} height={20} draggable={false} className={cn(PIXELATED, "size-5")} />
                  {item.label}
                </button>
              ))}
            </div>
            {/* records — subtle lifetime strip under the nav */}
            <div className="mx-auto mt-3 flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-[#9E93B5]" aria-label="Lifetime records">
              <span><span className="font-mono font-bold tabular-nums text-[#D9BA72]">{meta.bestWave}</span> best wave</span>
              <PxDiamond small className="opacity-50" />
              <span><span className="font-mono font-bold tabular-nums text-[#D9BA72]">{meta.runs}</span> trials</span>
              <PxDiamond small className="opacity-50" />
              <span><span className="font-mono font-bold tabular-nums text-[#D9BA72]">{meta.combosFound.length}</span> resonances</span>
              {meta.victories > 0 && (
                <>
                  <PxDiamond small className="opacity-50" />
                  <span><span className="font-mono font-bold tabular-nums text-[#D9BA72]">{meta.victories}</span> seals</span>
                </>
              )}
            </div>
            {/* legal footer */}
            <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[9px] uppercase tracking-[0.18em]">
              <button onClick={() => setLegal("terms")} className="min-h-11 px-2 py-1 font-bold text-white/40 transition-colors hover:text-[#D9BA72] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D9BA72]">Terms of Service</button>
              <span aria-hidden className="text-white/20">·</span>
              <button onClick={() => setLegal("privacy")} className="min-h-11 px-2 py-1 font-bold text-white/40 transition-colors hover:text-[#D9BA72] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D9BA72]">Privacy Policy</button>
            </div>
          </motion.div>
        </div>
      </div>
      <div className="safe-b safe-x pointer-events-none absolute bottom-2 right-3 z-30 font-mono text-[9px] uppercase tracking-[0.25em] tabular-nums text-white/40">v{GAME_VERSION} · {CHANGELOG[0].name}</div>
      <LegalDialog which={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />
    </motion.div>
  );
}
/** Rune-frame corner brackets around the whole viewport. */
function RuneCorners() {
  const c = "pointer-events-none absolute size-10 border-[#D9BA72]/45";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={`${c} left-3 top-3 border-l-2 border-t-2`} />
      <div className={`${c} right-3 top-3 border-r-2 border-t-2`} />
      <div className={`${c} bottom-3 left-3 border-b-2 border-l-2`} />
      <div className={`${c} bottom-3 right-3 border-b-2 border-r-2`} />
    </div>
  );
}
/** Cinematic letterbox bars — collapse in from full-bleed on load. */
function LetterboxBars() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
      <div className="rift-lb rift-lb-top absolute inset-x-0 top-0 h-6 bg-[#140E1D]" />
      <div className="rift-lb rift-lb-bot absolute inset-x-0 bottom-0 h-6 bg-[#140E1D]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LEGAL — Terms of Service / Privacy Policy                          */
/* ------------------------------------------------------------------ */
const LEGAL_UPDATED = "2026-10-27";
const LEGAL_TERMS: [string, string][] = [["The game", "ARCHMAGE: RIFTBOUND is a free roguelite that runs entirely in your browser. It is provided as-is, for enjoyment, without warranty of any kind."], ["Your progress", "The game has no accounts. Progress, unlocks and settings live in your browser's local storage — they never leave your device, and clearing your browser data erases them. Nothing is backed up anywhere."], ["Seeds and fair play", "Every run is deterministic per seed. Sharing seeds is encouraged; exploiting bugs is between you and the rift."], ["The art and the code", "The game's code is by The Last Archmage. The mage, the bestiary, the terrains, the spell icons and the particles come from open-source art packs, credited in full in the in-game Codex."], ["Changes", "The game and these terms may change between versions; the in-game Codex carries the changelog."], ["Contact", "File issues at the source repository: github.com/Pushyanth02/Archmage."]];
const LEGAL_PRIVACY: [string, string][] = [["What we collect", "Nothing. No accounts, no analytics, no advertising, no cookies, no tracking pixels. The game cannot identify you."], ["What stays on your device", "Progress and settings are written to your browser's local storage. They are never transmitted; the game runs entirely on your device. Clearing your browser data deletes them."], ["The crash snapshot", "If the game breaks, it offers to copy a diagnostic snapshot (seed, settings, version) to your clipboard. It is never uploaded anywhere."], ["Third parties", "One kind of request leaves your browser: the page and its files (typefaces included — they are part of the game itself) are fetched from GitHub Pages, which sees standard web-server request logs (IP address, user agent). Nothing else is shared with anyone — there is nothing else to share."], ["Children", "No data is collected from anyone, of any age."], ["Changes", "This policy may change between versions; material changes will be noted in the in-game changelog."], ["Contact", "github.com/Pushyanth02/Archmage — issues."]];
function LegalDialog({ which, onClose, onSwitch }: { which: null | "terms" | "privacy"; onClose: () => void; onSwitch: (w: "terms" | "privacy") => void }) {
  const isTerms = which === "terms";
  const doc = isTerms ? LEGAL_TERMS : LEGAL_PRIVACY;
  return (
    <Dialog open={which !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="dark flex flex-col gap-4 overflow-hidden border-[#D9BA72]/25 bg-[#1B1528]/95 p-4 text-white/90 backdrop-blur-xl sm:max-w-lg sm:p-5">
        <div className="shrink-0 text-center">
          <DialogTitle className="font-display text-lg font-bold uppercase tracking-[0.25em] text-[#D9BA72]">{isTerms ? "Terms of Service" : "Privacy Policy"}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-white/40">ARCHMAGE: RIFTBOUND — v{GAME_VERSION} · updated {LEGAL_UPDATED}</DialogDescription>
        </div>
        <div className="rift-scroll min-h-0 flex-1 overflow-y-auto pr-2">
          <div className="flex flex-col gap-4">
            {doc.map(([h, body]) => (
              <section key={h}>
                <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-[#A991F7]">{h}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#BFB5D4]">{body}</p>
              </section>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-white/10 pt-3" role="tablist" aria-label="Legal documents">
          <button role="tab" aria-selected={isTerms} disabled={isTerms} onClick={() => onSwitch("terms")} className="min-h-11 rounded-md border border-white/10 bg-black/40 px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-[#D9BA72] disabled:border-[#D9BA72]/50 disabled:bg-[#D9BA72]/10 disabled:text-[#D9BA72]">Terms of Service</button>
          <button role="tab" aria-selected={!isTerms} disabled={!isTerms} onClick={() => onSwitch("privacy")} className="min-h-11 rounded-md border border-white/10 bg-black/40 px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-[#D9BA72] disabled:border-[#D9BA72]/50 disabled:bg-[#D9BA72]/10 disabled:text-[#D9BA72]">Privacy Policy</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/*  THE VAULT — filterable relic grid + right-hand detail inspector    */
/* ================================================================== */
const VAULT_TABS: { id: RarityKey | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "regal", label: RARITY.regal.label },
  { id: "arcane", label: RARITY.arcane.label },
  { id: "attuned", label: RARITY.attuned.label },
  { id: "common", label: RARITY.common.label },
];
/** Rarity per Vault item — derived from the upgrade level achieved. */
function rarityFor(key: string, level: number): RarityKey {
  if (level >= RELIQUARY_MAX_LEVEL) return "regal";
  if (level >= 4) return "arcane";
  if (level >= 2) return "attuned";
  if (level >= 1) return "common";
  return key === "vitality" ? "common" : "common";
}
export function ReliquaryScreen() {
  const screen = useRiftStore(s => s.screen);
  return <AnimatePresence>{screen === "reliquary" && <ReliquaryContent key="reliquary" />}</AnimatePresence>;
}
function ReliquaryContent() {
  const meta = useRiftStore(s => s.meta);
  const buyUpgrade = useRiftStore(s => s.buyUpgrade);
  const setScreen = useRiftStore(s => s.setScreen);
  const bonuses = computeBonuses(meta.upgrades);
  const [filter, setFilter] = useState<RarityKey | "all">("all");
  const [selected, setSelected] = useState<string>(RELIQUARY[0]?.key ?? "vitality");
  const close = () => setScreen("menu");

  const items = RELIQUARY.map(def => {
    const level = meta.upgrades[def.key as ReliquaryKey] ?? 0;
    return { def, level, rarity: rarityFor(def.key, level) };
  });
  const filtered = filter === "all" ? items : items.filter(i => i.rarity === filter);
  const sel = items.find(i => i.def.key === selected) ?? items[0];
  const selCost = reliquaryCost(sel.level);
  const selMaxed = sel.level >= RELIQUARY_MAX_LEVEL;
  const selAfford = meta.shards >= selCost;

  return (
    <ScreenShell title="The Vault" subtitle="Permanent upgrades · paid in aether glyphs" onClose={close} right={<CurrencyCluster shards={meta.shards} score={meta.bestScore} />}>
      {/* rarity filter chips */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
        {VAULT_TABS.map(t => (
          <button key={t.id} type="button" className="rn-chip" data-active={filter === t.id} onClick={() => { sfx.hover(); setFilter(t.id); }}>
            {t.id !== "all" && <span aria-hidden className="size-2 rounded-[1px]" style={{ backgroundColor: RARITY[t.id as RarityKey].color }} />}
            {t.label}
          </button>
        ))}
      </div>
      {/* grid + inspector */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* the grid */}
        <div className="rn-scroll grid flex-1 content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 ? (
            <p className="col-span-full px-1 py-8 text-center text-[11px] italic text-white/35">No relics of this rarity yet — bind levels in the grid above.</p>
          ) : filtered.map(({ def, level, rarity }) => {
            const isSel = def.key === selected;
            const maxed = level >= RELIQUARY_MAX_LEVEL;
            const cost = reliquaryCost(level);
            const afford = meta.shards >= cost;
            return (
              <button
                key={def.key}
                type="button"
                className="rn-tile"
                data-selected={isSel}
                onClick={() => { sfx.hover(); setSelected(def.key); }}
                aria-pressed={isSel}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-[#140E1D]/80" style={{ borderColor: `${RARITY[rarity].color}55` }}>
                    <img src={RELIQUARY_ICON[def.key]?.() ?? RELIC.tome()} alt="" width={32} height={32} draggable={false} className={cn(PIXELATED, "size-8")} style={{ filter: `drop-shadow(0 0 8px ${RARITY[rarity].color}66)` }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-bold uppercase tracking-[0.14em] text-[#EFEAF7]">{def.name}</span>
                      <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: RARITY[rarity].color }}>{RARITY[rarity].label}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[#9E93B5]">{def.desc}</span>
                  </span>
                </div>
                {/* level pips */}
                <span className="flex gap-1.5" aria-label={`Level ${level} of ${RELIQUARY_MAX_LEVEL}`}>
                  {Array.from({ length: RELIQUARY_MAX_LEVEL }, (_, i) => (
                    <span key={i} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: i < level ? RARITY[rarity].color : "rgba(255,255,255,0.08)", boxShadow: i < level ? `0 0 8px ${RARITY[rarity].color}66` : undefined }} />
                  ))}
                </span>
                <span className="flex items-center justify-between gap-2">
                  {maxed ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#58D6C2]">Fully attuned</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[10px] text-white/45">
                      <img src={ICON.crystal()} alt="" width={12} height={12} draggable={false} className={cn(PIXELATED, "size-3")} />
                      <span className={cn("font-mono font-bold tabular-nums", afford ? "text-[#D9BA72]" : "text-white/35")}>{cost}</span>
                      <span className="text-white/30">glyphs</span>
                    </span>
                  )}
                  <span className="font-mono text-[10px] uppercase tabular-nums text-white/40">Lv {level}/{RELIQUARY_MAX_LEVEL}</span>
                </span>
              </button>
            );
          })}
        </div>
        {/* the detail inspector */}
        <aside className="flex shrink-0 flex-col gap-3 lg:w-80" aria-label="Relic details">
          <PxPanel className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border-2 bg-[#140E1D]" style={{ borderColor: `${RARITY[sel.rarity].color}88`, boxShadow: `0 0 18px ${RARITY[sel.rarity].color}33` }}>
                <img src={RELIQUARY_ICON[sel.def.key]?.() ?? RELIC.tome()} alt="" width={44} height={44} draggable={false} className={cn(PIXELATED, "size-11")} style={{ filter: `drop-shadow(0 0 10px ${RARITY[sel.rarity].color}88)` }} />
              </span>
              <div className="min-w-0">
                <div className="truncate font-display text-lg font-bold text-[#EFEAF7]">{sel.def.name}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: RARITY[sel.rarity].color }}>{RARITY[sel.rarity].label} relic</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tabular-nums text-[#9E93B5]">Level {sel.level} / {RELIQUARY_MAX_LEVEL}</div>
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-[#BFB5D4]">{sel.def.desc} Ancient gold script along the rim names the rite: <span className="italic text-[#9E93B5]">{sel.def.perLevel} per level, forever.</span></p>
            <div className="rn-stat"><span>Effect per level</span><b>{sel.def.perLevel}</b></div>
            <div className="rn-stat"><span>Total now</span><b>{sel.def.key === "vitality" ? pct(bonuses.hpMult) : sel.def.key === "power" ? pct(bonuses.dmgMult) : sel.def.key === "focus" ? pct(bonuses.aetherMult) : pct(bonuses.speedMult)}</b></div>
            <div className="rn-stat"><span>Next level cost</span><b>{selMaxed ? "—" : fmtNum(selCost)}</b></div>
            <button
              type="button"
              disabled={selMaxed || !selAfford}
              onClick={() => { buyUpgrade(sel.def.key as ReliquaryKey); }}
              className="px-btn px-btn--primary min-h-11 w-full text-[11px]! disabled:opacity-40"
            >
              {selMaxed ? "Fully attuned" : `Bind level ${sel.level + 1} · ${fmtNum(selCost)} glyphs`}
            </button>
          </PxPanel>
          {/* attuned totals */}
          <PxPanel className="p-4">
            <PxHeader>Attuned totals</PxHeader>
            <div className="mt-2">
              <div className="rn-stat"><span>Health</span><b className="text-[#E96578]!">{pct(bonuses.hpMult)}</b></div>
              <div className="rn-stat"><span>Spell damage</span><b className="text-[#E96578]!">{pct(bonuses.dmgMult)}</b></div>
              <div className="rn-stat"><span>Aether</span><b className="text-[#A991F7]!">{pct(bonuses.aetherMult)}</b></div>
              <div className="rn-stat"><span>Speed</span><b className="text-[#58D6C2]!">{pct(bonuses.speedMult)}</b></div>
            </div>
          </PxPanel>
        </aside>
      </div>
    </ScreenShell>
  );
}

/* ================================================================== */
/*  THE RUNES — loadout & socket UX: spells, sockets, synergy, mercy   */
/* ================================================================== */
const RUNES_TABS: TabDef[] = [
  { id: "spellbook", label: "Spellbook" },
  { id: "resonances", label: "Resonances" },
  { id: "mercy", label: "Rift Mercy" },
  { id: "records", label: "Records" },
];
export function ArcanumScreen() {
  const screen = useRiftStore(s => s.screen);
  return <AnimatePresence>{screen === "arcanum" && <ArcanumContent key="arcanum" />}</AnimatePresence>;
}
function ArcanumContent() {
  const meta = useRiftStore(s => s.meta);
  const setScreen = useRiftStore(s => s.setScreen);
  const setMercyTier = useRiftStore(s => s.setMercyTier);
  const [tab, setTab] = useState("spellbook");
  const close = () => setScreen("menu");
  const maxTier = Math.min(MERCY_MAX_TIER, meta.mercyDeaths);
  const seenSpells = SPELL_ORDER.filter(id => meta.seenSpells.includes(id));
  const discoveredCombos = ALL_PAIRS.filter(([a, b]) => meta.combosFound.includes(comboKey(a, b)));
  return (
    <ScreenShell title="The Runes" subtitle="Spellbook · resonances · the rite of mercy" onClose={close} right={<CurrencyCluster shards={meta.shards} score={meta.bestScore} />}>
      <TabStrip tabs={RUNES_TABS} active={tab} onChange={t => { sfx.hover(); setTab(t); }} ariaLabel="Runes sections" />
      {tab === "spellbook" && (
        <div className="rn-scroll">
          {/* live loadout sockets — the three spell slots the HUD mirrors */}
          <PxPanel className="mb-3 p-4">
            <PxHeader>Loadout sockets</PxHeader>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#9E93B5]">The three sockets you carry into every trial. Spells are offered by the rift as you fight — bind a new one by picking it up in a run; fuse two at a resonance gate to fill a socket with a merged pair.</p>
            <div className="mt-3 flex flex-wrap items-end justify-center gap-4">
              {[0, 1, 2].map(i => {
                const known = seenSpells[i] ?? null;
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <span className="px-socket relative flex size-14 items-center justify-center border-2 border-[#3D3152] bg-[#140E1D]" style={{ boxShadow: known ? `0 0 14px ${elementColor(known)}44` : undefined }}>
                      <span aria-hidden className="absolute -top-2 left-1/2 flex h-4 -translate-x-1/2 items-center rounded-[4px] border border-[#9E854F] bg-gradient-to-b from-[#F8E7BF] to-[#D9BA72] px-1 font-mono text-[9px] font-black text-[#241408]">{i + 1}</span>
                      {known ? (
                        <img src={elementIcon(known)} alt="" width={30} height={30} draggable={false} className={cn(PIXELATED, "size-[30px]")} style={{ filter: `drop-shadow(0 0 8px ${elementColor(known)}aa)` }} />
                      ) : (
                        <span className="text-lg font-black text-white/15">+</span>
                      )}
                    </span>
                    <span className="max-w-[76px] truncate text-center text-[9px] font-bold uppercase tracking-[0.1em] text-[#9E93B5]">{known ? SPELLS[known]?.name ?? known : "Empty"}</span>
                  </div>
                );
              })}
            </div>
          </PxPanel>
          {/* the bound spell grid */}
          {seenSpells.length === 0 ? (
            <p className="px-1 py-8 text-center text-[11px] italic leading-relaxed text-white/35">No spells bound yet. Enter the rift — every spell you hold appears here.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2 xl:grid-cols-3">
              {seenSpells.map(id => {
                const s = SPELLS[id as keyof typeof SPELLS];
                return (
                  <div key={id} className="rn-tile" data-selected={false} style={{ cursor: "default" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <img src={elementIcon(id)} alt="" width={38} height={38} draggable={false} className={cn(PIXELATED, "h-[38px] w-[38px] shrink-0")} style={{ filter: `drop-shadow(0 0 8px ${s.color}aa)` }} />
                        <div className="min-w-0">
                          <h3 className="font-display truncate text-base font-bold leading-tight text-[#EFEAF7]">{s.name}</h3>
                          <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: s.color }}>{s.tagline}</p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: s.color, borderColor: `${s.color}55`, backgroundColor: `${s.color}12` }}>{id}</span>
                    </div>
                    <p className="flex-1 text-xs leading-relaxed text-white/50">{s.desc}</p>
                    <div className="grid grid-cols-3 gap-2 border-t border-[#3D3152]/50 pt-2 text-center">
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">Aether</div><div className="font-mono text-sm font-bold tabular-nums" style={{ color: s.color }}>{s.manaCost}</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">Cooldown</div><div className="font-mono text-sm font-bold tabular-nums text-white/80">{s.cooldown}s</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">Damage</div><div className="font-mono text-sm font-bold tabular-nums text-white/80">{s.baseDamage > 0 ? s.baseDamage : "—"}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {tab === "resonances" && (
        <div className="rn-scroll">
          <div className="flex items-baseline justify-between pb-2">
            <SectionLabel>Resonances woven</SectionLabel>
            <span className="font-mono text-xs tabular-nums text-white/60"><span className="font-bold text-[#A991F7]">{discoveredCombos.length}</span> / {ALL_PAIRS.length}</span>
          </div>
          {discoveredCombos.length === 0 ? (
            <p className="px-1 py-8 text-center text-[11px] italic leading-relaxed text-white/35">Nothing woven yet. Cast two different elements back to back to weave a resonance.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3 lg:grid-cols-4">
              {discoveredCombos.map(([a, b]) => {
                const key = comboKey(a, b);
                const combo = COMBOS[key];
                const ca = SPELLS[a].color;
                const cb = SPELLS[b].color;
                return (
                  <div className="rn-tile" data-selected={false} style={{ cursor: "default" }} key={key}>
                    <div className="flex items-center gap-1.5">
                      <img src={elementIcon(a)} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />
                      <span className="text-[9px] text-white/25">+</span>
                      <img src={elementIcon(b)} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />
                    </div>
                    {combo ? (
                      <>
                        <div className="text-xs font-bold leading-tight text-white/90">{combo.name}</div>
                        <p className="text-[10px] leading-snug text-white/40">{combo.lore}</p>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {tab === "mercy" && (
        <div className="rn-scroll">
          <PxPanel className="p-4">
            <PxHeader>Rift Mercy</PxHeader>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#9E93B5]">
              The rift relents for the fallen. AUTO spends your banked falls ({meta.mercyDeaths} banked) and softens each return. Tier 1 grants {Math.round(mercyTierBase(1) * 100)}% mercy, +4% per tier beyond.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <MercyChip active={meta.mercyTierSel === -1} onClick={() => setMercyTier(-1)}>Auto</MercyChip>
              {Array.from({ length: maxTier }, (_, i) => i + 1).map(t => (
                <MercyChip key={t} active={meta.mercyTierSel === t} onClick={() => setMercyTier(t)}>
                  {t}<span className="ml-1 font-mono text-[9px] tabular-nums opacity-60">{Math.round(mercyTierBase(t) * 100)}%</span>
                </MercyChip>
              ))}
              {maxTier === 0 && <span className="self-center text-[10px] italic text-[#9E93B5]/60">No tiers unlocked — fall once to earn mercy.</span>}
            </div>
            <p className="mt-3 rounded-lg border border-[#58D6C2]/25 bg-[#58D6C2]/5 px-3 py-2 text-[11px] leading-relaxed text-[#58D6C2]">
              {meta.mercyTierSel === -1 ? "AUTO: the rift spends your banked falls for you." : `Tier ${meta.mercyTierSel} is locked in — ${Math.round(mercyTierBase(meta.mercyTierSel) * 100)}% base mercy, growing a little each wave.`}
            </p>
          </PxPanel>
        </div>
      )}
      {tab === "records" && (
        <div className="rn-scroll">
          <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3">
            {[
              { label: "Best Wave", value: String(meta.bestWave), color: GOLD },
              { label: "Best Score", value: fmtNum(meta.bestScore), color: GOLD },
              { label: "Best Endless", value: String(meta.bestEndless), color: VIOLET },
              { label: "Runs", value: fmtNum(meta.runs), color: TEAL },
              { label: "Victories", value: fmtNum(meta.victories), color: GOLD },
              { label: "Total Kills", value: fmtNum(meta.totalKills), color: CRIMSON },
              { label: "Total Damage", value: fmtNum(meta.totalDamage), color: "#E96578" },
              { label: "Time in the Rift", value: fmtDuration(meta.totalTimeSec), color: TEAL },
              { label: "Mercy Banked", value: `${meta.mercyDeaths} falls`, color: "#E96578" },
            ].map(r => (
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-[#3D3152]/60 bg-[#1B1528]/90 p-4 text-center" key={r.label}>
                <div className="font-display text-lg font-bold tabular-nums text-white/90">{r.value}</div>
                <SectionLabel>{r.label}</SectionLabel>
              </div>
            ))}
          </div>
        </div>
      )}
    </ScreenShell>
  );
}

/* ================================================================== */
/*  THE CODEX — structured reference: search + tabs + previews         */
/* ================================================================== */
const CODEX_TABS: TabDef[] = [
  { id: "classes", label: "Classes" },
  { id: "spells", label: "Spells" },
  { id: "resonances", label: "Resonances" },
  { id: "bestiary", label: "Bestiary" },
  { id: "tyrants", label: "Tyrants" },
  { id: "biomes", label: "Biomes" },
  { id: "controls", label: "Controls" },
  { id: "changelog", label: "Changelog" },
  { id: "credits", label: "Credits" },
];
/** The six playable classes — name, element voice and epithet. */
const CLASSES = [
  { id: "stormcaller", name: "Stormcaller", epithet: "Voice of the Rift", el: "lightning", bio: "The tempest-cloaked savant — the brand mage every run begins as." },
  { id: "pyromancer", name: "Pyromancer", epithet: "Keeper of the Pyre", el: "fire", bio: "Fire given focus — ember volleys that bloom into falling stars." },
  { id: "cryomancer", name: "Cryomancer", epithet: "Warden of Frost", el: "ice", bio: "The frozen archive — shards that slow everything they touch." },
  { id: "voidweaver", name: "Voidweaver", epithet: "the Null Choir", el: "void", bio: "Stitches the rift's silence into lances of unlight." },
  { id: "aethermancer", name: "Aethermancer", epithet: "the Looming Star", el: "arcane", bio: "Bends raw aether into arcs that seek on their own." },
  { id: "chronomancer", name: "Chronomancer", epithet: "the Hour Thief", el: "time", bio: "Trades seconds for distance — every blink a stolen moment." },
];
export function CodexScreen() {
  const screen = useRiftStore(s => s.screen);
  return <AnimatePresence>{screen === "codex" && <CodexContent key="codex" />}</AnimatePresence>;
}
function CodexContent() {
  const meta = useRiftStore(s => s.meta);
  const setScreen = useRiftStore(s => s.setScreen);
  const isTouch = useIsTouch();
  const [tab, setTab] = useState("classes");
  const [query, setQuery] = useState("");
  const close = () => setScreen("menu");
  const q = query.trim().toLowerCase();
  const match = (...fields: string[]) => q === "" || fields.some(f => f.toLowerCase().includes(q));

  /* discovery progress — one bar per tab family */
  const seenEnemies = ENEMY_ORDER.filter(t => meta.seenEnemies.includes(t));
  const seenBosses = BOSS_DEFS.filter(b => meta.seenBosses.includes(b.id));
  const seenSpells = SPELL_ORDER.filter(id => meta.seenSpells.includes(id));
  const wovenCombos = ALL_PAIRS.filter(([a, b]) => meta.combosFound.includes(comboKey(a, b)));
  const discoveredTotal = seenEnemies.length + seenBosses.length + seenSpells.length + wovenCombos.length;
  const discoverableTotal = ENEMY_ORDER.length + BOSS_DEFS.length + SPELL_ORDER.length + ALL_PAIRS.length;

  return (
    <ScreenShell
      title="The Codex"
      subtitle={`Discovery ${discoveredTotal} / ${discoverableTotal} · how to play · what changed`}
      onClose={close}
      right={<CurrencyCluster shards={meta.shards} score={meta.bestScore} />}
    >
      {/* search + tabs */}
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <label className="rn-search">
          <svg viewBox="0 0 16 16" width="13" height="13" shapeRendering="crispEdges" aria-hidden>
            <circle cx="6.5" cy="6.5" r="4" fill="none" stroke="#9E93B5" strokeWidth="1.6" />
            <path d="M10 10 L14 14" stroke="#9E93B5" strokeWidth="1.8" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the codex…"
            aria-label="Search the codex"
          />
        </label>
        <div className="min-w-0 flex-1" />
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <TabStrip tabs={CODEX_TABS} active={tab} onChange={t => { sfx.hover(); setTab(t); }} ariaLabel="Codex sections" />
        </div>
      </div>
      {/* the discovery progress bar */}
      <div className="flex flex-shrink-0 items-center gap-3 px-1" aria-label={`Discovery progress ${discoveredTotal} of ${discoverableTotal}`}>
        <span className="rn-label shrink-0">Discovery</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-[3px] border border-[#3D3152] bg-[#140E1D]">
          <span className="block h-full rounded-[2px] bg-[#58D6C2] transition-[width] duration-300" style={{ width: `${(discoveredTotal / discoverableTotal) * 100}%` }} />
        </span>
        <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-[#58D6C2]">{Math.round((discoveredTotal / discoverableTotal) * 100)}%</span>
      </div>

      {tab === "classes" && (
        <div className="rn-scroll">
          <div className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2 xl:grid-cols-3">
            {CLASSES.filter(c => match(c.name, c.epithet, c.bio)).map(c => (
              <div key={c.id} className="rn-tile" style={{ cursor: "default" }}>
                <div className="flex items-center gap-3">
                  <span className="relative block size-16 shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#D9BA72] to-[#9E854F] p-[2px]">
                    <span className="block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#241C33]">
                      <img src={PORTRAIT.class(c.id)} alt="" width={56} height={56} draggable={false} className={cn(PIXELATED, "size-full object-cover")} />
                    </span>
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display truncate text-base font-bold text-[#EFEAF7]">{c.name}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: elementColor(c.el) }}>{c.epithet}</p>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-white/50">{c.bio}</p>
                <div className="flex items-center gap-2 border-t border-[#3D3152]/50 pt-2">
                  <img src={elementIcon(c.el)} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: elementColor(c.el) }}>{c.el} school</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "spells" && (
        <div className="rn-scroll">
          {SPELL_ORDER.filter(id => match(SPELLS[id]?.name ?? id, id)).length === 0 ? (
            <p className="px-1 py-8 text-center text-[11px] italic text-white/35">No spells match that word.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2 xl:grid-cols-3">
              {SPELL_ORDER.filter(id => match(SPELLS[id]?.name ?? id, id)).map(id => {
                const s = SPELLS[id as keyof typeof SPELLS];
                const known = meta.seenSpells.includes(id);
                return (
                  <div key={id} className="rn-tile" data-locked={!known} style={{ cursor: "default" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <img src={elementIcon(id)} alt="" width={38} height={38} draggable={false} className={cn(PIXELATED, "h-[38px] w-[38px] shrink-0")} style={{ filter: `drop-shadow(0 0 8px ${s.color}aa)` }} />
                        <div className="min-w-0">
                          <h3 className="font-display truncate text-base font-bold leading-tight text-[#EFEAF7]">{s.name}</h3>
                          <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: s.color }}>{s.tagline}</p>
                        </div>
                      </div>
                      {known ? (
                        <span className="shrink-0 rounded-full border border-[#58D6C2]/40 bg-[#58D6C2]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.15em] text-[#58D6C2]">Bound</span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-[#3D3152] px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.15em] text-white/30">Unbound</span>
                      )}
                    </div>
                    <p className="flex-1 text-xs leading-relaxed text-white/50">{s.desc}</p>
                    <div className="grid grid-cols-3 gap-2 border-t border-[#3D3152]/50 pt-2 text-center">
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">Aether</div><div className="font-mono text-sm font-bold tabular-nums" style={{ color: s.color }}>{s.manaCost}</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">Cooldown</div><div className="font-mono text-sm font-bold tabular-nums text-white/80">{s.cooldown}s</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">Damage</div><div className="font-mono text-sm font-bold tabular-nums text-white/80">{s.baseDamage > 0 ? s.baseDamage : "—"}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {tab === "resonances" && (
        <div className="rn-scroll">
          <div className="flex items-baseline justify-between pb-2">
            <SectionLabel>Elemental pairs — cast back to back to weave</SectionLabel>
            <span className="font-mono text-xs tabular-nums text-white/60"><span className="font-bold text-[#A991F7]">{wovenCombos.length}</span> / {ALL_PAIRS.length} woven</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3 lg:grid-cols-4">
            {ALL_PAIRS.filter(([a, b]) => match(a, b, COMBOS[comboKey(a, b)]?.name ?? "")).map(([a, b]) => {
              const key = comboKey(a, b);
              const combo = COMBOS[key];
              const woven = meta.combosFound.includes(key);
              return (
                <div key={key} className="rn-tile" data-locked={!woven} style={{ cursor: "default" }}>
                  <div className="flex items-center gap-1.5">
                    <img src={elementIcon(a)} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />
                    <span className="text-[9px] text-white/25">+</span>
                    <img src={elementIcon(b)} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />
                    {woven && <span className="ml-auto rounded-full border border-[#A991F7]/40 bg-[#A991F7]/10 px-1.5 py-px text-[8px] font-black uppercase text-[#E8D6FF]">Woven</span>}
                  </div>
                  {combo ? (
                    woven ? (
                      <>
                        <div className="text-xs font-bold leading-tight text-white/90">{combo.name}</div>
                        <p className="text-[10px] leading-snug text-white/40">{combo.lore}</p>
                      </>
                    ) : (
                      <>
                        <div className="text-xs font-bold leading-tight text-white/45">{a} + {b}</div>
                        <p className="text-[10px] leading-snug text-white/30">Weave this pair in the rift to record its name and lore.</p>
                      </>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab === "bestiary" && (
        <div className="rn-scroll">
          {/* elite affixes */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
            <SectionLabel className="mr-1">Elite affixes</SectionLabel>
            {ELITE_ORDER.map(affix => {
              const e = ELITE_DEFS[affix];
              return (
                <span className="flex items-center gap-1.5 rounded-full border border-[#3D3152] bg-[#140E1D]/60 px-2.5 py-1 text-[10px] text-white/55" key={affix}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: e.color, boxShadow: `0 0 6px ${e.color}` }} />
                  <span className="font-semibold uppercase tracking-wider" style={{ color: e.color }}>{e.name}</span>
                  <span className="font-mono text-white/35 tabular-nums">×{e.hpMult}hp ×{e.spdMult}spd{e.resist > 0 ? ` ${Math.round(e.resist * 100)}%res` : ""}</span>
                </span>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2 xl:grid-cols-3">
            {ENEMY_ORDER.filter(t => match(ENEMY_DEFS[t]?.name ?? t, t)).map(type => {
              const d = ENEMY_DEFS[type];
              const seen = meta.seenEnemies.includes(type);
              const previewId = ENEMY_PREVIEW[type];
              return (
                <div key={type} className="rn-tile" data-locked={!seen} style={{ cursor: "default" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-[#140E1D]/80" style={{ borderColor: seen ? `${d.color}55` : "#3D315288" }}>
                        {seen && previewId ? (
                          <img src={PREVIEW.enemies(previewId)} alt="" width={40} height={40} draggable={false} className={cn(PIXELATED, "size-10")} style={{ filter: `drop-shadow(0 0 8px ${d.color}66)` }} />
                        ) : (
                          <Skull className="size-5" style={{ color: seen ? d.color : "#3D3152" }} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold uppercase tracking-[0.15em] text-[#EFEAF7]">{seen ? d.name : "???"}</h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">{d.brain} · {d.flying ? "flying" : "ground"}</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] uppercase tabular-nums tracking-wider text-white/30">W{d.unlockWave}</span>
                  </div>
                  {seen && (
                    <div className="grid grid-cols-3 gap-2 border-t border-[#3D3152]/50 pt-2 text-center">
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">HP</div><div className="font-mono text-sm font-bold tabular-nums text-[#E96578]">{d.hp}</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">DMG</div><div className="font-mono text-sm font-bold tabular-nums text-[#E96578]">{d.damage}</div></div>
                      <div><div className="text-[9px] uppercase tracking-wider text-white/30">SPD</div><div className="font-mono text-sm font-bold tabular-nums text-[#58D6C2]">{d.speed}</div></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab === "tyrants" && (
        <div className="rn-scroll">
          <div className="grid grid-cols-1 gap-3 pb-2 md:grid-cols-2">
            {BOSS_DEFS.filter(b => match(b.name, b.title, b.mechanics)).map((boss, i) => {
              const seen = meta.seenBosses.includes(boss.id);
              const previewId = BOSS_PREVIEW[boss.id];
              return (
                <div key={boss.id} className="rn-tile" data-locked={!seen} style={{ cursor: "default", boxShadow: seen ? `inset 0 40px 70px -50px ${boss.color}` : undefined }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SectionLabel>Wave {10 * (i + 1)}</SectionLabel>
                      <h3 className="mt-1 font-display text-xl font-bold" style={{ color: seen ? boss.color : "#4A3F61", textShadow: seen ? `0 0 18px ${boss.color}55` : undefined }}>{seen ? boss.name : "???"}</h3>
                      <p className="text-xs italic text-white/50">{seen ? boss.title : "face it to record its name"}</p>
                    </div>
                    {seen && previewId ? (
                      <img src={PREVIEW.boss(previewId)} alt="" width={72} height={72} draggable={false} className={cn(PIXELATED, "size-16 shrink-0")} style={{ filter: `drop-shadow(0 0 12px ${boss.color}66)` }} />
                    ) : (
                      <Skull className="size-8 shrink-0 text-[#3D3152]" />
                    )}
                  </div>
                  {seen && (
                    <>
                      <p className="text-xs leading-relaxed text-white/55">{boss.mechanics}</p>
                      <div className="mt-1 flex gap-4 border-t border-[#3D3152]/50 pt-2 font-mono text-xs tabular-nums">
                        <span className="text-[#E96578]">HP {boss.hp}</span>
                        <span className="text-[#E96578]">DMG {boss.damage}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab === "biomes" && (
        <div className="rn-scroll">
          <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 xl:grid-cols-3">
            {TERRAINS.filter(t => match(t.name, t.desc)).map(t => {
              const tile = BIOME_TILE[BIOME_FAMILY[t.id] ?? "cursed_grove"]();
              const stat = t.id === "graveyard" || t.id === "glacial" ? { kills: "—" } : { kills: "—" };
              return (
                <div key={t.id} className="rn-tile" style={{ cursor: "default" }}>
                  {/* tiled biome swatch — the exact ground art runs draw */}
                  <span aria-hidden className="block overflow-hidden rounded-md border border-[#3D3152]" style={{ height: 96, backgroundImage: `url(${tile})`, backgroundSize: "96px 96px", imageRendering: "pixelated", backgroundRepeat: "repeat" }} />
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-base font-bold text-[#EFEAF7]">{t.name}</h3>
                    {t.isNew && <span className="shrink-0 rounded-full border border-[#A991F7]/40 bg-[#A991F7]/10 px-2 py-px text-[8px] font-black uppercase tracking-widest text-[#E8D6FF]">New</span>}
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/50">{t.desc}. Drawn from the same tileset atlas the rift floor renders — the Codex tile IS the ground you fight on.{stat.kills}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab === "controls" && (
        <div className="rn-scroll">
          <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 lg:grid-cols-3">
            {isTouch ? (
              <>
                <ControlsPane title="Touch" now>
                  <TouchRow badge="LEFT STICK" label="Drag anywhere — move the Archmage" />
                  <TouchRow badge="HOLD CAST" label="Auto-target spell — hold to keep attacking" />
                  <TouchRow badge="VOLLEY" label="Arcane bolts seek the nearest foe" />
                  <TouchRow badge="BLINK" label="Blink step — brief immunity" />
                  <TouchRow badge="SURGE" label="Unleash the Surge when full" />
                  <TouchRow badge="SPELL" label="Cycle the spell slots" />
                </ControlsPane>
                <ControlsPane title="Keyboard & Mouse"><KbmRows /></ControlsPane>
              </>
            ) : (
              <>
                <ControlsPane title="Keyboard & Mouse" now><KbmRows /></ControlsPane>
                <ControlsPane title="Touch">
                  <TouchRow badge="LEFT STICK" label="Drag anywhere — move the Archmage" />
                  <TouchRow badge="HOLD CAST" label="Auto-target spell — hold to keep attacking" />
                  <TouchRow badge="VOLLEY" label="Arcane bolts seek the nearest foe" />
                  <TouchRow badge="BLINK" label="Blink step — brief immunity" />
                  <TouchRow badge="SURGE" label="Unleash the Surge when full" />
                  <TouchRow badge="SPELL" label="Cycle the spell slots" />
                </ControlsPane>
              </>
            )}
            <ControlsPane title="Gamepad">
              <KeyRow keys={["LS"]} label="Move the Archmage" />
              <KeyRow keys={["RS"]} label="Aim the spell" />
              <KeyRow keys={["RT"]} label="Cast — hold to keep casting" />
              <KeyRow keys={["LT"]} label="Volley — hold for bolts" />
              <KeyRow keys={["A"]} label="Blink step — brief immunity" />
              <KeyRow keys={["Y"]} label="Unleash the Surge when full" />
              <KeyRow keys={["X"]} label="Cycle spells" />
              <KeyRow keys={["LB", "RB"]} label="Cycle spells both ways" />
              <KeyRow keys={["D-PAD"]} label="Pick a spell slot" />
              <KeyRow keys={["B", "START"]} label="Pause the trial" />
            </ControlsPane>
          </div>
        </div>
      )}
      {tab === "changelog" && (
        <div className="rn-scroll">
          <div className="flex flex-col gap-3 pb-2">
            {CHANGELOG.filter(entry => match(entry.name, `v${entry.version}`, ...entry.notes)).map(entry => (
              <article className="relative overflow-hidden rounded-xl border border-[#3D3152]/60 bg-[#1B1528]/90 p-5" key={entry.version}>
                <header className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded-full border border-[#D9BA72]/40 bg-[#D9BA72]/10 px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] tabular-nums text-[#D9BA72]">v{entry.version}</span>
                  <h3 className="font-display text-lg font-bold leading-tight text-[#EFEAF7]">{entry.name}</h3>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-white/40">{entry.date}</span>
                </header>
                <ul className="relative mt-3 flex flex-col gap-1.5">
                  {entry.notes.map((note, i) => (
                    <li className="flex gap-2 text-[13px] leading-relaxed text-[#BFB5D4]" key={i}>
                      <PxDiamond small className="mt-1.5 opacity-60" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            <CodexHonors />
          </div>
        </div>
      )}
      {tab === "credits" && (
        <div className="rn-scroll">
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-[12px] leading-relaxed text-[#BFB5D4]">The mage, the bestiary, the terrains, the spell icons and the particle effects come from generous open-source packs, shared freely for game makers — our gratitude goes to their authors. The rest of the game is conjured in code.</p>
            <AssetAttributionList />
          </div>
        </div>
      )}
    </ScreenShell>
  );
}
/** The changelog's honorary section — packs + authors from the same
 *  manifest source as the Credits tab. */
function CodexHonors() {
  const [packs, setPacks] = useState(FALLBACK_PACKS);
  useEffect(() => {
    fetchPackCredits().then(setPacks).catch(() => {});
  }, []);
  return (
    <section className="relative overflow-hidden rounded-xl border border-[#58D6C2]/25 bg-[#58D6C2]/[0.04] p-5">
      <header className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded-full border border-[#58D6C2]/40 bg-[#58D6C2]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#58D6C2]">Honors</span>
        <h3 className="font-display text-lg font-bold leading-tight text-[#EFEAF7]">The rift honors its makers</h3>
      </header>
      <ul className="relative mt-3 flex flex-col gap-1.5">
        {packs.map(p => (
          <li className="flex flex-wrap gap-x-2 text-[13px] leading-relaxed text-[#BFB5D4]" key={p.id}>
            <PxDiamond small className="mt-1.5 opacity-60" />
            <span className="font-semibold text-[#EFEAF7]">{p.pack}</span>
            <span className="text-white/35">by</span>
            <span>{p.author}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{p.licenseId}</span>
          </li>
        ))}
        <li className="flex gap-2 pt-1 text-[12px] italic text-[#A991F7]">
          <PxDiamond small className="mt-1 opacity-60" />
          <span>Shared freely so worlds like this one can exist — thank you, all of you.</span>
        </li>
      </ul>
    </section>
  );
}
/** One device pane in the Codex controls tab. `now` marks the CURRENT
 *  device — its rite is listed first on every layout. */
function ControlsPane({ title, now = false, children }: { title: string; now?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-[#3D3152]/60 bg-[#1B1528]/90 p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#D9BA72]">{title}</div>
        {now && <span className="rounded-full border border-[#58D6C2]/40 bg-[#58D6C2]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-[#58D6C2]">This device</span>}
      </div>
      {children}
    </div>
  );
}
/** Keyboard & mouse rite — mirrors GameShell's actual mappings. */
function KbmRows() {
  return (
    <>
      <KeyRow keys={["W", "A", "S", "D"]} label="Move — arrow keys work too" />
      <KeyRow keys={["LMB"]} label="Cast — hold to keep casting" />
      <KeyRow keys={["RMB"]} label="Volley — bolts seek on their own" />
      <KeyRow keys={["SPACE"]} label="Blink step — brief immunity" />
      <KeyRow keys={["F"]} label="Unleash the Surge when full" />
      <KeyRow keys={["P"]} label="Pause the trial" />
      <KeyRow keys={["Q", "E"]} label="Cycle spells both ways" />
      <KeyRow keys={["1", "2", "3"]} label="Pick a spell slot" />
      <KeyRow keys={["WHEEL"]} label="Cycle spells during a run" />
      <KeyRow keys={["F3"]} label="Telemetry overlay" />
      <KeyRow keys={["M"]} label="Mute all audio" />
    </>
  );
}
/** Touch rite rows — mirrors TouchControls' actual cluster. */
function TouchRows() {
  return (
    <>
      <TouchRow badge="STICK" label="Left thumb — move (up is away)" />
      <TouchRow badge="CAST" label="Right cluster — hold to keep casting" />
      <TouchRow badge="VOLLEY" label="Right cluster — seeking bolts" />
      <TouchRow badge="BLINK" label="Right cluster — tap, brief immunity" />
      <TouchRow badge="SURGE" label="Right cluster — tap when full" />
      <TouchRow badge="SWAP" label="Cycle spell slots" />
    </>
  );
}

/* ================================================================== */
/*  SETTINGS — the shared shell, cleanly grouped, instantly persisted  */
/* ================================================================== */
/** Shared scroll classes for a tab body. */
const SETTINGS_TAB_SCROLL = "rift-scroll min-h-0 flex-1 overflow-y-auto pr-1 pb-1";
/** Live fullscreen state for the Video tab's Display mode row. */
function useFullscreenLive() {
  const [isFs, setIsFs] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const sync = () => {
      const live = !!document.fullscreenElement;
      setIsFs(live);
      if (live) setBlocked(false);
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
  return { isFs, blocked, toggle };
}
export function SettingsModal() {
  const settingsOpen = useRiftStore(s => s.settingsOpen);
  const closeSettings = useRiftStore(s => s.closeSettings);
  const meta = useRiftStore(s => s.meta);
  const patchSettings = useRiftStore(s => s.patchSettings);
  const st = meta.settings;
  const maxTier = Math.min(MERCY_MAX_TIER, meta.mercyDeaths);
  const fs = useFullscreenLive();
  /* section nav — Audio / Visual / Gameplay / Touch / Controls / Data */
  const [nav, setNav] = useState<"audio" | "visual" | "gameplay" | "touch" | "controls" | "data">("audio");
  const baseline = useRiftStore(s => s.settingsBaseline) ?? st;
  /** Patch a setting AND push volumes to the audio synth live. */
  const apply = (patch: Partial<GameSettings>) => {
    patchSettings(patch);
    const next = { ...st, ...patch };
    sfx.setMuted(next.muted);
    sfx.setVolumes(next.master, next.music, next.sfx, next.ambience);
  };
  const NAV: [typeof nav, string][] = [
    ["audio", "Audio"],
    ["visual", "Visual"],
    ["gameplay", "Gameplay"],
    ["touch", "Touch"],
    ["controls", "Controls"],
    ["data", "Data"],
  ];
  /* Esc closes (the shared ScreenShell contract) — routed through the
     same dialog onOpenChange so the store stays consistent. */
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [settingsOpen, closeSettings]);

  return (
    <Dialog open={settingsOpen} onOpenChange={o => { if (!o) closeSettings(); }}>
      <DialogContent showCloseButton={false} className="dark flex h-[88vh] max-h-[88vh] w-full max-w-5xl flex-col gap-0 overflow-hidden border-[#D9BA72]/40 bg-[#1B1528]/97 p-0 text-white/90 backdrop-blur-xl">
        {/* header bar — the SAME geometry as the hub screens */}
        <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-[#D9BA72]/25 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button type="button" onClick={() => { sfx.click(); closeSettings(); }} aria-label="Close settings" className="rn-close">
              <svg viewBox="0 0 16 16" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
                <path d="M3 3 L4 3 L5 4 L6 5 L7 6 L8 5 L9 4 L10 3 L11 3 L11 4 L10 5 L9 6 L8 7 L9 8 L10 9 L11 10 L11 11 L10 11 L9 10 L8 9 L7 10 L6 11 L5 11 L5 10 L6 9 L7 8 L6 7 L5 6 L4 5 L3 5 Z" fill="currentColor" />
              </svg>
            </button>
            <div className="min-w-0">
              <DialogTitle className="rn-header-title">Settings</DialogTitle>
              <DialogDescription className="rn-header-sub mt-0.5">Tune your rift experience — every change applies and saves instantly</DialogDescription>
            </div>
          </div>
          <span aria-hidden className="hidden items-center gap-2 sm:flex">
            <span className="font-display text-sm font-black uppercase tracking-[0.2em] text-[#D9BA72]">Archmage</span>
            <PxDiamond small />
            <span className="text-[8px] font-bold uppercase tracking-[0.34em] text-[#A991F7]">Riftbound</span>
          </span>
        </div>
        {/* body: nav rail + panel */}
        <div className="relative flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#D9BA72]/20 p-2 sm:w-40 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r" aria-label="Settings sections">
            {NAV.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => { sfx.hover(); setNav(id); }}
                aria-current={nav === id}
                className={cn(
                  "flex min-h-11 shrink-0 items-center rounded-md border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-all",
                  nav === id
                    ? "border-[#A991F7]/60 bg-[#241C33] text-[#E8D6FF]"
                    : "border-transparent text-[#9E93B5] hover:border-[#3D3152] hover:text-[#BFB5D4]"
                )}
              >
                <span className="truncate">{label}</span>
                {nav === id && <span aria-hidden className="ml-auto hidden size-1.5 rotate-45 bg-[#A991F7] sm:block" />}
              </button>
            ))}
          </nav>
          <div className={SETTINGS_TAB_SCROLL + " p-4 sm:p-5"}>
            {nav === "audio" && (
              <div className="flex flex-col gap-4">
                <PxHeader>Audio</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9E93B5]">Balance the voices of the rift — music, ambience and spellwork each carry their own weight. Changes apply the instant you slide.</p>
                <SliderRow label="Master" value={st.master} disabled={st.muted} onChange={v => apply({ master: v })} />
                <SliderRow label="Music" value={st.music} disabled={st.muted} onChange={v => apply({ music: v })} />
                <SliderRow label="Ambience" value={st.ambience} disabled={st.muted} step={5} onChange={v => apply({ ambience: v })} />
                <SliderRow label="Effects" value={st.sfx} disabled={st.muted} onChange={v => apply({ sfx: v })} />
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#3D3152] bg-[#140E1D]/80 px-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-[#BFB5D4]">Mute all</div>
                    <div className="text-[10px] text-[#9E93B5]">Silence every channel at once · M</div>
                  </div>
                  <Switch checked={st.muted} onCheckedChange={v => apply({ muted: v })} aria-label="Mute all audio" className="data-[state=checked]:bg-[#D9BA72]" />
                </div>
              </div>
            )}
            {nav === "visual" && (
              <div className="flex flex-col gap-4">
                <PxHeader>Visual & Accessibility</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9E93B5]">Shape what you see, how it moves, and how hard the engine works for it. Every toggle is instant — no run restart needed.</p>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Picture</SectionLabel>
                  <div className="flex min-h-11 items-center gap-3">
                    <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-[#BFB5D4]">Quality</span>
                    <Slider value={[Math.round(st.quality * 100)]} min={50} max={100} step={5} aria-label="Render quality" onValueChange={v => apply({ quality: v[0] / 100 })} className={GOLD_SLIDER} />
                    <span className="w-9 text-right font-mono text-xs tabular-nums text-[#D9BA72]">{Math.round(st.quality * 100)}</span>
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-[#BFB5D4]">Brightness</span>
                    <Slider value={[st.brightness]} min={50} max={250} step={5} aria-label="Brightness" onValueChange={v => apply({ brightness: v[0] })} className={GOLD_SLIDER} />
                    <span className="w-9 text-right font-mono text-xs tabular-nums text-[#D9BA72]">{st.brightness}</span>
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-[#BFB5D4]">Field of view</span>
                    <Slider value={[st.fov]} min={45} max={80} step={1} aria-label="Field of view in degrees" onValueChange={v => apply({ fov: v[0] })} className={GOLD_SLIDER} />
                    <span className="w-9 text-right font-mono text-xs tabular-nums text-[#D9BA72]">{st.fov}°</span>
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-[#BFB5D4]">Low-HP vignette</span>
                    <div className="flex flex-1 flex-wrap gap-2">
                      {([[0, "Off"], [0.35, "Low"], [0.7, "Medium"], [1, "High"]] as [number, string][]).map(([v, label]) => (
                        <MercyChip key={label} active={Math.abs(st.vignette - v) < 0.01} onClick={() => apply({ vignette: v })}>{label}</MercyChip>
                      ))}
                    </div>
                  </div>
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Performance</SectionLabel>
                  <ToggleRow label="Auto performance" hint="Eases resolution to target 60 fps" checked={st.autoQuality} onChange={v => apply({ autoQuality: v })} />
                  <ToggleRow label="Performance overlay" hint="FPS and render telemetry · F3" checked={st.perfOverlay} onChange={v => apply({ perfOverlay: v })} />
                  <div className="rounded-lg border border-[#3D3152] bg-[#140E1D]/80 px-3 py-2.5">
                    <div className="text-xs uppercase tracking-wider text-[#BFB5D4]">Frame-rate cap</div>
                    <div className="mt-1 text-[10px] text-[#9E93B5]">Gentler on hot phones and low batteries</div>
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
                  <div className="rounded-lg border border-[#3D3152] bg-[#140E1D]/80 px-3 py-2.5">
                    <div className="flex min-h-11 items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-[#BFB5D4]">Fullscreen</div>
                        <div className="text-[10px] text-[#9E93B5]">The whole screen, edge to edge</div>
                      </div>
                      <Switch checked={fs.isFs} onCheckedChange={fs.toggle} aria-label="Toggle fullscreen" className="data-[state=checked]:bg-[#D9BA72]" />
                    </div>
                    <p className={`mt-1 text-[10px] leading-relaxed ${fs.blocked ? "text-[#E96578]" : "text-[#9E93B5]"}`}>
                      {fs.blocked ? "Fullscreen is blocked here — this view will not hand over the screen." : "A live view state, not a saved setting — your browser asks for a tap each visit."}
                    </p>
                  </div>
                </section>
              </div>
            )}
            {nav === "gameplay" && (
              <div className="flex flex-col gap-4">
                <PxHeader>Gameplay</PxHeader>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Feel</SectionLabel>
                  <ToggleRow label="Screen shake" hint="The world trembles on impact" checked={st.screenShake} onChange={v => apply({ screenShake: v })} />
                  <ToggleRow label="Damage numbers" hint="Show floating damage digits" checked={st.damageNumbers} onChange={v => apply({ damageNumbers: v })} />
                  <ToggleRow label="Aim assist" hint="Gentle pull toward nearby foes" checked={st.aimAssist} onChange={v => apply({ aimAssist: v })} />
                  <ToggleRow label="Reduce flashing" hint="Softer strobes and pulses" checked={st.reduceFlashes} onChange={v => apply({ reduceFlashes: v })} />
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Rift Mercy</SectionLabel>
                  <p className="text-[11px] leading-relaxed text-[#9E93B5]">
                    The rift relents for the fallen. AUTO spends your banked falls ({meta.mercyDeaths} banked) and softens each return. Tier 1 grants {Math.round(mercyTierBase(1) * 100)}% mercy, +4% per tier beyond.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <MercyChip active={meta.mercyTierSel === -1} onClick={() => { useRiftStore.getState().setMercyTier(-1); }}>Auto</MercyChip>
                    {Array.from({ length: maxTier }, (_, i) => i + 1).map(t => (
                      <MercyChip key={t} active={meta.mercyTierSel === t} onClick={() => { useRiftStore.getState().setMercyTier(t); }}>
                        {t}<span className="ml-1 font-mono text-[9px] tabular-nums opacity-60">{Math.round(mercyTierBase(t) * 100)}%</span>
                      </MercyChip>
                    ))}
                    {maxTier === 0 && <span className="self-center text-[10px] italic text-[#9E93B5]/60">No tiers unlocked — fall once to earn mercy.</span>}
                  </div>
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>HUD density</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {([["compact", "Compact"], ["standard", "Standard"], ["expanded", "Expanded"]] as [string, string][]).map(([v, label]) => (
                      <MercyChip key={v} active={st.hudDensity === v} onClick={() => apply({ hudDensity: v })}>{label}</MercyChip>
                    ))}
                  </div>
                  {/* HUD preview mock — the live v3.1 HUD language */}
                  <div className="mt-1 rounded-md border border-[#D9BA72]/40 bg-[#140E1D]/90 p-2">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="relative block size-9 shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#D9BA72] to-[#9E854F] p-[2px]">
                        <span className="block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#241C33]">
                          <img src={PORTRAIT.player()} alt="" width={36} height={36} draggable={false} className={cn(PIXELATED, "size-full object-cover")} />
                        </span>
                      </span>
                      <span className="flex-1 space-y-1">
                        <span className="block h-1.5 w-full rounded-full bg-[#140E1D]"><span className="block h-full w-5/6 rounded-full bg-gradient-to-r from-[#E96578] to-[#E96578]" /></span>
                        <span className="block h-1.5 w-full rounded-full bg-[#140E1D]"><span className="block h-full w-3/4 rounded-full bg-gradient-to-r from-[#A991F7] to-[#E8D6FF]" /></span>
                        <span className="block h-1.5 w-full rounded-full bg-[#140E1D]"><span className="block h-full w-1/2 rounded-full bg-gradient-to-r from-[#D9BA72] to-[#F8E7BF]" /></span>
                      </span>
                    </div>
                    <div className="mt-2 flex justify-center gap-1.5">
                      {["fire", "ice", "lightning"].map(el => (
                        <span key={el} className="flex size-8 items-center justify-center rounded-md border border-[#D9BA72]/50 bg-[#1B1528]">
                          <img src={elementIcon(el)} alt="" width={22} height={22} draggable={false} className={cn(PIXELATED, "size-[22px]")} />
                        </span>
                      ))}
                    </div>
                  </div>
                </section>
                <section className="flex flex-col gap-2">
                  <SectionLabel>Colorblind palettes</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {PALETTE_IDS.map(p => (
                      <MercyChip key={p} active={st.palette === p} onClick={() => apply({ palette: p })}>{PALETTE_LABELS[p]}</MercyChip>
                    ))}
                  </div>
                  <div className="mt-1 flex gap-2">
                    {["fire", "ice", "lightning", "void"].map(el => (
                      <span key={el} aria-hidden className="block size-7 rounded-md border border-[#3D3152]" style={{ background: `linear-gradient(135deg, ${elementColor(el)} 0 50%, ${elementGlow(el)} 50% 100%)` }} />
                    ))}
                  </div>
                </section>
              </div>
            )}
            {nav === "touch" && (
              <div className="flex flex-col gap-4">
                <PxHeader>Touch & Comfort</PxHeader>
                <ToggleRow label="Left-handed layout" hint="Mirror the thumb cluster for left-thumb play" checked={st.leftHanded} onChange={v => apply({ leftHanded: v })} />
                <ToggleRow label="One-thumb casting" hint="Cast toward your move stick's direction" checked={st.tapToCast} onChange={v => apply({ tapToCast: v })} />
                <ToggleRow label="Haptic cues" hint="A pulse when spells ready, hits land, tyrants arrive" checked={st.haptics} onChange={v => apply({ haptics: v })} />
                <ToggleRow label="Resume countdown" hint="A 3-2-1 breath before the rift moves again" checked={st.resumeCountdown} onChange={v => apply({ resumeCountdown: v })} />
                <ToggleRow label="Auto immersive" hint="Touch devices snap to fullscreen landscape" checked={st.autoImmersive} onChange={v => apply({ autoImmersive: v })} />
              </div>
            )}
            {nav === "controls" && (
              <div className="flex flex-col gap-4">
                <PxHeader>Controls & Keybindings</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9E93B5]">The rite this device actually uses — keyboard and mouse below; touch controls follow. Bindings are fixed in this build.</p>
                <div className="rounded-lg border border-[#3D3152] bg-[#140E1D]/80 px-4 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="px-keycap">Default</span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9E93B5]">preset · fixed bindings in this build</span>
                  </div>
                  <KbmRows />
                </div>
                <div className="rounded-lg border border-[#3D3152] bg-[#140E1D]/80 px-4 py-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#9E93B5]">Touch rite (coarse-pointer devices)</div>
                  <TouchRows />
                </div>
              </div>
            )}
            {nav === "data" && (
              <div className="flex flex-col gap-4">
                <PxHeader>Data & Save Slots</PxHeader>
                <p className="text-[11px] leading-relaxed text-[#9E93B5]">Everything lives in this browser's local storage — three save slots, switchable from the hub. Settings persist instantly on every change.</p>
                <SaveSlots />
              </div>
            )}
          </div>
        </div>
        {/* bottom action bar: Reset · Discard · Done */}
        <div className="relative flex shrink-0 items-center justify-between gap-2 border-t border-[#D9BA72]/25 bg-[#140E1D]/80 px-4 py-3 safe-b-5 sm:px-5">
          <button type="button" onClick={() => { sfx.click(); apply(DEFAULT_SETTINGS); }} className="px-btn px-btn--ghost h-10 text-[10px]!">
            <RotateCcw className="size-3.5" />Reset to Defaults
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { sfx.click(); patchSettings(baseline); sfx.setMuted(baseline.muted); sfx.setVolumes(baseline.master, baseline.music, baseline.sfx, baseline.ambience); closeSettings(); }} className="px-btn px-btn--ghost h-10 text-[10px]!">
              <span>Discard Changes</span>
            </button>
            <button type="button" onClick={() => { sfx.click(); closeSettings(); }} className="px-btn px-btn--primary h-10 text-[10px]!">
              <span className="text-[#58D6C2]">Done</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
/** Save-slot cards: three slots, switch or overwrite, hub-only. */
function SaveSlots() {
  const activeSlot = useRiftStore(s => s.activeSlot);
  const switchSlot = useRiftStore(s => s.switchSlot);
  const overwriteSlot = useRiftStore(s => s.overwriteSlot);
  const resetProgress = useRiftStore(s => s.resetProgress);
  const phase = useRiftStore(s => s.phase);
  const meta = useRiftStore(s => s.meta);
  const [bump, setBump] = useState(0);
  const [armedOver, setArmedOver] = useState<number | null>(null);
  const [armedReset, setArmedReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const peeks = useMemo(() => peekSlots(), [activeSlot, meta, bump]);
  const inRun = phase !== "menu";
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);
  const done = (msg: string) => {
    setBump(b => b + 1);
    setNotice(msg);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] leading-relaxed text-white/45">Three mages may live on this device. Switch loads a slot's whole story: relics, records and discoveries; Overwrite copies your current mage onto a slot. Both work from the hub only — a live trial keeps its own slot.</p>
      {notice && <p role="status" aria-live="polite" className="rounded-lg border border-[#58D6C2]/30 bg-[#58D6C2]/[0.08] px-3 py-2 text-[11px] leading-relaxed text-[#58D6C2]">{notice}</p>}
      {peeks.map((peek, i) => {
        const active = i === activeSlot;
        const armed = armedOver === i;
        return (
          <div className={`flex flex-col gap-2.5 rounded-lg border px-3 py-2.5 ${armed ? "border-[#E96578]/50 bg-[#E96578]/[0.07]" : active ? "border-[#A991F7]/45 bg-[#A991F7]/[0.08]" : "border-white/10 bg-black/30"}`} key={i}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-white/80">Slot {i + 1}</span>
                {active && <span className="rounded-full border border-[#A991F7]/50 bg-[#A991F7]/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-[#E8D6FF]">Playing</span>}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-white/50">{peek ? `Best wave ${peek.bestWave} · ${fmtNum(peek.shards)} glyphs · ${peek.runs} trials` : "Empty — a fresh mage"}</div>
            </div>
            {armed ? (
              <div className="flex flex-col gap-2 rounded-md border border-[#E96578]/40 bg-[#E96578]/10 p-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#E96578]">Replace slot {i + 1}?</p>
                <p className="text-[11px] leading-relaxed text-white/60">{peek ? "Their relics, records and discoveries become a copy of your current mage. There is no way back through the rift." : "The empty slot fills with a copy of your current mage. Nothing is lost."}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setArmedOver(null)} className="px-btn px-btn--ghost min-h-11 px-4 text-[11px]!">Cancel</button>
                  <button type="button" onClick={() => { overwriteSlot(i); setArmedOver(null); done(`Slot ${i + 1} now holds a copy of your current mage.`); }} className="min-h-11 rounded-md border border-[#E96578]/50 bg-[#E96578]/15 px-4 text-[11px] font-bold uppercase tracking-wider text-[#E96578] transition-colors hover:bg-[#E96578] hover:text-white">Replace</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={active || inRun} onClick={() => { switchSlot(i); done(`Now playing slot ${i + 1} — their whole story is live.`); }} title={inRun ? "Finish or leave the trial first" : `Load slot ${i + 1}`} className="min-h-11 rounded-md border border-white/15 bg-transparent px-4 text-[11px] font-bold uppercase tracking-wider text-white/75 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30">
                  <span className="flex items-center gap-1.5"><Play className="size-3.5" />Switch</span>
                </button>
                <button type="button" disabled={active || inRun} onClick={() => { setArmedOver(i); setArmedReset(false); }} title={inRun ? "Finish or leave the trial first" : `Copy the current mage onto slot ${i + 1}`} className="min-h-11 rounded-md border border-white/15 bg-transparent px-4 text-[11px] font-bold uppercase tracking-wider text-white/75 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30">
                  <span className="flex items-center gap-1.5"><Copy className="size-3.5" />Overwrite</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
      {inRun && <p className="text-[10px] italic text-white/35">Slot switching unlocks from the hub — a live trial keeps its slot.</p>}
      <section className="flex flex-col gap-3 rounded-lg border border-[#E96578]/25 bg-[#E96578]/[0.05] p-3">
        <SectionLabel className="flex items-center gap-2 !text-[#E96578]/80">Danger Zone</SectionLabel>
        <p className="text-[11px] leading-relaxed text-white/45">Erase THIS SLOT's shards, relics, records and codex discoveries — the other save slots are untouched. Settings are kept.</p>
        {armedReset ? (
          <div className="flex flex-col gap-2 rounded-md border border-[#E96578]/40 bg-[#E96578]/10 p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#E96578]">Unmake everything?</p>
            <p className="text-[11px] leading-relaxed text-white/60">All shards, relics, records and codex discoveries return to dust. There is no way back through the rift.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setArmedReset(false)} className="px-btn px-btn--ghost min-h-11 px-4 text-[11px]!">Keep my progress</button>
              <button type="button" onClick={() => { resetProgress(); setArmedReset(false); done("Progress unmade — this slot starts fresh. Settings were kept."); }} className="min-h-11 rounded-md border border-[#E96578]/50 bg-[#E96578]/15 px-4 text-[11px] font-bold uppercase tracking-wider text-[#E96578] transition-colors hover:bg-[#E96578] hover:text-white">Unmake it all</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setArmedReset(true); setArmedOver(null); }} className="min-h-11 w-fit rounded-md border border-[#E96578]/40 bg-transparent px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#E96578] transition-colors hover:bg-[#E96578]/10">
            <span className="flex items-center gap-1.5"><RotateCcw className="size-3.5" />Reset progress</span>
          </button>
        )}
      </section>
    </div>
  );
}
function SliderRow({ label, value, onChange, disabled, step = 1 }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean; step?: number }) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <span className="w-16 shrink-0 text-xs uppercase tracking-wider text-white/60">{label}</span>
      <Slider value={[Math.round(value * 100)]} min={0} max={100} step={step} disabled={disabled} aria-label={`${label} volume`} onValueChange={v => onChange(v[0] / 100)} className={GOLD_SLIDER} />
      <span className="w-8 text-right font-mono text-xs tabular-nums text-[#D9BA72]">{Math.round(value * 100)}</span>
    </div>
  );
}
function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
      <div>
        <div className="text-xs uppercase tracking-wider text-white/70">{label}</div>
        <div className="text-[10px] text-white/35">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} className="data-[state=checked]:bg-[#D9BA72]" />
    </div>
  );
}
function MercyChip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("min-h-11 rounded-md border px-3 text-xs font-bold uppercase tracking-wider transition-colors", active ? "border-[#58D6C2]/60 bg-[#58D6C2]/15 text-[#58D6C2] shadow-[0_0_14px_rgba(88,214,194,0.2)]" : "border-white/10 bg-black/30 text-white/45 hover:border-white/25 hover:text-white/75")}>
      {children}
    </button>
  );
}

/* ================================================================== */
/*  RESULTS SCREENS + PAUSE                                            */
/* ================================================================== */
export function GameOverScreen() {
  const phase = useRiftStore(s => s.phase);
  const stats = useRiftStore(s => s.stats);
  const show = phase === "gameover" && !!stats && !stats.triumph;
  return <AnimatePresence>{show && <GameOverContent key="gameover" />}</AnimatePresence>;
}
function GameOverContent() {
  const stats = useRiftStore(s => s.stats);
  if (!stats) return null;
  const payout = stats.payout;
  const earned = stats.delta ? stats.delta.glyphs : stats.glyphs;
  const actIdx = Math.min(4, Math.floor((Math.max(1, stats.wave - 1)) / 10));
  const act = ACTS[actIdx];
  const lastHit = stats.lastHits && stats.lastHits.length > 0 ? stats.lastHits[stats.lastHits.length - 1] : null;
  const remix = () => {
    sfx.click();
    useRiftStore.getState().randomizeSeed();
    ui.onGameOverRetry(useRiftStore.getState().seed);
  };
  return (
    <motion.div className="dark fixed inset-0 z-50 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-[#171321]">
        <div className="absolute inset-0" style={{ background: "radial-gradient(1100px 700px at 50% 20%, rgba(233,101,120,0.16), transparent 62%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(20,14,29,0.85) 100%)" }} />
      </div>
      <div className="rift-scroll relative mx-auto flex min-h-full w-full max-w-5xl flex-col items-center gap-4 px-4 py-8 safe-b-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-[0.42em] text-[#EFEAF7]/85">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#7A669C]/70" />
            Archmage
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#7A669C]/70" />
          </div>
          <motion.h2 className="font-display px-crimson-text mt-1 text-[clamp(56px,11vw,120px)] font-black leading-none tracking-[0.05em]" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, ease: [0.2, 0.9, 0.3, 1.15] }}>
            DEFEAT
          </motion.h2>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.34em] text-[#E96578]">
            {stats.endless ? "The endless echo swallowed you" : "The rift overwhelmed you"}
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <PxPanel variant="crimson" className="flex flex-1 items-center gap-3 p-3 sm:p-4">
            {(() => {
              const bossArt = bossPortrait(stats.killedBy);
              return bossArt ? (
                <span aria-hidden className="relative block size-14 shrink-0 overflow-hidden rounded-lg border-2 border-[#E96578]/60 bg-[#1B1528] shadow-[0_0_18px_rgba(233,101,120,0.3)]">
                  <img src={bossArt} alt="" width={56} height={56} draggable={false} className={cn(PIXELATED, "size-full object-cover")} />
                </span>
              ) : (
                <span className="px-socket !size-11 border-2 border-[#E96578]/50" style={{ boxShadow: "0 0 14px rgba(233,101,120,0.35)" }}>
                  <Skull className="size-5 text-[#E96578]" />
                </span>
              );
            })()}
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.24em] text-[#E96578]">Cause of Death</span>
              <span className="font-display mt-0.5 block truncate text-lg font-bold text-[#EFEAF7]">Slain by {stats.killedBy ?? "the rift's aftermath"}</span>
              {lastHit && lastHit.amount > 0 && (
                <span className="mt-0.5 block text-[11px] leading-snug text-[#9E93B5]">
                  A final strike that dealt <span className="font-mono font-bold tabular-nums text-[#E96578]">{lastHit.amount}</span> damage.
                </span>
              )}
            </span>
          </PxPanel>
          <PxPanel className="flex items-center gap-3 p-3 sm:w-64 sm:p-4">
            <img src={ICON.heart()} alt="" width={22} height={22} draggable={false} className={cn(PIXELATED, "size-5 shrink-0")} />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.24em] text-[#9E93B5]">Fell At</span>
              <span className="font-display block text-2xl font-black leading-tight tabular-nums text-[#D9BA72]">WAVE {stats.wave}</span>
              <span className="block truncate text-[10px] uppercase tracking-[0.18em] text-[#9E93B5]">Act {ROMAN_ACTS[actIdx]} · {act?.name}</span>
            </span>
          </PxPanel>
        </div>
        <BuildPanel stats={stats} epithet="The Last Magus" icon={<Swords className="size-3.5" />} />
        <PxPanel className="grid w-full grid-cols-3 gap-px overflow-hidden !rounded-lg sm:grid-cols-6" corners={false}>
          <StatCell icon={<Swords className="size-4 text-[#D9BA72]" />} label="Damage Dealt" value={fmtNum(Math.round(stats.damage))} />
          <StatCell icon={<Skull className="size-4 text-[#D9BA72]" />} label="Kills" value={fmtNum(stats.kills)} />
          <StatCell icon={<img src={ICON.coins()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />} label="Score" value={fmtNum(stats.score)} />
          <StatCell icon={<img src={RELIC.crown()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />} label="Tyrants Slain" value={String(stats.bossesSlain.length)} />
          <StatCell icon={<img src={RELIC.tome()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />} label="Resonances" value={String(stats.newCombos.length)} />
          <StatCell icon={<span className="font-mono text-sm font-black text-[#D9BA72]">⏱</span>} label="Time Survived" value={fmtTime(stats.timeSec)} />
        </PxPanel>
        <PxPanel className="w-full p-3 sm:p-4">
          <PxHeader icon={<BookOpen className="size-3.5" />}>Run Summary</PxHeader>
          <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {[
              ["Waves Cleared", `${Math.max(0, stats.wave - 1)} / ${VICTORY_WAVE}`],
              ["Glyphs Collected", fmtNum(stats.glyphs)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-[#3D3152]/50 py-1 last:border-b-0">
                <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#BFB5D4]"><PxDiamond small className="opacity-60" />{label}</span>
                <span className="font-mono text-sm font-bold tabular-nums text-[#EFEAF7]">{value}</span>
              </div>
            ))}
          </div>
          {earned > 0 && (
            <div className="mt-2 flex items-center justify-center gap-2 rounded-md border border-[#D9BA72]/30 bg-[#D9BA72]/5 px-3 py-2 text-[11px] text-[#BFB5D4]">
              <img src={ICON.crystal()} alt="" width={14} height={14} draggable={false} className={cn(PIXELATED, "size-3.5")} />
              <span><span className="font-mono font-bold tabular-nums text-[#D9BA72]">{earned}</span> glyphs earned · <span className="font-mono font-bold tabular-nums text-[#D9BA72]">{payout}</span> banked<span className="text-[#9E93B5]"> (75% paid to the rift)</span></span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[#9E93B5]">
            Seed
            <span className="font-mono font-bold tracking-widest tabular-nums text-[#D9BA72]">{stats.seed}</span>
            <button className="flex size-6 items-center justify-center rounded-md border border-[#3D3152] text-[#BFB5D4] transition-colors hover:border-[#D9BA72] hover:text-[#D9BA72]" aria-label="Copy seed" onClick={async () => { try { await navigator.clipboard.writeText(stats.seed); sfx.click(); } catch { /* clipboard denied */ } }}>
              <Copy className="size-3" />
            </button>
          </div>
        </PxPanel>
        <div className="mt-1 grid w-full max-w-2xl grid-cols-1 gap-3 pb-4 sm:grid-cols-3">
          <button type="button" onClick={() => { sfx.click(); ui.onGameOverMenu(); }} className="px-btn px-btn--ghost h-14 flex-col !tracking-[0.16em]">
            <span className="flex items-center gap-2"><House className="size-4" />Return</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-60">to hub</span>
          </button>
          <button type="button" onClick={() => { sfx.click(); ui.onGameOverRetry(stats.seed); }} className="px-btn px-btn--primary px-breathe h-14 flex-col">
            <span className="flex items-center gap-2"><RotateCcw className="size-4" />Replay</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-70">same seed · wave 1</span>
          </button>
          <button type="button" onClick={remix} className="px-btn px-btn--purple h-14 flex-col">
            <span className="flex items-center gap-2"><Swords className="size-4" />Rematch</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-60">new run · new seed</span>
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
  return <AnimatePresence>{show && <CreditsContent key="credits" />}</AnimatePresence>;
}
function CreditsContent() {
  const stats = useRiftStore(s => s.stats);
  if (!stats) return null;
  return (
    <motion.div className="dark fixed inset-0 z-50 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-[#171321]">
        <div className="absolute inset-0" style={{ background: "radial-gradient(1100px 700px at 50% 18%, rgba(217,186,114,0.18), transparent 62%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 44%, rgba(20,14,29,0.8) 100%)" }} />
      </div>
      <div className="rift-scroll relative mx-auto flex min-h-full w-full max-w-5xl flex-col items-center gap-4 px-4 py-8 safe-b-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-[0.42em] text-[#EFEAF7]/90">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#D9BA72]/70" />
            Archmage
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#D9BA72]/70" />
          </div>
          <div className="mt-1 flex items-center justify-center gap-3 sm:gap-5">
            <img src={RELIC.crown()} alt="" width={56} height={56} draggable={false} className={cn(PIXELATED, "h-16 w-auto sm:h-20")} style={{ filter: "drop-shadow(0 0 16px rgba(217,186,114,0.6))" }} />
            <motion.h2 className="font-display px-gold-text text-[clamp(48px,9.5vw,104px)] font-black leading-none tracking-[0.05em]" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: [0.2, 0.9, 0.3, 1.15] }}>
              VICTORY
            </motion.h2>
            <img src={RELIC.crown()} alt="" width={56} height={56} draggable={false} className={cn(PIXELATED, "h-16 w-auto scale-x-[-1] sm:h-20")} style={{ filter: "drop-shadow(0 0 16px rgba(217,186,114,0.6))" }} />
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.34em] text-[#D9BA72]">The rift has been sealed</div>
        </div>
        <PxPanel className="grid w-full grid-cols-2 gap-px overflow-hidden sm:grid-cols-4" corners={false}>
          {[
            { icon: <img src={RELIC.crown()} alt="" width={16} height={16} draggable={false} className={cn(PIXELATED, "size-4")} />, label: "Run Complete", value: `Wave ${stats.wave} / ${VICTORY_WAVE}` },
            { icon: <img src={RELIC.chalice()} alt="" width={16} height={16} draggable={false} className={cn(PIXELATED, "size-4")} />, label: "Final Act", value: `Act ${ROMAN_ACTS[Math.min(4, Math.floor((stats.wave - 1) / 10))]}` },
            { icon: <span className="font-mono text-sm font-black text-[#D9BA72]">⏱</span>, label: "Clear Time", value: fmtTime(stats.timeSec) },
            { icon: <img src={ICON.crystal()} alt="" width={16} height={16} draggable={false} className={cn(PIXELATED, "size-4")} />, label: "Seed", value: stats.seed },
          ].map((c, i) => (
            <div key={c.label} className="flex items-center gap-2.5 bg-[#1B1528]/85 px-3 py-2.5">
              {c.icon}
              <span className="min-w-0">
                <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-[#9E93B5]">{c.label}</span>
                <span className="font-display block truncate text-sm font-black leading-tight text-[#EFEAF7]">{c.value}</span>
              </span>
              {i === 3 && (
                <button className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md border border-[#3D3152] text-[#BFB5D4] transition-colors hover:border-[#D9BA72] hover:text-[#D9BA72]" aria-label="Copy seed" onClick={async () => { try { await navigator.clipboard.writeText(stats.seed); sfx.click(); } catch { /* clipboard denied */ } }}>
                  <Copy className="size-3" />
                </button>
              )}
            </div>
          ))}
        </PxPanel>
        <BuildPanel stats={stats} epithet="Rift Sealer" icon={<Swords className="size-3.5" />} />
        <PxPanel className="grid w-full grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-6" corners={false}>
          <StatCell icon={<Swords className="size-4 text-[#D9BA72]" />} label="Damage Dealt" value={fmtNum(Math.round(stats.damage))} />
          <StatCell icon={<Skull className="size-4 text-[#D9BA72]" />} label="Kills" value={fmtNum(stats.kills)} />
          <StatCell icon={<img src={ICON.coins()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />} label="Score" value={fmtNum(stats.score)} />
          <StatCell icon={<img src={RELIC.crown()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />} label="Tyrants Slain" value={String(stats.bossesSlain.length)} />
          <StatCell icon={<span className="font-mono text-sm font-black text-[#D9BA72]">⏱</span>} label="Time in the Rift" value={fmtTime(stats.timeSec)} />
          <StatCell icon={<img src={RELIC.tome()} alt="" width={18} height={18} draggable={false} className={cn(PIXELATED, "size-[18px]")} />} label="Resonances" value={String(stats.newCombos.length)} />
        </PxPanel>
        <PxPanel className="w-full p-3 sm:p-4">
          <PxHeader icon={<img src={RELIC.crown()} alt="" width={14} height={14} draggable={false} className={cn(PIXELATED, "size-3.5")} />}>Rewards</PxHeader>
          <div className="mt-2.5 flex flex-wrap items-start gap-3">
            <RewardTile src={ICON.crystal()} count={fmtNum(stats.payout)} label="Aether Glyphs · 100% Banked" tone="violet" />
            <RewardTile src={ICON.coins()} count={fmtNum(stats.score)} label="Score Earned" />
            {stats.bossesSlain.length > 0 && (
              <RewardTile src={RELIC.crown()} count={String(stats.bossesSlain.length)} label={`Tyrant${stats.bossesSlain.length > 1 ? "s" : ""} Unmade`} />
            )}
            {stats.newCombos.slice(0, 4).map(k => (
              <RewardTile key={k} src={RELIC.grimoire()} count="NEW" label={COMBOS[k]?.name ?? k} tone="violet" />
            ))}
          </div>
          {stats.newCombos.length > 0 && (
            <div className="mt-3">
              <PxHeader className="!text-[#E8D6FF]">Unlocked</PxHeader>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {stats.newCombos.map(k => (
                  <span key={k} className="flex items-center gap-1.5 text-[11px] text-[#BFB5D4]">
                    <PxDiamond small />
                    <span>New Resonance: <span className="font-bold text-[#E8D6FF]">{COMBOS[k]?.name ?? k}</span></span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </PxPanel>
        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => { sfx.click(); ui.onCreditsReturn(); }} className="px-btn px-btn--ghost h-14 flex-col !tracking-[0.16em]">
            <span className="flex items-center gap-2"><House className="size-4" />Return</span>
            <span className="font-mono text-[8px] font-semibold normal-case tracking-[0.2em] opacity-60">bank {fmtNum(stats.payout)} glyphs · seal the weave</span>
          </button>
          <button type="button" onClick={() => { sfx.click(); ui.onCreditsFight(); }} className="px-btn px-btn--primary px-breathe h-14 flex-col">
            <span className="flex items-center gap-2"><InfinityIcon className="size-4" />Fight — the Endless Echo</span>
            <span className="text-[8px] font-semibold normal-case tracking-[0.2em] opacity-70">waves 51+ · escalating pressure</span>
          </button>
        </div>
        <details className="w-full max-w-3xl pb-6">
          <summary className="cursor-pointer text-center text-[10px] font-bold uppercase tracking-[0.24em] text-[#9E93B5]/70 transition-colors hover:text-[#BFB5D4]">Asset attribution</summary>
          <PxPanel className="mt-2 p-4">
            <AssetAttributionList />
          </PxPanel>
        </details>
      </div>
    </motion.div>
  );
}
export function PauseOverlay({ onResume, onAbandon, onSettings, hud }: { onResume: () => void; onAbandon: () => void; onSettings: () => void; hud?: { hp: number; hpMax: number; aether: number; aetherMax: number; surge: number; seed: string; biomeName?: string } }) {
  const phase = useRiftStore(s => s.phase);
  const hpPct = hud ? Math.max(0, Math.min(100, hud.hp / Math.max(1, hud.hpMax) * 100)) : 0;
  const aePct = hud ? Math.max(0, Math.min(100, hud.aether / Math.max(1, hud.aetherMax) * 100)) : 0;
  const sgPct = hud ? Math.round(hud.surge * 100) : 0;
  return (
    <AnimatePresence>
      {phase === "paused" && (
        <motion.div className="dark fixed inset-0 z-40 flex items-center justify-center bg-[#171321]/80 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} key="pause">
          <motion.div className="px-panel px-corners relative w-full max-w-sm p-6 text-center" initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.25, ease: "easeOut" }}>
            <img src={RELIC.amulet()} alt="" width={28} height={28} draggable={false} className={cn(PIXELATED, "relative mx-auto size-7")} style={{ filter: "drop-shadow(0 0 10px rgba(217,186,114,0.5))" }} />
            <h2 className="font-display relative mt-3 text-balance text-lg font-black uppercase tracking-[0.14em] text-[#D9BA72] [text-shadow:0_0_22px_rgba(217,186,114,0.35)] sm:text-2xl">The Rift Sleeps</h2>
            <div className="relative mt-1.5 flex items-center justify-center gap-2">
              <PxDiamond small />
              <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-[#9E93B5]">it waits, impatient</span>
              <PxDiamond small />
            </div>
            {hud && (
              <div className="relative mt-4 rounded-lg border border-[#A991F7]/25 bg-[#1B1528]/70 px-4 py-3" aria-label="Active run identity">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#58D6C2]">Active rift seed</span>
                  <span className="font-mono text-sm font-bold tracking-widest tabular-nums text-[#F8E7BF]">{hud.seed}</span>
                </div>
                {hud.biomeName && <div className="mt-1 text-center text-[10px] uppercase tracking-[0.22em] text-white/40">Current ground · <span className="font-bold text-[#BFB5D4]">{hud.biomeName}</span></div>}
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <img src={ICON.heart()} alt="" width={13} height={13} draggable={false} className={cn(PIXELATED, "size-[13px] shrink-0")} />
                    <span className="h-2 flex-1 overflow-hidden rounded-full border border-[#D9BA72]/30 bg-[#140E1D]"><span className="block h-full rounded-full" style={{ width: `${hpPct}%`, background: "linear-gradient(90deg,#E96578,#E96578)" }} /></span>
                    <span className="w-14 text-right font-mono text-[8px] font-bold tabular-nums text-[#BFB5D4]">{Math.ceil(Math.max(0, hud.hp))} / {Math.round(hud.hpMax)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img src={ICON.flask()} alt="" width={13} height={13} draggable={false} className={cn(PIXELATED, "size-[13px] shrink-0")} />
                    <span className="h-2 flex-1 overflow-hidden rounded-full border border-[#D9BA72]/30 bg-[#140E1D]"><span className="block h-full rounded-full" style={{ width: `${aePct}%`, background: "linear-gradient(90deg,#A991F7,#E8D6FF)" }} /></span>
                    <span className="w-14 text-right font-mono text-[8px] font-bold tabular-nums text-[#BFB5D4]">{Math.floor(hud.aether)} / {Math.round(hud.aetherMax)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img src={ICON.crystal()} alt="" width={13} height={13} draggable={false} className={cn(PIXELATED, "size-[13px] shrink-0")} />
                    <span className="h-2 flex-1 overflow-hidden rounded-full border border-[#D9BA72]/30 bg-[#140E1D]"><span className="block h-full rounded-full" style={{ width: `${sgPct}%`, background: "linear-gradient(90deg,#D9BA72,#F8E7BF)" }} /></span>
                    <span className="w-14 text-right font-mono text-[8px] font-bold tabular-nums text-[#BFB5D4]">SURGE {sgPct}%</span>
                  </div>
                </div>
              </div>
            )}
            <div className="relative mt-6 flex flex-col gap-2.5">
              <button type="button" onClick={() => { sfx.click(); onResume(); }} className="px-btn px-btn--primary px-breathe w-full">
                <Play className="size-4" /> Resume
              </button>
              <button type="button" onClick={() => { sfx.click(); onSettings(); }} className="px-btn w-full">
                <span className="uppercase tracking-[0.12em]">Settings</span>
              </button>
              <button type="button" onClick={() => { sfx.click(); onAbandon(); }} className="px-btn w-full" style={{ borderColor: "rgba(233,101,120,0.5)", color: "#E96578" }}>
                <DoorOpen className="size-4" /> Abandon Run
              </button>
            </div>
            <div className="relative mt-3 text-center text-[8px] font-bold uppercase tracking-[0.24em] text-white/30">P resumes · the rift holds its breath</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
