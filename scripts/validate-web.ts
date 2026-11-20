#!/usr/bin/env bun
/* ARCHMAGE: RIFTBOUND — web identity validator (v2.1.1, The Visibility
   Update). Run: bun scripts/validate-web.ts

   The game now declares its identity to the open web in several places
   that CANNOT share imports by design (content.ts is game data, llms.txt
   and robots.txt are static files, layout metadata is server-side). This
   validator pins them all to one another so nothing can drift silently:

     1. GAME_VERSION (content.ts) === SITE_VERSION (lib/site.ts)
        === CHANGELOG[0].version — one version, everywhere
     2. CHANGELOG[0].name === SITE_VERSION_NAME — the update name matches
     3. public/llms.txt carries the current version, the canonical URL,
        the sitemap link and the honest data stance
     4. public/robots.txt points at the sitemap and disallows nothing
     5. the SEO surface exists: app/sitemap.ts, app/not-found.tsx,
        canonical + JSON-LD in layout.tsx, the prerendered content block
        in page.tsx, and no stray <h1> in the client menu (the static
        summary owns the single primary heading)

   Prints a checklist report; exits non-zero on any drift. Plain script —
   no test framework, no DOM. */

import { existsSync, readFileSync } from "node:fs";
import { GAME_VERSION, CHANGELOG } from "../src/game3d/content";
import { SITE_URL, SITE_VERSION, SITE_VERSION_NAME } from "../src/lib/site";

let failures = 0;
const check = (ok: boolean, label: string, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — ${detail ?? ""}`}`);
  if (!ok) failures++;
};

console.log(`\nweb identity validator — v${SITE_VERSION} "${SITE_VERSION_NAME}"\n`);

/* 1. one version, everywhere */
check(GAME_VERSION === SITE_VERSION, `GAME_VERSION === SITE_VERSION ("${SITE_VERSION}")`, `content.ts has "${GAME_VERSION}", lib/site.ts has "${SITE_VERSION}"`);
check(CHANGELOG[0].version === SITE_VERSION, `CHANGELOG[0].version === SITE_VERSION`, `changelog head is "${CHANGELOG[0].version}"`);
check(typeof CHANGELOG[0].date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(CHANGELOG[0].date), "CHANGELOG[0].date is ISO-formatted", CHANGELOG[0].date);

/* 2. the update name matches */
check(CHANGELOG[0].name === SITE_VERSION_NAME, `CHANGELOG[0].name === SITE_VERSION_NAME ("${SITE_VERSION_NAME}")`, `changelog says "${CHANGELOG[0].name}"`);

/* 3. llms.txt */
const llms = readFileSync("public/llms.txt", "utf8");
check(llms.includes(SITE_VERSION), "llms.txt carries the current version");
check(llms.includes(SITE_VERSION_NAME), "llms.txt carries the current update name");
check(llms.includes(`${SITE_URL}/`), "llms.txt links the canonical play URL");
check(llms.includes(`${SITE_URL}/sitemap.xml`), "llms.txt links the sitemap");
check(/no ads, no analytics|no accounts, no ads, no analytics/i.test(llms), "llms.txt states the honest data stance");
check(llms.length > 400, "llms.txt is a real document, not a stub");

/* 4. robots.txt */
const robots = readFileSync("public/robots.txt", "utf8");
check(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), "robots.txt points at the sitemap");
check(!/Disallow:\s*\/(\s|$)/.test(robots), "robots.txt disallows nothing site-wide");
check(!/noindex/i.test(robots), "robots.txt contains no noindex");

/* 5. the SEO surface exists in the source */
check(existsSync("public/sitemap.xml"), "public/sitemap.xml exists (static — exports in every build mode)");
const sitemap = readFileSync("public/sitemap.xml", "utf8");
check(sitemap.includes(`<loc>${SITE_URL}/</loc>`), "sitemap.xml carries the canonical URL");
check(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap), "sitemap.xml carries a lastmod date", "bump it with every release");
check(existsSync("src/app/not-found.tsx"), "app/not-found.tsx exists (branded 404)");
const manifest = readFileSync("public/manifest.webmanifest", "utf8");
check(!/\s"id":\s*"\/"/.test(manifest), "PWA id is not the host root (subpath deploys must not launch to a 404)");
check(manifest.includes("\"start_url\": \"./\""), "PWA start_url is relative (resolves under the deploy subpath)");
const layout = readFileSync("src/app/layout.tsx", "utf8");
check(layout.includes("alternates: { canonical: `${SITE_URL}/` }"), "layout declares the absolute canonical URL");
check(layout.includes("application/ld+json"), "layout emits JSON-LD structured data");
check(layout.includes('"@type": "VideoGame"'), "JSON-LD declares a VideoGame entity");
check(/from\s+"next\/font\/local"/.test(layout), "brand faces self-hosted via next/font/local");
check(!/fonts\.googleapis\.com/.test(layout), "no runtime Google Fonts stylesheet (fonts ship with the game)");
check(!/fonts\.gstatic\.com/.test(layout), "no gstatic font origins");
const page = readFileSync("src/app/page.tsx", "utf8");
check(page.includes('className="sr-only"') && page.includes("<h1>"), "page.tsx prerenders the screen-reader summary with the single <h1>");
check(page.includes("<noscript>"), "page.tsx carries a <noscript> fallback");
const screens = readFileSync("src/components/game3d/screens.tsx", "utf8");
check(!screens.includes("motion.h1"), "the client menu renders no <h1> (the static summary owns the primary heading)");
check(screens.includes("GAME_VERSION") && screens.includes("CHANGELOG[0].name"), "menu version labels derive from the changelog, not hardcoded strings");

console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK${failures === 1 ? "" : "S"} FAILED`}\n`);
if (failures > 0) process.exit(1);
