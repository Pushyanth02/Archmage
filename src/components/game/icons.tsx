import type { ElementId } from "@/game/content";

/* All icons are hand-drawn inline SVG — stroke-based, inherit currentColor. */

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function base(props: IconProps) {
  const { size = 18, className, strokeWidth = 1.8 } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

/* ------------------------------ Element glyphs ------------------------------
   Patch 11.0 "The Umbral Requiem" — every element glyph is redrawn to match
   the dark-arcane rebrand: hellmouth flames, grave-ice, gallows sparks,
   ossuary wards, umbral gates, wrathlight, hollow hours, null rifts,
   hexagram eyes, blood tithes, blightspores, soulscythes and banshee dirges.
   Still stroke-based inline SVG, still inheriting currentColor. */

/* Pyroclasm — a three-tongued hellmouth flame with a devouring inner maw. */
export function FireIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 2.5c.6 2.6 3.9 4.4 3.9 8.2 0 1.6-.6 2.9-1.5 3.9.1-1.5-.5-2.6-1.5-3.2.1 2.6-1.3 4-2.9 4.7 1-2.2.6-3.7-.4-4.8-1.5 1.5-2.6 3-2.6 5 0 .5.05 1 .2 1.5A5.7 5.7 0 0 1 6.3 14c0-5 4.9-6.6 5.7-11.5z" />
      <path d="M9.9 17.8c.5-1.7 1.6-2.6 3.1-2.7-.4 1.9.3 3.3 1.9 4.1-1.3.7-3.2 1.4-4.4-.4-.3-.5-.5-.7-.6-1z" />
    </svg>
  );
}

/* Gravefrost — a coffin-slab of grave-ice, fractured down the seam. */
export function IceIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 2.5h6l2.5 4-3 12h-5l-3-12z" />
      <path d="M10.2 4.5h3.6l1.6 2.6-2.2 8.6h-2.4l-2.2-8.6z" opacity="0.55" />
      <path d="M12 4.5v15" />
      <path d="M12 4.5 10.6 8l1.4 1.6L10.4 12l1.6 2-1.2 2.6M12 4.5l1.4 3.5L12 9.6l1.6 2.4-1.6 2 1.2 2.6" opacity="0.7" />
    </svg>
  );
}

/* Wraithbolt — a gallows spark: jagged bolt trailed by a spectral echo. */
export function BoltIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 2 5 13.5h5L9.5 22 19 10h-5.5L13.5 2z" />
      <path d="M17.5 5.5 15.5 8" opacity="0.5" />
      <path d="M19 8.5l-1.4 1.8" opacity="0.4" />
    </svg>
  );
}

/* Gravewarden — an ossuary tombstone ward with rune scratch. */
export function EarthIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 20V9a5 5 0 0 1 10 0v11" />
      <path d="M4.5 20h15" />
      <path d="M12 7.5v3M10.5 9h3" />
      <path d="M9.5 13.5l1.6 1.6M14.5 13.5l-1.6 1.6" opacity="0.7" />
    </svg>
  );
}

/* Umbral Passage — the archway into the long dark, hemmed by shadow. */
export function ShadowIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.5 21V12a5.5 5.5 0 0 1 11 0v9" />
      <path d="M3.5 21h17" />
      <path d="M12 8.2v6" opacity="0.8" />
      <path d="M12 15.8c-1.3 0-2.2-.9-2.4-2.1M12 15.8c1.3 0 2.2-.9 2.4-2.1" opacity="0.6" />
    </svg>
  );
}

/* Lance of Judgment — wrathlight: a piercing shaft crowned with a halo. */
export function LightIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 2v20" />
      <path d="M12 2 9.8 6.4M12 2l2.2 4.4" />
      <path d="M8.4 9.6 12 7.6l3.6 2" />
      <path d="M6 12h12" />
      <path d="M7.6 16.5h8.8" opacity="0.7" />
      <path d="M9.2 20h5.6" opacity="0.45" />
    </svg>
  );
}

