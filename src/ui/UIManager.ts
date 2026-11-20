/* ARCHMAGE: RIFTBOUND — UIManager
   Owns every interactive behaviour of the title-screen HUD:

     - typed UI state (profile, currencies, seed)
     - seed forge: [word]-[4digits] generation, edit toggle, shuffle scramble
     - currency increment handlers with count-up tweens and gain pops
     - glassmorphic modal system (Vault / Runes / Codex / Settings / Party)
       with focus trapping, Escape/backdrop dismissal and focus restoration
     - SfxSynth: a tiny Web Audio synth for hover/click/modal chimes

   The manager is framework-free: it binds to the semantic markup injected
   by the bootstrap and addresses elements through [data-ui] hooks. Every
   listener is bound through one AbortController, so `dispose()` is a
   single abort away. */

import type { SceneControls } from "@/scene/MenuScene";

/* ------------------------------------------------------------------ */
/* Seed forge                                                          */
/* ------------------------------------------------------------------ */

const SEED_WORDS = [
  "echo", "hex", "rune", "gale", "ember", "frost", "vault", "mist", "sable",
  "lumen", "drift", "onyx", "quill", "fable", "gleam", "umbra", "vesta",
  "wraith", "zephyr", "aether", "cinder", "halo", "knell", "opal",
] as const;

const RUNE_SIGILS = [
  { name: "Fehu", glyph: "\u16D0" }, { name: "Uruz", glyph: "\u16A2" },
  { name: "Thurisaz", glyph: "\u16A6" }, { name: "Ansuz", glyph: "\u16A8" },
  { name: "Raidho", glyph: "\u16B1" }, { name: "Kenaz", glyph: "\u16B7" },
  { name: "Gebo", glyph: "\u16D7" }, { name: "Wunjo", glyph: "\u16B8" },
  { name: "Hagalaz", glyph: "\u16BA" }, { name: "Nauthiz", glyph: "\u16BE" },
  { name: "Isa", glyph: "\u16C1" }, { name: "Jera", glyph: "\u16C3" },
  { name: "Eihwaz", glyph: "\u16C7" }, { name: "Algiz", glyph: "\u16B9" },
  { name: "Sowilo", glyph: "\u16C8" }, { name: "Tiwaz", glyph: "\u16CF" },
  { name: "Berkano", glyph: "\u16D2" }, { name: "Ehwaz", glyph: "\u16E6" },
  { name: "Mannaz", glyph: "\u16D6" }, { name: "Laguz", glyph: "\u16DA" },
  { name: "Ingwaz", glyph: "\u16B7" }, { name: "Dagaz", glyph: "\u16DE" },
  { name: "Othala", glyph: "\u16CF" },
] as const;

