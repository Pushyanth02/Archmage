#!/usr/bin/env bun
/* ARCHMAGE: RIFTBOUND (3D Edition) — mute lifecycle regression harness
   (v2.0 audit R-03).  Run: bun scripts/validate-audio-mute.ts

   Drives the REAL Sfx class headlessly against a FakeAudioContext that
   implements the exact node/param API surface audio.ts touches (gains,
   oscillators, filters, compressor, buffers, sources) while COUNTING every
   scheduled thing: nodes created, sources started/stopped, intervals
   created/cleared, and master-gain automation targets.

   Scenarios:
     1.  One-shot entry points (play/click/hover) create ZERO nodes while
         muted — no audio work is scheduled at all.
     2.  Muting tears down the live music + ambience layers (timers cleared
         synchronously, sources stopped).
     3.  Nothing can be scheduled while muted — musicMenu/musicCombat/
         setAmbienceMood during mute build no layers.
     4.  Unmute restores EXACTLY ONE music layer of the desired mood and the
         ambience layer of the desired act — no duplicates.
     5.  Ten rapid mute/unmute toggles never accumulate timers or live
         sources; exactly one layer pair survives.
     6.  musicStop() while muted ⇒ unmute restores nothing.
     7.  Mute BEFORE the context exists (persisted mute at boot): the first
         resume() starts nothing; unmuting then starts the desired mood.
     8.  setVolumes() while muted never raises the master gain above zero.
     9.  Ambience act + level survive a mute round-trip.
*/

/* The Sfx module reaches for `window.*` (timers) and `AudioContext` — bun
   has neither, so we provide both BEFORE the dynamic import below. */
const fakeWindow = globalThis as unknown as { setInterval: typeof setInterval };
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = fakeWindow;
}

/* ----------------------------- fake audio ------------------------------- */
class FakeParam {
  value = 0;
  targets: number[] = [];
  setValueAtTime(_v: number, _t: number): void {}
  linearRampToValueAtTime(_v: number, _t: number): void {}
  exponentialRampToValueAtTime(_v: number, _t: number): void {}
  setTargetAtTime(v: number, _t: number, _c: number): void {
    this.targets.push(v);
    this.value = v;
  }
  cancelScheduledValues(_t: number): void {}
}
class FakeNode {
  inputs: FakeNode[] = [];
  connect(n: FakeNode): FakeNode {
    this.inputs.push(n);
    return n;
  }
  disconnect(): void {
    this.inputs.length = 0;
  }
}
class FakeSource extends FakeNode {
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.onended?.();
  }
}
interface HarnessStats {
  nodes: number;
  sources: FakeSource[];
  timersCreated: number;
  timersCleared: number;
  liveTimers: Set<unknown>;
}
const stats: HarnessStats = { nodes: 0, sources: [], timersCreated: 0, timersCleared: 0, liveTimers: new Set() };
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode();
  constructor(_opts?: unknown) {
    stats.nodes++;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createGain(): { gain: FakeParam } & FakeNode {
    stats.nodes++;
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createDynamicsCompressor(): FakeNode & Record<string, FakeParam> {
    stats.nodes++;
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    } as Record<string, FakeParam>);
  }
  createBiquadFilter(): FakeNode & { frequency: FakeParam; Q: FakeParam; detune: FakeParam; type: string } {
    stats.nodes++;
    return Object.assign(new FakeNode(), {
      frequency: new FakeParam(),
      Q: new FakeParam(),
      detune: new FakeParam(),
      type: "lowpass",
    });
  }
  createOscillator(): FakeSource & { type: string; frequency: FakeParam; detune: FakeParam } {
    stats.nodes++;
    const src = Object.assign(new FakeSource(), {
      type: "sine",
      frequency: new FakeParam(),
      detune: new FakeParam(),
    });
    stats.sources.push(src);
    return src;
  }
  createBuffer(ch: number, len: number, _rate: number): { getChannelData(): Float32Array } {
    stats.nodes++;
    return { getChannelData: () => new Float32Array(len * ch) };
  }
  createBufferSource(): FakeSource & { buffer: unknown; playbackRate: FakeParam } {
    stats.nodes++;
    const src = Object.assign(new FakeSource(), { buffer: null, playbackRate: new FakeParam() });
    stats.sources.push(src);
    return src;
  }
}
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;