/* Chronoshroud — an hourglass wrapped in the frozen hour's circle. */
export function TimeIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9.4" opacity="0.55" />
      <path d="M8 3.5h8M8 20.5h8" />
      <path d="M8 3.5v3.2c0 2.8 4 4.3 4 5.3s-4 2.5-4 5.3v3.2M16 3.5v3.2c0 2.8-4 4.3-4 5.3s4 2.5 4 5.3v3.2" />
      <path d="M12 12.6v3.4" opacity="0.7" />
    </svg>
  );
}

/* Null Rift — a vertical tear in the world, matter bending into it. */
export function VoidIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5c2.2 3.4 3.6 5.4 3.6 8.5s-1.4 5.1-3.6 8.5c-2.2-3.4-3.6-5.4-3.6-8.5S9.8 6.9 12 3.5z" />
      <path d="M12 7.5v9" opacity="0.7" />
      <path d="M4.5 8c1.8.8 2.9 2.2 3.3 4M19.5 8c-1.8.8-2.9 2.2-3.3 4" opacity="0.6" />
      <path d="M3.5 13.5c2 .2 3.4 1 4.2 2.3M20.5 13.5c-2 .2-3.4 1-4.2 2.3" opacity="0.4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

/* Hexweave Fan — the thousand-eye hexagram, a watching rune knot. */
export function ArcaneIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.6 4.8 16.2h14.4z" />
      <path d="M12 20.4 4.8 7.8h14.4z" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="0.7" fill="currentColor" />
    </svg>
  );
}

/* Crimson Requiem — the tithe: a blood drop transfixed by a thorn. */
export function BloodIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 2.5s7 7.5 7 12.2a7 7 0 0 1-14 0C5 10 12 2.5 12 2.5z" />
      <path d="M8.2 14.5c0 1.9 1.2 3.4 2.9 3.9" />
      <path d="M9.5 8.5l5 8M14.5 8.5l-5 8" opacity="0.55" />
    </svg>
  );
}

/* Blightspore — a wilted bloom dropping rot into the garden. */
export function NatureIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 21v-8" />
      <path d="M12 13c0-4 2.6-6.6 7-7-.4 4.6-3 7-7 7z" />
      <path d="M12 13c0-3-2-5-5.4-5.3.3 3.6 2.2 5.3 5.4 5.3z" />
      <circle cx="7" cy="19" r="0.7" fill="currentColor" />
      <circle cx="17.5" cy="18" r="0.7" fill="currentColor" />
      <circle cx="15" cy="21.3" r="0.7" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

/* Patch 9.0 glyphs — Soulscythe & Dirge Nova (redrawn for the rebrand). */

/* Soulscythe — the hollow gale: a reaping crescent trailed by wind lines. */
export function WindIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20.5 4.5A9 9 0 1 0 20.5 16" />
      <path d="M20.5 4.5v4h-4" />
      <path d="M8 12h6.5" opacity="0.6" />
      <path d="M6.5 16h5" opacity="0.45" />
    </svg>
  );
}

/* Dirge Nova — the banshee's cry: a tolling bell wrapped in sound rings. */
export function SonicIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5c3 0 5 2.2 5 5.5l1.2 5.5H5.8L7 9c0-3.3 2-5.5 5-5.5z" />
      <path d="M10 17.5a2 2 0 0 0 4 0" />
      <path d="M3.5 8.5a2.6 2.6 0 0 1 2-2.4M20.5 8.5a2.6 2.6 0 0 0-2-2.4" opacity="0.55" />
      <path d="M2.5 13a6.5 6.5 0 0 1 2.5-4.5M21.5 13a6.5 6.5 0 0 0-2.5-4.5" opacity="0.35" />
      <circle cx="12" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Patch 9.0 — rotate-your-screen glyph (forced-landscape overlay) */
export function RotateIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="7" y="3" width="10" height="18" rx="2.2" />
      <path d="M10.8 18.6h2.4" />
      <path d="M20.5 8.5a9 9 0 0 1 1 4.5M21.5 6.5v3h-3" />
    </svg>
  );
}

