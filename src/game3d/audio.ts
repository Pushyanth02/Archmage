/* ARCHMAGE: RIFTBOUND (3D Edition) — Web Audio synthesized audio engine.
   Zero audio files: every sound is oscillators + shared white noise through
   envelopes, filters and pitch bends. Self-contained — imports NOTHING.

   Graph:
     [music bus]─────┐
     [sfx bus]───────┤
     [ambience bus]──┼──(master gain)──(compressor)──destination
     [ui bus]────────┘

   UI bus: pure interface feedback (click / hover). It tracks the SFX
   slider (setVolumes drives both) — no separate user-facing setting.
   "deny" and "buy" stay on the sfx bus: they double as gameplay events
   (cast-denied in engine/spells, tribute-gate rewards) alongside their
   UI uses (reliquary purchases), so they are not pure UI sounds.

   Music: three moods (menu / combat / boss) built from persistent drone
   oscillators + a 100ms lookahead scheduler that fires one-shot notes on a
   tempo grid. Mood switches crossfade ~1s and fully tear down the previous
   layer (intervals cleared, sources stopped). The menu mood is a cinematic
   "threshold" cue (audit F-07): a dark low-fifth drone, a breathing diatonic
   pad on a deterministic Am→F→C→G table, a choir-ish shimmer, sparse
   pentatonic bell notes and a ~9s gradual rise. Entering a run (menu →
   combat/boss) fades the menu layer to silence in 450ms — inside the audited
   500ms budget — and fires a short "entering the Rift" sting on the music bus.

   Ambience: a fourth bus under the music — per-act biome presets (wind
   drone + bandpass noise swells + distant rumbles + ember crackle), one
   synth path, six parameter sets. setAmbienceMood(act | null) switches or
   stops it with the same clean teardown as music moods. */

export interface SfxPlayOpts {
  intensity?: number; // 0..1 — scales brightness/volume
}

/* ------------------------------ small utils ----------------------------- */

type AudioCtor = typeof AudioContext;

