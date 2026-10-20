"use client";

/* Archmage global store — Patch 7.0 "The Pure Arcanum".
   ----------------------------------------------------------------------------
   Zustand owns meta-progression, settings, phase, and every overlay payload.
   The story layer is gone: no cutscene state, no dialogue bar, no death
   quotes. New bestiary-discovery actions (addEnemySeen / addBossSeen) write
   first-kill unlocks into the meta save for the Arcanum.

   The perf-critical HUD path is deliberately NOT here: the 30 Hz HUD payload
   keeps mutating DOM refs directly in GameShell (zero React re-renders).

   The Sfx instance lives here as a module singleton so both the store
   actions (click sounds) and the engine (voice lines) share one AudioContext
   and one volume graph — including the new adaptive intensity + ducking. */

import { create } from "zustand";
import {
  DEFAULT_META, ElementId, EnemyType, GameSettings, MetaSave, UpgradeChoice,
  computeBonuses, loadMeta, randomSeedString, saveMeta,
} from "./content";
import { GamePhase, MergeOffer, RunStats, SpellOffer } from "./engine";
import { EvolutionDef } from "./evolutions";
import { Sfx } from "./audio";

/* module singleton — one AudioContext for the whole app */
export const sfx = new Sfx();

export type ScreenId = "menu" | "sanctum" | "arcanum";

export interface Banner { title: string; sub: string | null; color: string; key: number }

export interface SpellOfferState {
  pool: ElementId[];
  equipped: (ElementId | { merged: ElementId[] } | null)[];
}

export interface MergeOfferState {
  slots: number[];
  equipped: (ElementId | { merged: ElementId[] } | null)[];
}

export interface RewardOfferState {
  rewards: UpgradeChoice[];
  wave: number;
  /** how many of each reward the player already holds (for stack badges) */
  tiers: Record<string, number>;
}

interface ArchmageStore {
  /* persistent meta + settings */
  meta: MetaSave;
  screen: ScreenId;
  phase: GamePhase;
  seed: string;

  /* transient run UI */
  banner: Banner | null;
  rewardOffer: RewardOfferState | null;
  spellOffer: SpellOfferState | null;
  mergeOffer: MergeOfferState | null;
  evolutions: EvolutionDef[] | null;
  stats: RunStats | null;

  /* settings screen */
  settingsOpen: boolean;

  /* Patch 8.0 — Archmage Mode: in-run autopilot toggle (mobile button).
     Lives in the store so GameShell overlays can auto-pick while it's on. */
  autoMode: boolean;

  /* Patch 9.0 — Rift Mercy ladder selection: −1 = AUTO (use every banked
     death), ≥ 0 = a manually chosen (lower) tier. Written by the Settings
     tier chips + GameOver screen. */
  setMercyTier: (tier: number) => void;

  /* ---------- actions ---------- */
  setScreen: (s: ScreenId) => void;
  setPhase: (p: GamePhase) => void;
  setSeed: (s: string) => void;
  randomizeSeed: () => void;
  showBanner: (title: string, sub: string | null, color: string) => void;
  clearBanner: () => void;
  setRewardOffer: (offer: RewardOfferState | null) => void;
  setSpellOffer: (offer: SpellOfferState | null) => void;
  setMergeOffer: (offer: MergeOfferState | null) => void;
  setEvolutions: (choices: EvolutionDef[] | null) => void;
  setStats: (stats: RunStats | null) => void;
  openSettings: () => void;
  closeSettings: () => void;
  setAutoMode: (b: boolean) => void;
  patchSettings: (patch: Partial<GameSettings>) => void;
  applyRunResult: (stats: RunStats) => void;
  buyUpgrade: (k: keyof MetaSave["upgrades"]) => void;
  resetProgress: () => void;
  addComboFound: (key: string) => void;
  /* Patch 7.0 — bestiary discovery (first-kill unlocks) */
  addEnemySeen: (type: EnemyType) => void;
  addBossSeen: (id: string) => void;
  clearRunState: () => void;
}

let bannerKey = 0;
let bannerTimer: number | undefined;
let bannerDelay: number | undefined;
let bannerShownAt = 0;
/* V1.0 final — BANNER MINIMUM-DISPLAY: announcements that fire in the same
   frame (wave start + boss alert + drop formation) no longer overwrite each
   other instantly. The first banner holds the plate for at least 1.1 s;
   the most recent announcement then takes over. Clearing (or a third call
   during the hold) always wins — nothing stacks up. */
const BANNER_MIN_SHOW = 1100;
const BANNER_LIFE = 2500;

