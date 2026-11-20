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
import { PxPanel, PxBannerTab, PxDiamond, PxFiligree } from "@/components/game3d/pixel";
import { cn } from "@/lib/utils";

/* ARCHMAGE: RIFTBOUND — v3.0 Pixel Reforged in-run overlays: Banner, Tribute
   Gate, Spell Tear Offer, Sacrifice Merge, Evolution. These sit over the
   canvas while the engine holds the sim paused. Props carry engine
   callbacks — GameShell wires them.
   Art direction (concept 07): cards are enchanted panels with notched
   banner tabs (SPELL UPGRADE / BOON / EVOLUTION), hexagonal icon
   medallions, inset stat boxes, trait callouts with roundel icons, diamond
   finials, and the wizard-sanctum rift vista reading through the veil. */

const GOLD = "#f5c96b";

/* ------------------------------------------------------------------ */
/*  SPELL TRADE-OFF COPY — one honest mechanical line per element      */
/*  (plan §9: "spell selection cards should explain the effect and      */
/*   relevant trade-off"). Sourced from the ACTUAL behaviors in          */
/*   spells.ts + stats in content.ts SPELLS — keep in sync if a          */
/*   behavior changes.                                                   */
/* ------------------------------------------------------------------ */
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

/* The wizard-sanctum vista (concept 07) reading through the overlay veil. */
function SanctumBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img src={assetPath("/art/v3/upgrade-bg.jpg")} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-25" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0712]/80 via-[#120a1e]/70 to-[#0a0712]/90" />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(10,7,18,0.72) 100%)" }} />
    </div>
  );
}

/** Hexagonal icon medallion (concept 07) — element-rimmed hex with the
 *  pixel icon inside; a second hexagon provides the 2px rim. */
function HexMedallion({ icon, color, size = 64, glow = true }: { icon: React.ReactNode; color: string; size?: number; glow?: boolean }) {
  const HEX = "polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)";
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, clipPath: `polygon(50% 0,94% 26%,94% 74%,50% 100%,6% 74%,6% 26%)`, background: `linear-gradient(180deg, ${color}, ${color}88)`, padding: 2, boxShadow: glow ? `0 0 22px ${color}44` : undefined }}
    >
      <span className="flex items-center justify-center bg-[#100a1e]" style={{ width: size - 4, height: size - 4, clipPath: HEX }}>
        {icon}
      </span>
    </span>
  );
}

/** Inset stat box (concept 07) — label + value in an element-bordered chip. */
function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border bg-[#0e0817]/90 px-1.5 py-1 text-center" style={{ borderColor: color ? `${color}55` : "rgba(217,164,65,0.35)" }}>
      <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-[#9a8fb5]">{label}</div>
      <div className="text-[13px] font-extrabold tabular-nums" style={{ color: color ?? "#f2e8c9" }}>{value}</div>
    </div>
  );
}

/** Trait callout (concept 07) — roundel icon badge + two-line mechanical hint. */
function TraitCallout({ icon, text, color }: { icon: React.ReactNode; text: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ borderColor: `${color}44`, background: `${color}0d` }}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: `${color}66`, background: `${color}14`, color }}>{icon}</span>
      <span className="text-[10px] font-semibold leading-snug text-[#d8cfe8]">{text}</span>
    </div>
  );
}

