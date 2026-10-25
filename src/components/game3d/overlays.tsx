"use client";


import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BatteryCharging, Cross, Flame, Gem, Heart, Shield, Sparkles, Target, Timer, Zap, type LucideIcon } from "lucide-react";
import { useRiftStore } from "@/game3d/store";
import { SPELLS, elementColor, evolvedSpellDef, type ElementId } from "@/game3d/content";
import { sfx } from "@/game3d/audio";
import { assetPath } from "@/lib/asset-path";
import type { EvolveOfferPayload, GateChoice, MergeOfferPayload } from "@/game3d/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ARCHMAGE: RIFTBOUND (3D Edition) — in-run overlays: Banner, Tribute Gate, Spell Tear
   Offer, Sacrifice Merge. These sit over the canvas while the engine holds
   the sim paused. Props carry engine callbacks — GameShell wires them. */

const GOLD = "#f5c96b";
/* ------------------------------------------------------------------ */ /*  SPELL TRADE-OFF COPY — one honest mechanical line per element      */ /*  (plan §9: "spell selection cards should explain the effect and      */ /*   relevant trade-off"). Sourced from the ACTUAL behaviors in          */ /*  spells.ts + stats in content.ts SPELLS — keep in sync if a          */ /*  behavior changes.                                                   */ /* ------------------------------------------------------------------ */
const ELEMENT_HINTS: Record<ElementId, string> = {
  fire: "Explosive orb — splash + burn",
  ice: "Piercing shards, slows foes",
  lightning: "Chains between foes, short reach",
  earth: "Ward wall — blocks, no damage",
  shadow: "Blink strike, hits both ends",
  light: "Pierces every lane, no splash",
  time: "Wide slow field, little damage",
  void: "Drags foes inward, crushes slowly",
  arcane: "Five homing seekers, low damage",
  blood: "Skewers lines, heavy aether cost",
  nature: "Lobbed cloud — poison and slow",
  wind: "Pierces and shoves foes back",
  sonic: "Nova around you, hurls foes away"
};
export function Banner() {
  const banner = useRiftStore(s => s.banner);
  return <div className="pointer-events-none fixed inset-x-0 top-[10%] z-30 flex justify-center px-4">{<AnimatePresence mode="wait">{banner && <motion.div initial={{
        opacity: 0,
        y: -18,
        scale: 0.95
      }} animate={{
        opacity: 1,
        y: 0,
        scale: 1
      }} exit={{
        opacity: 0,
        y: -10,
        scale: 0.98
      }} transition={{
        duration: 0.3,
        ease: "easeOut"
      }} className="relative flex max-w-full items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-black/80 px-3.5 py-3 shadow-[0_10px_44px_rgba(0,0,0,0.55)] sm:gap-4 sm:px-7" key={banner.key}>{<div aria-hidden className="pointer-events-none absolute inset-0" style={{
          background: `radial-gradient(ellipse at center, ${banner.color}14, transparent 70%)`
        }} />}{<span className="relative h-px w-4 shrink-0 bg-gradient-to-r from-transparent to-[#f5c96b]/70 sm:w-12" />}{<div className="relative min-w-0 shrink text-center">{<div className="text-balance font-serif text-lg font-bold uppercase tracking-[0.14em] sm:text-2xl sm:tracking-[0.18em]" style={{
            color: banner.color,
            textShadow: `0 0 26px ${banner.color}55`
          }}>{banner.title}</div>}{banner.sub && <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-white/50">{banner.sub}</div>}</div>}{<span className="relative h-px w-4 shrink-0 bg-gradient-to-l from-transparent to-[#f5c96b]/70 sm:w-12" />}</motion.div>}</AnimatePresence>}</div>;
}
/* ------------------------------------------------------------------ */ /*  TRIBUTE GATE — mandatory boon pick every TRIBUTE_INTERVAL waves.    */ /* ------------------------------------------------------------------ */const GATE_ICONS: Record<string, LucideIcon> = {
  heart: Heart,
  cross: Cross,
  flame: Flame,
  sparkles: Sparkles,
  zap: Zap,
  timer: Timer,
  battery: BatteryCharging,
  shield: Shield,
  gem: Gem,
  target: Target
};
export function TributeGateOverlay({
  choices,
  wave,
  onPick
}: {
  choices: GateChoice[];
  wave: number;
  onPick: (id: string) => void;
}) {
  return <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/75 px-4 safe-b-4 pt-4 max-sm:items-end">{<motion.div className="relative my-auto max-sm:my-0 max-sm:pb-2 flex w-full max-w-4xl flex-col items-center gap-6 py-4" initial={{
      opacity: 0,
      y: 20
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.3,
      ease: "easeOut"
    }}>{<div className="relative text-center">{<div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{
          backgroundColor: GOLD
        }} />}{<h2 className="relative text-balance font-serif text-xl font-bold uppercase tracking-[0.1em] text-[#f5c96b] [text-shadow:0_0_30px_rgba(245,201,107,0.4)] sm:text-3xl sm:tracking-[0.18em]">{"Tribute Gate — Wave "}{wave}</h2>}{<p className="relative mt-2 text-xs uppercase tracking-[0.25em] text-white/45">The rift demands a toll. Choose one boon.</p>}</div>}{<div className="flex w-full flex-col gap-4 sm:flex-row sm:items-stretch">{choices.map((c, idx) => {
          const Icon = GATE_ICONS[c.icon] ?? Sparkles;
          return <motion.button type="button" initial={{
            opacity: 0,
            y: 22
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            delay: 0.1 + idx * 0.09,
            duration: 0.3,
            ease: "easeOut"
          }} whileHover={{
            y: -6
          }} whileTap={{
            scale: 0.97
          }} onClick={() => {
            sfx.click();
            onPick(c.id);
          }} className="group relative flex flex-1 cursor-pointer flex-col items-center gap-3 overflow-hidden rounded-xl border bg-black/75 p-5 sm:p-6" style={{
            borderColor: `${c.color}55`,
            boxShadow: `0 0 26px ${c.color}14`
          }} key={c.id}>{<div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{
              background: `radial-gradient(circle at 50% 15%, ${c.color}22, transparent 70%)`
            }} />}{c.tier > 0 && <Badge className="absolute right-3 top-3 border-white/10 bg-white/5 font-mono text-[10px] text-white/60">HELD ×{c.tier}</Badge>}{<div className="flex size-14 items-center justify-center rounded-full border transition-transform duration-200 group-hover:scale-105" style={{
              borderColor: `${c.color}66`,
              backgroundColor: `${c.color}14`,
              color: c.color,
              boxShadow: `0 0 20px ${c.color}33`
            }}>{<Icon className="size-7" />}</div>}{<div className="relative text-center">{<div className="text-sm font-bold uppercase tracking-[0.22em]" style={{
                color: c.color
              }}>{c.name}</div>}{<div className="mt-1.5 text-xs leading-relaxed text-white/55">{c.desc}</div>}</div>}</motion.button>;
        })}</div>}</motion.div>}</div>;
}
function slotInfo(slot: string | { merged: string[] } | null): SlotInfo {
  if (slot === null) return {
    name: "Empty Slot",
    colors: ["rgba(255,255,255,0.14)"],
    fused: false,
    empty: true
  };
  if (typeof slot === "string") {
    const d = SPELLS[slot as ElementId];
    return {
      name: d ? d.name : slot,
      colors: [elementColor(slot)],
      fused: false,
      empty: false
    };
  }
  const names: string[] = [];
  const colors: string[] = [];
  for (const m of slot.merged) {
    const d = SPELLS[m as ElementId];
    names.push(d ? d.name : m);
    colors.push(elementColor(m));
  }
  return {
    name: names.join(" · "),
    colors,
    fused: true,
    empty: false
  };
}
interface SlotInfo {
  name: string;
  colors: string[];
  fused: boolean;
  empty: boolean;
}
/** Compact equip slot plate — a SELECTABLE destination in the spell offer
 *  (R-07). Empty plates read as bind targets; occupied plates require an
 *  explicit replacement choice; the chosen plate carries the DESTINATION
 *  badge and a gold highlight. */
