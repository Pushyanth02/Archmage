import * as THREE from "three";

export type PlayerAnim = "idle" | "move" | "dash" | "cast" | "hit" | "death";

export interface AnimPlayOpts {
  /** Cross-fade seconds (default 0.18). */
  fade?: number;
  /** Priority override (defaults to the state's table priority). */
  priority?: number;
  /** Playback rate (default 1; the dash fallback runs Running_A at 1.35). */
  speed?: number;
}

/* ARCHMAGE: RIFTBOUND (3D Edition) — player animation controller (plan §5).
   Production THREE port of the plan's Babylon sketch: cross-fades, a priority
   table with cancellation rules, one-shot auto-return, missing-clip fallbacks
   and a dual-axis locomotion blend (idle + run always playing, smoothed
   moveWeight — the exact easing the engine used before).

   Layer model (weights always sum to ≤ 1):
     locomotion substrate: idle (1 - moveW) + move (moveW), BOTH looping
     action overlay:       dash | cast | hit | one at a time, faded in over
                           `fade` seconds while the substrate fades out

   Priority table:   death 4 > hit 3 > cast 2 > dash 1.5 > locomotion 1
   Cancellation:     a request with priority >= the current action's interrupts
                     it; death locks everything; hit interrupts cast; cast does
                     NOT interrupt hit (2 < 3 is rejected by the table itself).

   CLIP-BANK AUDIT (10-d, conservative — no mapping changes): the KayKit bank
   (anims.glb, 15 clips) maps to this controller as
     idle=Idle_A · move=Running_A · dash=Running_B · cast=Throw · hit=Hit_A ·
     death=Death_A (engine.buildMageModel).
   The remaining 9 clips were reviewed for the player and deliberately left
   unmapped: Walking_A/Walking_B (the controller is a dual-axis idle/run blend
   — a walk gait would change the movement feel, out of conservative scope),
   Idle_B (idle variety needs a state machine/timer layer, not a swap), Hit_B
   (Hit_A is established and reads correctly), Spawn_Ground (no player spawn
   moment — runs start with a banner, not a ground rise), Use_Item / PickUp /
   Interact (no corresponding gameplay moment; glyph pickup is a magnet + HUD
   beat, interrupting locomotion for it would feel wrong), Death_B (Death_A is
   the wired collapse and the engine's death path plays it under the 1.3s
   slow-mo — verified). The player death path (engine.playerDeath) plays the
   locked "death" one-shot exactly as designed; no change needed.

   This module imports THREE only (architecture contract). */

export const ANIM_PRIORITY: Record<PlayerAnim, number> = {
  death: 4,
  hit: 3,
  cast: 2,
  dash: 1.5,
  move: 1,
  idle: 1
};
export const ANIM_DEFAULT_FADE = 0.18;
export const ANIM_MOVE_SMOOTH = 9;

interface ActionSlot {
  state: PlayerAnim;
  action: THREE.AnimationAction;
  priority: number;
  /** true = LoopOnce + clampWhenFinished + auto-return when finished. */
  oneShot: boolean;
  /** Current visual weight (ramped toward 1 while playing, 0 when retiring). */
  weight: number;
  /** Linear ramp rate = 1 / fade. */
  fadeRate: number;
}

/** Clip bank given to the controller — null/missing entries fall back
 *  (that state is simply unavailable and requests for it are ignored). */
export type AnimClipBank = { [K in PlayerAnim]?: THREE.AnimationClip | null };

export class AnimationController {
  readonly mixer: THREE.AnimationMixer;

