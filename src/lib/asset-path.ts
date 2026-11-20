/* R-08 (v2.0 audit): public-asset URL helper for subpath deploys.
   Next's basePath rewrites framework chunks and links, but NOT absolute
   strings hand-written in JS/CSS — every manually-authored public-asset
   URL (spell icons, key art, the asset manifest, GLB models) must go
   through assetPath() so a GitHub Pages project site served under
   /<repository>/ resolves correctly. In the normal root/Vercel build
   NEXT_PUBLIC_BASE_PATH is unset and this is the identity function.
   Inlined at build time — zero runtime cost. */

export function assetPath(path: string): string {
  if (!path.startsWith("/")) return path; // already relative or fully external
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}${path}`;
}