/** Find an AudioContext constructor (webkit fallback). Safe on SSR. */
function getAudioCtor(): AudioCtor | null {
  if (typeof AudioContext !== "undefined") return AudioContext;
  if (typeof window !== "undefined") {
    const w = window as unknown as { webkitAudioContext?: AudioCtor };
    if (w.webkitAudioContext) return w.webkitAudioContext;
  }
  return null;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
/** Note table (Hz). Root of the score: A (A-minor family). */
const N = {
  G1: 49.0,
  A1: 55.0,
  C2: 65.41,
  Eb2: 77.78,
  E2: 82.41,
  A2: 110.0,
  C3: 130.81,
  Eb3: 155.56,
  E3: 164.81,
  A3: 220.0,
  C4: 261.63,
  Cs4: 277.18,
  D4: 293.66,
  Eb4: 311.13,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  Bb4: 466.16,
  C5: 523.25,
  Cs5: 554.37,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  Bb5: 932.33,
  B5: 987.77,
  C6: 1046.5,
  Cs6: 1108.73,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
  A6: 1760.0
} as const;
/** A-minor pentatonic ladders for the plucked note generators. */
const PENT_MID: readonly number[] = [N.A3, N.C4, N.D4, N.E4, N.G4, N.A4, N.C5, N.D5, N.E5];
const PENT_WIDE: readonly number[] = [N.A3, N.C4, N.D4, N.E4, N.G4, N.A4, N.C5, N.D5, N.E5, N.G5];
/** Menu "threshold" pad — slow diatonic progression in the A-minor family
    (Am → F → C → G, ~8s per chord, advanced by a deterministic counter).
    Each row is the 4-voice pad voicing [bass, third, fifth, octave], chosen
    for close voice-leading between adjacent chords. */
const MENU_CHORDS: ReadonlyArray<readonly [number, number, number, number]> = [/* Am — A3 C4 E4 A4 */[220.0, 261.63, 329.63, 440.0], /* F — F3 A3 C4 F4 */[174.61, 220.0, 261.63, 349.23], /* C — G3 C4 E4 G4 */[196.0, 261.63, 329.63, 392.0], /* G — G3 B3 D4 G4 */[196.0, 246.94, 293.66, 392.0]];
/** Signature high bell notes for the menu — the top rung of the PENT_WIDE
    ladder one octave up, walked deterministically (no random jumps). */
const MENU_BELLS: readonly number[] = PENT_WIDE.slice(5).map(f => f * 2);
/** Deterministic gaps (s) between menu bell notes — sparse, 6–10s apart. */
const MENU_BELL_GAPS: readonly number[] = [7.5, 6.5, 9.0, 8.0];
/** Hard cap on concurrent one-shot SFX voices (music-bus notes are exempt). */
const MAX_VOICES = 48;

/* ----------------------------- voice specs ------------------------------ */

interface FilterSpec {
  type: BiquadFilterType;
  f0: number; // start cutoff
  f1?: number; // end cutoff (sweep over the voice duration)
  q?: number;
}

interface ToneSpec {
  type?: OscillatorType; // default "sine"
  f0: number; // start frequency
  f1?: number; // pitch bend target (exponential by default)
  bend?: "exp" | "lin";
  dur: number; // total voice length (s)
  a?: number; // attack (s), default 0.004
  hold?: number; // hold at peak before decay
  g?: number; // peak gain, default 0.2
  detune?: number; // cents
  at?: number; // absolute AudioContext time (default now)
  bus?: GainNode; // default sfx bus
  filter?: FilterSpec;
}

interface NoiseSpec {
  dur: number;
  a?: number;
  hold?: number;
  g?: number;
  rate?: number; // playback rate (pitch of the noise)
  at?: number;
  bus?: GainNode;
  filter?: FilterSpec;
  loop?: boolean; // force loop (auto-loops long voices anyway)
}

/* ------------------------------ music types ----------------------------- */

type MusicMood = "menu" | "combat" | "boss";

interface MusicLayer {
  mood: MusicMood;
  out: GainNode; // layer gain — used for crossfades
  dead: boolean;
  timers: number[]; // setInterval ids owned by this layer
  sources: AudioScheduledSourceNode[]; // persistent drones / LFOs
  setIntensity: (x: number) => void;
}

/** Shape killLayer can tear down (music + ambience layers share it). */
interface LayerCore {
  out: GainNode;
  dead: boolean;
  timers: number[];
  sources: AudioScheduledSourceNode[];
  mood?: MusicMood; // music layers label themselves — killLayer reads it to fire the menu exit sting
}

/* ----------------------------- ambience ------------------------------- */

/** Per-act ambience parameters — biome flavor over one synth path. */
interface AmbiencePreset {
  droneHz: number; // wind-drone base pitch
  sawMix: number; // sawtooth edge share vs the triangle body
  filterBase: number; // drone lowpass cutoff (240..420)
  filterDepth: number; // slow LFO depth on the cutoff
  filterLfo: number; // cutoff LFO rate (Hz)
  breatheLfo: number; // gain-breathing LFO rate (Hz)
  droneGain: number; // drone level — deliberately under the music
  swellF: number; // bandpass center of the noise-swell layer
  swellQ: number;
  swellGain: number;
  swellEvery: [number, number]; // seconds between swells
  swellRise: number;
  swellFall: number;
  rumbleGain: number; // distant thump layer (0 = off)
  rumbleEvery: [number, number];
  crackleGain: number; // ember ticks (cinder halls only; 0 = off)
  crackleEvery: [number, number];
}

/** Six biomes in ACTS order (content.ts): vestibule · cinder · drowned ·
 *  sepulcher · abyss · endless. Everything stays subtle — it sits UNDER the
 *  music and must never fatigue. */
const AMBIENCE_PRESETS: readonly AmbiencePreset[] = [/* 0 — The Sunless Vestibule: neutral dark wind */{
  droneHz: 55.0,
  sawMix: 0.35,
  filterBase: 300,
  filterDepth: 90,
  filterLfo: 0.07,
  breatheLfo: 0.05,
  droneGain: 0.055,
  swellF: 620,
  swellQ: 0.9,
  swellGain: 0.05,
  swellEvery: [7, 12],
  swellRise: 2.6,
  swellFall: 3.4,
  rumbleGain: 0.05,
  rumbleEvery: [16, 26],
  crackleGain: 0,
  crackleEvery: [1, 2]
}, /* 1 — The Cinder Labyrinth: darker furnace wind + ember crackle */{
  droneHz: 49.0,
  sawMix: 0.5,
  filterBase: 260,
  filterDepth: 80,
  filterLfo: 0.06,
  breatheLfo: 0.055,
  droneGain: 0.06,
  swellF: 480,
  swellQ: 0.8,
  swellGain: 0.055,
  swellEvery: [6, 11],
  swellRise: 2.2,
  swellFall: 3.0,
  rumbleGain: 0.06,
  rumbleEvery: [14, 24],
  crackleGain: 0.035,
  crackleEvery: [0.7, 2.4]
}, /* 2 — The Drowned Necropolis: muffled current, heavier low end */{
  droneHz: 43.65,
  sawMix: 0.25,
  filterBase: 240,
  filterDepth: 70,
  filterLfo: 0.05,
  breatheLfo: 0.045,
  droneGain: 0.07,
  swellF: 340,
  swellQ: 0.7,
  swellGain: 0.06,
  swellEvery: [6, 10],
  swellRise: 3.0,
  swellFall: 4.0,
  rumbleGain: 0.07,
  rumbleEvery: [12, 22],
  crackleGain: 0,
  crackleEvery: [1, 2]
}, /* 3 — The Silent Sepulcher: brighter, thinner frost whistle */{
  droneHz: 82.41,
  sawMix: 0.15,
  filterBase: 420,
  filterDepth: 130,
  filterLfo: 0.09,
  breatheLfo: 0.08,
  droneGain: 0.035,
  swellF: 1050,
  swellQ: 1.6,
  swellGain: 0.035,
  swellEvery: [6, 12],
  swellRise: 2.0,
  swellFall: 2.8,
  rumbleGain: 0.035,
  rumbleEvery: [18, 26],
  crackleGain: 0,
  crackleEvery: [1, 2]
}, /* 4 — The Heart of the Abyss: ominous pressure beat */{
  droneHz: 38.9,
  sawMix: 0.45,
  filterBase: 250,
  filterDepth: 60,
  filterLfo: 0.055,
  breatheLfo: 0.04,
  droneGain: 0.075,
  swellF: 400,
  swellQ: 0.8,
  swellGain: 0.05,
  swellEvery: [8, 13],
  swellRise: 3.2,
  swellFall: 4.2,
  rumbleGain: 0.08,
  rumbleEvery: [11, 20],
  crackleGain: 0,
  crackleEvery: [1, 2]
}, /* 5 — The Endless Dirge: deep sub drone, sparse and hollow */{
  droneHz: 36.7,
  sawMix: 0.4,
  filterBase: 240,
  filterDepth: 50,
  filterLfo: 0.05,
  breatheLfo: 0.04,
  droneGain: 0.08,
  swellF: 300,
  swellQ: 0.7,
  swellGain: 0.04,
  swellEvery: [10, 16],
  swellRise: 3.6,
  swellFall: 4.6,
  rumbleGain: 0.06,
  rumbleEvery: [14, 26],
  crackleGain: 0,
  crackleEvery: [1, 2]
}];
function randRange(w: readonly [number, number]): number {
  return w[0] + Math.random() * (w[1] - w[0]);
}

interface AmbienceLayer extends LayerCore {
  setLevel: (x: number) => void; // live whole-layer level
}

/* ================================= Sfx ================================== */

export class Sfx {
  /* -- audio graph (created lazily on first resume()) -- */
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  /* UI bus — pure interface sounds (click/hover), follows the SFX slider. */
  private uiBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  /* -- mixer state (applied immediately when changed) -- */
  private muted = false;
  private masterVol = 0.8;
  private musicVol = 0.55;
  /* v2.2 overlay ducking: 1 = full music, ~0.5 (≈−6 dB) while an overlay
   *  is open. One factor — a single setTargetAtTime per toggle, so ducks
   *  never stack envelopes. */
  private musicDuck = 1;
  private sfxVol = 0.85;
  private ambienceVol = 0.5;
  private ambienceLevel = 1; // R-03: last requested ambience level (unmute restore)
  /* -- runtime state -- */
  private active = 0; // live one-shot sfx voices (concurrency guard)
  private intensity = 0; // adaptive music intensity 0..1
  private layer: MusicLayer | null = null;
  private currentMood: MusicMood | null = null;
  private pendingMood: MusicMood | null = null; // music requested pre-gesture
  private ambienceLayer: AmbienceLayer | null = null;
  private currentAmbience: number | null = null; // act index 0..5
  private pendingAmbience: number | null = null; // ambience requested pre-gesture
  private pendingAmbienceLevel = 1;
  constructor() {
    /* All AudioContext work is deferred to resume() — the singleton may be
       constructed during SSR where window/AudioContext don't exist. */
  }
  /* ============================ lifecycle ============================== */

  /** Lazily create/unlock the AudioContext. Call on user gesture.
      Idempotent and safe to call many times. */
  resume(): void {
    if (!this.ctx) {
      const AC = getAudioCtor();
      if (!AC) return;
      try {
        this.ctx = new AC({
          latencyHint: "interactive"
        });
      } catch {
        try {
          this.ctx = new AC();
        } catch {
          this.ctx = null;
          return;
        }
      }
      this.buildGraph();
    }
    const ctx = this.ctx;
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    // If music was requested before the context existed, start it now. The
    // (!this.layer || this.layer.dead) guard also means a pending mood can
    // never stack a SECOND live layer on top of a running one (F-07: no
    // path can spawn a duplicate menu loop).
    if (this.pendingMood && (!this.layer || this.layer.dead)) {
      const mood = this.pendingMood;
      this.pendingMood = null;
      this.startMusic(mood);
    }
    // Same for ambience.
    if (this.pendingAmbience !== null && (!this.ambienceLayer || this.ambienceLayer.dead)) {
      const idx = this.pendingAmbience;
      const level = this.pendingAmbienceLevel;
      this.pendingAmbience = null;
      this.startAmbience(idx, level);
    }
  }
  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx || this.master) return;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(comp);
    const musicBus = ctx.createGain();
    musicBus.connect(master);
    const sfxBus = ctx.createGain();
    sfxBus.connect(master);
    const ambienceBus = ctx.createGain();
    ambienceBus.connect(master);
    const uiBus = ctx.createGain();
    uiBus.connect(master);
    this.comp = comp;
    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.ambienceBus = ambienceBus;
    this.uiBus = uiBus;
    // apply stored mixer state directly (no ramp on init)
    master.gain.value = this.muted ? 0 : this.masterVol;
    musicBus.gain.value = this.musicVol;
    sfxBus.gain.value = this.sfxVol;
    ambienceBus.gain.value = this.ambienceVol;
    uiBus.gain.value = this.sfxVol; // UI rides the SFX slider (plan §8 bus split)
    this.noiseBuf = this.makeNoise();
  }
  /** One shared 1.5s white-noise buffer reused by every noise voice. */
  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
  /* ============================== mixer ================================ */
  /** R-03 (v2.0 audit): MUTE IS AUTHORITATIVE. Turning it on tears down the
   *  live music + ambience layers (timers cleared synchronously, sources
   *  stopped) and clears any pre-gesture pending requests, so nothing can
   * keep scheduling while muted; currentMood/currentAmbience survive as the
   * DESIRED state. Turning it off rebuilds exactly the layers the current
   * phase wants (startMusic's same-mood guard makes duplicates impossible).
   *  Idempotent: repeated toggles of the same value never rebuild layers. */
  setMuted(b: boolean): void {
    if (this.muted === b) return;
    this.muted = b;
    if (b) {
      this.pendingMood = null;
      this.pendingAmbience = null;
      this.killLayer(this.layer, 0.15);
      this.layer = null;
      this.killLayer(this.ambienceLayer, 0.15);
      this.ambienceLayer = null;
    } else {
      if (this.currentMood) this.startMusic(this.currentMood);
      if (this.currentAmbience !== null) this.startAmbience(this.currentAmbience, this.ambienceLevel);
    }
    this.applyVolumes();
  }
  /** Read-only mute probe (tests / shell boot sync). The setting stays the
   *  single source of truth — this never mutates state. */
  isMuted(): boolean {
    return this.muted;
  }
  /** master / music / sfx / ambience — each 0..1. The 4th param is optional:
    omitted ⇒ ambience keeps its last-set value (default 0.5). */
  setVolumes(master: number, music: number, sfx: number, ambience?: number): void {
    this.masterVol = clamp01(master);
    this.musicVol = clamp01(music);
    this.sfxVol = clamp01(sfx);
    if (ambience !== undefined) this.ambienceVol = clamp01(ambience);
    this.applyVolumes();
  }
  /** v2.2: duck the music bus ≈−6 dB while an in-run overlay is open and
   *  restore it when the run resumes. Idempotent; one ramp per change. */
  duckMusic(on: boolean): void {
    const next = on ? 0.5 : 1;
    if (next === this.musicDuck) return;
    this.musicDuck = next;
    this.applyVolumes();
  }
  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus || !this.ambienceBus || !this.uiBus) return;
    const t = ctx.currentTime;
    try {
      /* muted ⇒ master target is ALWAYS zero — setVolumes can never bypass
       * the mute invariant (R-03) */
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVol, t, 0.03);
      this.musicBus.gain.setTargetAtTime(this.musicVol * this.musicDuck, t, 0.03);
      this.sfxBus.gain.setTargetAtTime(this.sfxVol, t, 0.03);
      this.ambienceBus.gain.setTargetAtTime(this.ambienceVol, t, 0.03);
      this.uiBus.gain.setTargetAtTime(this.sfxVol, t, 0.03);
    } catch {
      /* context closed — ignore */
  }
  }
  /* =============================== UI ================================== */

  /** Short UI click (UI bus). R-03: no UI sound is ever scheduled while
      muted — the guard lives at the entry point, before any node creation. */
  click(): void {
    if (this.muted) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || !this.uiBus) return;
    const t = ctx.currentTime;
    this.tone({
      at: t,
      type: "square",
      f0: 1850,
      f1: 1250,
      dur: 0.035,
      a: 0.001,
      g: 0.09,
      filter: {
        type: "lowpass",
        f0: 4200,
        f1: 2600,
        q: 0.6
      },
      bus: this.uiBus
    });
    this.noise({
      at: t,
      dur: 0.018,
      a: 0.001,
      g: 0.05,
      filter: {
        type: "highpass",
        f0: 3200
      },
      bus: this.uiBus
    });
  }
  /** Very soft tick for hover (UI bus). */
  hover(): void {
    if (this.muted) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || !this.uiBus) return;
    this.tone({
      at: ctx.currentTime,
      type: "sine",
      f0: 2700,
      f1: 2300,
      dur: 0.028,
      a: 0.001,
      g: 0.035,
      bus: this.uiBus
    });
  }
  /* ============================ voice router =========================== */
  play(name: string, opts?: SfxPlayOpts): void {
    const ctx = this.ctx;
    if (this.muted) return; // R-03: authoritative mute — no voice is created, let alone scheduled
    if (!ctx || ctx.state === "closed" || !this.sfxBus) return;
    if (this.active >= MAX_VOICES) return; // cheap early-out (real guard is per-voice)
    const i = clamp01(opts && opts.intensity !== undefined ? opts.intensity : 0.65);
    const t = ctx.currentTime;
    const k = 0.55 + 0.6 * i; // intensity → gain/brightness scalar
    switch (name) {
      case "cast":
        {
          // Arcane whoosh: swept noise + rising tonal body + sparkle tail.
          const dur = 0.26 + 0.14 * i;
          this.noise({
            at: t,
            dur,
            a: 0.02,
            g: 0.2 * k,
            filter: {
              type: "bandpass",
              f0: 300 + 500 * i,
              f1: 1800 + 2600 * i,
              q: 1.4
            }
          });
          this.tone({
            at: t,
            type: "triangle",
            f0: 230,
            f1: 480 + 320 * i,
            dur,
            a: 0.02,
            g: 0.12 * k,
            filter: {
              type: "lowpass",
              f0: 1400,
              f1: 2600,
              q: 0.7
            }
          });
          this.tone({
            at: t + 0.05,
            type: "sine",
            f0: 1100 + 700 * i,
            f1: 2300,
            dur: dur * 0.6,
            a: 0.01,
            g: 0.05 * k
          });
          break;
        }
      case "volley":
        {
          // Rapid arcane bolt: light, bright, gone fast.
          this.tone({
            at: t,
            type: "square",
            f0: 980,
            f1: 1500,
            dur: 0.07,
            a: 0.002,
            g: 0.09 * k,
            filter: {
              type: "lowpass",
              f0: 3800,
              q: 0.5
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 1500,
            f1: 2200,
            dur: 0.05,
            a: 0.001,
            g: 0.06 * k
          });
          this.noise({
            at: t,
            dur: 0.03,
            a: 0.001,
            g: 0.07 * k,
            filter: {
              type: "highpass",
              f0: 4200
            }
          });
          break;
        }
      case "hit":
        {
          // Thud + spark: filtered noise crunch over a falling sine body.
          this.noise({
            at: t,
            dur: 0.09,
            a: 0.001,
            g: 0.28 * k,
            filter: {
              type: "lowpass",
              f0: 1400,
              f1: 320,
              q: 0.8
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 175,
            f1: 68,
            dur: 0.12,
            a: 0.001,
            g: 0.38 * k
          });
          this.tone({
            at: t,
            type: "triangle",
            f0: 880,
            f1: 330,
            dur: 0.05,
            a: 0.001,
            g: 0.07 * k,
            filter: {
              type: "bandpass",
              f0: 1200,
              q: 2
            }
          });
          break;
        }
      case "crit":
        {
          // Heavier thud with a mid "bite" band and a high crack.
          this.tone({
            at: t,
            type: "sine",
            f0: 210,
            f1: 58,
            dur: 0.24,
            a: 0.001,
            g: 0.5 * k
          });
          this.noise({
            at: t,
            dur: 0.16,
            a: 0.001,
            g: 0.32 * k,
            filter: {
              type: "bandpass",
              f0: 2200,
              f1: 500,
              q: 1.6
            }
          });
          this.tone({
            at: t,
            type: "square",
            f0: 420,
            f1: 130,
            dur: 0.13,
            a: 0.001,
            g: 0.14 * k,
            filter: {
              type: "lowpass",
              f0: 1000,
              f1: 400
            }
          });
          this.noise({
            at: t + 0.02,
            dur: 0.06,
            a: 0.001,
            g: 0.12 * k,
            filter: {
              type: "highpass",
              f0: 3000
            }
          });
          break;
        }
      case "kill":
        {
          // Pop up, then a descending dissolve + splat.
          this.tone({
            at: t,
            type: "square",
            f0: 320,
            f1: 880,
            dur: 0.06,
            a: 0.001,
            g: 0.1 * k,
            filter: {
              type: "lowpass",
              f0: 2600
            }
          });
          this.tone({
            at: t + 0.05,
            type: "triangle",
            f0: 720,
            f1: 130,
            dur: 0.34,
            a: 0.004,
            g: 0.26 * k,
            filter: {
              type: "lowpass",
              f0: 2600,
              f1: 420
            }
          });
          this.noise({
            at: t + 0.04,
            dur: 0.2,
            a: 0.002,
            g: 0.18 * k,
            filter: {
              type: "lowpass",
              f0: 1600,
              f1: 240
            }
          });
          break;
        }
      case "hurt":
        {
          // Low thump + beating dissonant dyad (fear sting).
          this.tone({
            at: t,
            type: "sine",
            f0: 135,
            f1: 46,
            dur: 0.3,
            a: 0.002,
            g: 0.5 * k
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 196,
            dur: 0.26,
            a: 0.004,
            g: 0.07 * k,
            filter: {
              type: "lowpass",
              f0: 750,
              f1: 250
            }
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 207.6,
            dur: 0.26,
            a: 0.004,
            g: 0.07 * k,
            filter: {
              type: "lowpass",
              f0: 750,
              f1: 250
            }
          });
          this.noise({
            at: t,
            dur: 0.14,
            a: 0.001,
            g: 0.14 * k,
            filter: {
              type: "lowpass",
              f0: 520,
              f1: 160
            }
          });
          break;
        }
      case "death":
        {
          // Long dark fall: closing saw, deep sub, minor-2nd wail, rumble.
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 220,
            f1: 36,
            dur: 1.5,
            a: 0.02,
            g: 0.26 * k,
            filter: {
              type: "lowpass",
              f0: 1000,
              f1: 70,
              q: 1
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 62,
            f1: 27,
            dur: 1.5,
            a: 0.03,
            g: 0.4 * k
          });
          this.tone({
            at: t,
            type: "sine",
            f0: N.A4,
            dur: 1.1,
            a: 0.12,
            g: 0.05 * k
          });
          this.tone({
            at: t,
            type: "sine",
            f0: N.Bb4,
            dur: 1.1,
            a: 0.12,
            g: 0.05 * k
          });
          this.noise({
            at: t,
            dur: 1.3,
            a: 0.05,
            g: 0.12 * k,
            rate: 0.55,
            filter: {
              type: "lowpass",
              f0: 260,
              f1: 55
            }
          });
          break;
        }
      case "blink":
        {
          // Teleport: noise whoosh up then down (doppler) + shimmer tail.
          this.noise({
            at: t,
            dur: 0.16,
            a: 0.01,
            g: 0.22 * k,
            filter: {
              type: "bandpass",
              f0: 380,
              f1: 3200,
              q: 1.6
            }
          });
          this.noise({
            at: t + 0.15,
            dur: 0.2,
            a: 0.01,
            g: 0.16 * k,
            filter: {
              type: "bandpass",
              f0: 3000,
              f1: 480,
              q: 1.6
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 520,
            f1: 1500,
            dur: 0.16,
            a: 0.004,
            g: 0.13 * k
          });
          this.tone({
            at: t + 0.14,
            type: "sine",
            f0: 1400,
            f1: 420,
            dur: 0.22,
            a: 0.004,
            g: 0.1 * k
          });
          this.tone({
            at: t + 0.3,
            type: "sine",
            f0: 2500,
            f1: 2900,
            dur: 0.07,
            a: 0.001,
            g: 0.05 * k
          });
          break;
        }
      case "surge":
        {
          // Ultimate: rising power swell that lands with an impact.
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 90,
            f1: 720,
            dur: 0.85,
            a: 0.18,
            g: 0.24 * k,
            filter: {
              type: "lowpass",
              f0: 160,
              f1: 4500,
              q: 1.2
            }
          });
          this.tone({
            at: t,
            type: "triangle",
            f0: 180,
            f1: 1440,
            dur: 0.85,
            a: 0.22,
            g: 0.12 * k
          });
          this.tone({
            at: t + 0.12,
            type: "sine",
            f0: 1200,
            f1: 3400,
            dur: 0.55,
            a: 0.1,
            g: 0.06 * k
          });
          this.noise({
            at: t,
            dur: 0.8,
            a: 0.12,
            g: 0.13 * k,
            filter: {
              type: "bandpass",
              f0: 220,
              f1: 3200,
              q: 1.1
            }
          });
          this.tone({
            at: t + 0.78,
            type: "sine",
            f0: 90,
            f1: 60,
            dur: 0.3,
            a: 0.005,
            g: 0.3 * k
          });
          break;
        }
      case "surgeReady":
        {
          // Gentle two-note chime (A5 → E6) with shimmer detune.
          this.tone({
            at: t,
            type: "sine",
            f0: N.A5,
            dur: 0.55,
            a: 0.004,
            g: 0.13
          });
          this.tone({
            at: t + 0.08,
            type: "sine",
            f0: N.E6,
            dur: 0.7,
            a: 0.004,
            g: 0.1
          });
          this.tone({
            at: t + 0.08,
            type: "sine",
            f0: N.E6 * 1.005,
            dur: 0.7,
            a: 0.004,
            g: 0.04
          });
          break;
        }
      case "pickup":
        {
          // Generic pickup: rising blip + soft octave plop.
          this.tone({
            at: t,
            type: "sine",
            f0: 780,
            f1: 1180,
            dur: 0.09,
            a: 0.002,
            g: 0.16 * k
          });
          this.tone({
            at: t + 0.05,
            type: "triangle",
            f0: 1560,
            f1: 1760,
            dur: 0.14,
            a: 0.002,
            g: 0.09 * k
          });
          break;
        }
      case "heart":
        {
          // Warm heal: A-major triad blooming over a low root.
          [N.A4, N.Cs5, N.E5].forEach((f, idx) => {
            this.tone({
              at: t + idx * 0.07,
              type: "sine",
              f0: f,
              dur: 0.8,
              a: 0.03,
              g: 0.11 * k,
              filter: {
                type: "lowpass",
                f0: 2200,
                q: 0.5
              }
            });
          });
          this.tone({
            at: t,
            type: "sine",
            f0: N.A3,
            dur: 0.7,
            a: 0.05,
            g: 0.1 * k
          });
          break;
        }
      case "glyph":
        {
          // Tiny crystalline tick: two very short high partials.
          this.tone({
            at: t,
            type: "sine",
            f0: 3150,
            f1: 3350,
            dur: 0.07,
            a: 0.001,
            g: 0.09 * k
          });
          this.tone({
            at: t + 0.008,
            type: "sine",
            f0: 4720,
            dur: 0.05,
            a: 0.001,
            g: 0.04 * k
          });
          break;
        }
      case "gate":
        {
          // Deep gong: strike noise + inharmonic partials over a 64Hz root.
          this.noise({
            at: t,
            dur: 0.09,
            a: 0.001,
            g: 0.2,
            filter: {
              type: "bandpass",
              f0: 800,
              q: 1
            }
          });
          const partials: ReadonlyArray<readonly [number, number]> = [[1, 0.34], [2.76, 0.16], [5.4, 0.1], [8.93, 0.055]];
          for (const [ratio, g] of partials) {
            this.tone({
              at: t,
              type: "sine",
              f0: 64 * ratio,
              f1: 62 * ratio,
              dur: 2.3,
              a: 0.004,
              g,
              filter: {
                type: "lowpass",
                f0: 3200,
                q: 0.4
              }
            });
          }
          this.tone({
            at: t,
            type: "sine",
            f0: 32,
            dur: 2.0,
            a: 0.005,
            g: 0.3
          });
          this.noise({
            at: t,
            dur: 1.6,
            a: 0.01,
            g: 0.09,
            rate: 0.5,
            filter: {
              type: "lowpass",
              f0: 240,
              f1: 80
            }
          });
          break;
        }
      case "offer":
        {
          // Mysterious shimmer: slow-attack high cluster, slight upward drift.
          [N.B5, N.D6, N.E6].forEach((f, idx) => {
            this.tone({
              at: t + idx * 0.04,
              type: "sine",
              f0: f * 0.985,
              f1: f * 1.012,
              dur: 1.5,
              a: 0.25,
              g: 0.06,
              detune: idx * 4 - 4
            });
          });
          this.tone({
            at: t,
            type: "sine",
            f0: N.A3,
            dur: 1.4,
            a: 0.3,
            g: 0.06
          });
          this.noise({
            at: t,
            dur: 1.2,
            a: 0.35,
            g: 0.035,
            filter: {
              type: "highpass",
              f0: 6000
            }
          });
          break;
        }
      case "merge":
        {
          // Two tones converge to unison, then bloom at the fused pitch.
          this.tone({
            at: t,
            type: "triangle",
            f0: 330,
            f1: 660,
            bend: "lin",
            dur: 0.5,
            a: 0.02,
            g: 0.16
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 495,
            f1: 660,
            bend: "lin",
            dur: 0.5,
            a: 0.02,
            g: 0.16
          });
          this.noise({
            at: t,
            dur: 0.5,
            a: 0.08,
            g: 0.06,
            filter: {
              type: "bandpass",
              f0: 600,
              f1: 1600,
              q: 1.5
            }
          });
          this.tone({
            at: t + 0.5,
            type: "sine",
            f0: 660,
            dur: 0.7,
            a: 0.008,
            g: 0.14
          });
          this.tone({
            at: t + 0.5,
            type: "sine",
            f0: 990,
            dur: 0.7,
            a: 0.008,
            g: 0.09
          });
          this.tone({
            at: t + 0.5,
            type: "sine",
            f0: 1320,
            dur: 0.6,
            a: 0.008,
            g: 0.05
          });
          this.tone({
            at: t + 0.52,
            type: "triangle",
            f0: 1980,
            f1: 2400,
            dur: 0.3,
            a: 0.005,
            g: 0.04
          });
          break;
        }
      case "resonance":
        {
          // Resonance weave: INTENSE dual-tone harmonic bloom + sparkle run.
          const kk = 0.75 + 0.5 * i;
          this.tone({
            at: t,
            type: "sine",
            f0: 95,
            f1: 48,
            dur: 0.3,
            a: 0.002,
            g: 0.4 * kk
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: N.A3,
            dur: 1.15,
            a: 0.05,
            g: 0.2 * kk,
            detune: -8,
            filter: {
              type: "lowpass",
              f0: 500,
              f1: 5200,
              q: 1.4
            }
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: N.E4,
            dur: 1.15,
            a: 0.05,
            g: 0.18 * kk,
            detune: 9,
            filter: {
              type: "lowpass",
              f0: 500,
              f1: 5200,
              q: 1.4
            }
          });
          [N.A5, N.C6, N.E6, N.G6].forEach((f, idx) => {
            this.tone({
              at: t + 0.06 + idx * 0.085,
              type: "sine",
              f0: f,
              dur: 0.5,
              a: 0.004,
              g: (0.1 - idx * 0.015) * kk
            });
          });
          this.noise({
            at: t + 0.02,
            dur: 0.8,
            a: 0.04,
            g: 0.07 * kk,
            filter: {
              type: "highpass",
              f0: 4500,
              f1: 7000
            }
          });
          break;
        }
      case "wave":
        {
          // Short horn: doubled saws with a pitch scoop + low triangle body.
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 216,
            f1: 220,
            dur: 0.42,
            a: 0.015,
            hold: 0.14,
            g: 0.17,
            filter: {
              type: "lowpass",
              f0: 1900,
              f1: 900,
              q: 1
            }
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 323.6,
            f1: 329.6,
            dur: 0.42,
            a: 0.02,
            hold: 0.12,
            g: 0.13,
            detune: 6,
            filter: {
              type: "lowpass",
              f0: 2200,
              f1: 1000
            }
          });
          this.tone({
            at: t,
            type: "triangle",
            f0: 108,
            dur: 0.4,
            a: 0.02,
            g: 0.12
          });
          this.noise({
            at: t,
            dur: 0.1,
            a: 0.002,
            g: 0.08,
            filter: {
              type: "bandpass",
              f0: 1400,
              q: 1
            }
          });
          break;
        }
      case "boss":
        {
          // Entry sting: riser behind a rising minor triad, then a slam.
          this.noise({
            at: t,
            dur: 0.8,
            a: 0.3,
            g: 0.16,
            filter: {
              type: "bandpass",
              f0: 150,
              f1: 2600,
              q: 1.2
            }
          });
          [N.A2, N.C3, N.E3].forEach((f, idx) => {
            this.tone({
              at: t + idx * 0.13,
              type: "sawtooth",
              f0: f,
              dur: 0.16,
              a: 0.004,
              g: 0.22,
              filter: {
                type: "lowpass",
                f0: 1300,
                q: 1
              }
            });
          });
          this.tone({
            at: t + 0.42,
            type: "sawtooth",
            f0: N.A2,
            f1: N.A2 * 0.985,
            dur: 0.75,
            a: 0.005,
            g: 0.24,
            filter: {
              type: "lowpass",
              f0: 1500,
              f1: 500
            }
          });
          this.tone({
            at: t + 0.42,
            type: "sawtooth",
            f0: N.E3,
            dur: 0.75,
            a: 0.005,
            g: 0.16,
            filter: {
              type: "lowpass",
              f0: 1500,
              f1: 500
            }
          });
          this.tone({
            at: t + 0.42,
            type: "sine",
            f0: 55,
            f1: 40,
            dur: 0.6,
            a: 0.003,
            g: 0.45
          });
          this.noise({
            at: t + 0.42,
            dur: 0.5,
            a: 0.002,
            g: 0.3,
            filter: {
              type: "lowpass",
              f0: 900,
              f1: 120
            }
          });
          break;
        }
      case "bossDie":
        {
          // Long collapse: falling saw + rumble + sub, then a victory bloom.
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 320,
            f1: 38,
            dur: 1.7,
            a: 0.01,
            g: 0.26,
            filter: {
              type: "lowpass",
              f0: 1400,
              f1: 60,
              q: 1.2
            }
          });
          this.noise({
            at: t,
            dur: 1.7,
            a: 0.02,
            g: 0.28,
            rate: 0.5,
            filter: {
              type: "lowpass",
              f0: 350,
              f1: 45
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 52,
            f1: 24,
            dur: 1.6,
            a: 0.02,
            g: 0.4
          });
          const win = [N.A3, N.Cs4, N.E4, N.A4];
          win.forEach((f, idx) => {
            this.tone({
              at: t + 1.55 + idx * 0.02,
              type: "sine",
              f0: f,
              dur: 1.6,
              a: 0.04,
              g: 0.12,
              filter: {
                type: "lowpass",
                f0: 3400,
                q: 0.5
              }
            });
          });
          this.noise({
            at: t + 1.55,
            dur: 1.3,
            a: 0.01,
            g: 0.1,
            filter: {
              type: "highpass",
              f0: 5000,
              f1: 6500
            }
          });
          this.tone({
            at: t + 1.55,
            type: "sine",
            f0: 110,
            f1: 108,
            dur: 1.5,
            a: 0.02,
            g: 0.2
          });
          break;
        }
      case "explode":
        {
          // Boom: big noise thump + sub drop + initial crack.
          const kk = 0.6 + 0.55 * i;
          this.noise({
            at: t,
            dur: 0.75,
            a: 0.003,
            g: 0.55 * kk,
            filter: {
              type: "lowpass",
              f0: 3000 * (0.6 + 0.5 * i),
              f1: 110,
              q: 0.9
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 105,
            f1: 27,
            dur: 0.55,
            a: 0.002,
            g: 0.5 * kk
          });
          this.noise({
            at: t,
            dur: 0.05,
            a: 0.001,
            g: 0.24 * kk,
            filter: {
              type: "highpass",
              f0: 1800
            }
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 160,
            f1: 48,
            dur: 0.42,
            a: 0.002,
            g: 0.2 * kk,
            filter: {
              type: "lowpass",
              f0: 700,
              f1: 120
            }
          });
          break;
        }
      case "nova":
        {
          // Radial sweep: expanding ring (up) then collapse (down).
          this.noise({
            at: t,
            dur: 0.32,
            a: 0.015,
            g: 0.3 * k,
            filter: {
              type: "bandpass",
              f0: 260,
              f1: 3800,
              q: 1.3
            }
          });
          this.noise({
            at: t + 0.28,
            dur: 0.4,
            a: 0.02,
            g: 0.2 * k,
            filter: {
              type: "bandpass",
              f0: 3400,
              f1: 480,
              q: 1.3
            }
          });
          this.tone({
            at: t,
            type: "sine",
            f0: 340,
            f1: 1050,
            dur: 0.3,
            a: 0.01,
            g: 0.15 * k
          });
          this.tone({
            at: t + 0.27,
            type: "sine",
            f0: 1000,
            f1: 330,
            dur: 0.4,
            a: 0.01,
            g: 0.12 * k
          });
          this.tone({
            at: t + 0.05,
            type: "triangle",
            f0: 1700,
            f1: 3500,
            dur: 0.5,
            a: 0.02,
            g: 0.07 * k
          });
          break;
        }
      case "buy":
        {
          // Coin chime: E6 → A6 with a bright partial.
          this.tone({
            at: t,
            type: "sine",
            f0: N.E6,
            dur: 0.1,
            a: 0.001,
            g: 0.14
          });
          this.tone({
            at: t + 0.07,
            type: "sine",
            f0: N.A6,
            dur: 0.3,
            a: 0.001,
            g: 0.15
          });
          this.tone({
            at: t + 0.07,
            type: "triangle",
            f0: N.A6 * 1.5,
            dur: 0.22,
            a: 0.001,
            g: 0.05
          });
          break;
        }
      case "deny":
        {
          // Error buzz: two low square pulses with a falling edge.
          this.tone({
            at: t,
            type: "square",
            f0: 132,
            f1: 120,
            dur: 0.1,
            a: 0.002,
            g: 0.15,
            filter: {
              type: "lowpass",
              f0: 520,
              q: 1
            }
          });
          this.tone({
            at: t + 0.14,
            type: "square",
            f0: 118,
            f1: 106,
            dur: 0.12,
            a: 0.002,
            g: 0.15,
            filter: {
              type: "lowpass",
              f0: 480,
              q: 1
            }
          });
          this.noise({
            at: t,
            dur: 0.06,
            a: 0.001,
            g: 0.05,
            filter: {
              type: "lowpass",
              f0: 400
            }
          });
          break;
        }
      case "victory":
        {
          // Triumphant A-major arpeggio climbing into a held chord.
          const arp = [N.A3, N.Cs4, N.E4, N.A4, N.Cs5, N.E5, N.A5];
          arp.forEach((f, idx) => {
            this.tone({
              at: t + idx * 0.09,
              type: "triangle",
              f0: f,
              dur: 0.4,
              a: 0.004,
              g: 0.13,
              filter: {
                type: "lowpass",
                f0: 3600,
                q: 0.6
              }
            });
            this.tone({
              at: t + idx * 0.09,
              type: "sawtooth",
              f0: f / 2,
              dur: 0.4,
              a: 0.004,
              g: 0.045,
              filter: {
                type: "lowpass",
                f0: 1800,
                q: 0.6
              }
            });
          });
          [N.A3, N.Cs4, N.E4, N.A4].forEach(f => {
            this.tone({
              at: t + 0.66,
              type: "sine",
              f0: f,
              dur: 1.6,
              a: 0.03,
              g: 0.09,
              filter: {
                type: "lowpass",
                f0: 3000,
                q: 0.5
              }
            });
          });
          this.noise({
            at: t + 0.66,
            dur: 1.4,
            a: 0.3,
            g: 0.05,
            filter: {
              type: "highpass",
              f0: 5500,
              f1: 7500
            }
          });
          break;
        }
      case "slowmo":
        {
          // Time dilation: pitch falls away with a filtered echo.
          this.tone({
            at: t,
            type: "sine",
            f0: 940,
            f1: 170,
            dur: 0.6,
            a: 0.005,
            g: 0.2
          });
          this.tone({
            at: t,
            type: "sawtooth",
            f0: 720,
            f1: 130,
            dur: 0.6,
            a: 0.008,
            g: 0.07,
            filter: {
              type: "lowpass",
              f0: 2200,
              f1: 260,
              q: 1
            }
          });
          this.tone({
            at: t + 0.2,
            type: "sine",
            f0: 520,
            f1: 120,
            dur: 0.55,
            a: 0.006,
            g: 0.1
          });
          this.noise({
            at: t,
            dur: 0.5,
            a: 0.02,
            g: 0.06,
            rate: 0.7,
            filter: {
              type: "bandpass",
              f0: 1200,
              f1: 200,
              q: 1
            }
          });
          break;
        }
      default:
        break;
      // unknown names are silently ignored
    }
  }
  /* ============================== music ================================ */

  /** Calm act-tinted drone + sparse plucked pentatonic ladder. */
  musicMenu(): void {
    this.startMusic("menu");
  }
  /** Sharper drone family with pulsing sub-bass + faster pluck ladder. */
  musicCombat(): void {
    this.startMusic("combat");
  }
  /** Entry sting → driving 16th-note ostinato + tritone war drone. */
  musicBoss(): void {
    this.startMusic("boss");
  }
  /** Kill all music immediately (short fade, no leaked timers). */
  musicStop(): void {
    this.pendingMood = null;
    this.currentMood = null;
    this.killLayer(this.layer, 0.3);
    this.layer = null;
  }
  /** Adaptive layering for combat/boss music (filter cutoff + layers). */
  setIntensity(x: number): void {
    this.intensity = clamp01(x);
    const l = this.layer;
    if (l && !l.dead) {
      try {
        l.setIntensity(this.intensity);
      } catch {
        /* dead context — ignore */}
    }
  }
  private startMusic(mood: MusicMood): void {
    if (this.muted) {
      /* R-03: record the DESIRED mood and schedule nothing. The unmute path
       * rebuilds exactly this layer; musicStop() clears the desire. */
      this.currentMood = mood;
      this.pendingMood = null;
      return;
    }
    if (this.currentMood === mood && this.layer && !this.layer.dead) return; // already playing — this guard is what makes a second live menu layer impossible
    if (!this.ctx || !this.musicBus) {
      /* R-03: the DESIRED mood is recorded here too — a mute that lands while
       * the context is still pending must still restore this mood on unmute. */
      this.currentMood = mood;
      this.pendingMood = mood; // requested before first user gesture — resume() starts it once the context lives
      return;
    }
    /* Lifecycle contract (audit F-07 / §5.5): a SUSPENDED context still gets
       its layer built here, deliberately. Oscillators started on a suspended
       context are inaudible and its clock is frozen, so nothing plays and no
       automation advances until the browser resumes the context under a real
       user gesture — autoplay policy is respected and we never claim music
       is running. Only a MISSING context defers through pendingMood above. */
    if (this.ctx.state === "closed") return; // dead context — nothing to play on
    let layer: MusicLayer;
    try {
      layer = this.makeLayer(mood);
    } catch {
      return; // context died mid-build — leave music off
    }
    const old = this.layer;
    this.layer = layer;
    this.currentMood = mood;
    this.pendingMood = null;
    if (old) {
      // Entering a run: the menu "threshold" cue must be gone fast — fade it
      // to silence in 450ms (inside the audited 500ms budget) and mark the
      // kill fast so killLayer fires the transition sting. Every other mood
      // change keeps the ~1s musical crossfade.
      const fastOut = old.mood === "menu" && (mood === "combat" || mood === "boss");
      this.killLayer(old, fastOut ? 0.45 : 1.0, fastOut);
    }
  }
  private makeLayer(mood: MusicMood): MusicLayer {
    if (mood === "menu") return this.makeMenuLayer();
    if (mood === "combat") return this.makeCombatLayer();
    return this.makeBossLayer();
  }
  /* --------------------------- menu mood ------------------------------ */

  /* The cinematic "threshold" cue (audit F-07). Persistent graph — 13 source
     nodes, every one owned by the layer and torn down by killLayer:
       drone    4 osc (2 detuned saws on A1, saw on the E2 fifth, triangle
                sub) + 1 slow filter LFO, dark lowpass, restrained level
       pad      4 osc (detuned triangles + a faint saw edge) + 1 very slow
                gain-breath LFO, retuned through MENU_CHORDS by the scheduler
       shimmer  2 sine osc (2×/3× of moving chord tones) + 1 shared vibrato
     The 100ms scheduler also drops the interval-driven bell notes (self-
     stopping one-shots routed through this layer's gain, so the exit fade
     silences them too). Nothing in this layer uses Math.random — chords,
     bells and gaps all walk deterministic tables. */
  private makeMenuLayer(): MusicLayer {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    // GRADUAL RISE: early bloom to ~1/3 level, full mix over ~9s (was 1.4s).
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 2.4);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 9.0);
    out.connect(this.musicBus!);
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const layer: MusicLayer = {
      mood: "menu",
      out,
      dead: false,
      timers,
      sources,
      setIntensity: () => {}
    };
    // 1 — Restrained LOW drone: detuned saws opening on a low fifth (A1+E2)
    //     plus a sub triangle, through a dark lowpass swept at ~0.05Hz.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 300;
    droneFilter.Q.value = 0.8;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.13;
    droneFilter.connect(droneGain);
    droneGain.connect(out);
    const specs: ReadonlyArray<readonly [OscillatorType, number, number, number]> = [["sawtooth", N.A1, -7, 1], ["sawtooth", N.A1, 8, 1], ["sawtooth", N.E2, 4, 0.45], ["triangle", N.A1, 0, 0.85]];
    for (const [type, f, det, gs] of specs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gs;
      o.connect(og);
      og.connect(droneFilter);
      o.start();
      sources.push(o);
    }
    const droneLfo = ctx.createOscillator();
    droneLfo.frequency.value = 0.05;
    const droneLfoG = ctx.createGain();
    droneLfoG.gain.value = 90;
    droneLfo.connect(droneLfoG);
    droneLfoG.connect(droneFilter.frequency);
    droneLfo.start();
    sources.push(droneLfo);
    // 2 — Evolving harmonic pad: 4 detuned voices glide through MENU_CHORDS
    //     (Am → F → C → G, ~8s per chord), lowpassed, gain-breathing at
    //     ~0.04Hz. Voiced for close voice-leading so chords feel pulled.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.7;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.09;
    padFilter.connect(padGain);
    padGain.connect(out);
    const padVoices: OscillatorNode[] = [];
    const PAD_SPECS: ReadonlyArray<readonly [OscillatorType, number, number]> = [["triangle", -6, 0.5], ["triangle", 7, 0.42], ["sawtooth", 4, 0.16], ["triangle", -9, 0.3]];
    PAD_SPECS.forEach(([type, det, gs], i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = MENU_CHORDS[0][i];
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gs;
      o.connect(og);
      og.connect(padFilter);
      o.start();
      sources.push(o);
      padVoices.push(o);
    });
    const padBreath = ctx.createOscillator();
    padBreath.frequency.value = 0.04; // ~25s period — VERY slow breathing
    const padBreathG = ctx.createGain();
    padBreathG.gain.value = 0.03;
    padBreath.connect(padBreathG);
    padBreathG.connect(padGain.gain);
    padBreath.start();
    sources.push(padBreath);
    // 3 — Choir-ish shimmer: two quiet sines at 2×/3× of moving chord tones
    //     with a slow 5.5Hz vibrato of a few cents, very low gain.
    const SHIMMER: ReadonlyArray<readonly [number, number, number]> = [[1, 2, 1], [0, 3, 0.75]]; // [chord voice, harmonic, gain]
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.03;
    shimmerGain.connect(out);
    const shimmerVoices: OscillatorNode[] = [];
    for (const [voice, mult, gs] of SHIMMER) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = MENU_CHORDS[0][voice] * mult;
      const og = ctx.createGain();
      og.gain.value = gs;
      o.connect(og);
      og.connect(shimmerGain);
      o.start();
      sources.push(o);
      shimmerVoices.push(o);
    }
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = ctx.createGain();
    vibG.gain.value = 4; // cents
    vib.connect(vibG);
    vibG.connect(shimmerVoices[0].detune);
    vibG.connect(shimmerVoices[1].detune);
    vib.start();
    sources.push(vib);
    // 4 — One slow scheduler (same 100ms lookahead pattern as combat/boss):
    //     advances the chord table with a deterministic counter, retunes the
    //     pad + shimmer with long glides, and drops the sparse signature
    //     bells — a deterministic pentatonic ladder walk on a fixed gap
    //     table (every 6–10s). Zero Math.random in this layer.
    let chordIdx = 0;
    let nextChordAt = ctx.currentTime + 8.0;
    let bellIdx = 2;
    let bellDir = 1;
    let gapIdx = 0;
    let nextBellAt = ctx.currentTime + 5.0;
    const tick = window.setInterval(() => {
      if (layer.dead || ctx.state === "closed") return;
      const now = ctx.currentTime;
      if (now + 0.5 >= nextChordAt) {
        chordIdx = (chordIdx + 1) % MENU_CHORDS.length;
        const ch = MENU_CHORDS[chordIdx];
        try {
          const glide = 3.2; // slow-moving chords
          for (let i = 0; i < padVoices.length; i++) {
            padVoices[i].frequency.setTargetAtTime(ch[i], now, glide);
          }
          for (let i = 0; i < shimmerVoices.length; i++) {
            shimmerVoices[i].frequency.setTargetAtTime(ch[SHIMMER[i][0]] * SHIMMER[i][1], now, glide);
          }
        } catch {
          /* context closed mid-tick — teardown owns the rest */}
        nextChordAt = Math.max(nextChordAt + 8.0, now + 8.0); // no catch-up bursts after tab throttle
      }
      if (now + 0.4 >= nextBellAt) {
        const at = Math.max(nextBellAt, now + 0.02);
        this.menuBell(MENU_BELLS[bellIdx], at, 0.1, out);
        bellIdx += bellDir; // deterministic ladder walk, bouncing at the rails
        if (bellIdx >= MENU_BELLS.length - 1) {
          bellIdx = MENU_BELLS.length - 1;
          bellDir = -1;
        } else if (bellIdx <= 0) {
          bellIdx = 0;
          bellDir = 1;
        }
        nextBellAt = Math.max(nextBellAt + MENU_BELL_GAPS[gapIdx], now + 6.0);
        gapIdx = (gapIdx + 1) % MENU_BELL_GAPS.length;
      }
    }, 100);
    timers.push(tick);
    return layer;
  }
  /** Soft bell voice — sine fundamental + a quiet inharmonic partial. Used
      by the menu's signature high notes and the threshold sting. */
  private menuBell(f: number, at: number, g: number, bus: GainNode, dur = 2.4): void {
    this.tone({
      at,
      type: "sine",
      f0: f,
      dur,
      a: 0.005,
      g,
      bus
    });
    this.tone({
      at,
      type: "sine",
      f0: f * 2.76,
      dur: dur * 0.5,
      a: 0.002,
      g: g * 0.3,
      bus,
      filter: {
        type: "lowpass",
        f0: 7000,
        q: 0.5
      }
    });
  }
  /** "Entering the Rift" transition cue (audit F-07). Fired from killLayer
      ONLY on the fast menu → combat/boss fade: a rising filtered saw glide
      (root + fifth) that lands on a soft bell with a sub thump. Routed
      straight to the music bus with its own short envelope so it survives
      the dying menu layer's teardown. Mix safety: every peak stays ≤ 0.18 —
      well under the 0.25 sting budget — and the incoming combat/boss layer
      is still blooming in from silence, so no combined clip (the master
      compressor catches the momentary sum). */
  private menuTransitionSting(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || !this.musicBus) return;
    const t = ctx.currentTime + 0.02;
    this.tone({
      at: t,
      type: "sawtooth",
      f0: N.A2,
      f1: N.A3,
      dur: 0.55,
      a: 0.18,
      g: 0.18,
      bus: this.musicBus,
      filter: {
        type: "lowpass",
        f0: 420,
        f1: 3400,
        q: 1.1
      }
    });
    this.tone({
      at: t,
      type: "sawtooth",
      f0: N.E3,
      f1: N.E4,
      dur: 0.55,
      a: 0.18,
      g: 0.12,
      detune: 7,
      bus: this.musicBus,
      filter: {
        type: "lowpass",
        f0: 480,
        f1: 3600,
        q: 1.1
      }
    });
    this.menuBell(N.A5, t + 0.32, 0.16, this.musicBus, 1.3);
    this.tone({
      at: t + 0.32,
      type: "sine",
      f0: 110,
      f1: 55,
      dur: 0.5,
      a: 0.004,
      g: 0.14,
      bus: this.musicBus
    });
  }
  /* -------------------------- combat mood ----------------------------- */

  private makeCombatLayer(): MusicLayer {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.1);
    out.connect(this.musicBus!);
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const layer: MusicLayer = {
      mood: "combat",
      out,
      dead: false,
      timers,
      sources,
      setIntensity: () => {}
    };
    // Drone family (same as menu) — filter opens with intensity.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 380 + this.intensity * 2000;
    droneFilter.Q.value = 1.1;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.13;
    droneFilter.connect(droneGain);
    droneGain.connect(out);
    const specs: ReadonlyArray<readonly [OscillatorType, number, number, number]> = [["sawtooth", N.A2, -6, 1], ["sawtooth", N.A2, 7, 1], ["triangle", N.A1, 0, 0.7]];
    for (const [type, f, det, gs] of specs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gs;
      o.connect(og);
      og.connect(droneFilter);
      o.start();
      sources.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG);
    lfoG.connect(droneFilter.frequency);
    lfo.start();
    sources.push(lfo);
    // Rhythmic grid: 8th notes at ~120bpm. Sub-bass 3-3-2 pulse + pluck
    // ladder + intensity-gated off-beat hats.
    const stepDur = 0.25;
    let nextStep = ctx.currentTime + 0.2;
    let step = 0;
    const SUBP: ReadonlyArray<number | null> = [N.A1, null, null, N.A1, null, null, N.C2, null, N.A1, null, null, N.A1, null, N.G1, null, null];
    let ladder = 4;
    let dir = 1;
    const tick = window.setInterval(() => {
      if (layer.dead || ctx.state === "closed") return;
      const now = ctx.currentTime;
      if (nextStep < now) nextStep = now + 0.05; // don't burst after tab throttle
      while (nextStep < now + 1.2) {
        const s = step % 16;
        const at = Math.max(nextStep, now + 0.02);
        const p = SUBP[s];
        if (p !== null) {
          this.tone({
            at,
            type: "sine",
            f0: p,
            f1: p * 0.92,
            dur: 0.2,
            a: 0.003,
            g: 0.3,
            bus: out,
            filter: {
              type: "lowpass",
              f0: 300,
              q: 0.7
            }
          });
        }
        if (s % 2 === 1 && this.intensity > 0.2) {
          this.noise({
            at,
            dur: 0.03,
            a: 0.001,
            g: 0.015 + 0.03 * this.intensity,
            bus: out,
            filter: {
              type: "highpass",
              f0: 6500
            }
          });
        }
        if (s % 2 === 0 && Math.random() < 0.5 + 0.35 * this.intensity) {
          ladder += dir;
          if (ladder >= PENT_MID.length - 1) {
            ladder = PENT_MID.length - 1;
            dir = -1;
          } else if (ladder <= 0) {
            ladder = 0;
            dir = 1;
          }
          if (Math.random() < 0.12) {
            ladder = Math.random() * PENT_MID.length | 0;
            dir = Math.random() < 0.5 ? 1 : -1;
          }
          this.pluck(PENT_MID[ladder], at, 0.075 + 0.05 * this.intensity, out, 0.35);
        }
        nextStep += stepDur;
        step++;
      }
    }, 100);
    timers.push(tick);
    layer.setIntensity = (x: number) => {
      droneFilter.frequency.setTargetAtTime(380 + x * 2000, ctx.currentTime, 0.4);
    };
    return layer;
  }
  /* --------------------------- boss mood ------------------------------ */

  private makeBossLayer(): MusicLayer {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.25); // fast bloom — sting must hit
    out.connect(this.musicBus!);
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const layer: MusicLayer = {
      mood: "boss",
      out,
      dead: false,
      timers,
      sources,
      setIntensity: () => {}
    };
    // Entry sting: rising minor triad (A2 C3 E3) then a low slam.
    const stingAt = ctx.currentTime + 0.08;
    [N.A2, N.C3, N.E3].forEach((f, idx) => {
      this.tone({
        at: stingAt + idx * 0.14,
        type: "sawtooth",
        f0: f,
        dur: 0.18,
        a: 0.004,
        g: 0.26,
        bus: out,
        filter: {
          type: "lowpass",
          f0: 1400,
          q: 1
        }
      });
    });
    this.tone({
      at: stingAt + 0.45,
      type: "sine",
      f0: 58,
      f1: 40,
      dur: 0.7,
      a: 0.004,
      g: 0.5,
      bus: out
    });
    this.noise({
      at: stingAt + 0.45,
      dur: 0.5,
      a: 0.002,
      g: 0.3,
      bus: out,
      filter: {
        type: "lowpass",
        f0: 900,
        f1: 130
      }
    });
    // Tritone war drone: A2 + Eb3 saws through a moving lowpass.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 480 + this.intensity * 1100;
    droneFilter.Q.value = 1.0;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.12;
    droneFilter.connect(droneGain);
    droneGain.connect(out);
    const specs: ReadonlyArray<readonly [number, number, number]> = [[N.A2, -5, 0.8], [N.A2, 6, 0.8], [N.Eb3, 3, 0.65], [N.A1, 0, 0.4]];
    for (const [f, det, gs] of specs) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gs;
      o.connect(og);
      og.connect(droneFilter);
      o.start();
      sources.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG);
    lfoG.connect(droneFilter.frequency);
    lfo.start();
    sources.push(lfo);
    // Tension layer: minor-2nd sines under a tremolo, gain ramps in >0.5.
    const tensionGain = ctx.createGain();
    tensionGain.gain.value = 0;
    tensionGain.connect(out);
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.5;
    tremGain.connect(tensionGain);
    for (const [f, det] of [[N.A5, -6], [N.Bb5, 6]] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      o.connect(og);
      og.connect(tremGain);
      o.start();
      sources.push(o);
    }
    const trem = ctx.createOscillator();
    trem.type = "sine";
    trem.frequency.value = 6.5;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.35;
    trem.connect(tremDepth);
    tremDepth.connect(tremGain.gain);
    trem.start();
    sources.push(trem);
    // Driving ostinato: 16th-note bass pulse with tritone accents + war drums.
    const stepDur = 0.125;
    let nextStep = ctx.currentTime + 0.75; // let the sting land first
    let step = 0;
    const tick = window.setInterval(() => {
      if (layer.dead || ctx.state === "closed") return;
      const now = ctx.currentTime;
      if (nextStep < now) nextStep = now + 0.05;
      while (nextStep < now + 1.2) {
        const s = step % 16;
        const at = Math.max(nextStep, now + 0.02);
        const pitch = s === 6 || s === 14 ? N.Eb2 : N.A1; // tritone accents
        const accent = s % 4 === 0;
        this.tone({
          at,
          type: "sawtooth",
          f0: pitch,
          dur: 0.1,
          a: 0.002,
          g: accent ? 0.2 : 0.13,
          bus: out,
          filter: {
            type: "lowpass",
            f0: 620 + 500 * this.intensity,
            q: 1.2
          }
        });
        if (accent) this.tone({
          at,
          type: "sine",
          f0: pitch,
          dur: 0.16,
          a: 0.002,
          g: 0.22,
          bus: out
        });
        if (s === 0 || s === 8) {
          // war-drum thump
          this.tone({
            at,
            type: "sine",
            f0: 72,
            f1: 38,
            dur: 0.22,
            a: 0.002,
            g: 0.42,
            bus: out
          });
          this.noise({
            at,
            dur: 0.18,
            a: 0.001,
            g: 0.2,
            bus: out,
            filter: {
              type: "lowpass",
              f0: 350,
              f1: 90
            }
          });
        } else if (s === 4 || s === 12) {
          // snap
          this.noise({
            at,
            dur: 0.09,
            a: 0.001,
            g: 0.13,
            bus: out,
            filter: {
              type: "bandpass",
              f0: 1900,
              q: 0.9
            }
          });
        }
        nextStep += stepDur;
        step++;
      }
    }, 100);
    timers.push(tick);
    layer.setIntensity = (x: number) => {
      const t = ctx.currentTime;
      droneFilter.frequency.setTargetAtTime(480 + x * 1100, t, 0.4);
      tensionGain.gain.setTargetAtTime(x > 0.5 ? (x - 0.5) * 2 * 0.085 : 0, t, 0.5);
    };
    layer.setIntensity(this.intensity); // apply current state immediately
    return layer;
  }
  /* --------------------------- layer teardown ------------------------- */

  /** Fade a layer out and fully stop it: clear timers, stop drones, disconnect.
      Works for music AND ambience layers (both satisfy LayerCore).
      fast=true marks the F-07 menu → run transition (the short fade): the
      dying menu layer fires the "entering the Rift" sting on its way out.
      Silence lands at fade (450ms on the fast path — inside the audited
      500ms budget); sources stop at fade+50ms, gain disconnects after. */
  private killLayer(layer: LayerCore | null, fade = 1, fast = false): void {
    if (!layer || layer.dead) return;
    layer.dead = true;
    for (const id of layer.timers) window.clearInterval(id);
    layer.timers.length = 0;
    // Only the menu → run path passes fast — that transition gets the sting.
    // musicStop() (0.3s kill) and ordinary crossfades stay clean and silent.
    if (fast && layer.mood === "menu") this.menuTransitionSting();
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      const f = Math.max(0.02, fade);
      layer.out.gain.cancelScheduledValues(t);
      layer.out.gain.setValueAtTime(layer.out.gain.value, t);
      layer.out.gain.linearRampToValueAtTime(0, t + f);
      const stopAt = t + f + 0.05;
      for (const s of layer.sources) {
        try {
          s.stop(stopAt);
        } catch {
          /* already stopped — fine */}
      }
      window.setTimeout(() => {
        try {
          layer.out.disconnect();
        } catch {
          /* ignore */}
        layer.sources.length = 0;
      }, (fade + 0.25) * 1000);
    } catch {
      /* context closed — timers already cleared, nothing else to do */}
  }
  /* ============================== ambience ============================== */

  /** Biome ambience under the music. act = 0..5 in ACTS order (content.ts);
      null stops it cleanly. level 0..1.5 scales the whole layer — the menu
      uses the softer 0.55, runs use 1. */
  setAmbienceMood(act: number | null, level = 1): void {
    if (act !== null) this.ambienceLevel = Math.max(0.05, Math.min(1.5, level)); // R-03: durable level for the unmute restore
    if (act === null) {
      this.pendingAmbience = null;
      this.currentAmbience = null;
      this.killLayer(this.ambienceLayer, 1.2);
      this.ambienceLayer = null;
      return;
    }
    const idx = Math.max(0, Math.min(AMBIENCE_PRESETS.length - 1, Math.floor(act)));
    const lvl = Math.max(0.05, Math.min(1.5, level));
    if (this.currentAmbience === idx && this.ambienceLayer && !this.ambienceLayer.dead) {
      // same biome — just ride the level (soft ramp, no rebuild)
      this.pendingAmbience = null;
      try {
        this.ambienceLayer.setLevel(lvl);
      } catch {
        /* dead context — ignore */}
      return;
    }
    if (!this.ctx || !this.ambienceBus) {
      /* R-03: same desired-state record as the music path. */
      this.currentAmbience = idx;
      this.pendingAmbience = idx; // requested before first user gesture
      this.pendingAmbienceLevel = lvl;
      return;
    }
    this.startAmbience(idx, lvl);
  }
  private startAmbience(idx: number, level: number): void {
    if (this.muted) {
      /* R-03: desired state only — nothing is scheduled while muted; the
       * unmute path rebuilds exactly one ambience layer. */
      this.currentAmbience = idx;
      this.pendingAmbience = null;
      return;
    }
    if (!this.ctx || !this.ambienceBus) return;
    if (this.ctx.state === "closed") return; // dead context — nothing to play on
    let layer: AmbienceLayer;
    try {
      layer = this.makeAmbienceLayer(AMBIENCE_PRESETS[idx], level);
    } catch {
      return; // context died mid-build — leave ambience off
    }
    const old = this.ambienceLayer;
    this.ambienceLayer = layer;
    this.currentAmbience = idx;
    this.pendingAmbience = null;
    if (old) this.killLayer(old, 1.2); // crossfade, old pattern stops
  }
  /** One ambience voice: wind drone + noise swell + scheduled rumbles/ticks. */
  private makeAmbienceLayer(p: AmbiencePreset, level: number): AmbienceLayer {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(level, ctx.currentTime + 2.0); // slow bloom
    out.connect(this.ambienceBus!);
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const layer: AmbienceLayer = {
      out,
      dead: false,
      timers,
      sources,
      setLevel: () => {}
    };
    /* Wind drone: detuned triangle body + saw edge through a lowpass whose
    cutoff breathes on a very slow LFO, with a second LFO on the gain. */
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = p.filterBase;
    droneFilter.Q.value = 0.85;
    const droneGain = ctx.createGain();
    droneGain.gain.value = p.droneGain;
    droneFilter.connect(droneGain);
    droneGain.connect(out);
    const voices: ReadonlyArray<readonly [OscillatorType, number, number]> = [["triangle", -5, 1], ["sawtooth", 6, p.sawMix]];
    for (const [type, det, gs] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = p.droneHz;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gs;
      o.connect(og);
      og.connect(droneFilter);
      o.start();
      sources.push(o);
    }
    const cutLfo = ctx.createOscillator();
    cutLfo.frequency.value = p.filterLfo;
    const cutLfoG = ctx.createGain();
    cutLfoG.gain.value = p.filterDepth;
    cutLfo.connect(cutLfoG);
    cutLfoG.connect(droneFilter.frequency);
    cutLfo.start();
    sources.push(cutLfo);
    const breathLfo = ctx.createOscillator();
    breathLfo.frequency.value = p.breatheLfo;
    const breathG = ctx.createGain();
    breathG.gain.value = p.droneGain * 0.4;
    breathLfo.connect(breathG);
    breathG.connect(droneGain.gain); // gentle breathing
    breathLfo.start();
    sources.push(breathLfo);
    /* Swell layer: looped white noise through a bandpass, silent until a
    slow random swell breathes it open every 6-12 seconds. */
    const swellSrc = ctx.createBufferSource();
    swellSrc.buffer = this.noiseBuf;
    swellSrc.loop = true;
    const swellFilter = ctx.createBiquadFilter();
    swellFilter.type = "bandpass";
    swellFilter.frequency.value = p.swellF;
    swellFilter.Q.value = p.swellQ;
    const swellGain = ctx.createGain();
    swellGain.gain.value = 0.0001;
    swellSrc.connect(swellFilter);
    swellFilter.connect(swellGain);
    swellGain.connect(out);
    swellSrc.start();
    sources.push(swellSrc);
    /* One scheduler for swells + distant rumbles + (cinder) ember ticks. */
    let nextSwell = ctx.currentTime + randRange(p.swellEvery);
    let nextRumble = ctx.currentTime + randRange(p.rumbleEvery);
    let nextCrackle = p.crackleGain > 0 ? ctx.currentTime + randRange(p.crackleEvery) : Infinity;
    const tick = window.setInterval(() => {
      if (layer.dead || ctx.state === "closed") return;
      const now = ctx.currentTime;
      if (now + 0.3 >= nextSwell) {
        const rise = p.swellRise * (0.8 + Math.random() * 0.4);
        const fall = p.swellFall * (0.8 + Math.random() * 0.4);
        const peak = Math.max(0.0002, p.swellGain * (0.6 + Math.random() * 0.8));
        try {
          swellGain.gain.cancelScheduledValues(now);
          swellGain.gain.setValueAtTime(Math.max(0.0001, swellGain.gain.value), now);
          swellGain.gain.linearRampToValueAtTime(peak, now + rise);
          swellGain.gain.linearRampToValueAtTime(0.0001, now + rise + fall);
        } catch {
          /* closed mid-schedule — the teardown below cleans up */}
        nextSwell = now + rise + fall + randRange(p.swellEvery);
      }
      if (p.rumbleGain > 0 && now + 0.3 >= nextRumble) {
        // very low distant thump + soft low noise wash
        this.tone({
          at: now + 0.05,
          type: "sine",
          f0: 46,
          f1: 25,
          dur: 2.4,
          a: 0.5,
          g: p.rumbleGain,
          bus: out,
          filter: {
            type: "lowpass",
            f0: 120,
            q: 0.7
          }
        });
        this.noise({
          at: now + 0.05,
          dur: 2.0,
          a: 0.6,
          g: p.rumbleGain * 0.6,
          rate: 0.5,
          bus: out,
          filter: {
            type: "lowpass",
            f0: 160,
            q: 0.5
          }
        });
        nextRumble = now + randRange(p.rumbleEvery);
      }
      if (p.crackleGain > 0 && now + 0.3 >= nextCrackle) {
        // ember tick: tiny high-frequency snap, occasional double-tick
        this.noise({
          at: now + 0.02,
          dur: 0.02 + Math.random() * 0.03,
          a: 0.001,
          g: p.crackleGain * (0.5 + Math.random() * 0.9),
          bus: out,
          filter: {
            type: "highpass",
            f0: 2600 + Math.random() * 1800
          }
        });
        if (Math.random() < 0.25) {
          this.noise({
            at: now + 0.05 + Math.random() * 0.08,
            dur: 0.015,
            a: 0.001,
            g: p.crackleGain * 0.6,
            bus: out,
            filter: {
              type: "highpass",
              f0: 3200
            }
          });
        }
        nextCrackle = now + randRange(p.crackleEvery);
      }
    }, 400);
    timers.push(tick);
    layer.setLevel = (x: number) => {
      out.gain.setTargetAtTime(Math.max(0.0001, x), ctx.currentTime, 0.6);
    };
    return layer;
  }
  /* ------------------------- voice primitives ------------------------- */

  /** One oscillator voice: pitch bend + envelope + optional filter sweep. */
  private tone(s: ToneSpec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bus = s.bus ?? this.sfxBus;
    if (!bus) return;
    try {
      const t = s.at ?? ctx.currentTime;
      const dur = Math.max(0.02, s.dur);
      if (bus === this.sfxBus) {
        // hard concurrency guard — count real SFX voices (music notes exempt)
        if (this.active >= MAX_VOICES) return;
        this.active++;
        window.setTimeout(() => {
          this.active = Math.max(0, this.active - 1);
        }, (dur + 0.15) * 1000);
      }
      const a = Math.min(s.a ?? 0.004, dur * 0.5);
      const peak = Math.max(0.0001, s.g ?? 0.2);
      const osc = ctx.createOscillator();
      osc.type = s.type ?? "sine";
      osc.frequency.setValueAtTime(Math.max(1, s.f0), t);
      if (s.f1 !== undefined) {
        const f1 = Math.max(1, s.f1);
        if (s.bend === "lin") osc.frequency.linearRampToValueAtTime(f1, t + dur);else osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      }
      if (s.detune !== undefined) osc.detune.setValueAtTime(s.detune, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      const hold = Math.min(s.hold ?? 0, Math.max(0, dur - a - 0.01));
      if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let tail: AudioNode = osc;
      if (s.filter) {
        const flt = ctx.createBiquadFilter();
        flt.type = s.filter.type;
        flt.Q.value = s.filter.q ?? 1;
        flt.frequency.setValueAtTime(Math.max(10, s.filter.f0), t);
        if (s.filter.f1 !== undefined) {
          flt.frequency.exponentialRampToValueAtTime(Math.max(10, s.filter.f1), t + dur);
        }
        tail.connect(flt);
        tail = flt;
      }
      tail.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      osc.onended = () => {
        try {
          g.disconnect();
        } catch {
          /* ignore */}
      };
    } catch {
      /* context closed or node invalid — skip silently */}
  }
  /** One noise-burst voice from the shared white-noise buffer. */
  private noise(s: NoiseSpec): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const bus = s.bus ?? this.sfxBus;
    if (!bus) return;
    try {
      const t = s.at ?? ctx.currentTime;
      const dur = Math.max(0.02, s.dur);
      if (bus === this.sfxBus) {
        // hard concurrency guard — count real SFX voices (music notes exempt)
        if (this.active >= MAX_VOICES) return;
        this.active++;
        window.setTimeout(() => {
          this.active = Math.max(0, this.active - 1);
        }, (dur + 0.15) * 1000);
      }
      const a = Math.min(s.a ?? 0.002, dur * 0.5);
      const peak = Math.max(0.0001, s.g ?? 0.2);
      const rate = s.rate ?? 1;
      const loop = s.loop ?? dur * rate > 1.3; // auto-loop long draws
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = loop;
      if (rate !== 1) src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      const hold = Math.min(s.hold ?? 0, Math.max(0, dur - a - 0.01));
      if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let tail: AudioNode = src;
      if (s.filter) {
        const flt = ctx.createBiquadFilter();
        flt.type = s.filter.type;
        flt.Q.value = s.filter.q ?? 1;
        flt.frequency.setValueAtTime(Math.max(10, s.filter.f0), t);
        if (s.filter.f1 !== undefined) {
          flt.frequency.exponentialRampToValueAtTime(Math.max(10, s.filter.f1), t + dur);
        }
        tail.connect(flt);
        tail = flt;
      }
      tail.connect(g);
      g.connect(bus);
      if (loop) {
        src.start(t);
      } else {
        // random start offset = variety, clamped so offset + dur*rate stays
        // inside the shared buffer (no premature cut-off on long draws)
        const maxOff = Math.max(0, this.noiseBuf.duration - dur * rate - 0.05);
        src.start(t, Math.random() * maxOff);
      }
      src.stop(t + dur + 0.05);
      src.onended = () => {
        try {
          g.disconnect();
        } catch {
          /* ignore */}
      };
    } catch {
      /* skip silently */}
  }
  /** Plucked note (triangle body + sine partial) used by the music ladders. */
  private pluck(f: number, at: number, g: number, bus: GainNode, dur = 0.8): void {
    this.tone({
      at,
      type: "triangle",
      f0: f,
      dur,
      a: 0.004,
      g,
      bus,
      filter: {
        type: "lowpass",
        f0: 2600,
        q: 0.7
      }
    });
    this.tone({
      at,
      type: "sine",
      f0: f * 2,
      dur: dur * 0.5,
      a: 0.002,
      g: g * 0.3,
      bus
    });
  }
}
export const sfx = new Sfx();