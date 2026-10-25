#!/usr/bin/env bun
/* ARCHMAGE: RIFT 3D — asset manifest validator (plan §3 acceptance + §4 pipeline).
   Run: bun scripts/validate-assets.ts

   Verifies public/assets/manifests/assets.json:
     - every entry uri exists on disk under public/assets/
     - byteSize matches the actual file size (when declared)
     - license provenance complete and non-placeholder (author, sourceUrl,
       licenseId, attributionRequired, commercialUseVerified === true,
       reviewedAt set as YYYY-MM-DD, no RECORD_ or placeholder strings)
     - structural checks: valid kind, unique ids/uris, format matches kind,
       budget on models, animations on clipbanks, packs <-> assets consistency
   Prints a per-asset table report; exits non-zero on any failure. Plain
   script — no test framework. */

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface Row {
  id: string;
  kind: string;
  bytes: string;
  checks: Check[];
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pubAssets = join(root, "public", "assets");
const manifestPath = join(pubAssets, "manifests", "assets.json");

const PLACEHOLDER_RE = /RECORD_|PLACEHOLDER|TBD|TODO|FIXME|<[^>]+>/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KINDS = new Set(["model", "sprite", "icon", "clipbank"]);

function isPlaceholder(v: unknown): boolean {
  return typeof v !== "string" || v.trim().length === 0 || PLACEHOLDER_RE.test(v);
}

/** Manifest uris are relative to /assets/ ("models/mage.glb"); tolerate an
 *  absolute "/assets/..." spelling for plan-schema compatibility. */
function diskPathFor(uri: string): string {
  let rel = uri;
  if (rel.startsWith("/")) rel = rel.slice(1);
  if (rel.startsWith("assets/")) rel = rel.slice("assets/".length);
  return join(pubAssets, rel);
}

function relFor(uri: string): string {
  return `public/assets/${uri}`;
}

function checkLicenseFields(lic: unknown, checks: Check[]): void {
  const l = (lic ?? {}) as Record<string, unknown>;
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  push("license.author", !isPlaceholder(l.author), isPlaceholder(l.author) ? "missing/placeholder author" : undefined);
  push(
    "license.sourceUrl",
    typeof l.sourceUrl === "string" && /^https?:\/\//.test(l.sourceUrl) && !PLACEHOLDER_RE.test(l.sourceUrl),
    "must be the exact asset page URL",
  );
  push("license.licenseId", !isPlaceholder(l.licenseId), "missing/placeholder licenseId");
  push("license.attributionRequired", typeof l.attributionRequired === "boolean", "must be a boolean");
  push(
    "license.commercialUseVerified",
    l.commercialUseVerified === true,
    "must be boolean true to ship (plan §3 legal gate)",
  );
  push(
    "license.reviewedAt",
    typeof l.reviewedAt === "string" && DATE_RE.test(l.reviewedAt),
    "must be a YYYY-MM-DD review date",
  );
}

function checkEntry(entry: unknown, seenIds: Set<string>, seenUris: Set<string>): Check[] {
  const e = (entry ?? {}) as Record<string, unknown>;
  const checks: Check[] = [];
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  const id = typeof e.id === "string" && e.id.length > 0 ? e.id : "(missing id)";
  const kind = typeof e.kind === "string" ? e.kind : "?";

  push("kind", VALID_KINDS.has(kind), `invalid kind ${JSON.stringify(e.kind)}`);
  const idOk = typeof e.id === "string" && e.id.length > 0 && !seenIds.has(id);
  seenIds.add(id);
  push("id", idOk, idOk ? undefined : "missing or duplicate id");
  const uriOk = typeof e.uri === "string" && e.uri.length > 0 && !seenUris.has(String(e.uri));
  if (typeof e.uri === "string" && e.uri.length > 0) seenUris.add(e.uri);
  push("uri", uriOk, uriOk ? undefined : "missing or duplicate uri");

  if (typeof e.uri === "string" && e.uri.length > 0) {
    let size = -1;
    try {
      size = statSync(diskPathFor(e.uri)).size;
    } catch {
      /* missing file — reported below */
    }
    push("file-exists", size >= 0, size >= 0 ? undefined : `not found on disk: ${relFor(e.uri)}`);
    if (typeof e.byteSize === "number") {
      push("byteSize", size === e.byteSize, size >= 0 ? `manifest ${e.byteSize} vs disk ${size}` : "file missing, cannot compare");
    }
    // byteSize absent = skipped (warned in the summary), per task contract "when present"
  }

  const formatOk =
    kind === "model" || kind === "clipbank" ? e.format === "glb" : kind === "sprite" || kind === "icon" ? e.format === "png" : false;
  push("format", formatOk, `expected ${kind === "model" || kind === "clipbank" ? "glb" : "png"}, got ${JSON.stringify(e.format)}`);

  checkLicenseFields(e.license, checks);

  if (kind === "model") {
    const b = (e.budget ?? {}) as Record<string, unknown>;
    push("budget.maxMaterials", typeof b.maxMaterials === "number" && b.maxMaterials >= 1, "models must declare maxMaterials");
    push("budget.lodsRequired", typeof b.lodsRequired === "boolean", "models must declare lodsRequired");
  }
  if (kind === "clipbank") {
    const anims = e.animations;
    push(
      "animations",
      Array.isArray(anims) && anims.length > 0 && anims.every((a) => typeof a === "string" && a.length > 0),
      "clipbank must declare its clip names",
    );
  } else if (e.animations !== undefined) {
    push(
      "animations",
      Array.isArray(e.animations) && e.animations.every((a) => typeof a === "string" && a.length > 0),
      "must be an array of clip-name strings",
    );
  }

  push("no-placeholders", !PLACEHOLDER_RE.test(JSON.stringify(e)), "placeholder text found in entry");
  return checks;
}

function checkPack(pack: unknown, assetUriSet: Set<string>, checks: Check[]): string[] {
  const p = (pack ?? {}) as Record<string, unknown>;
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  push("pack.name", !isPlaceholder(p.pack), "missing/placeholder pack name");
  push("pack.author", !isPlaceholder(p.author), "missing/placeholder author");
  push(
    "pack.sourceUrl",
    typeof p.sourceUrl === "string" && /^https?:\/\//.test(p.sourceUrl) && !PLACEHOLDER_RE.test(p.sourceUrl),
    "must be the exact pack page URL",
  );
  push("pack.licenseId", !isPlaceholder(p.licenseId), "missing/placeholder licenseId");
  push("pack.attributionRequired", typeof p.attributionRequired === "boolean", "must be a boolean");
  push("pack.commercialUseVerified", p.commercialUseVerified === true, "must be boolean true to ship");
  push("pack.reviewedAt", typeof p.reviewedAt === "string" && DATE_RE.test(p.reviewedAt), "must be a YYYY-MM-DD review date");
  push("pack.files", Array.isArray(p.files) && p.files.length > 0 && p.files.every((f) => typeof f === "string"), "must list shipped files");
  const files = Array.isArray(p.files) ? (p.files as string[]) : [];
  for (const f of files) {
    if (!assetUriSet.has(f)) push("pack.file-ref", false, `pack file not in assets[]: ${f}`);
  }
  push("no-placeholders", !PLACEHOLDER_RE.test(JSON.stringify(p)), "placeholder text found in pack");
  return files;
}

/* ------------------------------- run ---------------------------------- */

let manifest: Record<string, unknown>;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
} catch (err) {
  console.error(`FAIL: cannot read manifest at ${manifestPath}`);
  console.error(String(err));
  process.exit(1);
}

