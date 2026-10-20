import type { NextConfig } from "next";

/* ============================================================================
   ARCHMAGE — dual-mode Next.js config.
   ----------------------------------------------------------------------------
   Sandbox/dev  : default          → output "standalone" (self-hosted server)
   GitHub Pages : BUILD_MODE=pages → output "export"     (static site in ./out)

   The Pages build additionally takes BASE_PATH (e.g. /archmage when deployed
   to https://user.github.io/archmage). See README.md → "Deploy to GitHub
   Pages" and .github/workflows/deploy.yml, which wires both env vars.
   ============================================================================ */

const isPages = process.env.BUILD_MODE === "pages";
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: isPages ? "export" : "standalone",
  trailingSlash: isPages,
  basePath,
  /* V1.2 — the static export has no server: exclude the API route handlers
     (all .ts files under src/app/api) from the Pages build so `next build`
     never tries to statically render them. Pages/layouts are .tsx and stay
     included. On GitHub Pages the Ledger of Legends reads as "sealed" —
     src/lib/leaderboard.ts treats the missing endpoint as gracefully
     unavailable. The standalone/server build keeps the API. */
  pageExtensions: isPages ? ["tsx", "jsx"] : ["ts", "tsx", "js", "jsx"],
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