export function SpellIcon({ id, ...p }: IconProps & { id: ElementId }) {
  switch (id) {
    case "fire": return <FireIcon {...p} />;
    case "ice": return <IceIcon {...p} />;
    case "lightning": return <BoltIcon {...p} />;
    case "earth": return <EarthIcon {...p} />;
    case "shadow": return <ShadowIcon {...p} />;
    case "light": return <LightIcon {...p} />;
    case "time": return <TimeIcon {...p} />;
    case "void": return <VoidIcon {...p} />;
    case "arcane": return <ArcaneIcon {...p} />;
    case "blood": return <BloodIcon {...p} />;
    case "nature": return <NatureIcon {...p} />;
    case "wind": return <WindIcon {...p} />;
    case "sonic": return <SonicIcon {...p} />;
  }
}

/* -------------------------------- Boon icons -------------------------------- */

export function BoonIcon({ name, ...p }: IconProps & { name: string }) {
  switch (name) {
    case "sword":
      return (
        <svg {...base(p)}>
          <path d="M4 20l2.5-2.5M14.5 4 20 3l-1 5.5L8.5 19 5 15.5 14.5 4z" />
          <path d="M5 15.5 4 20l4.5-1" />
        </svg>
      );
    case "hourglass": return <TimeIcon {...p} />;
    case "heart":
      return (
        <svg {...base(p)}>
          <path d="M12 20.5S3.5 15 3.5 8.9A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.5 2.5c0 6.1-8.5 11.6-8.5 11.6z" />
        </svg>
      );
    case "leaf":
      return (
        <svg {...base(p)}>
          <path d="M5 19C5 9 11 4.5 20 4c-.5 9-5 15-15 15z" />
          <path d="M5 19c2-5.5 5.5-9.5 10-12" />
        </svg>
      );
    case "drop":
      return (
        <svg {...base(p)}>
          <path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z" />
          <path d="M9 14.5a3 3 0 0 0 2 2.8" />
        </svg>
      );
    case "mind":
      return (
        <svg {...base(p)}>
          <path d="M12 3a9 9 0 1 0 9 9" />
          <path d="M12 7a5 5 0 1 0 5 5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </svg>
      );
    case "boot":
      return (
        <svg {...base(p)}>
          <path d="M6 3h6v8l6 4.5c1 .8.5 3.5-1.5 3.5H6z" />
          <path d="M6 14h5" />
        </svg>
      );
    case "star":
      return (
        <svg {...base(p)}>
          <path d="m12 2.8 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.1l6.1-.7L12 2.8z" />
        </svg>
      );
    case "arrows":
      return (
        <svg {...base(p)}>
          <path d="M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4" />
        </svg>
      );
    case "rings":
      return (
        <svg {...base(p)}>
          <circle cx="9" cy="12" r="5.5" />
          <circle cx="15" cy="12" r="5.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...base(p)}>
          <path d="M12 3 5 5.5v6c0 4.6 3 8.1 7 9.5 4-1.4 7-4.9 7-9.5v-6L12 3z" />
          <path d="M9 11.5l2.2 2.2L15.5 9" />
        </svg>
      );
    case "settings":
      return (
        <svg {...base(p)}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
        </svg>
      );
    case "bolt": return <BoltIcon {...p} />;
    case "fang":
      return (
        <svg {...base(p)}>
          <path d="M7 3c-1 6 1 14 5 18 4-4 6-12 5-18-2.5 2-7.5 2-10 0z" />
          <path d="M12 8v6" />
        </svg>
      );
    case "gem":
      return (
        <svg {...base(p)}>
          <path d="M7 3h10l4 6-9 12L3 9l4-6z" />
          <path d="M3 9h18M12 21 8.5 9 12 3l3.5 6L12 21z" />
        </svg>
      );
    case "fan":
      return (
        <svg {...base(p)}>
          <path d="M12 20 5 4.5M12 20 12 3M12 20l7-15.5" />
          <path d="M8.6 8.5a9 9 0 0 1 6.8 0" opacity="0.75" />
          <circle cx="12" cy="20" r="1" fill="currentColor" />
        </svg>
      );
    case "target":
      return (
        <svg {...base(p)}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.6" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="0.7" fill="currentColor" />
        </svg>
      );
    case "reach":
      return (
        <svg {...base(p)}>
          <path d="M3 12h13M13 8.5 16.5 12 13 15.5" />
          <path d="M19 5v14" opacity="0.7" />
          <circle cx="5.5" cy="12" r="1.6" />
        </svg>
      );
    case "hand":
      return (
        <svg {...base(p)}>
          <path d="M8 12V5.8a1.5 1.5 0 0 1 3 0V11m0-5.2a1.5 1.5 0 0 1 3 0V11m0-3.7a1.5 1.5 0 0 1 3 0V13c0 4.5-2.5 8-6.5 8-3 0-4.6-1.6-6-4.5L3 13.6a1.6 1.6 0 0 1 2.6-1.8L8 14" />
        </svg>
      );
    case "volley":
      return (
        <svg {...base(p)}>
          <path d="M4 17 18 5M4 17l3.5-.8M4 17l.8-3.5" />
          <circle cx="7.5" cy="8" r="1.4" />
          <circle cx="11" cy="12.5" r="1.4" />
          <circle cx="16.5" cy="9.5" r="1.4" />
          <circle cx="14.5" cy="17" r="1.4" />
        </svg>
      );
    default: return <SpellIcon id="void" {...p} />;
  }
}

