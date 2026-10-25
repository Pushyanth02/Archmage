import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { assetPath } from "@/lib/asset-path";
import {
  SITE_URL,
  SITE_NAME,
  SITE_VERSION,
  SITE_VERSION_NAME,
  SITE_FIRST_PUBLISHED,
  SITE_REPO,
  SITE_DESCRIPTION,
} from "@/lib/site";

/* v2.2: the brand faces are SELF-HOSTED (next/font/local) — preloaded,
   zero third-party requests, and the game no longer depends on Google
   Fonts at runtime (the privacy policy now names one origin: GitHub Pages).
   Files are the latin woff2 subsets, ~242 KB total for all ten faces. */
const cinzel = localFont({
  src: [
    { path: "./fonts/cinzel-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/cinzel-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/cinzel-800.woff2", weight: "800", style: "normal" },
    { path: "./fonts/cinzel-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-cinzel",
  display: "swap",
  preload: true,
});
const alegreya = localFont({
  src: [
    { path: "./fonts/alegreya-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/alegreya-sans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/alegreya-sans-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/alegreya-sans-800.woff2", weight: "800", style: "normal" },
    { path: "./fonts/alegreya-sans-400i.woff2", weight: "400", style: "italic" },
    { path: "./fonts/alegreya-sans-500i.woff2", weight: "500", style: "italic" },
  ],
  variable: "--font-alegreya",
  display: "swap",
  preload: true,
});

/* v2.2 — the site's <head>:
   - absolute canonical + og:url (this page is the only indexable URL)
   - ~155-char description for search snippets
   - JSON-LD VideoGame + WebSite structured data
   - ONE font system, self-hosted: Cinzel (display) + Alegreya Sans (body)
     via next/font/local — preloaded, no third-party font requests. */

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VideoGame",
      name: SITE_NAME,
      alternateName: ["Riftbound", "Archmage Riftbound"],
      description: SITE_DESCRIPTION,
      url: `${SITE_URL}/`,
      image: [`${SITE_URL}/art/og-image.jpg`],
      screenshot: `${SITE_URL}/art/cover.png`,
      genre: ["Roguelike", "Action RPG", "Wave Survival"],
      gamePlatform: "Web Browser",
      playMode: "SinglePlayer",
      numberOfPlayers: { "@type": "QuantitativeValue", minValue: 1, maxValue: 1 },
      applicationCategory: "Game",
      operatingSystem: "Any (requires WebGL2)",
      inLanguage: "en",
      isAccessibleForFree: true,
      softwareVersion: SITE_VERSION,
      datePublished: SITE_FIRST_PUBLISHED,
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD", availability: "https://schema.org/InStock" },
      author: { "@type": "Person", name: "The Last Archmage", url: SITE_REPO },
      publisher: { "@type": "Person", name: "The Last Archmage", url: SITE_REPO },
    },
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      inLanguage: "en",
      isAccessibleForFree: true,
      publisher: { "@type": "Person", name: "The Last Archmage", url: SITE_REPO },
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ARCHMAGE: RIFTBOUND — 3D Edition",
  description: SITE_DESCRIPTION,
  keywords: ["roguelike", "3D game", "archmage", "riftbound", "wave survival", "browser game", "free game", "Three.js", "no tracking"],
  authors: [{ name: "The Last Archmage", url: SITE_REPO }],
  /* One page, one canonical URL — duplicate-content protection for
     trailing-slash / http / host variants. */
  alternates: { canonical: `${SITE_URL}/` },
  /* v2.1 cross-device: the manifest declares display:fullscreen +
     orientation:landscape — an installed (Add to Home Screen) launch opens
     pre-snapped to fullscreen landscape on every platform, iOS included
     (where in-page orientation lock is impossible). */
  manifest: assetPath("/manifest.webmanifest"),
  icons: {
    /* R-08: Next does not apply basePath to metadata icon URLs in a static
       export — route them through the same assetPath() helper the client uses.
       v2.2: full brand suite (favicon.ico + PNG ladder + maskable). */
    icon: [
      { url: assetPath("/favicon.svg"), type: "image/svg+xml" },
      { url: assetPath("/favicon-32x32.png"), sizes: "32x32", type: "image/png" },
      { url: assetPath("/favicon-16x16.png"), sizes: "16x16", type: "image/png" }
    ],
    shortcut: assetPath("/favicon.ico"),
    apple: assetPath("/apple-touch-icon.png"),
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RIFTBOUND",
  },
  openGraph: {
    title: "ARCHMAGE: RIFTBOUND — 3D Edition",
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    url: `${SITE_URL}/`,
    images: [
      {
        url: `${SITE_URL}/art/og-image.jpg`,
        width: 1200,
        height: 630,
        alt: "Key art — the last Archmage stands before the sealed rift",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ARCHMAGE: RIFTBOUND — 3D Edition",
    description: SITE_DESCRIPTION,
    /* v2.2: one social image, not two byte-identical megabyte files — the
       card and the Open Graph preview are the same 1200×630 JPEG. */
    images: [`${SITE_URL}/art/og-image.jpg`],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* v2.2: pinch zoom stays available (WCAG 1.4.4). Gameplay surfaces
     already block the double-tap/zoom gesture via touch-none; iOS Safari
     ignored the old maximumScale anyway, so behavior is now consistent. */
  viewportFit: "cover", // let env(safe-area-inset-*) work on notched iOS
  themeColor: "#0a0812",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${cinzel.variable} ${alegreya.variable}`}>
      <head>
        {/* v2.2: structured data — VideoGame + WebSite (validated in the
            deploy smoke gate and by scripts/validate-web.ts conventions). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className="antialiased bg-[#0a0812] text-foreground overflow-hidden">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
