"use client";

/* ARCHMAGE: RIFTBOUND (3D Edition) — zustand store.
   Owns meta-progression, settings, phase, screens and every overlay payload.
   The perf-critical HUD path is NOT here — engine pushes HudSnapshot through
   a callback, applied to DOM refs in the shell at ~30 Hz (zero re-renders). */

import { create } from "zustand";
import {
  DEFAULT_META, SAVE_SLOT_COUNT,
  computeBonuses, computeRunCommit, loadMeta, loadSlotMeta, peekSlotMeta,
  randomSeedString, readActiveSlot, reliquaryCost, saveSlotMeta, consumeSaveWriteWarning, writeActiveSlot,
  RELIQUARY_MAX_LEVEL,
  type GameSettings, type MetaSave, type ReliquaryKey,
} from "./content";
import { sfx } from "./audio";
import type { BannerPayload, GamePhase, GateOffer, MergeOfferPayload, RunStats, SpellOfferPayload, EvolveOfferPayload } from "./types";

export type ScreenId = "menu" | "reliquary" | "arcanum" | "codex";

interface RiftStore {
  meta: MetaSave;
  screen: ScreenId;
  phase: GamePhase;
  seed: string;
  activeSlot: number;

  /* transient run UI */
  banner: BannerPayload | null;
  gateOffer: GateOffer | null;
  spellOffer: SpellOfferPayload | null;
  mergeOffer: MergeOfferPayload | null;
  evolveOffer: EvolveOfferPayload | null; // v2.2 spell-evolution offer
  stats: RunStats | null;
  settingsOpen: boolean;

  /* actions */
  setScreen: (s: ScreenId) => void;
  setPhase: (p: GamePhase) => void;
  setSeed: (s: string) => void;
  randomizeSeed: () => void;
  showBanner: (title: string, sub: string | null, color: string) => void;
  clearBanner: () => void;
  setGateOffer: (o: GateOffer | null) => void;
  setSpellOffer: (o: SpellOfferPayload | null) => void;
  setMergeOffer: (o: MergeOfferPayload | null) => void;
  setEvolveOffer: (o: EvolveOfferPayload | null) => void;
  setStats: (s: RunStats | null) => void;
  openSettings: () => void;
  closeSettings: () => void;
  patchSettings: (patch: Partial<GameSettings>) => void;
  applyRunResult: (stats: RunStats) => void;
  buyUpgrade: (k: ReliquaryKey) => void;
  resetProgress: () => void;
  addComboFound: (key: string) => void;
  addEnemySeen: (type: string) => void;
  addBossSeen: (id: string) => void;
  addSpellSeen: (id: string) => void;
  setMercyTier: (tier: number) => void;
  clearRunState: () => void;
  /* --- save slots (10-g) --- */
  switchSlot: (i: number) => void;
  overwriteSlot: (i: number) => void;
}

let bannerKey = 0;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
let bannerDelay: ReturnType<typeof setTimeout> | undefined;
let bannerShownAt = 0;
const BANNER_MIN_SHOW = 1100;
const BANNER_LIFE = 2500;

/* v2.2 save-integrity watchdog (scope report §7): every persisted write
   flows through here — a refused write (quota / private mode) latches a
   warning in content.ts and surfaces as an in-game banner instead of
   silently losing progress. In-memory state stays live for the session. */
function persistSlot(i: number, meta: MetaSave) {
  saveSlotMeta(i, meta);
  const warn = consumeSaveWriteWarning();
  if (warn) {
    useRiftStore.getState().showBanner("PROGRESS NOT SAVED", `${warn} — this session's changes may not persist`, "#ff4d6b");
  }
}

/* --- milestone-commit idempotency (audit P1-1) ---------------------------
   runId:kind pairs that have already banked this page session. Module-scoped
   on purpose: a page reload creates a fresh engine (fresh monotonic runIds)
   and therefore a fresh run anyway, so cross-session persistence of the set
   is unnecessary — it exists to make applyRunResult idempotent against a
   double emission of the same milestone (e.g. victory + a stray replay),
   which is exactly the endless double-banking defect. */
const committedRuns = new Set<string>();