/* --------------------------------- UI icons --------------------------------- */

export function UiIcon({ name, ...p }: IconProps & { name: string }) {
  switch (name) {
    case "pause":
      return (
        <svg {...base(p)}>
          <path d="M8.5 5v14M15.5 5v14" strokeWidth={2.4} />
        </svg>
      );
    case "play":
      return (
        <svg {...base(p)}>
          <path d="M7 4.5 19 12 7 19.5z" />
        </svg>
      );
    case "sound":
      return (
        <svg {...base(p)}>
          <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
          <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
        </svg>
      );
    case "mute":
      return (
        <svg {...base(p)}>
          <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" />
          <path d="m16 9.5 5 5M21 9.5l-5 5" />
        </svg>
      );
    case "skull":
      return (
        <svg {...base(p)}>
          <path d="M12 2.5a8 8 0 0 0-8 8c0 2.9 1.5 5 3.5 6.4V20a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 16.5 20v-3.1c2-1.4 3.5-3.5 3.5-6.4a8 8 0 0 0-8-8z" />
          <circle cx="8.8" cy="11" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="15.2" cy="11" r="1.7" fill="currentColor" stroke="none" />
          <path d="M10.5 21v-2.4M13.5 21v-2.4M12 14.5l-.9 2h1.8z" />
        </svg>
      );
    case "gem": return <BoonIcon name="gem" {...p} />;
    case "settings": return <BoonIcon name="settings" {...p} />;
    case "shield": return <BoonIcon name="shield" {...p} />;
    case "heart": return <BoonIcon name="heart" {...p} />;
    case "sword": return <BoonIcon name="sword" {...p} />;
    /* Patch 10.1 — bolt glyph for the attunement status chip */
    case "bolt": return <BoonIcon name="bolt" {...p} />;
    case "book":
      return (
        <svg {...base(p)}>
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22z" />
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M8 6.5h8M8 10h5" />
        </svg>
      );
    case "dice":
      return (
        <svg {...base(p)}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "gate":
      return (
        <svg {...base(p)}>
          <path d="M4 21V8l8-5 8 5v13" />
          <path d="M9 21v-8a3 3 0 0 1 6 0v8M2 21h20" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...base(p)}>
          <path d="M20 5v5h-5" />
          <path d="M20 10a8 8 0 1 0 2 5.3" opacity="0" />
          <path d="M19.5 10A8 8 0 1 0 20 14" />
        </svg>
      );
    case "wave":
      return (
        <svg {...base(p)}>
          <path d="M2.5 12c1.6-4 3.2-6 4.8-6s3.2 2 4.7 6 3.1 6 4.7 6 3.2-2 4.8-6" />
        </svg>
      );
    /* Patch 10.1 — fullscreen toggle glyphs (four-corner arrows) */
    case "expand":
      return (
        <svg {...base(p)}>
          <path d="M14 4h6v6M10 4H4v6M14 20h6v-6M10 20H4v-6" />
        </svg>
      );
    case "compress":
      return (
        <svg {...base(p)}>
          <path d="M20 14h-6v6M4 14h6v6M20 10h-6V4M4 10h6V4" />
        </svg>
      );
    case "github":
      return (
        <svg {...base(p)} viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
      );
    default: return null;
  }
}
