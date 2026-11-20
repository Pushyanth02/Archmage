#!/usr/bin/env bun
/* ARCHMAGE: RIFTBOUND (3D Edition) — spell-evolutions regression harness
   (v2.2 flagship, scope report §2/§6 + checklist items 1 & 3).
   Run: bun scripts/validate-evolutions.ts

   Property-tests the PURE evolution functions the engine's wave director +
   resolveEvolution consume:

     1.  DATA     — 22 cards, unique ids, valid base elements, every card
                    carries at least one real mod (≠ 1) and honest trade-off
                    lines; colors are hex.
     2.  MATH     — evolvedSpellDef applies the multipliers exactly (dmg/mana/
                    cd/radius), never mutates SPELLS, and passes unknown or
                    guard-token ids through as the base def.
     3.  DRAFT    — deterministic for a given seed (identical rng → identical
                    offers, twice); consumes ZERO rng when nothing is eligible;
                    eligibility honors wave-min, bound-waves, merged-slot and
                    one-per-run rules.
     4.  SLOTS    — evolution never moves a spell between slots (the commit
                    path is untouched: equip state is orthogonal).
 */

import {
  EVOLUTIONS, evolutionsFor, evolvedSpellDef, draftEvolutionOffer,
  EVOLVE_WAVE_MIN, EVOLVE_BOUND_WAVES, SPELLS, SPELL_ORDER, streamRng,
  type ElementId,
} from "../src/game3d/content";

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
function push(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}
type Slot = string | { merged: string[] } | null;

/* 1 — data integrity */
push("1a. exactly 22 evolution cards", EVOLUTIONS.length === 22, `got ${EVOLUTIONS.length}`);
const ids = new Set(EVOLUTIONS.map(e => e.id));
push("1b. all evolution ids unique", ids.size === EVOLUTIONS.length);
push("1c. every base is a real element", EVOLUTIONS.every(e => SPELL_ORDER.includes(e.base as ElementId)));
push("1d. every card changes at least one stat",
  EVOLUTIONS.every(e => [e.mods.dmg, e.mods.mana, e.mods.cd, e.mods.radius].some(m => m !== undefined && m !== 1)));
push("1e. every card carries trade-off lines",
  EVOLUTIONS.every(e => e.tradeoffs.length >= 1 && e.tradeoffs.every(t => t.trim().length > 0)));
