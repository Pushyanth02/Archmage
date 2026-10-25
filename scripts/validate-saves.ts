#!/usr/bin/env bun
/* ARCHMAGE: RIFT 3D — save migration validator (plan §12 "Save migrations
   pass fixtures" + §9 "Error/recovery states for ... invalid save").
   Run: bun scripts/validate-saves.ts

   Exercises the PURE migrateMeta() from src/game3d/content.ts against a
   fixture set (healthy / legacy / corrupt / hostile) and asserts the same
   post-migration invariants for EVERY fixture:
     - version === META_VERSION
     - every numeric field is a finite integer within its clamp
     - upgrades hold exactly the ReliquaryKey allow-list, levels 0..RELIQUARY_MAX_LEVEL
     - string arrays are string[], deduped, trimmed, item+list length capped
     - settings has every GameSettings field with the right type + range
     - prototype hygiene: plain objects, no __proto__/constructor/prototype
       own keys, Object.prototype unpolluted
     - migration is idempotent (migrating a migrated save changes nothing)
   Plus per-fixture deep expectations (healthy saves load identically,
   legacy partials heal, hostile values clamp, corrupt shapes default).
   Prints a per-fixture table report; exits non-zero on any failure. Plain
   script — no test framework, no DOM (migrateMeta is pure by design). */

import {
  DEFAULT_META,
  DEFAULT_SETTINGS,
  MERCY_MAX_TIER,
  META_KEY,
  META_NUM_MAX,
  META_STR_MAX,
  META_VERSION,
  migrateMeta,
  RELIQUARY,
  RELIQUARY_MAX_LEVEL,
  SETTINGS_RANGES,
} from "../src/game3d/content";
import type { MetaSave } from "../src/game3d/content";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface Fixture {
  name: string;
  raw: string; // short description of the raw input
  input: unknown;
  expect?: (m: MetaSave) => Check[]; // fixture-specific deep expectations
}

/* ------------------------------ helpers -------------------------------- */

const FORBIDDEN = ["__proto__", "constructor", "prototype"];
const KNOWN_UPGRADE_KEYS = RELIQUARY.map((d) => d.key).sort().join(",");

