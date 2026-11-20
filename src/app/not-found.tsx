import type { Metadata } from "next";
import Link from "next/link";
import { assetPath } from "@/lib/asset-path";
import { SITE_NAME, SITE_VERSION, SITE_VERSION_NAME } from "@/lib/site";

/* v2.1.1: branded 404. In BUILD_MODE=pages this exports as 404.html and
   GitHub Pages serves it for any unknown path under the site. A 404 is
   never a content page — keep it out of the index, but let crawlers
   follow the one link back to the game. */

export const metadata: Metadata = {
  title: `Sealed corridor — 404 | ${SITE_NAME}`,
  description: "This wing of the rift never opened. Return to the game.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0812] px-6 text-center">
      <p className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.42em] text-[#9a7bff]">
        <span aria-hidden className="h-px w-10 bg-gradient-to-r from-transparent to-[#9a7bff] sm:w-14" />
        Riftbound · 3D Edition
        <span aria-hidden className="h-px w-10 bg-gradient-to-l from-transparent to-[#9a7bff] sm:w-14" />
      </p>
      <h1 className="font-display text-[clamp(56px,10vw,110px)] font-black leading-none tracking-[0.08em] text-[#f5e3b3] [text-shadow:0_0_34px_rgba(245,201,107,0.5),0_0_90px_rgba(154,123,255,0.35)]">
        404
      </h1>
      <h2 className="font-serif text-lg font-bold uppercase tracking-[0.25em] text-[#f5c96b]">
        Sealed corridor
      </h2>
      <p className="max-w-md text-[15px] leading-relaxed italic text-[#b9aee0]">
        This wing of the rift never opened. The Archmage waits elsewhere — the trial goes on without you.
      </p>
      <Link
        href={assetPath("/")}
        className="font-display mt-3 inline-flex min-h-11 items-center gap-3 border border-[#f5c96b]/60 bg-[#f5c96b]/12 px-8 py-3 text-sm font-bold uppercase tracking-[0.22em] text-[#ffe9ad] shadow-[0_0_35px_rgba(245,201,107,0.2)] transition-all hover:bg-[#f5c96b]/22 hover:shadow-[0_0_60px_rgba(245,201,107,0.4)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5c96b] active:scale-[0.98]"
      >
        Return to the Rift
      </Link>
      <p className="mt-4 text-[9px] uppercase tracking-[0.25em] text-white/40">
        v{SITE_VERSION} · {SITE_VERSION_NAME} · {SITE_NAME}
      </p>
    </main>
  );
}