/* timer instrumentation (window.setInterval / clearInterval / setTimeout) */
const realSetInterval = globalThis.setInterval.bind(globalThis) as (fn: TimerHandler, ms?: number) => unknown;
const realClearInterval = globalThis.clearInterval.bind(globalThis) as (id: unknown) => void;
globalThis.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
  const id = realSetInterval(fn, ms);
  stats.timersCreated++;
  stats.liveTimers.add(id);
  return id;
}) as typeof setInterval;
globalThis.clearInterval = ((id: unknown) => {
  realClearInterval(id);
  if (stats.liveTimers.delete(id)) stats.timersCleared++;
}) as typeof clearInterval;

const liveSources = () => stats.sources.filter(s => s.started && !s.stopped).length;

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
function push(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

async function main() {
  const { Sfx } = await import("../src/game3d/audio");
  const sfx = new Sfx();
  const anySfx = sfx as unknown as {
    currentMood: string | null;
    currentAmbience: number | null;
    ambienceLevel: number;
    layer: { dead: boolean; mood?: string } | null;
    ambienceLayer: { dead: boolean } | null;
    master: { gain: FakeParam } | null;
  };

  /* 1 — one-shots gated while muted (before any context exists, then after) */
  sfx.setMuted(true);
  sfx.play("cast", { intensity: 1 });
  sfx.click();
  sfx.hover();
  push("1a. one-shots schedule nothing while muted (no ctx)", stats.nodes === 0, `nodes=${stats.nodes}`);
  sfx.resume(); // gesture → context builds, pending mood starts NOTHING (muted)
  await 0;
  const nodesAfterResume = stats.nodes;
  push("1b. first gesture under persisted mute starts no layer", liveSources() === 0 && nodesAfterResume > 0,
    `nodes=${nodesAfterResume} liveSources=${liveSources()}`);
  sfx.play("cast", { intensity: 1 });
  sfx.click();
  sfx.hover();
  push("1c. one-shots schedule nothing while muted (live ctx)", stats.nodes === nodesAfterResume,
    `nodes=${stats.nodes}`);

  /* 7 — muted boot: desired mood recorded, restored on unmute */
  sfx.musicMenu(); // requested while muted → desired state only
  push("7a. musicMenu while muted records the desired mood", anySfx.currentMood === "menu", `mood=${anySfx.currentMood}`);
  push("7b. musicMenu while muted schedules nothing", liveSources() === 0, `liveSources=${liveSources()}`);
  sfx.setMuted(false); // unmute → menu music starts
  push("7c. unmute restores the desired mood as a live layer",
    anySfx.layer !== null && !anySfx.layer.dead && anySfx.layer.mood === "menu" && liveSources() > 0,
    `liveSources=${liveSources()}`);

  /* 2 — muting tears the live layers down */
  sfx.setAmbienceMood(2, 0.55);
  const timersBefore = stats.liveTimers.size;
  const sourcesBefore = liveSources();
  push("2a. layers alive before mute", timersBefore >= 2 && sourcesBefore > 0,
    `timers=${timersBefore} liveSources=${sourcesBefore}`);
  sfx.setMuted(true);
  push("2b. mute kills the music layer", anySfx.layer === null || anySfx.layer.dead, `layer=${JSON.stringify(anySfx.layer?.dead)}`);
  push("2c. mute kills the ambience layer", anySfx.ambienceLayer === null || anySfx.ambienceLayer.dead);
  push("2d. mute clears every scheduler timer", stats.liveTimers.size === 0,
    `liveTimers=${stats.liveTimers.size}`);

  /* 3 — nothing can be scheduled while muted */
  const nodesWhileMuted = stats.nodes;
  const srcWhileMuted = liveSources();
  sfx.musicCombat();
  sfx.musicBoss();
  sfx.setAmbienceMood(4, 1);
  sfx.play("boss", { intensity: 1 });
  push("3. mood/ambience/sfx requests during mute schedule nothing",
    stats.nodes === nodesWhileMuted && liveSources() === srcWhileMuted && anySfx.currentMood === "boss",
    `mood=${anySfx.currentMood} act=${anySfx.currentAmbience}`);

  /* 4 + 9 — unmute restores exactly one correct layer pair */
  sfx.setMuted(false);
  const liveTimersAfterUnmute = stats.liveTimers.size;
  push("4a. unmute rebuilds exactly one music layer (boss, from §3)",
    anySfx.layer !== null && !anySfx.layer.dead && anySfx.layer.mood === "boss",
    `mood=${anySfx.layer?.mood}`);
  push("4b. unmute rebuilds the ambience layer of the desired act",
    anySfx.ambienceLayer !== null && !anySfx.ambienceLayer.dead && anySfx.currentAmbience === 4,
    `act=${anySfx.currentAmbience}`);
  /* 9 — isolated level round-trip: request a NEW act+level while unmuted,
   *  then mute/unmute with nothing in between (§3 legitimately re-set the
   *  desired level to 1 — that's desired-state tracking, not a leak). */
  sfx.setAmbienceMood(5, 0.4);
  sfx.setMuted(true);
  sfx.setMuted(false);
  push("9. ambience act + level survive an isolated mute round-trip",
    anySfx.currentAmbience === 5 && anySfx.ambienceLevel === 0.4 && anySfx.ambienceLayer !== null && !anySfx.ambienceLayer.dead,
    `act=${anySfx.currentAmbience} level=${anySfx.ambienceLevel}`);
  push("4c. exactly two scheduler timers run after unmute (music + ambience)",
    liveTimersAfterUnmute === 2, `timers=${liveTimersAfterUnmute}`);

  /* 5 — toggle storm */
  for (let i = 0; i < 10; i++) {
    sfx.setMuted(true);
    sfx.setMuted(false);
  }
  push("5a. ten rapid toggles leave exactly one music layer",
    anySfx.layer !== null && !anySfx.layer.dead && anySfx.layer.mood === "boss");
  push("5b. ten rapid toggles leave exactly one ambience layer",
    anySfx.ambienceLayer !== null && !anySfx.ambienceLayer.dead);
  push("5c. toggle storm clears every interim timer (no accumulation)",
    stats.liveTimers.size === 2, `liveTimers=${stats.liveTimers.size} created=${stats.timersCreated} cleared=${stats.timersCleared}`);

  /* 6 — musicStop while muted ⇒ unmute restores nothing */
  sfx.setMuted(true);
  sfx.musicStop();
  sfx.setAmbienceMood(null);
  sfx.setMuted(false);
  push("6. musicStop during mute ⇒ unmute starts no layer",
    (anySfx.layer === null || anySfx.layer.dead) && liveSources() === 0,
    `layer=${anySfx.layer} liveSources=${liveSources()}`);

  /* 8 — setVolumes can never bypass mute */
  sfx.setMuted(true);
  sfx.musicMenu();
  sfx.setVolumes(0.9, 0.9, 0.9, 0.9);
  const masterParam = anySfx.master?.gain;
  const lastTarget = masterParam ? masterParam.targets[masterParam.targets.length - 1] : undefined;
  push("8. setVolumes while muted keeps the master target at zero", lastTarget === 0,
    `lastMasterTarget=${lastTarget}`);

  /* cleanup — stop everything so the process can exit */
  sfx.musicStop();
  sfx.setAmbienceMood(null);
  for (const id of [...stats.liveTimers]) {
    realClearInterval(id);
  }

  /* report */
  let fail = 0;
  for (const c of checks) {
    if (!c.ok) fail++;
    console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}${c.ok ? "" : ` — ${c.detail ?? "FAILED"}`}`);
  }
  console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"} — ${checks.length - fail}/${checks.length} mute-lifecycle checks`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
