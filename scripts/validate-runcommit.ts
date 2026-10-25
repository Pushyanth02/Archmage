#!/usr/bin/env bun
/* ARCHMAGE: RIFT 3D — run-result banking idempotency gate (audit P1-1).
   Run: bun scripts/validate-runcommit.ts

   Exercises the exactly-once payout contract with the REAL functions:
     - shouldCommit (store.ts): a runId:kind pair banks exactly once.
     - computeRunCommit (content.ts):
       * death: full stats bank, runs+1, mercyDeaths+1
       * victory: payout banks, victories+1, mercy reset
       * endless-death: ONLY the post-victory delta banks (kills/damage/time
         are the delta's, runs NOT incremented, no second mercy death)
     - duplicate emissions (victory twice, death replay after victory) are
       suppressed by the guard before computeRunCommit ever runs. */

import { computeRunCommit, DEFAULT_META } from "../src/game3d/content";
import { shouldCommit } from "../src/game3d/store";

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
function push(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

const base = { ...DEFAULT_META, upgrades: { ...DEFAULT_META.upgrades }, settings: { ...DEFAULT_SETTINGS_COPY() } };
function DEFAULT_SETTINGS_COPY() {
  return { ...DEFAULT_META.settings };
}

function stats(kind: "death" | "victory" | "endless-death", over: Partial<Record<string, unknown>> = {}) {
  return {
    wave: 23, score: 10_000, kills: 240, damage: 90_000, timeSec: 900,
    glyphs: 40, triumph: kind === "victory", endless: kind === "endless-death",
    newCombos: ["fire+ice"], bossesSlain: ["vorrac"], bestResonance: "fire+ice",
    seed: "test-seed", runId: "run-1", kind, payout: 10, delta: null,
    ...over,
  } as import("../src/game3d/types").RunStats;
}

/* --- 1. shouldCommit: exactly-once per runId:kind ------------------------- */
{
  const seen = new Set<string>();
  const v = stats("victory");
  const first = shouldCommit(seen, v);
  const dup = shouldCommit(seen, v);
  const other = shouldCommit(seen, stats("endless-death"));
  push("shouldCommit: first victory commits", first === true);
  push("shouldCommit: duplicate victory suppressed", dup === false);
  push("shouldCommit: endless-death of the same run commits (different kind)", other === true);
  push("shouldCommit: endless-death replay suppressed", shouldCommit(seen, stats("endless-death")) === false);
  const fresh = shouldCommit(seen, { ...stats("death"), runId: "run-2" });
  push("shouldCommit: a NEW run's death commits (fresh runId)", fresh === true);
}

/* --- 2. computeRunCommit: death path ------------------------------------- */
{
  const next = computeRunCommit(base, stats("death"));
  push("death: runs +1", next.runs === base.runs + 1, `${next.runs}`);
  push("death: kills banked", next.totalKills === base.totalKills + 240);
  push("death: damage banked", next.totalDamage === base.totalDamage + 90_000);
  push("death: time banked", next.totalTimeSec === base.totalTimeSec + 900);
  push("death: shards += payout", next.shards === base.shards + 10);
  push("death: mercyDeaths +1", next.mercyDeaths === base.mercyDeaths + 1);
  push("death: newCombos recorded", next.combosFound.includes("fire+ice"));
}

/* --- 3. computeRunCommit: victory path ------------------------------------ */
{
  const next = computeRunCommit(base, stats("victory", { wave: 50, payout: 40 }));
  push("victory: victories +1", next.victories === base.victories + 1);
  push("victory: payout banks (100%)", next.shards === base.shards + 40);
  push("victory: bestWave = 50", next.bestWave === 50);
  push("victory: mercy resets to -1", next.mercyTierSel === -1);
  push("victory: mercyDeaths unchanged", next.mercyDeaths === base.mercyDeaths);
}

/* --- 4. computeRunCommit: endless-death banks ONLY the delta -------------- */
{
  const after = computeRunCommit(base, stats("victory", { wave: 50, payout: 40 }));
  const endless = stats("endless-death", {
    wave: 67, score: 20_000, kills: 900, damage: 400_000, timeSec: 3_000, glyphs: 120, payout: 25,
    delta: { kills: 60, damage: 12_000, timeSec: 240, glyphs: 8, score: 3_000 },
  });
  const next = computeRunCommit(after, endless);
  push("endless-death: runs NOT incremented again", next.runs === after.runs, `${next.runs}`);
  push("endless-death: only delta kills bank", next.totalKills === after.totalKills + 60, `${next.totalKills}`);
  push("endless-death: only delta damage bank", next.totalDamage === after.totalDamage + 12_000);
  push("endless-death: only delta time bank", next.totalTimeSec === after.totalTimeSec + 240);
  push("endless-death: endless payout banks", next.shards === after.shards + 25);
  push("endless-death: bestEndless tracks 67", next.bestEndless === 67);
  push("endless-death: a real fall banks mercyDeaths (recovered design)", next.mercyDeaths === after.mercyDeaths + 1);
  // missing delta on endless-death → zero contribution (defensive default)
  const nod = computeRunCommit(after, stats("endless-death", { delta: null, wave: 70, payout: 5 }));
  push("endless-death: missing delta contributes nothing", nod.totalKills === after.totalKills && nod.totalDamage === after.totalDamage);
}

/* --- 5. the exact UI flow: victory then endless death banks exactly once --- */
{
  const seen = new Set<string>();
  let meta = base;
  const emissions = [
    stats("victory", { wave: 50, payout: 40 }),
    stats("victory", { wave: 50, payout: 40 }), // stray replay
    stats("endless-death", { wave: 61, payout: 12, delta: { kills: 10, damage: 1_000, timeSec: 60, glyphs: 2, score: 500 } }),
    stats("endless-death", { wave: 61, payout: 12, delta: { kills: 10, damage: 1_000, timeSec: 60, glyphs: 2, score: 500 } }), // replay
  ];
  let commits = 0;
  for (const e of emissions) {
    if (shouldCommit(seen, e)) {
      meta = computeRunCommit(meta, e);
      commits++;
    }
  }
  push("flow: exactly 2 of 4 emissions committed", commits === 2, `${commits}`);
  push("flow: total shards = 40 + 12", meta.shards === base.shards + 52, `${meta.shards}`);
  push("flow: runs = 1 (victory; endless-death adds none)", meta.runs === base.runs + 1);
  push("flow: victories = 1", meta.victories === base.victories + 1);
}

/* --- report --------------------------------------------------------------- */
let pass = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (c.ok) pass++;
}
console.log(`\nRESULT: ${pass === checks.length ? "PASS" : "FAIL"} — ${pass}/${checks.length} run-commit checks`);
if (pass !== checks.length) process.exit(1);