function defaultsMeta(): MetaSave {
  return { ...DEFAULT_META, upgrades: { ...DEFAULT_META.upgrades }, settings: { ...DEFAULT_SETTINGS } };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** First differing path between two values (for failure details). */
function diffPath(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  for (const k of new Set([...ka, ...kb])) {
    const d = diffPath(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (d) return d;
  }
  return null;
}

function expectDeep(label: string, got: unknown, want: unknown): Check {
  const ok = deepEqual(got, want);
  return { name: `expect:${label}`, ok, detail: ok ? undefined : (diffPath(got, want) ?? "not deep-equal") };
}

/** Dotted-path field expectations, e.g. { "settings.master": 0.3, runs: 7 }. */
function expectFields(m: MetaSave, expected: Record<string, unknown>): Check[] {
  return Object.entries(expected).map(([path, want]) => {
    let val: unknown = m;
    for (const part of path.split(".")) {
      val = val == null ? undefined : (val as Record<string, unknown>)[part];
    }
    const ok = deepEqual(val, want);
    return {
      name: `expect:${path}`,
      ok,
      detail: ok ? undefined : `${JSON.stringify(val)} !== ${JSON.stringify(want)}`,
    };
  });
}

/* ------------------------- shared invariants ---------------------------- */

function checkInvariants(m: MetaSave, checks: Check[]): void {
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const rec = m as unknown as Record<string, unknown>;

  push("version", m.version === META_VERSION, `expected ${META_VERSION}, got ${JSON.stringify(m.version)}`);

  for (const [field, max] of Object.entries(META_NUM_MAX)) {
    const v = rec[field];
    push(
      `num:${field}`,
      typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= max,
      `${JSON.stringify(v)} not a finite integer in [0, ${max}]`,
    );
  }
  push(
    "num:mercyTierSel",
    typeof m.mercyTierSel === "number" && Number.isInteger(m.mercyTierSel) && m.mercyTierSel >= -1 && m.mercyTierSel <= MERCY_MAX_TIER,
    `${JSON.stringify(m.mercyTierSel)} not an integer in [-1, ${MERCY_MAX_TIER}]`,
  );

  push(
    "upgrades:allow-list",
    Object.keys(m.upgrades).sort().join(",") === KNOWN_UPGRADE_KEYS,
    `keys: ${Object.keys(m.upgrades).sort().join(",") || "(none)"}`,
  );
  for (const def of RELIQUARY) {
    const v = m.upgrades[def.key];
    push(
      `upgrades:${def.key}`,
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= RELIQUARY_MAX_LEVEL,
      `${JSON.stringify(v)} not an integer in [0, ${RELIQUARY_MAX_LEVEL}]`,
    );
  }

  for (const field of ["combosFound", "seenEnemies", "seenBosses"] as const) {
    const arr = rec[field];
    const ok =
      Array.isArray(arr) &&
      arr.length <= META_STR_MAX.list &&
      (arr as unknown[]).every((s) => typeof s === "string" && s.length <= META_STR_MAX.item && s.trim() === s) &&
      new Set(arr).size === arr.length;
    push(`arr:${field}`, ok, `not a deduped trimmed string[] capped at ${META_STR_MAX.list}x${META_STR_MAX.item}`);
  }

  const st = m.settings as unknown as Record<string, unknown>;
  const ds = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  push(
    "settings:field-set",
    Object.keys(st).sort().join(",") === Object.keys(ds).sort().join(","),
    `keys: ${Object.keys(st).sort().join(",")}`,
  );
  for (const key of Object.keys(ds)) {
    if (typeof ds[key] === "number") {
      const [lo, hi] = SETTINGS_RANGES[key] ?? [0, 1];
      push(
        `settings:${key}`,
        typeof st[key] === "number" && Number.isFinite(st[key]) && (st[key] as number) >= lo && (st[key] as number) <= hi,
        `${JSON.stringify(st[key])} not a finite number in [${lo}, ${hi}]`,
      );
    } else if (typeof ds[key] === "boolean") {
      push(`settings:${key}`, typeof st[key] === "boolean", `${JSON.stringify(st[key])} not a boolean`);
    }
  }

  push("proto:meta", Object.getPrototypeOf(m) === Object.prototype, "result must be a plain object");
  push("proto:upgrades", Object.getPrototypeOf(m.upgrades) === Object.prototype, "upgrades must be a plain object");
  push("proto:settings", Object.getPrototypeOf(m.settings) === Object.prototype, "settings must be a plain object");
  push(
    "proto:no-forbidden-own-keys",
    ![...Object.keys(rec), ...Object.keys(st), ...Object.keys(m.upgrades)].some((k) => FORBIDDEN.includes(k)),
    "__proto__/constructor/prototype survived as own keys",
  );
  push(
    "proto:Object.prototype-clean",
    ({} as Record<string, unknown>).polluted === undefined &&
      !Object.prototype.hasOwnProperty.call(Object.prototype, "polluted") &&
      !("shards" in Object.prototype),
    "global prototype polluted",
  );
}

/* ------------------------------- fixtures ------------------------------- */

/* Healthy v3 save, every field populated with live-ish values. Built over
   DEFAULT_SETTINGS so it stays complete when new settings fields land. */
const HEALTHY: MetaSave = {
  version: 3,
  shards: 777,
  upgrades: { vitality: 3, power: 2, focus: 1, swiftness: 6 },
  bestWave: 23,
  bestScore: 456_789,
  bestEndless: 31,
  runs: 57,
  victories: 4,
  totalKills: 3_204,
  totalDamage: 1_234_567,
  totalTimeSec: 9_876,
  combosFound: ["fire+ice", "earth+lightning", "ice+void"],
  seenEnemies: ["goblin", "archer", "imp"],
  seenBosses: ["vorrac", "korrath"],
  seenSpells: ["fire", "ice", "lightning", "void"],
  mercyDeaths: 12,
  mercyTierSel: 2,
  settings: {
    ...DEFAULT_SETTINGS,
    master: 0.55, music: 0.1, sfx: 0.95, ambience: 0.35, muted: true,
    screenShake: false, reduceFlashes: true, aimAssist: false,
    quality: 0.75, brightness: 135, autoQuality: false,
  },
};

/* Hostile payloads with OWN "__proto__"/"constructor" data properties —
   JSON.parse is the real-world transport (localStorage stores strings), so
   they are built with JSON.parse, never with object literals (a literal
   {"__proto__": …} would fire the setter instead of creating an own key). */
const HOSTILE_UPGRADES = JSON.parse(
  '{"vitality":2,"power":42,"focus":-3,"swiftness":"3","hax":99,"__proto__":99,"constructor":99,"prototype":99}',
);
const HOSTILE_PROTO = JSON.parse(
  '{"version":3,"shards":5,"combosFound":["fire+ice"],"upgrades":{"vitality":1,"__proto__":{"polluted":"hax"}},' +
    '"settings":{"master":0.3,"__proto__":{"polluted":"hax"},"constructor":"hax"},' +
    '"__proto__":{"polluted":"hax"},"constructor":{"polluted":"hax"},"prototype":{"polluted":"hax"}}',
);

const FIXTURES: Fixture[] = [
  /* ---- healthy ---- */
  {
    name: "healthy-v3-full",
    raw: "object, every field populated",
    input: HEALTHY,
    expect: (m) => [expectDeep("identical-to-input", m, HEALTHY)],
  },
  {
    name: "healthy-v3-json-roundtrip",
    raw: "JSON.parse(JSON.stringify(healthy))",
    input: JSON.parse(JSON.stringify(HEALTHY)),
    expect: (m) => [expectDeep("identical-after-transport", m, HEALTHY)],
  },
  {
    name: "healthy-v3-partial-settings",
    raw: "settings holds {master, muted} only",
    input: { ...HEALTHY, settings: { master: 0.2, muted: true } },
    expect: (m) => [
      expectDeep("settings-defaults-filled", m.settings, { ...DEFAULT_SETTINGS, master: 0.2, muted: true }),
      ...expectFields(m, { shards: 777, runs: 57, bestWave: 23, mercyTierSel: 2, combosFound: HEALTHY.combosFound }),
    ],
  },

  /* ---- legacy (v1/v2-era partial shapes → healed to v3) ---- */
  {
    name: "legacy-v1-partial",
    raw: "v1 {shards, upgrades, bestWave, runs}",
    input: { version: 1, shards: 50, upgrades: { vitality: 2 }, bestWave: 7, runs: 3 },
    expect: (m) => [
      expectDeep("healed-to-full-v3", m, {
        ...defaultsMeta(),
        shards: 50,
        upgrades: { vitality: 2, power: 0, focus: 0, swiftness: 0 },
        bestWave: 7,
        runs: 3,
      }),
    ],
  },
  {
    name: "legacy-v2-mercy",
    raw: "v2 {shards, runs, mercy fields}, no arrays",
    input: { version: 2, shards: 10, runs: 2, mercyDeaths: 4, mercyTierSel: 0 },
    expect: (m) => [
      expectDeep("healed-to-full-v3", m, { ...defaultsMeta(), shards: 10, runs: 2, mercyDeaths: 4, mercyTierSel: 0 }),
    ],
  },

  /* ---- corrupt shapes (plan §9 invalid-save recovery) ---- */
  { name: "corrupt-number", raw: "42", input: 42, expect: (m) => [expectDeep("defaults", m, defaultsMeta())] },
  { name: "corrupt-string", raw: '"not json"', input: "not json", expect: (m) => [expectDeep("defaults", m, defaultsMeta())] },
  { name: "corrupt-null", raw: "null", input: null, expect: (m) => [expectDeep("defaults", m, defaultsMeta())] },
  { name: "corrupt-undefined", raw: "undefined", input: undefined, expect: (m) => [expectDeep("defaults", m, defaultsMeta())] },
  {
    name: "corrupt-array",
    raw: '["shards", 99, {"shards": 1}]',
    input: ["shards", 99, { shards: 1 }],
    expect: (m) => [expectDeep("defaults", m, defaultsMeta())],
  },
  { name: "corrupt-empty-object", raw: "{}", input: {}, expect: (m) => [expectDeep("defaults", m, defaultsMeta())] },
  {
    name: "corrupt-empty-json-string",
    raw: 'string "{}" (parse result is {})',
    input: "{}",
    expect: (m) => [expectDeep("defaults", m, defaultsMeta())],
  },
  {
    name: "corrupt-subshapes",
    raw: "upgrades 7, settings 'loud', arrays wrong types",
    input: { version: 3, shards: 25, upgrades: 7, settings: "loud", combosFound: 3, seenBosses: { boss: true }, seenEnemies: null },
    expect: (m) => [
      ...expectFields(m, { shards: 25, upgrades: DEFAULT_META.upgrades, settings: DEFAULT_SETTINGS }),
      expectDeep("arrays-reset", [m.combosFound, m.seenEnemies, m.seenBosses], [[], [], []]),
    ],
  },

  /* ---- hostile numerics ---- */
  {
    name: "hostile-numerics-a",
    raw: "version 'v9'; NaN/Infinity/-42/1e30",
    input: { version: "v9", shards: NaN, bestScore: Infinity, runs: -42, totalDamage: 1e30 },
    expect: (m) =>
      expectFields(m, {
        version: META_VERSION, // invalid version string still migrates up
        shards: 0,
        bestScore: 0,
        runs: 0,
        totalDamage: META_NUM_MAX.totalDamage,
      }),
  },
  {
    name: "hostile-numerics-b",
    raw: "shards -5, victories '7', kills 3.7",
    input: { shards: -5, victories: "7", totalKills: 3.7, totalTimeSec: "12,5", bestEndless: 1e15 },
    expect: (m) =>
      expectFields(m, {
        shards: 0,
        victories: 7, // numeric string coerces
        totalKills: 4, // integer-coerced (Math.round)
        totalTimeSec: 0, // garbage string falls back
        bestEndless: META_NUM_MAX.bestEndless,
      }),
  },

  /* ---- hostile arrays ---- */
  {
    name: "hostile-arrays",
    raw: "non-array combos; mixed types + dupes",
    input: {
      combosFound: "not-an-array",
      seenBosses: { 0: "vorrac" },
      seenEnemies: ["imp", 42, null, "imp", "  voidbeast  ", "", true, ["nested"]],
    },
    expect: (m) => [
      expectDeep("combosFound-reset", m.combosFound, []),
      expectDeep("seenBosses-reset", m.seenBosses, []),
      expectDeep("seenEnemies-sanitized", m.seenEnemies, ["imp", "voidbeast"]),
    ],
  },
  {
    name: "hostile-array-caps",
    raw: "10k-char item + 600 entries in seenEnemies",
    input: { seenEnemies: ["y".repeat(10_000), ...Array.from({ length: 600 }, (_, i) => `e${i}`)] },
    expect: (m) => [
      ...expectFields(m, {
        seenEnemies: ["y".repeat(META_STR_MAX.item), ...Array.from({ length: META_STR_MAX.list - 1 }, (_, i) => `e${i}`)],
      }),
    ],
  },

  /* ---- hostile upgrades / mercy ---- */
  {
    name: "hostile-upgrades",
    raw: "unknown keys; __proto__; levels 42/-3",
    input: { upgrades: HOSTILE_UPGRADES },
    expect: (m) => [
      expectDeep("allow-listed+clamped", m.upgrades, { vitality: 2, power: RELIQUARY_MAX_LEVEL, focus: 0, swiftness: 3 }),
    ],
  },
  {
    name: "hostile-mercy",
    raw: "mercyTierSel -999, mercyDeaths 999",
    input: { version: 2, mercyTierSel: -999, mercyDeaths: 999 },
    expect: (m) => expectFields(m, { version: META_VERSION, mercyTierSel: -1, mercyDeaths: META_NUM_MAX.mercyDeaths }),
  },

  /* ---- hostile settings ---- */
  {
    name: "hostile-settings",
    raw: "volumes 7/-2, NaN, '0.5', truthy strings, 0/1",
    input: {
      settings: {
        master: 7, music: -2, sfx: "0.5", ambience: NaN, quality: 3, brightness: 99,
        muted: "yes", screenShake: 0, damageNumbers: 1, reduceFlashes: null,
        aimAssist: "true", autoQuality: undefined, futureUnknownSetting: "x",
      },
    },
    expect: (m) => [
      expectDeep("clamped+coerced", m.settings, {
        ...DEFAULT_SETTINGS,
        master: 1, music: 0, sfx: 0.5, quality: 1, brightness: 99,
      }),
    ],
  },

  /* ---- prototype-pollution payload ---- */
  {
    name: "hostile-prototype-payload",
    raw: "__proto__/constructor/prototype payloads",
    input: HOSTILE_PROTO,
    expect: (m) => [
      ...expectFields(m, { shards: 5, "upgrades.vitality": 1, "settings.master": 0.3, combosFound: ["fire+ice"] }),
      {
        name: "expect:no-pollution-payload",
        ok: !JSON.stringify(m).includes("polluted") && !JSON.stringify(m).includes("hax"),
        detail: "pollution payload survived into the migrated save",
      },
    ],
  },
];

/* -------------------------------- run ----------------------------------- */

console.log("ARCHMAGE: RIFT 3D — save migration validation (migrateMeta fixtures)");
console.log(`  module : src/game3d/content.ts (migrateMeta — pure, no DOM)`);
console.log(`  storage: localStorage["${META_KEY}"] · current format v${META_VERSION}`);
console.log("");

const failures: string[] = [];
const rows: Array<{ name: string; raw: string; checks: Check[] }> = [];

for (const fx of FIXTURES) {
  const checks: Check[] = [];
  try {
    const m = migrateMeta(fx.input);
    checkInvariants(m, checks);
    checks.push({
      name: "idempotent",
      ok: deepEqual(m, migrateMeta(m)),
      detail: "migrating a migrated save changed the result",
    });
    checks.push(...(fx.expect?.(m) ?? []));
  } catch (err) {
    checks.push({ name: "no-throw", ok: false, detail: `migrateMeta threw: ${String(err)}` });
  }
  rows.push({ name: fx.name, raw: fx.raw, checks });
  for (const c of checks) if (!c.ok) failures.push(`${fx.name}: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}

/* ------------------------------- report --------------------------------- */

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));

console.log(`  ${pad("FIXTURE", 28)}${pad("RAW INPUT", 46)}${pad("CHECKS", 8)}RESULT`);
for (const r of rows) {
  const passed = r.checks.filter((c) => c.ok).length;
  const ok = passed === r.checks.length;
  console.log(`  ${pad(r.name, 28)}${pad(r.raw, 46)}${pad(`${passed}/${r.checks.length}`, 8)}${ok ? "ok" : "FAIL"}`);
}
console.log("");

if (failures.length > 0) {
  console.log(`  Failures (${failures.length}):`);
  for (const f of failures) console.log(`    FAIL: ${f}`);
  console.log("");
}

const okRows = rows.filter((r) => r.checks.every((c) => c.ok)).length;
const totalChecks = rows.reduce((a, r) => a + r.checks.length, 0);
const pass = failures.length === 0;
console.log(
  `  RESULT: ${pass ? "PASS" : "FAIL"} — ${okRows}/${rows.length} fixtures valid (${totalChecks} checks)` +
    (pass ? "" : `, ${failures.length} failure(s)`),
);
process.exitCode = pass ? 0 : 1;
