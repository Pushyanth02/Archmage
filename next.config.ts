import type { NextConfig } from "next";

/* R-08/R-09 (v2.0): TWO independent build modes — they never contaminate
   each other.

   DEFAULT (Vercel / self-host / `bun run build`): a normal Next.js
   production build with standalone packaging, exactly as before.

   BUILD_MODE=pages (GitHub Pages / `bun run build:pages`): a static export
   (output:"export") with images.unoptimized and a repository-subpath
   basePath/assetPrefix driven by BASE_PATH. The path is normalized
   (leading slash, no trailing slash, "/" → root). NEXT_PUBLIC_BASE_PATH is
   mirrored here so the runtime assetPath() helper (which prefixes
   hand-written public-asset URLs Next's basePath does NOT rewrite) sees
   the same value even when the caller only sets BASE_PATH. */

const PAGES_MODE = process.env.BUILD_MODE === "pages";

function normalizeBasePath(raw: string | undefined): string {
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "");
}

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);

if (PAGES_MODE && BASE_PATH && !process.env.NEXT_PUBLIC_BASE_PATH) {
  // Set BEFORE webpack starts bundling, so NEXT_PUBLIC_ inlining picks it up.
  process.env.NEXT_PUBLIC_BASE_PATH = BASE_PATH;
}

const nextConfig: NextConfig = {
  ...(PAGES_MODE
    ? {
        output: "export" as const,
        basePath: BASE_PATH || undefined,
        assetPrefix: BASE_PATH || undefined,
        images: { unoptimized: true },
        /* V1.2-upstream mechanism: the static export has no server — exclude
           any .ts route handlers under src/app from the Pages build (pages/
           layouts are .tsx and stay included). The game is zero-backend by
           design, so this is a guard, not a feature. */
        pageExtensions: ["tsx", "jsx"] as const,
      }
    : {
        output: "standalone" as const,
      }),
  /* Recovery Phase 4: TypeScript build errors are FATAL — the project
     type-checks clean (bunx tsc --noEmit = 0 errors), so the old
     ignoreBuildErrors:true suppression is removed. */
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