function EquipSlotPlate({
  index,
  slot,
  selected,
  onSelect
}: {
  index: number;
  slot: string | { merged: string[] } | null;
  selected: boolean;
  onSelect: (i: number) => void;
}) {
  const info = slotInfo(slot);
  const primary = info.empty ? null : typeof slot === "string" ? slot : slot ? slot.merged[0] : null;
  return <button type="button" onClick={() => {
    sfx.hover();
    onSelect(index);
  }} aria-pressed={selected} aria-label={`Destination slot ${index + 1}${info.empty ? ", empty" : `, replacing ${info.name}`}`} className={cn("relative flex min-h-11 flex-1 cursor-pointer flex-col items-center gap-1.5 overflow-hidden rounded-lg border bg-black/70 px-3 py-2.5 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c96b]", selected ? "-translate-y-0.5" : "hover:-translate-y-0.5")} style={{
    borderColor: selected ? "rgba(245,201,107,0.9)" : info.empty ? "rgba(255,255,255,0.08)" : `${info.colors[0]}55`,
    boxShadow: selected ? "0 0 22px rgba(245,201,107,0.25)" : "none"
  }}>{<span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/30">{"Slot "}{index + 1}</span>}{primary ? <img src={assetPath(`/assets/icons/element-${primary}.png`)} alt="" width={30} height={30} className="h-[30px] w-[30px] [image-rendering:pixelated]" style={{
      filter: `drop-shadow(0 0 7px ${info.colors[0]}aa)`
    }} /> : <div className="flex h-[30px] items-center justify-center">{<span className="text-lg font-black text-white/20">+</span>}</div>}{info.fused && <Badge className="border-[#f5c96b]/40 bg-[#f5c96b]/10 px-1.5 text-[8px] font-bold uppercase tracking-wider text-[#f5c96b]">Fused</Badge>}{<span className={cn("text-center text-[11px] font-semibold leading-tight", info.empty ? "text-white/25" : "text-white/85")}>{info.empty ? "Empty — bind here" : info.name}</span>}{selected && <Badge className="absolute -top-2 right-2 bg-[#f5c96b] text-[8px] font-bold uppercase tracking-wider text-black">Destination</Badge>}</button>;
}
export function SpellOfferOverlay({
  pool,
  equipped,
  onPick,
  onSkip
}: {
  pool: string[];
  equipped: (string | { merged: string[] } | null)[];
  onPick: (el: string, targetSlot: number) => void;
  onSkip: () => void;
}) {
  /* R-07: the destination is EXPLICIT. The first empty slot is the highlighted
   *  default; a full loadout starts with NO target and requires the player
   *  to choose the exact slot to replace. `committed` makes the resolve
   *  one-shot — a double click can never submit twice. */
  const [target, setTarget] = useState<number>(() => equipped.findIndex(s => s === null));
  const committedRef = useRef(false);
  const pick = (el: string) => {
    if (committedRef.current || target < 0) return;
    committedRef.current = true;
    sfx.click();
    onPick(el, target);
  };
  const skip = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    sfx.click();
    onSkip();
  };
  /* numeric slot keys work while the offer is open (1/2/3 pick the
   *  destination) — captured at the WINDOW level so they fire regardless of
   * where focus sits (body vs. inside the dialog), then swallowed so the
   * global handler never sees them (its phase guard would ignore them
   * anyway — belt and suspenders). Removed with the overlay. */
  useEffect(() => {
    const onWinKey = (ev: KeyboardEvent) => {
      const k = ev.key;
      const i = k === "1" ? 0 : k === "2" ? 1 : k === "3" ? 2 : -1;
      if (i >= 0) {
        ev.preventDefault();
        sfx.hover();
        setTarget(i);
      }
    };
    window.addEventListener("keydown", onWinKey);
    return () => window.removeEventListener("keydown", onWinKey);
  }, []);
  const targetInfo = target >= 0 ? slotInfo(equipped[target]) : null;
  const replacing = targetInfo !== null && !targetInfo.empty;
  return <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/75 px-4 safe-b-4 pt-4 max-sm:items-end">{<motion.div className="relative my-auto max-sm:my-0 max-sm:pb-2 flex w-full max-w-4xl flex-col items-center gap-5 py-2" initial={{
      opacity: 0,
      y: 20
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.3,
      ease: "easeOut"
    }}>{<div className="relative text-center">{<div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{
          backgroundColor: "#9a7bff"
        }} />}{<h2 className="relative text-balance font-serif text-xl font-bold uppercase tracking-[0.1em] text-[#f5c96b] [text-shadow:0_0_28px_rgba(245,201,107,0.4)] sm:text-3xl sm:tracking-[0.15em]">A Spell Breaks Through</h2>}{<p className="relative mt-2 text-xs uppercase tracking-[0.25em] text-white/45">Bind it — or leave it to the dark.</p>}</div>}{<div className="flex w-full max-w-2xl flex-col gap-2">{<div className="flex w-full flex-wrap gap-2">{equipped.slice(0, 3).map((slot, i) => <EquipSlotPlate index={i} slot={slot} selected={target === i} onSelect={setTarget} key={i} />)}</div>}{<p role="status" aria-live="polite" className="min-h-5 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{target < 0 ? "All three slots are bound — choose which spell to replace" : replacing ? `Replacing ${targetInfo.name} in Slot ${target + 1}` : `Binding to Slot ${target + 1} — an empty slot`}</p>}</div>}{<div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">{pool.map((el, i) => {
          const d = SPELLS[el as ElementId];
          if (!d) return null;
          const elementId = el as ElementId;
          const col = elementColor(el);
          return <motion.div initial={{
            opacity: 0,
            y: 18
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            delay: 0.1 + i * 0.09,
            duration: 0.3,
            ease: "easeOut"
          }} className="relative flex flex-col overflow-hidden rounded-xl border bg-black/75 p-4" style={{
            borderColor: `${col}55`,
            boxShadow: `0 0 24px ${col}12`
          }} key={el}>{<div aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl" style={{
              backgroundColor: col
            }} />}{<div className="flex items-center gap-3">{<img src={assetPath(`/assets/icons/element-${el}.png`)} alt="" width={40} height={40} className="h-10 w-10 shrink-0 [image-rendering:pixelated]" style={{
                filter: `drop-shadow(0 0 8px ${col}aa)`
              }} />}{<div className="min-w-0 flex-1">{<div className="flex items-start justify-between gap-2">{<h3 className="font-serif text-lg font-bold leading-tight text-white/95">{d.name}</h3>}{<span className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]" style={{
                    color: col,
                    borderColor: `${col}55`,
                    backgroundColor: `${col}12`
                  }}>{el}</span>}</div>}{<p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{
                  color: col
                }}>{d.tagline}</p>}</div>}</div>}{<p className="mt-2 flex-1 text-xs leading-relaxed text-white/50">{d.desc}</p>}{<p className="mt-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400" title={ELEMENT_HINTS[elementId]}>{<span className="mr-1.5 text-[#f5c96b]/70">◆</span>}{ELEMENT_HINTS[elementId]}</p>}{<div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">{<div>{<div className="text-[8px] uppercase tracking-wider text-white/30">Aether</div>}{<div className="font-mono text-sm font-bold" style={{
                  color: col
                }}>{d.manaCost}</div>}</div>}{<div>{<div className="text-[8px] uppercase tracking-wider text-white/30">Cooldown</div>}{<div className="font-mono text-sm font-bold text-white/80">{d.cooldown}s</div>}</div>}{<div>{<div className="text-[8px] uppercase tracking-wider text-white/30">Damage</div>}{<div className="font-mono text-sm font-bold text-white/80">{d.baseDamage > 0 ? d.baseDamage : "—"}</div>}</div>}</div>}{<Button onClick={() => pick(el)} disabled={target < 0} aria-label={target >= 0 ? `Take ${d.name} into slot ${target + 1}` : `Choose a destination slot for ${d.name} first`} className="mt-3 h-11 w-full rounded-lg text-xs font-bold uppercase tracking-[0.3em] transition-all active:scale-[0.97]" style={{
              borderColor: `${col}66`,
              backgroundColor: `${col}14`,
              color: col,
              boxShadow: `0 0 18px ${col}22`
            }} variant="outline">{target < 0 ? "Choose a slot above" : replacing ? `Replace Slot ${target + 1}` : `Bind to Slot ${target + 1}`}</Button>}</motion.div>;
        })}</div>}{<Button variant="ghost" onClick={skip} className="h-11 text-[11px] uppercase tracking-[0.3em] text-white/40 hover:bg-white/5 hover:text-white/70">Leave it</Button>}</motion.div>}</div>;
}
export function MergeOverlay({
  offer,
  onMerge
}: {
  offer: MergeOfferPayload;
  onMerge: (a: number, b: number) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const reduceMotion = useReducedMotion() ?? false; // gate the idle orb pulse loop
  const ready = selected.length === 2;
  const toggle = (i: number) => {
    sfx.hover();
    setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : prev.length >= 2 ? [prev[1], i] : [...prev, i]);
  };
  const fuse = () => {
    if (!ready) return;
    sfx.click();
    const [a, b] = [...selected].sort((x, y) => x - y);
    onMerge(a, b);
  };
  const infoA = ready ? slotInfo(offer.equipped[selected[0]]) : null;
  const infoB = ready ? slotInfo(offer.equipped[selected[1]]) : null;
  const colA = infoA ? infoA.colors[0] : "#9a7bff";
  const colB = infoB ? infoB.colors[infoB.colors.length - 1] : "#43e8d8";
  return <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/75 px-4 safe-b-4 pt-4">{<motion.div className="relative my-auto flex w-full max-w-3xl flex-col items-center gap-5 py-2" initial={{
      opacity: 0,
      y: 20
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.3,
      ease: "easeOut"
    }}>{<div className="relative text-center">{<div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{
          backgroundColor: "#9a7bff"
        }} />}{<h2 className="relative text-balance font-serif text-xl font-bold uppercase tracking-[0.1em] text-[#f5c96b] [text-shadow:0_0_28px_rgba(245,201,107,0.4)] sm:text-3xl sm:tracking-[0.15em]">The Sacrifice Merge</h2>}{<div className="relative mt-2 text-[10px] uppercase tracking-[0.3em] text-white/40">The orb offers</div>}{<div className="relative font-serif text-xl font-bold text-[#9a7bff] [text-shadow:0_0_22px_rgba(154,123,255,0.4)]">{offer.resonanceName}</div>}{<p className="relative mt-1 text-xs italic text-white/45">{offer.resonanceLore}</p>}</div>}{<div className="flex h-24 items-center justify-center">{<motion.div className="relative size-20 rounded-full border" animate={ready && !reduceMotion ? {
          scale: [1, 1.06, 1],
          boxShadow: [`0 0 34px ${colA}55`, `0 0 46px ${colB}66`, `0 0 34px ${colA}55`]
        } : {
          scale: 1
        }} transition={{
          duration: 1.6,
          repeat: ready && !reduceMotion ? Infinity : 0,
          ease: "easeInOut"
        }} style={{
          borderColor: ready ? `${GOLD}88` : "rgba(255,255,255,0.12)",
          background: ready ? `linear-gradient(125deg, ${colA}, ${colB})` : "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
          filter: ready ? "none" : "grayscale(0.6)"
        }}>{!ready && <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-[0.25em] text-white/30">Select two</div>}</motion.div>}</div>}{<div className="grid w-full max-w-2xl grid-cols-3 gap-3">{offer.equipped.map((slot, i) => {
          const info = slotInfo(slot);
          const isSel = selected.includes(i);
          const canSelect = !info.empty;
          return <motion.button type="button" disabled={!canSelect} whileTap={canSelect ? {
            scale: 0.96
          } : undefined} onClick={() => canSelect && toggle(i)} className={cn("relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 bg-black/75 transition-all", !canSelect && "cursor-not-allowed opacity-35", canSelect && !isSel && "hover:-translate-y-0.5", isSel && "-translate-y-1")} style={{
            borderColor: isSel ? `${GOLD}aa` : `${info.colors[0]}55`,
            backgroundColor: isSel ? "rgba(245,201,107,0.07)" : "rgba(0,0,0,0.5)",
            boxShadow: isSel ? `0 0 26px rgba(245,201,107,0.22)` : `0 0 16px ${info.colors[0]}0d`
          }} key={i}>{<span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/30">{"Slot "}{i + 1}</span>}{<div className="flex items-center gap-1.5">{info.colors.map((c, ci) => <span className="size-2.5 rounded-full" style={{
                backgroundColor: c,
                boxShadow: `0 0 8px ${c}`
              }} key={ci} />)}</div>}{<span className={cn("text-center font-serif text-xs font-bold leading-tight sm:text-sm", info.empty ? "text-white/25" : "text-white/90")}>{info.name}</span>}{info.fused && <Badge className="border-[#f5c96b]/40 bg-[#f5c96b]/10 px-1.5 text-[8px] font-bold uppercase tracking-wider text-[#f5c96b]">Fused</Badge>}{isSel && <Badge className="absolute -top-2.5 right-2 bg-[#f5c96b] text-[8px] font-bold uppercase tracking-wider text-black">Sacrifice</Badge>}</motion.button>;
        })}</div>}{<p className="max-w-md text-center text-[11px] leading-relaxed text-white/40">Both are consumed. One fused slot remains, casting each in turn.</p>}{<Button disabled={!ready} onClick={fuse} className="h-12 w-full max-w-sm rounded-lg border border-[#f5c96b]/50 bg-[#f5c96b]/10 px-8 text-sm font-bold uppercase tracking-[0.3em] text-[#f5c96b] shadow-[0_0_30px_rgba(245,201,107,0.18)] transition-all hover:bg-[#f5c96b]/20 active:scale-[0.98] disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30 disabled:shadow-none">{ready ? "Fuse the Resonance" : "Select exactly two spells"}</Button>}</motion.div>}</div>;
}
/* ------------------------------------------------------------------ */ /*  SPELL EVOLUTION (v2.2) — one long-bound spell is offered its final  */ /*  form. Cards carry honest trade-offs; declining keeps the base spell. */ /* ------------------------------------------------------------------ */
export function EvolveOverlay({
  offer,
  onPick
}: {
  offer: EvolveOfferPayload;
  onPick: (evoId: string | null) => void;
}) {
  /* one-shot commit (like the spell offer): a double click can never
   * submit twice — declining counts as committing too */
  const committedRef = useRef(false);
  const pick = (evoId: string | null) => {
    if (committedRef.current) return;
    committedRef.current = true;
    sfx.click();
    onPick(evoId);
  };
  const elementId = offer.element as ElementId;
  const base = SPELLS[elementId];
  const col = elementColor(offer.element);
  return <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/75 px-4 safe-b-4 pt-4 max-sm:items-end">{<motion.div className="relative my-auto max-sm:my-0 max-sm:pb-2 flex w-full max-w-3xl flex-col items-center gap-5 py-2" initial={{
      opacity: 0,
      y: 20
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.3,
      ease: "easeOut"
    }}>{<div className="relative text-center">{<div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{
          backgroundColor: col
        }} />}{<h2 className="relative text-balance font-serif text-xl font-bold uppercase tracking-[0.1em] text-[#f5c96b] [text-shadow:0_0_28px_rgba(245,201,107,0.4)] sm:text-3xl sm:tracking-[0.15em]">The Spell Evolves</h2>}{<p className="relative mt-2 text-xs uppercase tracking-[0.25em] text-white/45">{base.name} has drunk deep of the rift — choose its final form</p>}</div>}{<img src={assetPath(`/assets/icons/element-${offer.element}.png`)} alt="" width={44} height={44} className="h-11 w-11 [image-rendering:pixelated]" style={{
      filter: `drop-shadow(0 0 9px ${col}aa)`
    }} />}{<div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">{offer.cards.map((evo, i) => {
      const def = evolvedSpellDef(elementId, evo.id);
      return <motion.div initial={{
        opacity: 0,
        y: 18
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.1 + i * 0.09,
        duration: 0.3,
        ease: "easeOut"
      }} className="relative flex flex-col overflow-hidden rounded-xl border bg-black/75 p-4" style={{
        borderColor: `${evo.color}55`,
        boxShadow: `0 0 24px ${evo.color}12`
      }} key={evo.id}>{<div aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl" style={{
          backgroundColor: evo.color
        }} />}{<div className="flex items-start justify-between gap-2">{<h3 className="font-serif text-lg font-bold leading-tight text-white/95">{evo.name}</h3>}{<span className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]" style={{
            color: evo.color,
            borderColor: `${evo.color}55`,
            backgroundColor: `${evo.color}12`
          }}>{evo.tagline}</span>}</div>}{<p className="mt-2 flex-1 text-xs leading-relaxed text-white/50">{evo.desc}</p>}{<ul className="mt-1.5 flex flex-col gap-1">{evo.tradeoffs.map(t => <li className="flex gap-2 text-[11px] leading-relaxed text-white/55" key={t}>{<span className="text-[#f5c96b]">◆</span>}{t}</li>)}</ul>}{<div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">{<div>{<div className="text-[8px] uppercase tracking-wider text-white/30">Aether</div>}{<div className="font-mono text-sm font-bold" style={{
            color: evo.color
          }}>{def.manaCost}</div>}</div>}{<div>{<div className="text-[8px] uppercase tracking-wider text-white/30">Cooldown</div>}{<div className="font-mono text-sm font-bold text-white/80">{def.cooldown}s</div>}</div>}{<div>{<div className="text-[8px] uppercase tracking-wider text-white/30">Damage</div>}{<div className="font-mono text-sm font-bold text-white/80">{def.baseDamage > 0 ? def.baseDamage : "—"}</div>}</div>}</div>}{<p className="mt-1.5 text-center font-mono text-[9px] tracking-wide text-white/30">base {base.manaCost} → {def.manaCost} aether · base {base.baseDamage} → {def.baseDamage} dmg</p>}{<Button onClick={() => pick(evo.id)} aria-label={`Evolve ${base.name} into ${evo.name}`} className="mt-3 h-11 w-full rounded-lg text-xs font-bold uppercase tracking-[0.3em] transition-all active:scale-[0.97]" style={{
          borderColor: `${evo.color}66`,
          backgroundColor: `${evo.color}14`,
          color: evo.color,
          boxShadow: `0 0 18px ${evo.color}22`
        }} variant="outline">Evolve {base.name}</Button>}</motion.div>;
    })}</div>}{<Button variant="ghost" onClick={() => pick(null)} className="h-11 text-[11px] uppercase tracking-[0.3em] text-white/40 hover:bg-white/5 hover:text-white/70">Keep it as it is</Button>}</motion.div>}</div>;
}