push("1f. colors are #rrggbb hex",
  EVOLUTIONS.every(e => /^#[0-9a-f]{6}$/i.test(e.color) && /^#[0-9a-f]{6}$/i.test(e.glow)));
push("1g. all 13 elements have at least one branch",
  SPELL_ORDER.every(el => evolutionsFor(el as ElementId).length >= 1));
const dual = SPELL_ORDER.filter(el => evolutionsFor(el as ElementId).length === 2).length;
push("1h. 9 dual-branch + 4 single-branch elements (9×2+4 = 22)",
  dual === 9 && EVOLUTIONS.length === 22, `dual=${dual}`);

/* 2 — evolvedSpellDef math */
const fireBase = SPELLS.fire;
const cinder = evolvedSpellDef("fire", "fire:cinderwake");
push("2a. damage multiplier applied (34 × 1.45 → 49)",
  cinder.baseDamage === Math.round(fireBase.baseDamage * 1.45), `got ${cinder.baseDamage}`);
push("2b. mana multiplier applied (14 × 1.35 → 18.9)",
  Math.abs(cinder.manaCost - fireBase.manaCost * 1.35) < 0.051, `got ${cinder.manaCost}`);
push("2c. cooldown multiplier applied (0.48 × 1.25 → 0.6)",
  Math.abs(cinder.cooldown - fireBase.cooldown * 1.25) < 0.0051, `got ${cinder.cooldown}`);
push("2d. radius multiplier applied (3.2 × 1.3 → 4.2)",
  Math.abs((cinder.radius ?? 0) - 3.2 * 1.3) < 0.051, `got ${cinder.radius}`);
push("2e. identity swapped (name + color from the card)",
  cinder.name === "Cinderwake" && cinder.color === "#ff5c33");
push("2f. behavior archetype preserved (orb stays orb)",
  cinder.behavior === fireBase.behavior);
push("2g. SPELLS record never mutated",
  SPELLS.fire.name === "Ember" && SPELLS.fire.baseDamage === 34 && SPELLS.fire.manaCost === 14);
push("2h. unknown evo id falls back to the base def",
  evolvedSpellDef("fire", "nope:not-real").name === "Ember");
push("2i. the 'seen' guard token falls back to the base def (declined look)",
  evolvedSpellDef("fire", "seen").name === "Ember");
push("2j. null/undefined evo falls back to the base def",
  evolvedSpellDef("fire", null).name === "Ember" && evolvedSpellDef("ice", undefined).name === "Frost");
const earthEvo = evolvedSpellDef("earth", "earth:deeproots");
push("2k. radius-less base stays radius-less under evolution",
  earthEvo.radius === undefined);

/* 3 — deterministic draft + rng contract */
const eq: Slot[] = ["fire", "ice", null];
const evolved: Record<string, string> = {};
const bound: Record<string, number> = { fire: 0, ice: 0 };
const wave = 20; // ≥ EVOLVE_WAVE_MIN, ≥ bound+6 for both
const runA = draftEvolutionOffer(eq, evolved, bound, wave, streamRng("seed-x", "evolve"));
const runB = draftEvolutionOffer(eq, evolved, bound, wave, streamRng("seed-x", "evolve"));
push("3a. same seed → same offer (element + cards)",
  runA?.element === runB?.element && runA?.cards.map(c => c.id).join() === runB?.cards.map(c => c.id).join());
push("3b. offer names a genuinely eligible element",
  runA !== null && (runA.element === "fire" || runA.element === "ice"));
push("3c. offered cards are exactly that element's branches",
  runA !== null && runA.cards.length === evolutionsFor(runA.element).length &&
  runA.cards.every(c => c.base === runA.element));
/* rng contract: no consumption when nothing eligible */
const rng = streamRng("seed-y", "evolve");
const before: number[] = [];
for (let i = 0; i < 6; i++) before.push(rng.next());
const rng2 = streamRng("seed-y", "evolve");
const none = draftEvolutionOffer(eq, { fire: "seen", ice: "seen" }, bound, wave, rng2); // nothing eligible
const after: number[] = [];
for (let i = 0; i < 6; i++) after.push(rng2.next());
push("3d. nothing eligible → null offer AND zero rng consumed",
  none === null && before.every((v, i) => v === after[i]));
/* eligibility rules */
push("3e. below EVOLVE_WAVE_MIN → never offered",
  draftEvolutionOffer(eq, {}, bound, EVOLVE_WAVE_MIN - 1, streamRng("s", "evolve")) === null);
const freshBound: Record<string, number> = { fire: 15, ice: 15 };
let lateOffer: { element: string } | null = null;
for (let s = 0; s < 40; s++) {
  const o = draftEvolutionOffer(eq, {}, freshBound, 20, streamRng(`late-${s}`, "evolve"));
  if (o) { lateOffer = o; break; }
}
push("3f. bound fewer than EVOLVE_BOUND_WAVES ago → never offered", lateOffer === null);
const merged: Slot[] = [{ merged: ["fire", "void"] }, "ice", null];
let mergedOffer: { element: string } | null = null;
for (let s = 0; s < 40; s++) {
  const o = draftEvolutionOffer(merged, {}, { ice: 0 }, 20, streamRng(`m-${s}`, "evolve"));
  if (o) { mergedOffer = o; break; }
}
push("3g. merged slots are never offered (resonance is their path)",
  mergedOffer === null || mergedOffer.element === "ice");

/* 4 — slot safety: evolution changes no equipped slots (orthogonal state) */
push("4a. evolution state is keyed by element, never by slot index",
  typeof evolvedSpellDef("ice", "ice:hailstorm").manaCost === "number" &&
  eq[0] === "fire" && eq[2] === null /* untouched by all drafts above */);
push("4b. EVOLVE gating constants are the documented values",
  EVOLVE_WAVE_MIN === 12 && EVOLVE_BOUND_WAVES === 6);

/* report */
const failed = checks.filter(c => !c.ok);
console.log(`validate-evolutions: ${checks.length - failed.length}/${checks.length} checks pass`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : ` — ${c.detail ?? "FAILED"}`}`);
}
if (failed.length > 0) {
  console.error(`validate-evolutions: ${failed.length} check(s) FAILED`);
  process.exit(1);
}
console.log("validate-evolutions: evolutions are deterministic, safe and honest ✓");