export function Banner() {
  const banner = useRiftStore(s => s.banner);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[10%] z-30 flex justify-center px-4">
      <AnimatePresence mode="wait">
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="px-panel px-corners relative flex max-w-full items-center gap-3 px-5 py-2.5 sm:gap-5 sm:px-8"
            key={banner.key}
          >
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${banner.color}14, transparent 70%)` }} />
            <span className="relative flex items-center gap-1.5">
              <span className="h-px w-4 bg-gradient-to-r from-transparent to-[#d9a441]/80 sm:w-10" />
              <PxDiamond small />
            </span>
            <div className="relative min-w-0 shrink text-center">
              <div className="text-balance font-serif text-lg font-bold uppercase tracking-[0.14em] sm:text-2xl sm:tracking-[0.18em]" style={{ color: banner.color, textShadow: `0 0 26px ${banner.color}55` }}>
                {banner.title}
              </div>
              {banner.sub && <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-[#9a8fb5]">{banner.sub}</div>}
            </div>
            <span className="relative flex items-center gap-1.5">
              <PxDiamond small />
              <span className="h-px w-4 bg-gradient-to-l from-transparent to-[#d9a441]/80 sm:w-10" />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TRIBUTE GATE — mandatory boon pick every TRIBUTE_INTERVAL waves.    */
/* ------------------------------------------------------------------ */
const GATE_ICONS: Record<string, LucideIcon> = {
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
  return (
    <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 safe-b-4 pt-4 max-sm:items-end">
      <SanctumBackdrop />
      <motion.div
        className="relative my-auto flex max-sm:my-0 max-sm:pb-2 w-full max-w-4xl flex-col items-center gap-6 py-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="relative text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{ backgroundColor: GOLD }} />
          <h2 className="font-display px-gold-text relative text-balance text-2xl font-black uppercase tracking-[0.1em] sm:text-4xl">Rift Tribute</h2>
          <div className="relative mt-1.5 flex items-center justify-center gap-3">
            <PxFiligree width="w-10" />
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#c9b8e8]">Wave {wave}</span>
            <PxFiligree width="w-10" />
          </div>
          <p className="relative mt-2 text-xs uppercase tracking-[0.25em] text-[#9a8fb5]">The rift demands a toll. Choose one boon.</p>
        </div>
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-5">
          {choices.map((c, idx) => {
            const Icon = GATE_ICONS[c.icon] ?? Sparkles;
            return (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + idx * 0.09, duration: 0.3, ease: "easeOut" }}
                whileHover={{ y: -6 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { sfx.click(); onPick(c.id); }}
                className="px-panel group relative flex flex-1 cursor-pointer flex-col items-center gap-3 p-5 pt-7 sm:p-6 sm:pt-8"
                style={{ borderColor: `${c.color}77` }}
                key={c.id}
              >
                <PxBannerTab color="gold">Boon</PxBannerTab>
                {c.tier > 0 && <Badge className="absolute right-3 top-3 border-[#d9a441]/40 bg-[#241a3a]/90 font-mono text-[10px] text-[#f0c060]">HELD ×{c.tier}</Badge>}
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: `radial-gradient(circle at 50% 15%, ${c.color}1e, transparent 70%)` }} />
                <HexMedallion color={c.color} icon={<Icon className="size-7" />} />
                <div className="relative text-center">
                  <div className="font-serif text-base font-bold uppercase tracking-[0.16em]" style={{ color: c.color, textShadow: `0 0 16px ${c.color}44` }}>{c.name}</div>
                  <div className="mt-1.5 text-xs leading-relaxed text-[#d8cfe8]/75">{c.desc}</div>
                </div>
                <span aria-hidden className="px-finial" style={{ bottom: -12 }} />
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

function slotInfo(slot: string | { merged: string[] } | null): SlotInfo {
  if (slot === null) return { name: "Empty Slot", colors: ["rgba(255,255,255,0.14)"], fused: false, empty: true };
  if (typeof slot === "string") {
    const d = SPELLS[slot as ElementId];
    return { name: d ? d.name : slot, colors: [elementColor(slot)], fused: false, empty: false };
  }
  const names: string[] = [];
  const colors: string[] = [];
  for (const m of slot.merged) {
    const d = SPELLS[m as ElementId];
    names.push(d ? d.name : m);
    colors.push(elementColor(m));
  }
  return { name: names.join(" · "), colors, fused: true, empty: false };
}
interface SlotInfo {
  name: string;
  colors: string[];
  fused: boolean;
  empty: boolean;
}

/** Compact equip slot plate — a SELECTABLE destination in the spell offer
 *  (R-07). Styled as the concept-07 "YOUR BUILD (SO FAR)" rune circles. */
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
  return (
    <button
      type="button"
      onClick={() => { sfx.hover(); onSelect(index); }}
      aria-pressed={selected}
      aria-label={`Destination slot ${index + 1}${info.empty ? ", empty" : `, replacing ${info.name}`}`}
      className={cn(
        "relative flex min-h-11 flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-lg border bg-[#0e0817]/85 px-3 py-2.5 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c060]",
        selected ? "-translate-y-0.5" : "hover:-translate-y-0.5"
      )}
      style={{
        borderColor: selected ? "rgba(240,192,96,0.95)" : info.empty ? "rgba(58,44,104,0.8)" : `${info.colors[0]}66`,
        boxShadow: selected ? "0 0 22px rgba(240,192,96,0.28)" : "none"
      }}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-[#9a8fb5]/70">Slot {index + 1}</span>
      {primary ? (
        <img src={assetPath(`/assets/icons/element-${primary}.png`)} alt="" width={30} height={30} className="h-[30px] w-[30px] [image-rendering:pixelated]" style={{ filter: `drop-shadow(0 0 7px ${info.colors[0]}aa)` }} />
      ) : (
        <div className="flex h-[30px] items-center justify-center"><span className="text-lg font-black text-white/20">+</span></div>
      )}
      {info.fused && <Badge className="border-[#d9a441]/40 bg-[#d9a441]/10 px-1.5 text-[8px] font-bold uppercase tracking-wider text-[#f0c060]">Fused</Badge>}
      <span className={cn("text-center text-[11px] font-semibold leading-tight", info.empty ? "text-[#9a8fb5]/50" : "text-[#f2e8c9]")}>{info.empty ? "Empty — bind here" : info.name}</span>
      {selected && <Badge className="absolute -top-2 right-2 bg-[#f0c060] text-[8px] font-bold uppercase tracking-wider text-[#1e1430]">Destination</Badge>}
    </button>
  );
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
   *  where focus sits (body vs. inside the dialog), then swallowed so the
   *  global handler never sees them (its phase guard would ignore them
   *  anyway — belt and suspenders). Removed with the overlay. */
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
  return (
    <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 safe-b-4 pt-4 max-sm:items-end">
      <SanctumBackdrop />
      <motion.div
        className="relative my-auto flex max-sm:my-0 max-sm:pb-2 w-full max-w-4xl flex-col items-center gap-5 py-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="relative text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{ backgroundColor: "#a66bf0" }} />
          <h2 className="font-display px-gold-text relative text-balance text-2xl font-black uppercase tracking-[0.1em] sm:text-4xl sm:tracking-[0.14em]">Rift Upgrade</h2>
          <p className="relative mt-2 text-xs uppercase tracking-[0.25em] text-[#9a8fb5]">The rift offers new power — bind it, or leave it to the dark.</p>
        </div>
        {/* YOUR BUILD (SO FAR) — destination plates */}
        <div className="flex w-full max-w-2xl flex-col gap-2">
          <div className="flex items-center justify-center gap-3">
            <PxFiligree width="w-8" />
            <span className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-[#f0c060]">Your build (so far)</span>
            <PxFiligree width="w-8" />
          </div>
          <div className="flex w-full flex-wrap gap-2">
            {equipped.slice(0, 3).map((slot, i) => <EquipSlotPlate index={i} slot={slot} selected={target === i} onSelect={setTarget} key={i} />)}
          </div>
          <p role="status" aria-live="polite" className="min-h-5 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a8fb5]">
            {target < 0 ? "All three slots are bound — choose which spell to replace" : replacing ? `Replacing ${targetInfo.name} in Slot ${target + 1}` : `Binding to Slot ${target + 1} — an empty slot`}
          </p>
        </div>
        {/* the three spell cards */}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {pool.map((el, i) => {
            const d = SPELLS[el as ElementId];
            if (!d) return null;
            const elementId = el as ElementId;
            const col = elementColor(el);
            return (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.09, duration: 0.3, ease: "easeOut" }}
                className="px-panel relative flex flex-col gap-3 p-4 pt-7"
                style={{ borderColor: `${col}80` }}
                key={el}
              >
                <PxBannerTab color="gold">Spell Upgrade</PxBannerTab>
                <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl" style={{ backgroundColor: col }} />
                <div className="flex items-center gap-3">
                  <HexMedallion color={col} icon={<img src={assetPath(`/assets/icons/element-${el}.png`)} alt="" width={34} height={34} className="h-[34px] w-[34px] [image-rendering:pixelated]" style={{ filter: `drop-shadow(0 0 8px ${col}aa)` }} />} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif truncate text-lg font-bold leading-tight text-[#f2e8c9]">{d.name}</h3>
                    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: col }}>{el} · {d.tagline}</p>
                  </div>
                </div>
                <p className="flex-1 text-xs leading-relaxed text-[#d8cfe8]/70">{d.desc}</p>
                <TraitCallout color={col} icon={<Sparkles className="size-3.5" />} text={ELEMENT_HINTS[elementId]} />
                <div className="grid grid-cols-3 gap-2">
                  <StatBox label="Aether" value={`${d.manaCost}`} color={col} />
                  <StatBox label="Cooldown" value={`${d.cooldown}s`} />
                  <StatBox label="Damage" value={d.baseDamage > 0 ? `${d.baseDamage}` : "—"} />
                </div>
                <div className="flex justify-center gap-1.5" aria-hidden>
                  <PxDiamond small /><PxDiamond small /><PxDiamond small />
                </div>
                <button
                  type="button"
                  onClick={() => pick(el)}
                  disabled={target < 0}
                  aria-label={target >= 0 ? `Take ${d.name} into slot ${target + 1}` : `Choose a destination slot for ${d.name} first`}
                  className="mt-auto h-11 w-full rounded-lg border-2 text-xs font-extrabold uppercase tracking-[0.22em] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ borderColor: `${col}80`, backgroundColor: `${col}16`, color: col, boxShadow: `0 0 18px ${col}22` }}
                >
                  {target < 0 ? "Choose a slot above" : replacing ? `Replace Slot ${target + 1}` : `Bind to Slot ${target + 1}`}
                </button>
                <span aria-hidden className="px-finial" style={{ borderColor: col, background: `linear-gradient(135deg, ${col}, ${col}88)` }} />
              </motion.div>
            );
          })}
        </div>
        <button type="button" onClick={skip} className="min-h-11 text-[11px] font-bold uppercase tracking-[0.3em] text-[#9a8fb5]/60 transition-colors hover:text-[#d8cfe8]">
          Leave it to the dark
        </button>
      </motion.div>
    </div>
  );
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
  const colA = infoA ? infoA.colors[0] : "#a66bf0";
  const colB = infoB ? infoB.colors[infoB.colors.length - 1] : "#58d6c2";
  return (
    <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 safe-b-4 pt-4">
      <SanctumBackdrop />
      <motion.div
        className="relative my-auto flex w-full max-w-3xl flex-col items-center gap-5 py-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="relative text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{ backgroundColor: "#a66bf0" }} />
          <h2 className="font-display px-gold-text relative text-balance text-2xl font-black uppercase tracking-[0.1em] sm:text-4xl sm:tracking-[0.14em]">Resonance</h2>
          <div className="relative mt-1.5 flex items-center justify-center gap-3">
            <PxFiligree width="w-10" />
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#c9b8e8]">The sacrifice merge</span>
            <PxFiligree width="w-10" />
          </div>
          <div className="relative mt-2 font-serif text-xl font-bold text-[#c9a0ff] [text-shadow:0_0_22px_rgba(166,107,240,0.5)]">{offer.resonanceName}</div>
          <p className="relative mt-1 text-xs italic text-[#9a8fb5]">{offer.resonanceLore}</p>
        </div>
        {/* the resonance orb */}
        <div className="flex h-24 items-center justify-center">
          <motion.div
            className="relative size-20 rounded-full border-2"
            animate={ready && !reduceMotion ? {
              scale: [1, 1.06, 1],
              boxShadow: [`0 0 34px ${colA}55`, `0 0 46px ${colB}66`, `0 0 34px ${colA}55`]
            } : { scale: 1 }}
            transition={{ duration: 1.6, repeat: ready && !reduceMotion ? Infinity : 0, ease: "easeInOut" }}
            style={{
              borderColor: ready ? "rgba(240,192,96,0.75)" : "rgba(58,44,104,0.9)",
              background: ready ? `linear-gradient(125deg, ${colA}, ${colB})` : "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
              filter: ready ? "none" : "grayscale(0.6)"
            }}
          >
            {!ready && <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-[0.25em] text-white/30">Select two</div>}
          </motion.div>
        </div>
        {/* the two sacrifice slots + the empty third */}
        <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
          {offer.equipped.map((slot, i) => {
            const info = slotInfo(slot);
            const isSel = selected.includes(i);
            const canSelect = !info.empty;
            return (
              <motion.button
                type="button"
                disabled={!canSelect}
                whileTap={canSelect ? { scale: 0.96 } : undefined}
                onClick={() => canSelect && toggle(i)}
                className={cn(
                  "px-panel relative flex cursor-pointer flex-col items-center gap-2 p-4 pt-6 transition-all",
                  !canSelect && "cursor-not-allowed opacity-35",
                  canSelect && !isSel && "hover:-translate-y-0.5",
                  isSel && "-translate-y-1"
                )}
                style={{ borderColor: isSel ? "rgba(240,192,96,0.85)" : `${info.colors[0]}66`, boxShadow: isSel ? "0 0 26px rgba(240,192,96,0.22)" : undefined }}
                key={i}
              >
                <PxBannerTab color={isSel ? "gold" : "violet"}>{isSel ? "Sacrifice" : `Slot ${i + 1}`}</PxBannerTab>
                <div className="flex items-center gap-1.5">
                  {info.colors.map((c, ci) => <span className="size-2.5 rotate-45" style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}` }} key={ci} />)}
                </div>
                <span className={cn("text-center font-serif text-xs font-bold leading-tight sm:text-sm", info.empty ? "text-[#9a8fb5]/50" : "text-[#f2e8c9]")}>{info.name}</span>
                {info.fused && <Badge className="border-[#d9a441]/40 bg-[#d9a441]/10 px-1.5 text-[8px] font-bold uppercase tracking-wider text-[#f0c060]">Fused</Badge>}
              </motion.button>
            );
          })}
        </div>
        <p className="max-w-md text-center text-[11px] leading-relaxed text-[#9a8fb5]">Both are consumed. One fused slot remains, casting each in turn.</p>
        <button
          type="button"
          disabled={!ready}
          onClick={fuse}
          className="px-btn px-btn--primary h-12 w-full max-w-sm"
        >
          {ready ? "Fuse the Resonance" : "Select exactly two spells"}
        </button>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SPELL EVOLUTION (v2.2) — one long-bound spell is offered its final  */
