"use client";

/* ARCHMAGE: RIFTBOUND — RiftScreen: the ONE shared modal/screen shell.
   Every hub screen (Vault, Runes, Codex) and the Settings dialog render
   through this chrome: identical header geometry (close button left, title
   + subtitle center-left, currency cluster right — the close button sits in
   the EXACT same position on every screen), Esc-to-close, framer-motion
   entrance, tab strip, custom scrollbars and the single-elevation flat
   panel language. No nested card-inside-card.

   Composition:
     <ScreenShell title subtitle onClose header={<CurrencyPill …/>}>
       <TabStrip …/>
       <div className="rn-scroll">…body…</div>
     </ScreenShell> */

import { useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ICON } from "@/game3d/palette";

/* ------------------------------------------------------------------ */
/*  Shared header                                                      */
/* ------------------------------------------------------------------ */
export function ScreenHeader({
  title,
  subtitle,
  onClose,
  closeLabel = "Back to the gate",
  right,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
  /** right-hand slot (currency counters etc.) */
  right?: ReactNode;
}) {
  return (
    <header className="rn-header">
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="rn-close"
        title={closeLabel}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
          <path d="M3 3 L4 3 L5 4 L6 5 L7 6 L8 5 L9 4 L10 3 L11 3 L11 4 L10 5 L9 6 L8 7 L9 8 L10 9 L11 10 L11 11 L10 11 L9 10 L8 9 L7 10 L6 11 L5 11 L5 10 L6 9 L7 8 L6 7 L5 6 L4 5 L3 5 Z" fill="currentColor" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <h2 className="rn-header-title truncate">{title}</h2>
        {subtitle && <div className="rn-header-sub truncate">{subtitle}</div>}
      </div>
      {right}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared tab strip                                                   */
/* ------------------------------------------------------------------ */
export interface TabDef {
  id: string;
  label: string;
  icon?: ReactNode;
}
export function TabStrip({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="rn-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === active}
          data-active={tab.id === active}
          className="rn-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared currency counter — pixel icon + mono tabular-nums           */
/* ------------------------------------------------------------------ */
export function CurrencyCount({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string | number;
  label: string;
}) {
  return (
    <span className="rn-currency" title={label}>
      <img
        src={icon}
        alt=""
        width={20}
        height={20}
        draggable={false}
        className="size-5 [image-rendering:pixelated]"
      />
      <span>{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>
    </span>
  );
}
/** The two standard hub currencies: aether glyphs + score. */
export function CurrencyCluster({ shards, score }: { shards: number; score: number }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <CurrencyCount icon={ICON.crystal()} value={shards} label="Aether glyphs" />
      <CurrencyCount icon={ICON.coins()} value={score} label="Score" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared full-screen modal shell (Vault / Runes / Codex)             */
/*  Esc closes; single elevation; one motion language.                 */
/* ------------------------------------------------------------------ */
export function ScreenShell({
  title,
  subtitle,
  onClose,
  right,
  children,
  closeLabel,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** header right-hand slot (currency cluster) */
  right?: ReactNode;
  children: ReactNode;
  closeLabel?: string;
}) {
  /* Esc closes — the GameShell's global pause branch already yields to
     open dialogs, so this capture-phase handler is the one true Esc path. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <motion.div
      className="rn-shell"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="rn-shell-inner">
        <ScreenHeader title={title} subtitle={subtitle} onClose={onClose} closeLabel={closeLabel} right={right} />
        {children}
      </div>
    </motion.div>
  );
}
