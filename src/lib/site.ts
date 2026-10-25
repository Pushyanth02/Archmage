/* v2.2 (The Reforged Update): single source of truth for the site's
   identity on the open web. Imported by app metadata, the sitemap, the
   branded 404, the boot loader and the JSON-LD graph.

   SITE_VERSION must stay in lockstep with content.ts GAME_VERSION and
   CHANGELOG[0].version — that invariant (plus the llms.txt/robots.txt
   references below) is machine-checked on every CI run by
   scripts/validate-web.ts. */

export const SITE_URL = "https://pushyanth02.github.io/Archmage";

export const SITE_NAME = "ARCHMAGE: RIFTBOUND";

export const SITE_VERSION = "2.2.0";

export const SITE_VERSION_NAME = "The Reforged Update";

/* Earliest CHANGELOG entry date (v1.x, 2026-10-21) — used for
   schema.org datePublished. */
export const SITE_FIRST_PUBLISHED = "2026-10-21";

export const SITE_REPO = "https://github.com/Pushyanth02/Archmage";

export const SITE_TAGLINE =
  "A free 3D roguelike that runs entirely in your browser — deterministic per seed, no installs, no accounts, no tracking.";

/* Search-snippet length (~155 chars): the long-form description lives in
   the page's server-rendered content block and llms.txt. */
export const SITE_DESCRIPTION =
  "Free 3D roguelike in your browser: 50 waves, 13 elements, 78 resonances, 22 spell evolutions, 5 tyrants, 10 terrains. No installs, no accounts, no tracking.";