export const useArchmageStore = create<ArchmageStore>((set, get) => ({
  meta: typeof window === "undefined" ? DEFAULT_META : loadMeta(),
  screen: "menu",
  phase: "menu",
  seed: typeof window === "undefined" ? "rune-1000" : randomSeedString(),

  banner: null,
  rewardOffer: null,
  spellOffer: null,
  mergeOffer: null,
  evolutions: null,
  stats: null,

  settingsOpen: false,
  autoMode: false,

  setScreen: (s) => { sfx.click(); set({ screen: s }); },
  setPhase: (p) => set({ phase: p }),
  setSeed: (s) => set({ seed: s }),
  randomizeSeed: () => { sfx.click(); set({ seed: randomSeedString() }); },

  showBanner: (title, sub, color) => {
    bannerKey++;
    const next: Banner = { title, sub, color, key: bannerKey };
    const show = () => {
      bannerShownAt = performance.now();
      window.clearTimeout(bannerTimer);
      set({ banner: next });
      bannerTimer = window.setTimeout(() => set({ banner: null }), BANNER_LIFE);
    };
    const elapsed = performance.now() - bannerShownAt;
    window.clearTimeout(bannerDelay);
    if (get().banner && elapsed >= 0 && elapsed < BANNER_MIN_SHOW) {
      bannerDelay = window.setTimeout(show, BANNER_MIN_SHOW - elapsed);
    } else {
      show();
    }
  },
  clearBanner: () => {
    window.clearTimeout(bannerTimer);
    window.clearTimeout(bannerDelay);
    set({ banner: null });
  },

  setRewardOffer: (offer) => set({ rewardOffer: offer }),
  setSpellOffer: (offer) => set({ spellOffer: offer }),
  setMergeOffer: (offer) => set({ mergeOffer: offer }),
  setEvolutions: (choices) => set({ evolutions: choices }),

  setStats: (stats) => set({ stats }),

  openSettings: () => { sfx.click(); set({ settingsOpen: true }); },
  closeSettings: () => { sfx.click(); set({ settingsOpen: false }); },

  setAutoMode: (b) => { sfx.click(); set({ autoMode: b }); },

  /* Patch 9.0 — Rift Mercy tier selection (Hades-God-Mode dignity: the
     player may always opt DOWN). −1 = AUTO (full ladder). */
  setMercyTier: (tier) => {
    sfx.click();
    const prev = get().meta;
    const next: MetaSave = { ...prev, mercyTierSel: Math.max(-1, tier | 0) };
    saveMeta(next);
    set({ meta: next });
  },

  patchSettings: (patch) => {
    const prev = get().meta;
    const next: MetaSave = { ...prev, settings: { ...prev.settings, ...patch } };
    saveMeta(next);
    set({ meta: next });
    /* keep the audio graph in sync immediately */
    sfx.setVolumes(next.settings.master, next.settings.music, next.settings.sfx);
  },

  applyRunResult: (stats) => {
    const prev = get().meta;
    /* Patch 9.0 — the Rift Mercy ladder: every death banks one stack; a
       triumphant run (all five tyrants) clears the ladder entirely. */
    const mercyDeaths = stats.triumph ? 0 : Math.min(prev.mercyDeaths + 1, 99);
    const next: MetaSave = {
      ...prev,
      runs: prev.runs + 1,
      bestWave: Math.max(prev.bestWave, stats.wave),
      bestScore: Math.max(prev.bestScore, stats.score),
      totalKills: prev.totalKills + stats.kills,
      totalDamage: prev.totalDamage + stats.damage,
      totalTimeSec: prev.totalTimeSec + stats.timeSec,
      shards: prev.shards + stats.shards,
      combosFound: [...prev.combosFound, ...stats.newCombos.filter((c) => !prev.combosFound.includes(c))],
      victories: prev.victories + (stats.triumph ? 1 : 0),
      mercyDeaths,
      /* a victory clears the ladder, so AUTO is again the honest default */
      mercyTierSel: stats.triumph ? -1 : prev.mercyTierSel,
    };
    saveMeta(next);
    set({ meta: next, stats });
  },

  buyUpgrade: (k) => {
    sfx.click();
    const prev = get().meta;
    const lvl = prev.upgrades[k];
    const cost = Math.round(20 + 18 * lvl + 8 * lvl * lvl);
    if (lvl >= 6 || prev.shards < cost) return;
    const next: MetaSave = {
      ...prev,
      shards: prev.shards - cost,
      upgrades: { ...prev.upgrades, [k]: lvl + 1 },
    };
    saveMeta(next);
    set({ meta: next });
  },

  resetProgress: () => {
    /* full wipe: meta, shards, upgrades, Arcanum discoveries — settings kept
       so the player's audio/graphics preferences survive the reset */
    const prev = get().meta;
    const fresh: MetaSave = {
      ...DEFAULT_META,
      upgrades: { ...DEFAULT_META.upgrades },
      combosFound: [],
      seenEnemies: [],
      seenBosses: [],
      settings: { ...prev.settings },
    };
    saveMeta(fresh);
    sfx.click();
    set({ meta: fresh });
  },

  addComboFound: (key) => {
    const prev = get().meta;
    if (prev.combosFound.includes(key)) return;
    const next: MetaSave = { ...prev, combosFound: [...prev.combosFound, key] };
    saveMeta(next);
    set({ meta: next });
  },

  addEnemySeen: (type) => {
    const prev = get().meta;
    if (prev.seenEnemies.includes(type)) return;
    const next: MetaSave = { ...prev, seenEnemies: [...prev.seenEnemies, type] };
    saveMeta(next);
    set({ meta: next });
  },

  addBossSeen: (id) => {
    const prev = get().meta;
    if (prev.seenBosses.includes(id)) return;
    const next: MetaSave = { ...prev, seenBosses: [...prev.seenBosses, id] };
    saveMeta(next);
    set({ meta: next });
  },

  clearRunState: () => set({
    rewardOffer: null,
    spellOffer: null,
    mergeOffer: null,
    evolutions: null,
    stats: null,
    banner: null,
  }),
}));

/* helpers re-exported for the shell */
export function currentBonuses(meta: MetaSave) {
  return computeBonuses(meta);
}