const failures: string[] = [];
const warn = (msg: string): void => {
  console.log(`  warn: ${msg}`);
};

console.log("ARCHMAGE: RIFT 3D — asset manifest validation");
console.log(`  manifest : ${manifestPath.replace(`${root}/`, "")}`);
console.log(`  generator: ${String(manifest.generator ?? "(missing)")} · version ${String(manifest.version ?? "(missing)")}`);
if (isPlaceholder(manifest.generator) || isPlaceholder(manifest.version)) {
  failures.push("manifest top-level: generator/version missing or placeholder");
}

const entries = Array.isArray(manifest.assets) ? (manifest.assets as unknown[]) : [];
const packs = Array.isArray(manifest.packs) ? (manifest.packs as unknown[]) : [];
if (entries.length === 0) failures.push("manifest top-level: assets[] missing or empty");
if (packs.length === 0) failures.push("manifest top-level: packs[] missing or empty");

const seenIds = new Set<string>();
const seenUris = new Set<string>();
const rows: Row[] = [];
for (const entry of entries) {
  const e = (entry ?? {}) as Record<string, unknown>;
  const id = typeof e.id === "string" && e.id.length > 0 ? e.id : "(missing id)";
  const kind = typeof e.kind === "string" ? e.kind : "?";
  const checks = checkEntry(entry, seenIds, seenUris);
  if (typeof e.byteSize !== "number") warn(`${id}: no byteSize declared (size check skipped)`);
  rows.push({ id, kind, bytes: typeof e.byteSize === "number" ? String(e.byteSize) : "-", checks });
  for (const c of checks) if (!c.ok) failures.push(`${id}: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}

/* packs <-> assets cross-consistency */
const packFilesByUri = new Map<string, { packId: string; pack: Record<string, unknown> }>();
const packRows: Array<{ id: string; files: number; author: string; licenseId: string; checks: Check[] }> = [];
for (const pack of packs) {
  const p = (pack ?? {}) as Record<string, unknown>;
  const id = typeof p.id === "string" && p.id.length > 0 ? p.id : "(missing id)";
  const checks: Check[] = [];
  const files = checkPack(pack, seenUris, checks);
  for (const f of files) packFilesByUri.set(f, { packId: id, pack: p });
  packRows.push({
    id,
    files: files.length,
    author: typeof p.author === "string" ? p.author : "?",
    licenseId: typeof p.licenseId === "string" ? p.licenseId : "?",
    checks,
  });
  for (const c of checks) if (!c.ok) failures.push(`${id}: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
for (const uri of seenUris) {
  if (!packFilesByUri.has(uri)) failures.push(`orphan asset: ${uri} is not listed in any pack`);
}

/* license fields must agree between a pack and each of its assets */
for (const row of rows) {
  const e = (entries.find((x) => ((x ?? {}) as Record<string, unknown>).id === row.id) ?? {}) as Record<string, unknown>;
  const packRef = typeof e.uri === "string" ? packFilesByUri.get(e.uri) : undefined;
  if (!packRef || typeof e.license !== "object" || e.license === null) continue;
  const lic = e.license as Record<string, unknown>;
  for (const field of ["author", "sourceUrl", "licenseId", "attributionRequired", "commercialUseVerified", "reviewedAt"] as const) {
    if (JSON.stringify(lic[field]) !== JSON.stringify(packRef.pack[field])) {
      failures.push(`${row.id}: license.${field} disagrees with pack "${packRef.packId}"`);
    }
  }
}

/* ------------------------------- report -------------------------------- */

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const kindCounts = rows.reduce<Record<string, number>>((acc, r) => {
  acc[r.kind] = (acc[r.kind] ?? 0) + 1;
  return acc;
}, {});

console.log(`  assets   : ${rows.length} (${Object.entries(kindCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}) · packs: ${packRows.length}`);
console.log("");
console.log(`  ${pad("ID", 22)}${pad("KIND", 10)}${pad("BYTES", 9)}${pad("CHECKS", 8)}RESULT`);
for (const r of rows) {
  const passed = r.checks.filter((c) => c.ok).length;
  const ok = passed === r.checks.length;
  console.log(`  ${pad(r.id, 22)}${pad(r.kind, 10)}${pad(r.bytes, 9)}${pad(`${passed}/${r.checks.length}`, 8)}${ok ? "ok" : "FAIL"}`);
}
console.log("");
console.log("  Packs:");
for (const p of packRows) {
  const passed = p.checks.filter((c) => c.ok).length;
  const ok = passed === p.checks.length;
  console.log(`  ${pad(p.id, 24)}${pad(`${p.files} files`, 10)}${pad(p.author, 22)}${pad(p.licenseId, 54)}${ok ? "ok" : "FAIL"}`);
}
console.log("");

if (failures.length > 0) {
  console.log(`  Failures (${failures.length}):`);
  for (const f of failures) console.log(`    FAIL: ${f}`);
  console.log("");
}

const assetsOk = rows.filter((r) => r.checks.every((c) => c.ok)).length;
const packsOk = packRows.filter((p) => p.checks.every((c) => c.ok)).length;
const pass = failures.length === 0;
console.log(
  `  RESULT: ${pass ? "PASS" : "FAIL"} — ${assetsOk}/${rows.length} assets valid, ${packsOk}/${packRows.length} packs valid` +
    (pass ? "" : `, ${failures.length} failure(s)`),
);
process.exit(pass ? 0 : 1);
