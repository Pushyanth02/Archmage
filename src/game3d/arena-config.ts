/* ARCHMAGE: RIFTBOUND (3D Edition) — canonical arena configuration (audit F-04).
   THE single source of truth for every arena dimension. arena.ts (renderer),
   engine.ts (simulation/spawns/aim), entities.ts (collision contexts) and the
   validation harnesses all derive from these values — no module may re-declare
   a hard-coded arena radius.

   Provisional target per the audit: playable radius 50 units (from 42) —
   ~42% more playable ground for a circular arena. Derived dimensions grow
   with it, but obstacle density does NOT scale blindly with area: the central
   combat ring stays readable and only the outer band grows meaningfully. */

/** Playable radius — the fence line. Player/foe/projectile clamps, spawn
 *  bands, obstacle placement bounds and every perimeter visual derive from
 *  this. Change HERE and nowhere else. */
export const ARENA_RADIUS = 50;

/** Visual ground disc overshoot past the fence (world units). */
export const GROUND_OVERSHOOT = 4;
/** Visual ground disc radius (ground mesh + baked vignette normalization). */
export const GROUND_RADIUS = ARENA_RADIUS + GROUND_OVERSHOOT;

/** Energy-fence height (world units). */
export const FENCE_HEIGHT = 3.2;
/** Approximate arc length between fence studs — post density stays constant
 *  as the radius grows (the stud COUNT is derived, never hard-coded). */
export const FENCE_STUD_SPACING = 7.15;
/** Derived fence stud count for the current radius. */
export const FENCE_STUD_COUNT = Math.max(24, Math.round((Math.PI * 2 * ARENA_RADIUS) / FENCE_STUD_SPACING));

/** Player body margin used by engine clamps/blink/obstacle pushout. */
export const PLAYER_MARGIN = 0.6;
/** Obstacle scatter band — candidate cluster centers stay inside this band
 *  (grown modestly with the radius; the center clear zone is unchanged). */
export const OBSTACLE_R_MIN = 10;
export const OBSTACLE_R_MAX = ARENA_RADIUS - 10;