export function shouldCommit(seen: Set<string>, result: RunStats): boolean {
  const key = `${result.runId}:${result.kind}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

export const useRiftStore = create<RiftStore>((set, get) => ({
  meta: typeof window === "undefined" ? DEFAULT_META : loadMeta(),
  screen: "menu",
  phase: "menu",
  seed: typeof window === "undefined" ? "rune-1000" : randomSeedString(),
  activeSlot: typeof window === "undefined" ? 0 : readActiveSlot(),

  banner: null,
  gateOffer: null,
  spellOffer: null,
  mergeOffer: null,
  evolveOffer: null,
  stats: null,
  settingsOpen: false,

  setScreen: (s) => {
    sfx.click();
    set({ screen: s });
  },
  setPhase: (p) => set({ phase: p }),
  setSeed: (s) => set({ seed: s }),
  randomizeSeed: () => {
    sfx.click();
    set({ seed: randomSeedString() });
  },
  showBanner: (title, sub, color) => {
    bannerKey++;
    const next: BannerPayload = { title, sub, color, key: bannerKey };
    const show = () => {
      bannerShownAt = performance.now();
      if (bannerTimer) clearTimeout(bannerTimer);
      set({ banner: next });
      bannerTimer = setTimeout(() => set({ banner: null }), BANNER_LIFE);
    };
    const elapsed = performance.now() - bannerShownAt;
    if (bannerDelay) clearTimeout(bannerDelay);
    if (get().banner && elapsed >= 0 && elapsed < BANNER_MIN_SHOW) {
      bannerDelay = setTimeout(show, BANNER_MIN_SHOW - elapsed);
    } else {
      show();
    }
  },
  clearBanner: () => {
    if (bannerTimer) clearTimeout(bannerTimer);
    if (bannerDelay) clearTimeout(bannerDelay);
    set({ banner: null });
  },
  setGateOffer: (o) => set({ gateOffer: o }),
  setSpellOffer: (o) => set({ spellOffer: o }),
  setMergeOffer: (o) => set({ mergeOffer: o }),
  setEvolveOffer: (o) => set({ evolveOffer: o }),
  setStats: (s) => set({ stats: s }),
  openSettings: () => {
    sfx.click();
    set({ settingsOpen: true });
  },
  closeSettings: () => {
    sfx.click();
    set({ settingsOpen: false });
  },
  patchSettings: (patch) => {
    const prev = get().meta;
    const next = { ...prev, settings: { ...prev.settings, ...patch } };
    persistSlot(get().activeSlot, next);
    set({ meta: next });
    sfx.setMuted(next.settings.muted);
    sfx.setVolumes(next.settings.master, next.settings.music, next.settings.sfx, next.settings.ambience);
  },
  applyRunResult: (stats) => {
    /* milestone-commit idempotency (audit P1-1): the same runId+kind can
       never bank twice (e.g. a stray re-emission of the wave-50 victory
       result after the endless death). */
    if (!shouldCommit(committedRuns, stats)) return;
    const next = computeRunCommit(get().meta, stats);
    persistSlot(get().activeSlot, next);
    set({ meta: next, stats });
  },
  buyUpgrade: (k) => {
    const prev = get().meta;
    const lvl = prev.upgrades[k];
    const cost = reliquaryCost(lvl);
    if (lvl >= RELIQUARY_MAX_LEVEL || prev.shards < cost) {
      sfx.play("deny");
      return;
    }
    const next = { ...prev, shards: prev.shards - cost, upgrades: { ...prev.upgrades, [k]: lvl + 1 } };
    persistSlot(get().activeSlot, next);
    sfx.play("buy");
    set({ meta: next });
  },
  resetProgress: () => {
    const prev = get().meta;
    const fresh: MetaSave = {
      ...DEFAULT_META,
      upgrades: { ...DEFAULT_META.upgrades },
      combosFound: [],
      seenEnemies: [],
      seenBosses: [],
      settings: { ...prev.settings },
    };
    persistSlot(get().activeSlot, fresh);
    sfx.click();
    set({ meta: fresh });
  },
  addComboFound: (key) => {
    const prev = get().meta;
    if (prev.combosFound.includes(key)) return;
    const next = { ...prev, combosFound: [...prev.combosFound, key] };
    persistSlot(get().activeSlot, next);
    set({ meta: next });
  },
  addEnemySeen: (type) => {
    const prev = get().meta;
    if (prev.seenEnemies.includes(type)) return;
    const next = { ...prev, seenEnemies: [...prev.seenEnemies, type] };
    persistSlot(get().activeSlot, next);
    set({ meta: next });
  },
  addBossSeen: (id) => {
    const prev = get().meta;
    if (prev.seenBosses.includes(id)) return;
    const next = { ...prev, seenBosses: [...prev.seenBosses, id] };
    persistSlot(get().activeSlot, next);
    set({ meta: next });
  },
  addSpellSeen: (id) => {
    const prev = get().meta;
    if (prev.seenSpells.includes(id)) return;
    const next = { ...prev, seenSpells: [...prev.seenSpells, id] };
    persistSlot(get().activeSlot, next);
    set({ meta: next });
  },
  setMercyTier: (tier) => {
    sfx.click();
    const prev = get().meta;
    const next = { ...prev, mercyTierSel: Math.max(-1, tier | 0) };
    persistSlot(get().activeSlot, next);
    set({ meta: next });
  },
  clearRunState: () =>
    set({ gateOffer: null, spellOffer: null, mergeOffer: null, evolveOffer: null, stats: null, banner: null }),
  /* ------------------------- save slots (10-g) ------------------------- */
  switchSlot: (i) => {
    if (i < 0 || i >= SAVE_SLOT_COUNT) return;
    const st = get();
    if (i === st.activeSlot) return;
    /* menu-only: a live run (pause/gate/offer/merge) keeps its slot — switching
       mid-run would swap relics and settings under a running engine. */
    if (st.phase !== "menu") {
      sfx.play("deny");
      return;
    }
    st.clearRunState();
    persistSlot(st.activeSlot, st.meta); // belt + braces (already persisted)
    const next = loadSlotMeta(i); // empty slot → fresh mage
    writeActiveSlot(i);
    sfx.play("buy");
    set({ activeSlot: i, meta: next });
    sfx.setMuted(next.settings.muted);
    sfx.setVolumes(next.settings.master, next.settings.music, next.settings.sfx, next.settings.ambience);
  },
  overwriteSlot: (i) => {
    if (i < 0 || i >= SAVE_SLOT_COUNT) return;
    const st = get();
    if (i === st.activeSlot) return; // the active slot is always current
    if (st.phase !== "menu") {
      sfx.play("deny");
      return;
    }
    persistSlot(i, st.meta);
    sfx.play("buy");
    // the active slot does not change — the copy lives on slot i
  },
}));

export function currentBonuses(meta: MetaSave) {
  return computeBonuses(meta.upgrades);
}

export function peekSlots(): (MetaSave | null)[] {
  return Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => peekSlotMeta(i));
}