export function generateSeed(): string {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${word}-${digits}`;
}

/** Normalize free-typed input into a legal `[word]-[digits]`-style seed. */
export function normalizeSeedInput(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  return cleaned.length > 0 ? cleaned : generateSeed();
}

/** Deterministic 3-sigil reading of a seed (for the Runes modal). */
export function seedSigils(seed: string): Array<{ name: string; glyph: string }> {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pick = (salt: number): { name: string; glyph: string } => {
    const v = Math.abs(Math.imul(h ^ salt, 2654435761)) % RUNE_SIGILS.length;
    return RUNE_SIGILS[v];
  };
  return [pick(1), pick(2), pick(3)];
}

/* ------------------------------------------------------------------ */
/* SfxSynth — Web Audio UI chimes                                      */
/* ------------------------------------------------------------------ */

interface ToneOptions {
  freq: number;
  end?: number;
  dur: number;
  type: OscillatorType;
  gain: number;
  delay?: number;
}

export class SfxSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  constructor(signal: AbortSignal) {
    const arm = () => this.ensure();
    window.addEventListener("pointerdown", arm, { signal });
    window.addEventListener("keydown", arm, { signal });
  }

  /** Lazily create/resume the context inside a user gesture. */
  ensure(): void {
    if (!this.ctx) {
      type WindowWithLegacyAudio = Window & { webkitAudioContext?: typeof AudioContext };
      const w = window as WindowWithLegacyAudio;
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  hover(): void {
    this.tone({ freq: 1244.5, dur: 0.07, type: "sine", gain: 0.032 });
  }

  click(): void {
    this.tone({ freq: 523.25, dur: 0.09, type: "square", gain: 0.045 });
    this.tone({ freq: 783.99, dur: 0.08, type: "sine", gain: 0.04, delay: 0.05 });
  }

  confirm(): void {
    const notes = [659.25, 783.99, 987.77, 1318.5];
    notes.forEach((freq, i) => {
      this.tone({ freq, dur: 0.1, type: "triangle", gain: 0.05, delay: i * 0.075 });
    });
  }

  open(): void {
    this.tone({ freq: 640, end: 260, dur: 0.2, type: "triangle", gain: 0.05 });
  }

  close(): void {
    this.tone({ freq: 260, end: 640, dur: 0.15, type: "triangle", gain: 0.04 });
  }

  coin(): void {
    this.tone({ freq: 987.77, dur: 0.08, type: "square", gain: 0.04 });
    this.tone({ freq: 1318.5, dur: 0.16, type: "square", gain: 0.04, delay: 0.08 });
  }

  success(): void {
    this.tone({ freq: 659.25, dur: 0.24, type: "sine", gain: 0.05 });
    this.tone({ freq: 987.77, dur: 0.24, type: "sine", gain: 0.04, delay: 0.02 });
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private tone(o: ToneOptions): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + (o.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.end) osc.frequency.exponentialRampToValueAtTime(o.end, t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }
}

/* ------------------------------------------------------------------ */
/* UI state                                                            */
/* ------------------------------------------------------------------ */

export interface ProfileState {
  name: string;
  level: number;
  xp: number;
  xpMax: number;
}

export interface CurrencyState {
  gems: number;
  gold: number;
}

export interface SeedState {
  value: string;
  editing: boolean;
}

export type ModalKind = "vault" | "runes" | "codex" | "settings" | "party";

/** A modal action button with a label setter that keeps the text above the
    frame-gold fill layer. */
export type ModalActionButton = HTMLButtonElement & { setLabel(text: string): void };

export interface UIManagerConfig {
  /** The [data-ui="hud"] overlay root. */
  root: HTMLElement;
  sfx: SfxSynth;
  scene: SceneControls;
  /** SOLO RUN clicked — the bootstrap runs the camera dolly + veil. */
  onStartRun: (seed: string) => void;
  /** Splash "return" clicked — the bootstrap rewinds camera + veil. */
  onReturnToMenu: () => void;
}

const MODAL_TITLES: Record<ModalKind, string> = {
  vault: "The Vault",
  runes: "Runes of the Seed",
  codex: "Codex",
  settings: "Settings",
  party: "Online Party",
};

/* ------------------------------------------------------------------ */
/* V3.1 pixel-asset catalogues (served from /assets/v31)                */
/* ------------------------------------------------------------------ */

interface CatalogEntry {
  src: string;
  name: string;
}

/** Vault relics. Note: the sheet's `amulet.png` draws a ring and its
    `ring.png` draws a pendant — the labels below follow the art. */
const VAULT_RELICS: Array<CatalogEntry & { owned: boolean }> = [
  { src: "/assets/v31/relics/staff_storm.png", name: "Staff of the Tempest", owned: true },
  { src: "/assets/v31/relics/grimoire.png", name: "Grimoire of Rifts", owned: true },
  { src: "/assets/v31/relics/amulet.png", name: "Ring of the Ruby Oath", owned: true },
  { src: "/assets/v31/relics/chalice.png", name: "Chalice of Dawn", owned: true },
  { src: "/assets/v31/relics/staff_fire.png", name: "Staff of Embers", owned: false },
  { src: "/assets/v31/relics/staff_ice.png", name: "Staff of Deep Frost", owned: false },
  { src: "/assets/v31/relics/staff_void.png", name: "Staff of the Hollow Star", owned: false },
  { src: "/assets/v31/relics/staff_aether.png", name: "Staff of Aether Winds", owned: false },
  { src: "/assets/v31/relics/staff_chrono.png", name: "Staff of Counted Hours", owned: false },
  { src: "/assets/v31/relics/ring.png", name: "Amulet of the Rift", owned: false },
  { src: "/assets/v31/relics/crown.png", name: "Crown of the Pale King", owned: false },
  { src: "/assets/v31/relics/tome.png", name: "Tome of Forgotten Names", owned: false },
];

/** Rune crest elements (icons/element-*). */
const RUNE_ELEMENTS: Array<CatalogEntry> = [
  { src: "/assets/v31/icons/element-ember.png", name: "Ember" },
  { src: "/assets/v31/icons/element-frost.png", name: "Frost" },
  { src: "/assets/v31/icons/element-volt.png", name: "Volt" },
  { src: "/assets/v31/icons/element-arcane.png", name: "Arcane" },
  { src: "/assets/v31/icons/element-void.png", name: "Void" },
  { src: "/assets/v31/icons/element-vitality.png", name: "Vitality" },
  { src: "/assets/v31/icons/element-wind.png", name: "Wind" },
  { src: "/assets/v31/icons/element-time.png", name: "Time" },
  { src: "/assets/v31/icons/element-water.png", name: "Water" },
  { src: "/assets/v31/icons/element-shadow.png", name: "Shadow" },
  { src: "/assets/v31/icons/element-light.png", name: "Light" },
  { src: "/assets/v31/icons/element-earth.png", name: "Earth" },
];

/** Codex bestiary — playable masters plus the tyrants that seal the rift. */
const CODEX_MASTERS: Array<CatalogEntry> = [
  { src: "/assets/v31/portraits/pyromancer.png", name: "Pyromancer" },
  { src: "/assets/v31/portraits/cryomancer.png", name: "Cryomancer" },
  { src: "/assets/v31/portraits/stormcaller.png", name: "Stormcaller" },
  { src: "/assets/v31/portraits/voidweaver.png", name: "Voidweaver" },
  { src: "/assets/v31/portraits/aethermancer.png", name: "Aethermancer" },
  { src: "/assets/v31/portraits/chronomancer.png", name: "Chronomancer" },
];
const CODEX_TYRANTS: Array<CatalogEntry> = [
  { src: "/assets/v31/portraits/tyrant_grave.png", name: "Tyrant of the Grave" },
  { src: "/assets/v31/portraits/bone_regent.png", name: "Bone Regent" },
  { src: "/assets/v31/portraits/blight_colossus.png", name: "Blight Colossus" },
  { src: "/assets/v31/portraits/rift_leviathan.png", name: "Rift Leviathan" },
];

/** Crisp pixel <img> — style.css enforces image-rendering: pixelated. */
function pixelImg(src: string, alt: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.decoding = "async";
  img.className = "px-img";
  return img;
}

/** Small caps section header inside a modal body. */
function sectionHeader(text: string): HTMLHeadingElement {
  const h = document.createElement("h3");
  h.className = "modal-section";
  h.textContent = text;
  return h;
}

/* ------------------------------------------------------------------ */
/* UIManager                                                           */
/* ------------------------------------------------------------------ */

export class UIManager {
  private readonly ac = new AbortController();
  private readonly root: HTMLElement;
  private readonly sfx: SfxSynth;
  private readonly scene: SceneControls;
  private readonly cfg: UIManagerConfig;

  private profile: ProfileState = { name: "InfinityCat", level: 28, xp: 14300, xpMax: 26000 };
  private currency: CurrencyState = { gems: 1420, gold: 58300 };
  private seed: SeedState = { value: "echo-4584", editing: false };

  private modal: {
    kind: ModalKind;
    backdrop: HTMLElement;
    controller: AbortController;
    previouslyFocused: HTMLElement | null;
  } | null = null;

  private numberTweens = new Map<HTMLElement, number>();
  private scrambleTimer = 0;
  private locked = false;

  private readonly el: {
    solo: HTMLButtonElement;
    party: HTMLButtonElement;
    seedForm: HTMLFormElement;
    seedInput: HTMLInputElement;
    seedEdit: HTMLButtonElement;
    seedShuffle: HTMLButtonElement;
    gemValue: HTMLElement;
    goldValue: HTMLElement;
    xpFill: HTMLElement;
    xpTrack: HTMLElement;
    splashSeed: HTMLElement;
    splashReturn: HTMLButtonElement;
  };

  constructor(config: UIManagerConfig) {
    this.cfg = config;
    this.root = config.root;
    this.sfx = config.sfx;
    this.scene = config.scene;

    const q = <T extends HTMLElement>(key: string): T => {
      const found = this.root.querySelector<T>(`[data-ui="${key}"]`);
      if (!found) throw new Error(`UIManager: missing [data-ui="${key}"] element`);
      return found;
    };
    this.el = {
      solo: q("solo-run"),
      party: q("online-party"),
      seedForm: q("seed-form"),
      seedInput: q("seed-input"),
      seedEdit: q("seed-edit"),
      seedShuffle: q("seed-shuffle"),
      gemValue: q("gem-value"),
      goldValue: q("gold-value"),
      xpFill: q("xp-fill"),
      xpTrack: q("xp-track"),
      splashSeed: q("splash-seed"),
      splashReturn: q("splash-return"),
    };

    this.bindHoverChimes();
    this.bindActions();
    this.renderProfile();
  }

  /* ------------- state renderers ------------- */

  private renderProfile(): void {
    const pct = Math.min(100, (this.profile.xp / this.profile.xpMax) * 100);
    this.el.xpFill.style.width = `${pct.toFixed(1)}%`;
    this.el.xpTrack.setAttribute("aria-valuenow", String(this.profile.xp));
  }

  private setSeedValue(value: string, options?: { focusInput?: boolean }): void {
    this.seed.value = value;
    this.el.seedInput.value = value;
    this.el.splashSeed.textContent = value;
    if (options?.focusInput && this.seed.editing) this.el.seedInput.focus();
  }

  /* ------------- hover chimes ------------- */

  private bindHoverChimes(): void {
    const targets = this.root.querySelectorAll<HTMLElement>(
      "button, input, [role='progressbar']",
    );
    for (const t of targets) {
      t.addEventListener(
        "pointerenter",
        (ev) => {
          if (ev.pointerType === "mouse" && !this.locked) this.sfx.hover();
        },
        { signal: this.ac.signal },
      );
    }
  }

  /* ------------- action wiring ------------- */

  private bindActions(): void {
    const on = (key: string, type: string, fn: EventListener): void => {
      this.el[key].addEventListener(type, fn, { signal: this.ac.signal });
    };
    const onClick = (key: string, fn: (ev: MouseEvent) => void): void => {
      on(key, "click", fn as EventListener);
    };

    onClick("solo", () => {
      if (this.locked) return;
      this.sfx.confirm();
      this.cfg.onStartRun(this.seed.value);
    });

    onClick("party", () => {
      if (this.locked) return;
      this.sfx.click();
      this.openModal("party");
    });

    /* Currency increments — the + buttons on each pill. */
    this.root.querySelectorAll<HTMLButtonElement>("[data-ui='gems-plus']")
      .forEach((b) => b.addEventListener("click", () => this.incrementCurrency("gems"), { signal: this.ac.signal }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-ui='gold-plus']")
      .forEach((b) => b.addEventListener("click", () => this.incrementCurrency("gold"), { signal: this.ac.signal }));

    /* Seed bar. */
    onClick("seedEdit", () => {
      this.seed.editing = !this.seed.editing;
      this.el.seedInput.readOnly = !this.seed.editing;
      this.el.seedEdit.setAttribute("aria-pressed", String(this.seed.editing));
      this.el.seedForm.classList.toggle("editing", this.seed.editing);
      if (this.seed.editing) {
        this.el.seedInput.focus();
        this.el.seedInput.select();
      } else {
        this.commitSeed();
      }
      this.sfx.click();
    });
    on("seedInput", "keydown", (ev) => {
      const k = ev as KeyboardEvent;
      if (k.key === "Enter") {
        k.preventDefault();
        this.commitSeed();
        this.el.seedInput.blur();
      }
    });
    on("seedInput", "blur", () => this.commitSeed());
    onClick("seedShuffle", () => this.shuffleSeed());
    this.el.seedForm.addEventListener("submit", (ev) => ev.preventDefault(), { signal: this.ac.signal });

    /* Dock modals. */
    const dockMap: Array<[string, ModalKind]> = [
      ["open-vault", "vault"],
      ["open-runes", "runes"],
      ["open-codex", "codex"],
      ["open-settings", "settings"],
    ];
    for (const [key, kind] of dockMap) {
      this.root.querySelector<HTMLButtonElement>(`[data-ui="${key}"]`)
        ?.addEventListener(
          "click",
          () => {
            if (this.locked) return;
            this.sfx.click();
            this.openModal(kind);
          },
          { signal: this.ac.signal },
        );
    }

    /* Splash return. */
    onClick("splashReturn", () => {
      this.sfx.click();
      this.cfg.onReturnToMenu();
    });
  }

  private commitSeed(): void {
    if (!this.seed.editing) return;
    this.setSeedValue(normalizeSeedInput(this.el.seedInput.value));
  }

  private shuffleSeed(): void {
    if (this.locked) return;
    this.sfx.click();
    window.clearInterval(this.scrambleTimer);
    let ticks = 0;
    this.scrambleTimer = window.setInterval(() => {
      ticks += 1;
      if (ticks >= 6) {
        window.clearInterval(this.scrambleTimer);
        this.setSeedValue(generateSeed());
        this.sfx.success();
        return;
      }
      const jitter = (): string => {
        const chars = "abcdefghjkmnpqrstuvwxyz0123456789";
        return chars[Math.floor(Math.random() * chars.length)];
      };
      this.el.seedInput.value = `${jitter()}${jitter()}${jitter()}${jitter()}-${jitter()}${jitter()}${jitter()}${jitter()}`;
    }, 46);
  }

  /* ------------- currency ------------- */

  private incrementCurrency(kind: keyof CurrencyState): void {
    const amount = kind === "gems" ? 150 : 1500;
    const from = this.currency[kind];
    this.currency[kind] = from + amount;
    const valueEl = kind === "gems" ? this.el.gemValue : this.el.goldValue;
    this.animateNumber(valueEl, from, from + amount);
    this.sfx.coin();
    this.popGain(valueEl.parentElement ?? valueEl, `+${amount}`);
  }

  private animateNumber(el: HTMLElement, from: number, to: number, dur = 650): void {
    const existing = this.numberTweens.get(el);
    if (existing) window.cancelAnimationFrame(existing);
    const fmt = new Intl.NumberFormat("en-US");
    const t0 = performance.now();
    const step = (now: number): void => {
      const raw = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - raw, 3);
      el.textContent = fmt.format(Math.round(from + (to - from) * e));
      if (raw < 1) this.numberTweens.set(el, requestAnimationFrame(step));
      else this.numberTweens.delete(el);
    };
    this.numberTweens.set(el, requestAnimationFrame(step));
  }

  private popGain(host: HTMLElement, text: string): void {
    const pop = document.createElement("span");
    pop.className = "gain-pop";
    pop.textContent = text;
    host.appendChild(pop);
    const remove = (): void => {
      pop.remove();
      pop.removeEventListener("animationend", remove);
    };
    pop.addEventListener("animationend", remove);
    window.setTimeout(remove, 1400);
  }

  /* ------------- transition lock ------------- */

  setTransitionLock(locked: boolean): void {
    this.locked = locked;
    const lockables: Array<HTMLButtonElement | HTMLInputElement> = [
      this.el.solo,
      this.el.party,
      this.el.seedEdit,
      this.el.seedShuffle,
      this.el.seedInput,
    ];
    for (const el of lockables) el.disabled = locked;
    this.root.querySelectorAll<HTMLButtonElement>(".dock-btn").forEach((b) => {
      b.disabled = locked;
    });
    if (locked) {
      this.seed.editing = false;
      this.el.seedInput.readOnly = true;
      this.el.seedEdit.setAttribute("aria-pressed", "false");
      this.el.seedForm.classList.remove("editing");
    }
  }

  /* ------------- modal system ------------- */

  openModal(kind: ModalKind): void {
    if (this.modal) this.closeModal(false);
    this.sfx.open();
    const controller = new AbortController();
    const signal = { signal: controller.signal };
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const panel = document.createElement("div");
    panel.className = "modal-panel frame-gold ch-tlbr";
    /* Grid-heavy catalogues (vault / runes / codex) get the wide body. */
    if (kind === "vault" || kind === "runes" || kind === "codex") {
      panel.classList.add("modal-wide");
    }
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", MODAL_TITLES[kind]);

    const header = document.createElement("div");
    header.className = "modal-header";
    const title = document.createElement("h2");
    title.textContent = MODAL_TITLES[kind];
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "modal-close";
    closeBtn.setAttribute("aria-label", `Close ${MODAL_TITLES[kind]}`);
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 6 L18 18 M18 6 L6 18" stroke="#d8c8f0" stroke-width="2.5"/></svg>';
    header.append(title, closeBtn);
    panel.append(header, this.buildModalBody(kind, controller));

    backdrop.appendChild(panel);
    this.root.appendChild(backdrop);
    this.modal = { kind, backdrop, controller, previouslyFocused };

    closeBtn.addEventListener("click", () => this.closeModal(), signal);
    backdrop.addEventListener(
      "click",
      (ev) => {
        if (ev.target === backdrop) this.closeModal();
      },
      signal,
    );
    backdrop.addEventListener(
      "keydown",
      (ev) => {
        const k = ev as KeyboardEvent;
        if (k.key === "Escape") {
          k.stopPropagation();
          this.closeModal();
        } else if (k.key === "Tab") {
          // Minimal focus trap: wrap Tab inside the panel.
          const focusables = Array.from(
            panel.querySelectorAll<HTMLElement>("button, input, select, [tabindex]:not([tabindex='-1'])"),
          ).filter((el) => !el.hasAttribute("disabled"));
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (k.shiftKey && document.activeElement === first) {
            k.preventDefault();
            last.focus();
          } else if (!k.shiftKey && document.activeElement === last) {
            k.preventDefault();
            first.focus();
          }
        }
      },
      signal,
    );

    closeBtn.focus();
  }

  closeModal(playSound = true): void {
    if (!this.modal) return;
    if (playSound) this.sfx.close();
    this.modal.controller.abort();
    this.modal.backdrop.remove();
    this.modal.previouslyFocused?.focus?.();
    this.modal = null;
  }

  private buildModalBody(kind: ModalKind, controller: AbortController): HTMLElement {
    const signal = { signal: controller.signal };
    const body = document.createElement("div");
    body.className = "modal-body";

    const row = (label: string, value: string, cls = ""): HTMLElement => {
      const r = document.createElement("div");
      r.className = `stat-row ${cls}`.trim();
      const l = document.createElement("span");
      l.className = "stat-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "stat-value";
      v.textContent = value;
      r.append(l, v);
      return r;
    };
    const footnote = (text: string): void => {
      const f = document.createElement("p");
      f.className = "modal-footnote";
      f.textContent = text;
      body.appendChild(f);
    };
    const actionBtn = (label: string, onClick: () => void): ModalActionButton => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "modal-action frame-gold ch-tlbr";
      /* The label lives in a span: frame-gold lifts element children above
         its ::before fill layer, but bare text nodes would paint beneath. */
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      b.appendChild(labelSpan);
      b.addEventListener("click", onClick, signal);
      body.appendChild(b);
      return Object.assign(b, {
        setLabel(text: string): void {
          labelSpan.textContent = text;
        },
      });
    };

    switch (kind) {
      case "vault": {
        const fmt = new Intl.NumberFormat("en-US");
        body.append(
          row("Gems", fmt.format(this.currency.gems)),
          row("Gold", fmt.format(this.currency.gold)),
        );
        body.appendChild(sectionHeader("Relic Cabinet"));
        const grid = document.createElement("div");
        grid.className = "relic-grid";
        for (const relic of VAULT_RELICS) {
          const tile = document.createElement("div");
          tile.className = `relic-tile frame-gold ch-tlbr${relic.owned ? "" : " locked"}`;
          tile.appendChild(pixelImg(relic.src, relic.name));
          const name = document.createElement("span");
          name.className = "relic-name";
          name.textContent = relic.name;
          const tag = document.createElement("span");
          tag.className = "relic-tag";
          tag.textContent = relic.owned ? "OWNED" : "SEALED";
          tile.append(name, tag);
          tile.title = relic.owned ? relic.name : `${relic.name} — sealed`;
          grid.appendChild(tile);
        }
        body.appendChild(grid);
        const claim = actionBtn("CLAIM DAILY TRIBUTE", () => {
          const from = this.currency.gold;
          this.currency.gold = from + 250;
          this.animateNumber(this.el.goldValue, from, this.currency.gold);
          this.sfx.success();
          claim.disabled = true;
          claim.setLabel("CLAIMED — RETURN AT DAWN");
        });
        footnote("Tributes are minted locally. Nothing ever leaves your device.");
        break;
      }
      case "runes": {
        body.append(row("Active seed", this.seed.value, "mono"));
        const sigilRow = document.createElement("div");
        sigilRow.className = "sigil-row";
        const buildSigils = (): void => {
          sigilRow.replaceChildren();
          for (const s of seedSigils(this.seed.value)) {
            const tile = document.createElement("div");
            tile.className = "sigil-tile frame-gold ch-tlbr";
            const glyph = document.createElement("span");
            glyph.className = "sigil-glyph";
            glyph.textContent = s.glyph;
            const name = document.createElement("span");
            name.className = "sigil-name";
            name.textContent = s.name;
            tile.append(glyph, name);
            tile.title = s.name;
            sigilRow.appendChild(tile);
          }
        };
        buildSigils();
        body.appendChild(sigilRow);
        body.appendChild(sectionHeader("Elemental Attunements"));
        const crestGrid = document.createElement("div");
        crestGrid.className = "crest-grid";
        for (const el of RUNE_ELEMENTS) {
          const tile = document.createElement("div");
          tile.className = "crest-tile frame-gold ch-tlbr";
          tile.appendChild(pixelImg(el.src, el.name));
          const name = document.createElement("span");
          name.className = "crest-name";
          name.textContent = el.name;
          tile.appendChild(name);
          tile.title = el.name;
          crestGrid.appendChild(tile);
        }
        body.appendChild(crestGrid);
        actionBtn("FORGE NEW SEED", () => {
          this.setSeedValue(generateSeed());
          this.sfx.success();
          const seedRow = body.querySelector<HTMLElement>(".stat-row .stat-value");
          if (seedRow) seedRow.textContent = this.seed.value;
          buildSigils();
        });
        footnote("The same seed always walks the same ground — rerolls rewrite the rift.");
        break;
      }
      case "codex": {
        const lore = document.createElement("p");
        lore.className = "modal-lore";
        lore.textContent =
          "Fifty waves stand between you and the sealed rift. Bind spells from thirteen " +
          "elements, discover resonances by casting two within a breath, and spend your " +
          "surge when the gate crowds close. This is the gate itself — the menu build of ARCHMAGE: RIFTBOUND.";
        body.appendChild(lore);
        const buildBestiary = (entries: Array<CatalogEntry>, tier: string, cols: number): HTMLElement => {
          const grid = document.createElement("div");
          grid.className = `bestiary-grid bm-${cols}`;
          for (const entry of entries) {
            const tile = document.createElement("div");
            tile.className = "bestiary-tile frame-gold ch-tlbr";
            tile.appendChild(pixelImg(entry.src, entry.name));
            const name = document.createElement("span");
            name.className = "bestiary-name";
            name.textContent = entry.name;
            const tag = document.createElement("span");
            tag.className = "bestiary-tier";
            tag.textContent = tier;
            tile.append(name, tag);
            tile.title = entry.name;
            grid.appendChild(tile);
          }
          return grid;
        };
        body.appendChild(sectionHeader("Masters of the Rift"));
        body.appendChild(buildBestiary(CODEX_MASTERS, "MASTER", 6));
        body.appendChild(sectionHeader("Tyrants of the Deep Waves"));
        body.appendChild(buildBestiary(CODEX_TYRANTS, "TYRANT", 4));
        body.appendChild(sectionHeader("Rites & Bindings"));
        const table = document.createElement("div");
        table.className = "codex-table";
        const controls: Array<[string, string]> = [
          ["Move", "W A S D"],
          ["Aim", "Mouse"],
          ["Cast", "LMB"],
          ["Volley", "RMB"],
          ["Blink", "Space"],
          ["Surge", "F"],
          ["Pause", "P"],
        ];
        for (const [action, keys] of controls) {
          const r = document.createElement("div");
          r.className = "codex-row";
          const a = document.createElement("span");
          a.textContent = action;
          const k = document.createElement("kbd");
          k.textContent = keys;
          r.append(a, k);
          table.appendChild(r);
        }
        body.appendChild(table);
        footnote("The full rite unlocks inside the rift.");
        break;
      }
      case "settings": {
        const makeToggle = (
          label: string,
          checked: boolean,
          onChange: (v: boolean) => void,
        ): HTMLElement => {
          const wrap = document.createElement("label");
          wrap.className = "setting-row";
          const span = document.createElement("span");
          span.textContent = label;
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = checked;
          const track = document.createElement("span");
          track.className = "switch";
          wrap.append(span, input, track);
          input.addEventListener("change", () => {
            this.sfx.click();
            onChange(input.checked);
          }, signal);
          body.appendChild(wrap);
          return wrap;
        };
        makeToggle("Interface sounds", !this.sfx.isMuted(), (v) => this.sfx.setMuted(!v));
        makeToggle("Camera parallax", true, (v) => this.scene.setParallax(v));
        const densityRow = document.createElement("div");
        densityRow.className = "setting-row";
        const dLabel = document.createElement("span");
        dLabel.textContent = "Particles";
        const seg = document.createElement("div");
        seg.className = "segmented frame-gold ch-tlbr";
        /* Resting density is 0.75 (the scene boots there) — the segmented
           control mirrors it so the UI never lies about the live setting. */
        const options: Array<[string, number]> = [["LOW", 0.35], ["MEDIUM", 0.75], ["HIGH", 1]];
        for (const [name, value] of options) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = name;
          if (value === 0.75) b.classList.add("active");
          b.addEventListener("click", () => {
            this.sfx.click();
            this.scene.setParticleDensity(value);
            seg.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
          }, signal);
          seg.appendChild(b);
        }
        densityRow.append(dLabel, seg);
        body.appendChild(densityRow);
        footnote("Settings live for this session only.");
        break;
      }
      case "party": {
        const slots = document.createElement("div");
        slots.className = "party-slots";
        const you = document.createElement("div");
        you.className = "party-slot filled frame-gold ch-tlbr";
        you.innerHTML =
          '<span class="party-role">YOU</span><span class="party-name">InfinityCat</span><span class="party-lv">Lv. 28</span>';
        slots.appendChild(you);
        for (let i = 0; i < 2; i++) {
          const empty = document.createElement("div");
          empty.className = "party-slot frame-gold ch-tlbr";
          empty.innerHTML = '<span class="party-role">EMPTY</span><span class="party-name">Awaiting ally</span>';
          slots.appendChild(empty);
        }
        body.appendChild(slots);
        const invite = actionBtn("COPY INVITE SEED", () => {
          const done = (): void => {
            this.sfx.success();
            invite.setLabel("INVITE COPIED");
            window.setTimeout(() => {
              invite.setLabel("COPY INVITE SEED");
            }, 1600);
          };
          void navigator.clipboard
            ?.writeText(`archmage:join?seed=${this.seed.value}`)
            .then(done)
            .catch(() => {
              invite.setLabel("COPY BLOCKED — USE THE SEED BAR");
              window.setTimeout(() => {
                invite.setLabel("COPY INVITE SEED");
              }, 2200);
            });
        });
        footnote("Party rifts arrive with the multiplayer update. The seed is the invitation.");
        break;
      }
    }
    return body;
  }

  /* ------------- teardown ------------- */

  dispose(): void {
    this.closeModal(false);
    this.ac.abort();
    window.clearInterval(this.scrambleTimer);
    for (const id of this.numberTweens.values()) window.cancelAnimationFrame(id);
    this.numberTweens.clear();
  }
}