/*  form. Cards carry honest trade-offs; declining keeps the base spell. */
/* ------------------------------------------------------------------ */
export function EvolveOverlay({
  offer,
  onPick
}: {
  offer: EvolveOfferPayload;
  onPick: (evoId: string | null) => void;
}) {
  /* one-shot commit (like the spell offer): a double click can never
   *  submit twice — declining counts as committing too */
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
  return (
    <div className="dark fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 safe-b-4 pt-4 max-sm:items-end">
      <SanctumBackdrop />
      <motion.div
        className="relative my-auto flex max-sm:my-0 max-sm:pb-2 w-full max-w-3xl flex-col items-center gap-5 py-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="relative text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[70px]" style={{ backgroundColor: col }} />
          <h2 className="font-display px-gold-text relative text-balance text-2xl font-black uppercase tracking-[0.1em] sm:text-4xl sm:tracking-[0.14em]">Evolution</h2>
          <p className="relative mt-2 text-xs uppercase tracking-[0.25em] text-[#9a8fb5]">{base.name} has drunk deep of the rift — choose its final form</p>
        </div>
        <HexMedallion color={col} size={56} icon={<img src={assetPath(`/assets/icons/element-${offer.element}.png`)} alt="" width={36} height={36} className="h-9 w-9 [image-rendering:pixelated]" style={{ filter: `drop-shadow(0 0 9px ${col}aa)` }} />} />
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
          {offer.cards.map((evo, i) => {
            const def = evolvedSpellDef(elementId, evo.id);
            return (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.09, duration: 0.3, ease: "easeOut" }}
                className="px-panel relative flex flex-col gap-3 p-4 pt-7"
                style={{ borderColor: `${evo.color}80` }}
                key={evo.id}
              >
                <PxBannerTab color="violet">Evolution</PxBannerTab>
                <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl" style={{ backgroundColor: evo.color }} />
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-serif text-lg font-bold leading-tight text-[#f2e8c9]">{evo.name}</h3>
                  <span className="shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: evo.color, borderColor: `${evo.color}66`, backgroundColor: `${evo.color}14` }}>{evo.tagline}</span>
                </div>
                <p className="flex-1 text-xs leading-relaxed text-[#d8cfe8]/70">{evo.desc}</p>
                {/* trade-offs — diamond bullets (concept 07 consequences) */}
                <ul className="flex flex-col gap-1">
                  {evo.tradeoffs.map(t => (
                    <li className="flex gap-2 text-[11px] leading-relaxed text-[#d8cfe8]/80" key={t}>
                      <PxDiamond small className="mt-1" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-3 gap-2">
                  <StatBox label="Aether" value={`${base.manaCost} → ${def.manaCost}`} color={def.manaCost > base.manaCost ? "#ff8fa3" : "#4ae87a"} />
                  <StatBox label="Cooldown" value={`${base.cooldown}s → ${def.cooldown}s`} color={def.cooldown > base.cooldown ? "#ff8fa3" : "#4ae87a"} />
                  <StatBox label="Damage" value={`${base.baseDamage} → ${def.baseDamage}`} color={def.baseDamage >= base.baseDamage ? "#4ae87a" : "#ff8fa3"} />
                </div>
                <button
                  type="button"
                  onClick={() => pick(evo.id)}
                  aria-label={`Evolve ${base.name} into ${evo.name}`}
                  className="mt-2 h-11 w-full rounded-lg border-2 text-xs font-extrabold uppercase tracking-[0.22em] transition-all active:scale-[0.97]"
                  style={{ borderColor: `${evo.color}80`, backgroundColor: `${evo.color}16`, color: evo.color, boxShadow: `0 0 18px ${evo.color}22` }}
                >
                  Evolve {base.name}
                </button>
                <span aria-hidden className="px-finial" style={{ borderColor: evo.color, background: `linear-gradient(135deg, ${evo.color}, ${evo.color}88)` }} />
              </motion.div>
            );
          })}
        </div>
        <button type="button" onClick={() => pick(null)} className="min-h-11 text-[11px] font-bold uppercase tracking-[0.3em] text-[#9a8fb5]/60 transition-colors hover:text-[#d8cfe8]">
          Keep it as it is
        </button>
      </motion.div>
    </div>
  );
}
