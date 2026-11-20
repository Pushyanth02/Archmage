"use client";

/* ARCHMAGE: RIFTBOUND — v3.0 Pixel Reforged shared UI chrome.
   The enchanted-panel / gold-filigree component language distilled from the
   v3 concept boards: dark-purple panels with ornate corner brackets, diamond
   ornaments, filigree rules, notched hex plaques, keycap chips, gem finials. */

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Panel — enchanted dark plaque with gold border + corner brackets   */
/* ------------------------------------------------------------------ */
export function PxPanel({
  children,
  className,
  corners = true,
  variant = "gold",
  style,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  corners?: boolean;
  variant?: "gold" | "violet" | "crimson";
  style?: CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-panel",
        variant === "violet" && "px-panel--violet",
        variant === "crimson" && "px-panel--crimson",
        corners && "px-corners",
        className
      )}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diamond — rotated-square gold ornament                             */
/* ------------------------------------------------------------------ */
export function PxDiamond({ className, small }: { className?: string; small?: boolean }) {
  return <span aria-hidden className={cn("px-diamond", small && "px-diamond--sm", className)} />;
}

/* ------------------------------------------------------------------ */
/*  Filigree — hairline rule with a center diamond (—◆—)               */
/* ------------------------------------------------------------------ */
export function PxFiligree({ className, width = "w-24" }: { className?: string; width?: string }) {
  return (
    <span aria-hidden className={cn("flex items-center gap-2", width, className)}>
      <span className="px-rule h-px flex-1" />
      <PxDiamond small />
      <span className="px-rule h-px flex-1" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Header — icon + tracked caps + gold rule to the right edge         */
/* ------------------------------------------------------------------ */
export function PxHeader({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-header", className)}>
      {icon}
      <span className="truncate">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HexButton — notched hexagonal plaque with a raised icon tab        */
/* ------------------------------------------------------------------ */
export function PxHexButton({
  children,
  tabIcon,
  glow = "gold",
  className,
  ...rest
}: {
  children: ReactNode;
  tabIcon: ReactNode;
  glow?: "gold" | "violet";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const isGold = glow === "gold";
  return (
    <button className={cn("px-hex-frame group flex min-h-11 w-full flex-col items-center", className)} {...rest}>
      {/* raised arch tab with the icon */}
      <span
        aria-hidden
        className={cn(
          "relative z-10 -mb-3 flex h-12 w-12 items-center justify-center rounded-t-full border-2 border-b-0 transition-transform group-hover:scale-110",
          isGold
            ? "border-[#e87a1e]/80 bg-gradient-to-b from-[#3a2410] to-[#241408] text-[#ffb85c] shadow-[0_0_16px_rgba(255,158,61,0.35)]"
            : "border-[#c9a0ff]/70 bg-gradient-to-b from-[#2a1846] to-[#180e2c] text-[#c9a0ff] shadow-[0_0_16px_rgba(199,125,255,0.35)]"
        )}
      >
        {tabIcon}
      </span>
      {/* the notched plaque: gold shell + dark inner (clip-path border trick) */}
      <span
        aria-hidden
        className={cn(
          "px-hex-shell block w-full",
          isGold
            ? "bg-gradient-to-b from-[#f0c060] via-[#d9a441] to-[#8a5e22]"
            : "bg-gradient-to-b from-[#c9a0ff] via-[#a66bf0] to-[#5e2e8c]"
        )}
      >
        <span
          className={cn(
            "px-hex flex w-full items-center justify-center gap-2 whitespace-nowrap px-10 py-4 font-display text-base font-bold uppercase tracking-[0.16em] transition-colors sm:text-lg",
            isGold
              ? "bg-gradient-to-b from-[#2e1c10]/97 to-[#160c04]/97 text-[#f5efe0] group-hover:text-white"
              : "bg-gradient-to-b from-[#241740]/97 to-[#120a22]/97 text-[#e9e2ff] group-hover:text-white"
          )}
        >
          {children}
        </span>
      </span>
      {/* outer colored bloom on hover */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-60",
          isGold ? "bg-[#ff9e3d]/25" : "bg-[#c77dff]/25"
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Keycap — physical-key chip                                         */
/* ------------------------------------------------------------------ */
export function PxKeycap({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("px-keycap", className)}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/*  BannerTab — small plaque overlapping a card's top edge             */
/* ------------------------------------------------------------------ */
export function PxBannerTab({
  children,
  color = "gold",
  className,
}: {
  children: ReactNode;
  color?: "gold" | "violet" | "crimson" | "amber" | "ice";
  className?: string;
}) {
  const tones: Record<string, string> = {
    gold: "border-[#f0c060]/80 bg-gradient-to-b from-[#4a3410] to-[#2a1c06] text-[#ffd97a]",
    violet: "border-[#c9a0ff]/70 bg-gradient-to-b from-[#3a2460] to-[#22143c] text-[#c9a0ff]",
    crimson: "border-[#ff5a7a]/70 bg-gradient-to-b from-[#4a1424] to-[#2a0a14] text-[#ff8fa3]",
    amber: "border-[#ff7a1a]/80 bg-gradient-to-b from-[#4a2408] to-[#2a1204] text-[#ffb85c]",
    ice: "border-[#7fd8ff]/70 bg-gradient-to-b from-[#12344e] to-[#081c2c] text-[#aee8ff]",
  };
  return (
    <span
      className={cn(
        "px-tab absolute -top-px left-1/2 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 border-2 border-b-0 px-4 py-1 text-[10px] font-extrabold uppercase tracking-[0.22em]",
        tones[color],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Buttons                                                            */
/* ------------------------------------------------------------------ */
export function PxButton({
  children,
  variant = "default",
  className,
  ...rest
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "purple" | "ghost";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "px-btn",
        variant === "primary" && "px-btn--primary",
        variant === "purple" && "px-btn--purple",
        variant === "ghost" && "px-btn--ghost",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Bar — pill resource bar with an icon socket                        */
/* ------------------------------------------------------------------ */
export function PxBar({
  fillRef,
  textRef,
  icon,
  from,
  to,
  label,
  className,
}: {
  fillRef?: React.RefObject<HTMLDivElement | null>;
  textRef?: React.RefObject<HTMLSpanElement | null>;
  icon?: ReactNode;
  from: string;
  to: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {icon && <span className="px-socket">{icon}</span>}
      <div className="px-bar relative flex-1">
        <div ref={fillRef} className="px-bar-fill" style={{ width: "100%", background: `linear-gradient(90deg, ${from}, ${to})` }} />
        {label && (
          <span className="absolute inset-0 flex items-center justify-end pr-2 text-[9px] font-extrabold tabular-nums tracking-wider text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
            <span ref={textRef}>{label}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StarInArch — the title ornament (four-pointed star in an arch)     */
/* ------------------------------------------------------------------ */
export function PxStarInArch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 72" className={className} fill="none" aria-hidden>
      <path d="M32 4 C18 12 10 24 10 40 L10 68" stroke="#d9a441" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 4 C46 12 54 24 54 40 L54 68" stroke="#d9a441" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M10 68 L54 68" stroke="#d9a441" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M32 22 L35.5 32.5 L46 36 L35.5 39.5 L32 50 L28.5 39.5 L18 36 L28.5 32.5 Z"
        fill="#ffd97a"
        stroke="#b8822e"
        strokeWidth="1.2"
      />
      <circle cx="32" cy="36" r="2.4" fill="#fff3d0" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Tiny pixel-style inline icons (chest, triquetra)                   */
/* ------------------------------------------------------------------ */
export function IconChest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M3 8.5 C3 5.5 5.5 4 8 4 L16 4 C18.5 4 21 5.5 21 8.5 L21 11 L3 11 Z" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="11" width="18" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="10.4" y="8.6" width="3.2" height="5" rx="0.8" fill="currentColor" />
      <path d="M12 13.6 L12 15.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
export function IconTriquetra({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M12 3 C16.5 6 16.5 12 12 15 C7.5 12 7.5 6 12 3 Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 16.5 C7 11.5 13 10.5 16 13.5 C14 18.5 8 19.5 5 16.5 Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19 16.5 C17 11.5 11 10.5 8 13.5 C10 18.5 16 19.5 19 16.5 Z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