  private readonly actions: Partial<Record<PlayerAnim, THREE.AnimationAction | undefined>> = {};
  private current: ActionSlot | null = null;
  private retiring: ActionSlot | null = null;
  /** Death played — every further request is ignored until reset(). */
  private deathLocked = false;
  /** Locomotion-dash fallback active (no Running_B clip): the MOVE action is
  *  running at 1.35× and must be restored when the dash ends. */
  private dashBoost = false;
  private moveW = 0;
  private moveTarget = 0;
  constructor(mixer: THREE.AnimationMixer, clips: AnimClipBank) {
    this.mixer = mixer;
    const make = (clip: THREE.AnimationClip | null | undefined, loop: boolean): THREE.AnimationAction | undefined => {
      if (!clip) return undefined;
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      if (!loop) a.clampWhenFinished = true;
      return a;
    };
    this.actions.idle = make(clips.idle, true);
    this.actions.move = make(clips.move, true);
    this.actions.dash = make(clips.dash, true); // Running_B; fallback handled in play()
    this.actions.cast = make(clips.cast, false);
    this.actions.hit = make(clips.hit, false);
    this.actions.death = make(clips.death, false);
    mixer.addEventListener("finished", this.onFinished);
    /* locomotion starts immediately (same as the old rig bootstrap) */
    this.actions.idle?.reset().play();
    this.actions.idle?.setEffectiveWeight(1);
    this.actions.move?.reset().play();
    this.actions.move?.setEffectiveWeight(0);
  }
  /* ------------------------------- state -------------------------------- */ /** Action currently overlaying locomotion (null = pure locomotion). */
  get active(): PlayerAnim | null {
    return this.current?.state ?? null;
  }
  get isDeathLocked(): boolean {
    return this.deathLocked;
  }
  /** Current smoothed locomotion blend (0 = idle, 1 = run). */
  get moveWeight(): number {
    return this.moveW;
  }
  /* ------------------------------- control ------------------------------ */ /** Set the locomotion blend target (0 = idle, 1 = run). Smoothed in
                                                                               *  update() at ANIM_MOVE_SMOOTH — the engine calls this every frame with
                                                                               *  0/1 intent, exactly like the old runWeight code. */
  setMoveWeight(w: number): void {
    this.moveTarget = Math.min(1, Math.max(0, w));
  }
  /** Request a state. Honors the priority table + cancellation rules;
  *  requests for missing clips are ignored and the previous state keeps
  *  running. */
  play(state: PlayerAnim, opts?: AnimPlayOpts): void {
    if (this.deathLocked) return; // death locks everything
    const priority = opts?.priority ?? ANIM_PRIORITY[state];
    if (this.current && priority < this.current.priority) return; // rejected
    if (state === "idle" || state === "move") {
      /* Locomotion requests are the substrate — they can never interrupt an
      action (every action outranks them), they just retarget the blend. */
      if (this.current) return;
      this.setMoveWeight(state === "move" ? 1 : 0);
      return;
    }
    if (state === "dash" && !this.actions.dash) {
      /* No Running_B clip — fall back to Running_A at 1.35× as a locomotion
      boost (same clip the move state uses, so the dash is a speed-up of
      the run cycle, restored by stop("dash") or any higher interrupt). */
      if (!this.actions.move) return;
      this.retireCurrent();
      this.clearDashBoost();
      this.dashBoost = true;
      this.actions.move.timeScale = opts?.speed ?? 1.35;
      this.moveTarget = 1;
      return;
    }
    this.startAction(state, priority, opts);
  }
  /** Explicitly end a loop action (dash) or cancel a one-shot early,
  *  regardless of priority — the player-controlled "I'm done dashing" path. */
  stop(state: PlayerAnim): void {
    if (this.current?.state === state) this.retireCurrent();
    if (state === "dash") this.clearDashBoost();
  }
  /** Fresh-run reset (preserves the old resetPlayerAnim semantics): stop every
  *  one-shot, clear the death lock, restart idle/run at weights 1/0. */
  reset(): void {
    this.current?.action.stop();
    this.current = null;
    this.retiring?.action.stop();
    this.retiring = null;
    this.clearDashBoost();
    this.deathLocked = false;
    for (const key of Object.keys(this.actions) as PlayerAnim[]) {
      this.actions[key]?.reset().stop();
    }
    this.moveW = 0;
    this.moveTarget = 0;
    this.actions.idle?.reset().play();
    this.actions.idle?.setEffectiveWeight(1);
    this.actions.move?.reset().play();
    this.actions.move?.setEffectiveWeight(0);
  }
  /* -------------------------------- core -------------------------------- */
  private startAction(state: PlayerAnim, priority: number, opts?: AnimPlayOpts): void {
    const action = this.actions[state];
    if (!action) return; // missing clip — request ignored, previous keeps running
    this.retireCurrent();
    this.clearDashBoost();
    const fade = Math.max(0.001, opts?.fade ?? ANIM_DEFAULT_FADE);
    const speed = opts?.speed ?? 1;
    action.reset();
    action.timeScale = speed;
    action.setEffectiveWeight(0);
    action.play();
    this.current = {
      state,
      action,
      priority,
      oneShot: state !== "dash",
      weight: 0,
      fadeRate: 1 / fade
    };
    if (state === "death") this.deathLocked = true;
  }
  /** Move the current action to the retiring slot (fade out over its fade
  *  time while the next action fades in — a true cross-fade). */
  private retireCurrent(): void {
    if (!this.current) return;
    if (this.retiring) this.retiring.action.stop(); // only one retirement in flight
    this.retiring = this.current;
    this.current = null;
  }
  private clearDashBoost(): void {
    if (!this.dashBoost) return;
    this.dashBoost = false;
    if (this.actions.move) this.actions.move.timeScale = 1;
  }
  /** One-shots auto-return to the best locomotion state when they finish
  *  (the maintained moveWeight picks idle vs run) — death holds its clamp. */
  private onFinished = (e: { action: THREE.AnimationAction }): void => {
    const c = this.current;
    if (!c || e.action !== c.action || c.state === "death") return;
    if (c.oneShot) this.retireCurrent();
  };
  /** Advance the whole stack. Call once per rendered frame. */
  update(dt: number): void {
    /* locomotion blend smoothing (previous engine behavior: approach @ 9/s) */this.moveW += (this.moveTarget - this.moveW) * Math.min(1, dt * ANIM_MOVE_SMOOTH);
    /* retiring overlay fades out, then stops */
    if (this.retiring) {
      this.retiring.weight -= dt * this.retiring.fadeRate;
      if (this.retiring.weight <= 0) {
        this.retiring.action.stop();
        this.retiring = null;
      } else {
        this.retiring.action.setEffectiveWeight(this.retiring.weight);
      }
    }
    /* current overlay ramps in */
    let actionW = 0;
    if (this.current) {
      const c = this.current;
      c.weight = Math.min(1, c.weight + dt * c.fadeRate);
      c.action.setEffectiveWeight(c.weight);
      actionW = c.weight;
    }
    /* substrate fades out as the overlay takes over (weights sum to 1) */
    const locW = 1 - actionW;
    this.actions.idle?.setEffectiveWeight(locW * (1 - this.moveW));
    this.actions.move?.setEffectiveWeight(locW * this.moveW);
    this.mixer.update(dt);
  }
  dispose(): void {
    this.mixer.removeEventListener("finished", this.onFinished);
    this.mixer.stopAllAction();
    this.current = null;
    this.retiring = null;
    this.clearDashBoost();
    for (const key of Object.keys(this.actions) as PlayerAnim[]) {
      const a = this.actions[key];
      if (a) this.mixer.uncacheClip(a.getClip());
      delete this.actions[key];
    }
  }
}