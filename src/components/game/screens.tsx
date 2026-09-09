import { useMemo, useState } from "react";
import {
  ALL_PAIRS, ASSET_BASE, BOSS_DEFS, BOSS_ORDER, COMBOS, COMBO_COUNT, ELITE_DEFS, ELITE_ORDER, ElementId,
  ENEMY_DEFS, ENEMY_ORDER, EnemyDef, MAX_UPGRADE_LEVEL, MERCY_MAX_TIER, MetaSave, SPELLS, SPELL_ORDER,
  UpgradeChoice, comboKey, hashSeed, mercyTierBase, mulberry32, trackCost,
} from "@/game/content";
import { RunStats } from "@/game/engine";
import { useArchmageStore, sfx } from "@/game/store";
import { BoonIcon, SpellIcon, UiIcon } from "./icons";
import { BossSigil } from "./overlays";
import { useIsTouchDevice } from "./useIsTouchDevice";
import { useFullscreen } from "./useFullscreen";

/* ------------------------------ shared bits ------------------------------ */

export function Corners() {
  return (
    <>
      <span className="corner tl" /><span className="corner tr" />
      <span className="corner bl" /><span className="corner br" />
    </>
  );
}

export function ElementPill({ id, size = 14 }: { id: ElementId; size?: number }) {
  const sp = SPELLS[id];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-[11px] font-bold uppercase tracking-wider"
      style={{ color: sp.color, borderColor: sp.color + "66", background: sp.color + "14" }}
    >
      <SpellIcon id={id} size={size} />
      {sp.name}
    </span>
  );
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ============================================================================
   CoverSigil — Patch 7.0 procedural cover art.
   ----------------------------------------------------------------------------
   The game ships exactly ONE image (the menu cover). Everything else that
   wants art is GENERATED: this component paints a seeded rune-cover — layered
   gradients, rotating dashed rings, a polygon constellation and orbiting
   studs in the caller's accent color. Same seed ⇒ same art, so every Arcanum
   entry has a stable identity, while the featured header cover can be
   re-rolled at will for a fresh random cover. */

export function CoverSigil({
  seed, accent, glow, size = 300, children, className,
}: {
  seed: string;
  accent: string;
  glow?: string;
  size?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const art = useMemo(() => {
    const rng = mulberry32(hashSeed(seed));
    const hue = () => rng.next();
    /* background gradient stops */
    const cx = 30 + hue() * 40, cy = 26 + hue() * 36;
    /* large translucent polygons */
    const polys = Array.from({ length: 2 + Math.floor(hue() * 2) }, () => {
      const n = 3 + Math.floor(hue() * 4);
      const rot = hue() * 360;
      const r = 26 + hue() * 22;
      const cxp = 22 + hue() * 56, cyp = 20 + hue() * 60;
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + (rot * Math.PI) / 180;
        return `${cxp + Math.cos(a) * r},${cyp + Math.sin(a) * r}`;
      }).join(" ");
      return { pts, op: 0.08 + hue() * 0.14, stroke: hue() > 0.5 };
    });
    /* orbiting studs on the outer ring */
    const studs = Array.from({ length: 4 + Math.floor(hue() * 5) }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + hue() * 0.7;
      const r = 40 + hue() * 6;
      return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r, s: 1.6 + hue() * 2.4 };
    });
    /* radial rays */
    const rays = Array.from({ length: 6 + Math.floor(hue() * 6) }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 + hue() * 0.4;
      const inner = 16 + hue() * 8;
      const outer = 30 + hue() * 14;
      return {
        x1: 50 + Math.cos(a) * inner, y1: 50 + Math.sin(a) * inner,
        x2: 50 + Math.cos(a) * outer, y2: 50 + Math.sin(a) * outer,
      };
    });
    return { cx, cy, polys, studs, rays };
  }, [seed]);

  const gid = `cover-${hashSeed(seed).toString(36)}-${Math.round(size)}`;
  const soft = glow ?? accent;
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <radialGradient id={gid} cx={`${art.cx}%`} cy={`${art.cy}%`} r="75%">
          <stop offset="0%" stopColor={soft} stopOpacity="0.34" />
          <stop offset="45%" stopColor={accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0d0919" stopOpacity="0.92" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      {art.polys.map((p, i) => (
        <polygon
          key={i}
          points={p.pts}
          fill={i % 2 ? accent : soft}
          fillOpacity={p.op}
          stroke={p.stroke ? soft : "none"}
          strokeOpacity="0.35"
          strokeWidth="0.6"
        />
      ))}
      {art.rays.map((r, i) => (
        <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={soft} strokeOpacity="0.28" strokeWidth="0.7" />
      ))}
      <circle cx="50" cy="50" r="45" fill="none" stroke={accent} strokeOpacity="0.6" strokeWidth="0.9" strokeDasharray="8 6" className="sigil-spin" />
      <circle cx="50" cy="50" r="36" fill="none" stroke={soft} strokeOpacity="0.4" strokeWidth="0.7" strokeDasharray="2 8" className="sigil-spin-rev" />
      {art.studs.map((s, i) => (
        <rect key={i} x={s.x - s.s / 2} y={s.y - s.s / 2} width={s.s} height={s.s} fill={soft} fillOpacity="0.8" transform={`rotate(45 ${s.x} ${s.y})`} />
      ))}
      {children}
    </svg>
  );
}

function MenuBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% 38%, rgba(88,58,160,0.28), transparent 62%)," +
            "radial-gradient(700px 500px at 18% 85%, rgba(208,91,255,0.10), transparent 60%)," +
            "radial-gradient(700px 500px at 85% 12%, rgba(67,232,216,0.08), transparent 60%)",
        }}
      />
      <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.16] anim-spin-slow" width="760" height="760" viewBox="0 0 760 760" fill="none">
        <circle cx="380" cy="380" r="360" stroke="#f5c96b" strokeWidth="1.5" strokeDasharray="16 12" />
        <circle cx="380" cy="380" r="300" stroke="#9a7bff" strokeWidth="1" strokeDasharray="4 16" />
        <circle cx="380" cy="380" r="238" stroke="#f5c96b" strokeWidth="1" />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const x = 380 + Math.cos(a) * 330, y = 380 + Math.sin(a) * 330;
          return <rect key={i} x={x - 9} y={y - 9} width="18" height="18" transform={`rotate(45 ${x} ${y})`} stroke="#f5c96b" strokeWidth="1.4" />;
        })}
      </svg>
      {Array.from({ length: 26 }).map((_, i) => (
        <span
          key={i}
          className="mote"
          style={{
            left: `${(i * 37) % 100}%`,
            top: `${(i * 53) % 100}%`,
            animationDelay: `${(i % 10) * 0.7}s`,
            animationDuration: `${7 + (i % 6) * 2}s`,
            width: `${2 + (i % 3)}px`,
            height: `${2 + (i % 3)}px`,
          }}
        />
      ))}
    </div>
  );
}

function KeyRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="flex gap-1">
        {keys.map((k) => <span key={k} className="keycap">{k}</span>)}
      </span>
      <span className="text-[13px] text-[#b9aee0]">{label}</span>
    </div>
  );
}

/* Patch 10.0 — device-specific "Rite of Control": the touch rite mirrors
   KeyRow's shape with touch-chip badges instead of keycaps, so the menu
   teaches the REAL controls on the device it's opened on. */
function TouchRow({ badge, label }: { badge: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="touch-chip">{badge}</span>
      <span className="text-[13px] text-[#b9aee0]">{label}</span>
    </div>
  );
}

/* --------------------------------- title ---------------------------------- */

const AIM_LABELS = ["Off", "Standard", "Strong"];
const GFX_LABELS = ["Low", "Medium", "High"];

interface MenuProps {
  chapter: string;
  chapterSubtitle: string;
  onStart: () => void;
}

/* Patch 7.0: the menu reads the Zustand store directly. The Codex is now THE
   ARCANUM (renamed + rebuilt); the release panel advertises Version 1.0;
   buttons chirp on hover via the new uiHover voice. */
export function MenuScreen({ chapter, chapterSubtitle, onStart }: MenuProps) {
  const meta = useArchmageStore((s) => s.meta);
  const seed = useArchmageStore((s) => s.seed);
  const setSeed = useArchmageStore((s) => s.setSeed);
  const randomizeSeed = useArchmageStore((s) => s.randomizeSeed);
  const setScreen = useArchmageStore((s) => s.setScreen);
  const openSettings = useArchmageStore((s) => s.openSettings);
  const patchSettings = useArchmageStore((s) => s.patchSettings);
  /* Patch 10.0 — the Rite of Control teaches the controls the CURRENT
     device actually uses: keyboard/mouse rite on desktop, touch rite on
     phones/tablets. Never both. */
  const isTouch = useIsTouchDevice();
  /* V1.1 — the fullscreen switch lives as an ICON in the top-right utility
     cluster (beside Settings and Sound). One tap still carries the user
     gesture the Fullscreen API demands on ANY device, the state flips live
     (expand ⇄ compress glyph), and unsupported browsers (iPhone Safari)
     hide the button entirely. */
  const fs = useFullscreen();
  const muted = meta.settings.master <= 0;
  const toggleMute = () => patchSettings({ master: muted ? 80 : 0 });
  const hover = () => sfx.uiHover();
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* cover art backdrop — the ONE image the game ships */}
      <div className="cover-backdrop" aria-hidden>
        <img src={`${ASSET_BASE}/art/cover.png`} alt="" draggable={false} />
        <div className="cover-veil" />
      </div>
      <MenuBackdrop />
      <div className="rune-frame absolute inset-0 pointer-events-none"><Corners /></div>

      {/* GitHub repo link — top-left corner */}
      <a
        href="https://github.com/Pushyanth02/Archmage"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-6 left-6 z-20 btn-ghost px-3 py-2 text-[#e9e2ff] hover:text-[#ffe9ad] flex items-center gap-2 transition-colors"
        title="View source on GitHub"
        aria-label="Open GitHub repository"
        onMouseEnter={hover}
      >
        <UiIcon name="github" size={18} />
        <span className="hidden sm:inline text-[11px] font-bold uppercase tracking-[0.14em]">GitHub</span>
      </a>

      {/* V1.1 — the top-right utility cluster: FULLSCREEN (icon, live
          state), Settings, Sound — one compact row, identical sizing and
          spacing, 44px touch targets on every device. */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        {fs.supported && (
          <button
            onClick={() => { sfx.click(); void fs.toggle(); }}
            onMouseEnter={hover}
            aria-pressed={fs.isFullscreen}
            aria-label={fs.isFullscreen ? "Leave fullscreen" : "Enter fullscreen — play edge-to-edge on any device"}
            className={`btn-ghost px-3 py-2 flex items-center transition-colors ${
              fs.isFullscreen ? "text-[#6bf0c2] hover:text-[#a5ffd9]" : "text-[#e9e2ff] hover:text-[#ffe9ad]"
            }`}
            title={fs.isFullscreen ? "Leave fullscreen" : "Enter fullscreen — play edge-to-edge on any device"}
          >
            <UiIcon name={fs.isFullscreen ? "compress" : "expand"} size={18} />
          </button>
        )}
        <button
          onClick={openSettings}
          onMouseEnter={hover}
          className="btn-ghost px-3 py-2 text-[#e9e2ff] hover:text-[#ffe9ad]"
          title="Settings — audio, graphics, gameplay, data"
          aria-label="Open settings"
        >
          <UiIcon name="settings" size={18} />
        </button>
        <button
          onClick={toggleMute}
          onMouseEnter={hover}
          className="btn-ghost px-3 py-2 text-[#e9e2ff] hover:text-[#ffe9ad]"
          title="Toggle sound (M)"
          aria-label={muted ? "Unmute sound" : "Mute sound"}
        >
          <UiIcon name={muted ? "mute" : "sound"} size={18} />
        </button>
      </div>

      <div className="relative z-10 w-full flex flex-col items-center text-center px-6 max-h-full overflow-y-auto py-8">
        <div className="anim-fade-up flex items-center gap-3 text-[#9a7bff]">
          <span className="h-px w-16 bg-linear-to-r from-transparent to-[#9a7bff]" />
          <span className="text-[12px] font-bold uppercase tracking-[0.42em]">Rift Survivor</span>
          <span className="h-px w-16 bg-linear-to-l from-transparent to-[#9a7bff]" />
        </div>

        <h1 className="anim-fade-up-1 font-display title-glow text-[#f5e3b3] font-black leading-none mt-4 text-[clamp(52px,9vw,110px)] tracking-[0.08em]">
          ARCHMAGE
        </h1>

        {/* V1.1 — prominent release badge: the version branding reads
            at a glance on every device, right under the title. */}
        <div className="anim-fade-up-2 mt-3 flex items-center gap-2.5" aria-label="Version 1.1 patch — True Direction">
          <span className="px-3.5 py-1 border border-[rgba(245,201,107,0.65)] bg-[rgba(245,201,107,0.1)] text-[#f5c96b] text-[11px] font-black uppercase tracking-[0.26em]">
            Version 1.1
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9a7bff]">True Direction · Live Patch</span>
        </div>

        <p className="anim-fade-up-2 mt-3 max-w-xl text-[15px] leading-relaxed text-[#b9aee0] italic">
          Thirteen dark arts. Seventy-eight resonances. Five tyrants that shuffle with every seed.
          Weave the requiem fast enough and the abyss itself learns your name.
        </p>

        {/* chapter progress */}
        <div className="anim-fade-up-2 mt-4 rune-panel px-6 py-2.5 flex items-center gap-4">
          <UiIcon name="gate" size={20} />
          <div className="text-left">
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#6bf0c2]">Current biome</div>
            <div className="font-display font-bold text-lg text-[#f0e8ff] leading-tight">{chapter}</div>
            <div className="text-[11px] italic text-[#8f7bff]">{chapterSubtitle}</div>
          </div>
          {meta.victories > 0 && (
            <div className="ml-2 text-left border-l border-[rgba(245,201,107,0.35)] pl-4">
              <div className="font-display font-black text-2xl text-[#ffe9ad]">{meta.victories}</div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-[#8f7bff]">sealings</div>
            </div>
          )}
        </div>

        <div className="anim-fade-up-2 mt-4 flex items-center gap-2">
          <label htmlFor="rift-seed" className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#8f7bff]">Rift seed</label>
          <input
            id="rift-seed"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onStart(); }}
            spellCheck={false}
            className="w-40 bg-[#120b24] border border-[rgba(154,123,255,0.32)] px-3 py-1.5 text-sm text-[#ffe9ad] font-bold tracking-widest text-center outline-none focus:border-[#f5c96b] transition-colors"
          />
          <button
            className="btn-ghost px-2.5 py-1.5"
            title="Randomize seed"
            onClick={randomizeSeed}
            onMouseEnter={hover}
          >
            <UiIcon name="dice" size={16} />
          </button>
        </div>

        <button onClick={onStart} onMouseEnter={hover} className="anim-fade-up-3 btn-gold mt-3 px-12 py-4 text-lg flex items-center gap-3">
          <UiIcon name="gate" size={22} />
          Enter the Rift
        </button>

        <div className="anim-fade-up-3 mt-4 flex flex-wrap justify-center gap-3">
          <button onClick={() => setScreen("sanctum")} onMouseEnter={hover} className="btn-ghost px-5 py-2.5 text-sm flex items-center gap-2" title="The Reliquary — permanent upgrades bought with aether glyphs">
            <UiIcon name="gem" size={16} />
            Reliquary
            <span className="text-[#ffe9ad] font-black">{meta.shards}</span>
          </button>
          <button onClick={() => setScreen("arcanum")} onMouseEnter={hover} className="btn-ghost px-5 py-2.5 text-sm flex items-center gap-2">
            <UiIcon name="book" size={16} />
            Arcanum
            <span className="text-[#ffe9ad] font-black">{meta.combosFound.length}/{COMBO_COUNT}</span>
          </button>
          <button onClick={openSettings} onMouseEnter={hover} className="btn-ghost px-5 py-2.5 text-sm flex items-center gap-2">
            <UiIcon name="settings" size={16} />
            Settings
          </button>
        </div>

        {/* quick gameplay toggles — full panel lives in Settings */}
        <div className="anim-fade-up-3 mt-4 rune-panel px-6 py-3 flex flex-col sm:flex-row gap-x-10 gap-y-3 items-center">
          <div className="flex items-center gap-3">
            <UiIcon name="target" size={16} />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b9aee0]">Aim assist</span>
            <div className="flex" role="group" aria-label="Aim assist level">
              {AIM_LABELS.map((lbl, lvl) => (
                <button
                  key={lbl}
                  onClick={() => { sfx.click(); useArchmageStore.getState().patchSettings({ aimAssist: lvl as 0 | 1 | 2 }); }}
                  aria-pressed={meta.settings.aimAssist === lvl}
                  className={`aim-seg ${meta.settings.aimAssist === lvl ? "on" : ""}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer" title="Rift Mercy — a per-death assist ladder: every fall banks a tier (defense, attack, fewer spawns, softer foes). A triumph clears it.">
            <input
              type="checkbox"
              checked={meta.settings.mercy}
              onChange={(e) => { sfx.click(); useArchmageStore.getState().patchSettings({ mercy: e.target.checked }); }}
              className="accent-[#f5c96b] w-4 h-4"
            />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b9aee0]">
              Rift Mercy {meta.settings.mercy && <span className="text-[#6bf0c2]">(per-death ladder)</span>}
            </span>
          </label>
        </div>

        <div className="anim-fade-up-3 mt-4 grid grid-cols-1 sm:grid-cols-[auto_auto] gap-x-14 gap-y-1 rune-panel px-7 py-3 text-left">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-1.5">Rite of Control</div>
            {isTouch ? (
              /* Patch 10.0 — the TOUCH rite: only the gestures a phone/tablet
                 actually has. Landscape + docked controls, one thumb per zone. */
              <>
                <TouchRow badge="LEFT STICK" label="Drag anywhere — move the Archmage" />
                <TouchRow badge="HOLD FIRE" label="Auto-target cast — hold to keep attacking" />
                <TouchRow badge="HOLD VOLLEY" label="Arcane bolts seek the nearest foe while held" />
                <TouchRow badge="SPELL" label="Tap to cycle your bound spells" />
                <TouchRow badge="DASH" label="Blink step — brief immunity" />
                <TouchRow badge="SURGE" label="Unleash the Weave Surge when full" />
                <TouchRow badge="ARCHMAGE" label="Autopilot — the rift plays itself" />
                <TouchRow badge="STRIP" label="Tap any rune to cast it outright" />
              </>
            ) : (
              <>
                <KeyRow keys={["W", "A", "S", "D"]} label="Move the Archmage" />
                <KeyRow keys={["LMB"]} label="Cast the chosen rune — the weave bends toward foes" />
                <KeyRow keys={["RMB"]} label="Arcane volley — bolts seek the nearest foe on their own" />
                <KeyRow keys={["CLICK"]} label="Click any rune in the bar to cast it outright" />
                <KeyRow keys={["WHEEL"]} label="Cycle your bound spells (or Q / E, or 1–0)" />
                <KeyRow keys={["F"]} label="Unleash the Weave Surge when the meter is full" />
                <KeyRow keys={["SPACE"]} label="Blink step (brief immunity)" />
                <KeyRow keys={["P"]} label="Suspend the trial" />
              </>
            )}
          </div>
          <div className="sm:border-l sm:border-[rgba(154,123,255,0.32)] sm:pl-10">
            <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-1.5">The Old Ledger</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 py-2">
              <div><div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.bestWave}</div><div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Best wave</div></div>
              <div><div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.runs}</div><div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Trials</div></div>
              <div><div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.totalKills.toLocaleString()}</div><div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Foes felled</div></div>
              <div><div className="font-display text-2xl font-bold text-[#ffe9ad]">{meta.combosFound.length}<span className="text-base text-[#8f7bff]">/{COMBO_COUNT}</span></div><div className="text-[11px] uppercase tracking-wider text-[#8f7bff]">Resonances</div></div>
            </div>
            <p className="text-[12px] text-[#8f7bff] italic max-w-[260px]">
              Cast two elements within a breath to discover a resonance. Fell a tyrant — or touch a rift shrine — to transmute a spell forever.
            </p>
          </div>
        </div>

        {/* V1.1 — THE PATCH LEDGER: the live patch's release notes on top
            (mirrors CHANGELOG.md "Version 1.1 — True Direction"), with the
            V1.0 release highlights preserved beneath as the foundation. */}
        <div className="anim-fade-up-3 mt-4 w-full max-w-2xl border border-[rgba(154,123,255,0.28)] bg-[rgba(18,11,36,0.75)] px-6 py-3 text-left">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#6bf0c2]">Version 1.1 — True Direction</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f5c96b]">latest patch</div>
          </div>
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-[12.5px] text-[#c9bdf0] list-none">
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> Floating analog stick — touch movement maps your finger 1:1, every angle</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> DASH above Weave, VOLLEY beside it — one thumb owns the whole arsenal</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> Customizable touch UI — size, opacity, stick model, handedness</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> Fairer fights — live-aim telegraphs, range gates, elite speed cap</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> 60 fps held — baked mote sprites, cached fonts &amp; gradients, no dispatch storms</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> Fullscreen one-tap icon in the top-right corner, beside settings &amp; sound</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> A 9px label floor and fully labeled touch controls for accessibility</li>
            <li className="flex gap-2"><span className="text-[#f5c96b]">◆</span> Full brand pass — icons, favicons &amp; banners for every device and crawler</li>
          </ul>
          {/* V1.0 foundation */}
          <div className="mt-2.5 border-t border-[rgba(154,123,255,0.25)] pt-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#8f7bff] mb-1">V1.0 — The Sealed Rift</div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-[12px] text-[#b9aee0] list-none">
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> The attunement curve — your magic grows with the rift</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> The weave hunts the marked — elites take +35% spell damage</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> Aether glyphs — every pickup registers live and pays post-run</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> The Reliquary — four permanent tracks bound to your soul</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> Wave 50 seals the rift — credits, then Return or endless Fight</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> Five tyrant minds — stampede, shockwave, waltz, spiral, storm</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> Loadout-aware loot — the rift only offers what you can wield</li>
              <li className="flex gap-2"><span className="text-[#43e8d8]">◆</span> The Fateweaver — an autopilot that never casts through walls</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- reliquary -------------------------------- */

export interface TrackDef { key: keyof MetaSave["upgrades"]; name: string; lore: string; icon: string; color: string; effect: (lvl: number) => string }

/* Version 1.0 — THE RELIQUARY (formerly the Sanctum): balanced scaling.
   Effects:
   - Vitality: +20/lvl (cap +120 HP at lvl 6)
   - Power:    +8%/lvl (cap +48% spell damage at lvl 6)
   - Focus:    +12 mana/lvl, +10%/lvl regen (cap +72 mana, +60% regen)
   - Swiftness: +6%/lvl (cap +36% move speed)
   trackCost curve: 20 + 18·lvl + 8·lvl² (lvl 0=20, 1=46, 2=84, 3=134, 4=196, 5=270, 6=356).
   MAX_UPGRADE_LEVEL=6 caps progression so high-tier players can fully max
   every track without unbounded snowballing. All boosts apply LIVE from the
   first frame of the next run (engine reads computeBonuses at construction:
   max HP, max aether, spell power, aether regen, move speed). */
export const TRACKS: TrackDef[] = [
  { key: "vitality", name: "Vitality", lore: "Heartwood grafts from the World-Root.", icon: "heart", color: "#ff4d6b", effect: (l) => `${100 + l * 20} → ${100 + (l + 1) * 20} max health` },
  { key: "power", name: "Power", lore: "Runes etched deeper into the staff.", icon: "sword", color: "#f5c96b", effect: (l) => `${100 + l * 8}% → ${100 + (l + 1) * 8}% spell damage` },
  { key: "focus", name: "Focus", lore: "The well beneath the reliquary deepens.", icon: "mind", color: "#43e8d8", effect: (l) => `${100 + l * 12} mana, +${l * 10}% → +${(l + 1) * 10}% regen` },
  { key: "swiftness", name: "Swiftness", lore: "Boots anointed with storm-oil.", icon: "boot", color: "#c9955a", effect: (l) => `+${l * 6}% → +${(l + 1) * 6}% move speed` },
];

export function ReliquaryScreen() {
  const meta = useArchmageStore((s) => s.meta);
  const buyUpgrade = useArchmageStore((s) => s.buyUpgrade);
  const setScreen = useArchmageStore((s) => s.setScreen);
  const onBack = () => setScreen("menu");
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <MenuBackdrop />
      <div className="rune-frame absolute inset-0 pointer-events-none"><Corners /></div>
      <div className="relative z-10 w-full h-full overflow-y-auto py-6 sm:py-8 flex flex-col items-center">
        <div className="w-full max-w-4xl px-4 sm:px-6 my-auto">
        <div className="flex items-end justify-between anim-fade-up">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.34em] text-[#9a7bff]">Between trials</div>
            <h2 className="font-display text-4xl md:text-5xl font-black text-[#f5e3b3] tracking-wide">THE RELIQUARY</h2>
          </div>
          <div className="flex items-center gap-2 text-[#ffe9ad] font-display font-bold text-2xl">
            <UiIcon name="gem" size={22} /> {meta.shards}
            <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#8f7bff] ml-1">glyphs</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-[#b9aee0] italic anim-fade-up-1">Spend aether glyphs to bind permanent boons to your soul — every track applies live from your next trial's first breath.</p>

        <div className="mt-6 sm:mt-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TRACKS.map((t, i) => {
            const lvl = meta.upgrades[t.key];
            const cost = trackCost(lvl);
            const afford = meta.shards >= cost;
            const maxed = lvl >= MAX_UPGRADE_LEVEL;
            return (
              <div key={t.key} className={`rune-panel shop-card p-4 sm:p-5 anim-fade-up-${Math.min(3, i + 1)}`} style={{ borderColor: t.color + "44" }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 grid place-items-center border" style={{ color: t.color, borderColor: t.color + "55", background: t.color + "12" }}>
                      <BoonIcon name={t.icon} size={24} />
                    </span>
                    <div>
                      <div className="font-display font-bold text-xl text-[#f0e8ff] tracking-wide">{t.name.toUpperCase()}</div>
                      <div className="text-[12px] italic text-[#8f7bff]">{t.lore}</div>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {Array.from({ length: MAX_UPGRADE_LEVEL }).map((_, j) => (
                      <span key={j} className="w-2 h-2 rotate-45" style={{ background: j < lvl ? t.color : "rgba(154,123,255,0.18)" }} />
                    ))}
                  </div>
                </div>
                <div className="mt-3 text-[13px] text-[#c9bdf0]">{maxed ? "Track fully empowered." : t.effect(lvl)}</div>
                <button
                  onClick={() => buyUpgrade(t.key)}
                  disabled={!afford || maxed}
                  className={`mt-4 w-full py-2.5 text-sm font-display font-bold tracking-[0.14em] uppercase transition-all flex items-center justify-center gap-2 ${
                    maxed ? "opacity-60 cursor-default border border-[rgba(245,201,107,0.45)] text-[#ffe9ad] bg-[rgba(245,201,107,0.08)]"
                    : afford ? "btn-gold" : "opacity-40 cursor-not-allowed border border-[rgba(154,123,255,0.32)] text-[#8f7bff] bg-[#171029]"
                    }`}
                >
                  {maxed ? (<><UiIcon name="star" size={15} /> Maxed</>) : (<><UiIcon name="gem" size={15} /> {cost} glyphs — Empower</>)}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-6 sm:mt-7 flex justify-center anim-fade-up-3">
          <button onClick={onBack} className="btn-ghost px-8 py-3">Return to the Gate</button>
        </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   THE ARCANUM — Patch 7.0 rebirth of the Codex.
   ----------------------------------------------------------------------------
   Five living sections behind animated tabs:
     · SPELLBOOK  — all thirteen spells with stats and procedural mini-covers
     · RESONANCES — the 78 combo grid, discovery-gated as before
     · BESTIARY   — 19 enemy types + 4 elite affixes; entries unlock on FIRST
                    KILL (Hades-Codex-style — nothing auto-fills)
     · TYRANTS    — the 5 shuffled bosses; unlock on first kill
     · RECORDS    — the lifetime ledger (runs, bests, kills, time, sealings)
   The header features a RANDOM PROCEDURAL COVER — reroll it anytime. */

type ArcTab = "spellbook" | "resonances" | "bestiary" | "tyrants" | "records";

const ARC_TABS: { id: ArcTab; label: string; icon: string }[] = [
  { id: "spellbook", label: "Spellbook", icon: "book" },
  { id: "resonances", label: "Resonances", icon: "star" },
  { id: "bestiary", label: "Bestiary", icon: "skull" },
  { id: "tyrants", label: "Tyrants", icon: "fang" },
  { id: "records", label: "Records", icon: "gem" },
];

function enemyBehavior(def: EnemyDef): string {
  const parts: string[] = [];
  parts.push(
    def.ranged ? "Keeps distance, fires bolts"
      : def.speed >= 120 ? "Fast pursuit"
      : def.speed <= 60 ? "Slow, heavy advance"
      : "Direct pursuit",
  );
  if (def.flying) parts.push("flies");
  if (def.hp >= 120) parts.push("very durable");
  if (def.damage >= 15) parts.push("heavy hitter");
  return parts.join(" · ") + ".";
}

export function ArcanumScreen() {
  const meta = useArchmageStore((s) => s.meta);
  const setScreen = useArchmageStore((s) => s.setScreen);
  const [tab, setTab] = useState<ArcTab>("spellbook");
  const [coverNonce, setCoverNonce] = useState(0);
  const [coverElem, setCoverElem] = useState<ElementId>(() => SPELL_ORDER[Math.floor(Math.random() * SPELL_ORDER.length)]);
  const onBack = () => setScreen("menu");

  const reroll = () => {
    sfx.click();
    setCoverNonce((n) => n + 1);
    setCoverElem(SPELL_ORDER[Math.floor(Math.random() * SPELL_ORDER.length)]);
  };
  const switchTab = (id: ArcTab) => {
    if (id === tab) return;
    sfx.tab();
    setTab(id);
  };

  const coverSeed = `arcanum-${coverNonce}-${coverElem}`;
  const seenEnemies = meta.seenEnemies;
  const seenBosses = meta.seenBosses;

  const counters: Record<ArcTab, string> = {
    spellbook: `${SPELL_ORDER.length}`,
    resonances: `${meta.combosFound.length}/${COMBO_COUNT}`,
    bestiary: `${seenEnemies.length}/${ENEMY_ORDER.length}`,
    tyrants: `${seenBosses.length}/${BOSS_ORDER.length}`,
    records: "",
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <MenuBackdrop />
      <div className="rune-frame absolute inset-0 pointer-events-none"><Corners /></div>
      <div className="relative z-10 w-full max-w-5xl px-4 sm:px-6 max-h-full flex flex-col py-6 sm:py-8">

        {/* featured procedural cover + title */}
        <div className="anim-fade-up shrink-0 flex flex-col sm:flex-row items-center gap-5">
          <div className="arc-cover relative shrink-0" aria-hidden>
            <CoverSigil seed={coverSeed} accent={SPELLS[coverElem].color} glow={SPELLS[coverElem].glow} />
            <div className="arc-cover-core" style={{ color: SPELLS[coverElem].color }}>
              <SpellIcon id={coverElem} size={34} />
            </div>
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="text-[11px] font-bold uppercase tracking-[0.34em] text-[#9a7bff]">The compendium of the rift</div>
            <h2 className="font-display text-4xl md:text-5xl font-black text-[#f5e3b3] tracking-wide">THE ARCANUM</h2>
            <p className="mt-1 text-[13px] text-[#b9aee0] italic">
              Every rune, foe and tyrant — entries wake when you first fell them.
            </p>
            <button onClick={reroll} onMouseEnter={() => sfx.uiHover()} className="btn-ghost mt-3 px-4 py-2 text-xs flex items-center gap-2 mx-auto sm:mx-0">
              <UiIcon name="dice" size={14} /> Reroll cover — {SPELLS[coverElem].name}
            </button>
          </div>
        </div>

        {/* tab bar */}
        <div className="anim-fade-up-1 mt-4 shrink-0 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Arcanum sections">
          {ARC_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              onMouseEnter={() => sfx.uiHover()}
              className={`arc-tab ${tab === t.id ? "is-on" : ""}`}
            >
              <UiIcon name={t.icon} size={14} />
              <span>{t.label}</span>
              {counters[t.id] && <span className="arc-tab-count">{counters[t.id]}</span>}
            </button>
          ))}
        </div>

        {/* tab content */}
        <div key={tab} className="arc-content mt-4 overflow-y-auto pr-1 pb-2 flex-1 min-h-0 arc-scroll">

          {tab === "spellbook" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {SPELL_ORDER.map((id, i) => {
                const sp = SPELLS[id];
                return (
                  <div key={id} className={`arc-entry anim-fade-up-${Math.min(4, (i % 4) + 1)}`} style={{ ["--entry-accent" as string]: sp.color }}>
                    <div className="arc-entry-cover" aria-hidden>
                      <CoverSigil seed={`spell-${id}`} accent={sp.color} glow={sp.glow} />
                      <span className="arc-entry-glyph" style={{ color: sp.color }}><SpellIcon id={id} size={26} /></span>
                    </div>
                    <div className="p-3.5">
                      <div className="font-display font-bold text-[15px] tracking-wide text-[#f0e8ff]">{sp.name.toUpperCase()}</div>
                      <div className="text-[11px] italic" style={{ color: sp.color }}>{sp.tagline}</div>
                      <div className="text-[12px] text-[#c9bdf0] mt-1.5 leading-snug">{sp.desc}</div>
                      <div className="mt-2.5 pt-2 border-t border-[#2a1d4d] flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6a5a99]">
                        <span>{sp.manaCost} aether</span>
                        <span>{sp.cooldown.toFixed(2)}s cd</span>
                        <span style={{ color: sp.color }}>{sp.baseDamage > 0 ? `${sp.baseDamage} dmg` : "ward"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "resonances" && (
            <div>
              <p className="text-sm text-[#b9aee0] italic mb-3">
                Cast two different elements within 1.5 seconds and the rift answers with something new.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {ALL_PAIRS.map(([a, b], i) => {
                  const key = comboKey(a, b);
                  const found = meta.combosFound.includes(key);
                  const def = COMBOS[key];
                  return (
                    <div
                      key={key}
                      className={`rune-panel p-3.5 transition-all arc-entry-hover anim-fade-up-${Math.min(4, (i % 4) + 1)} ${found ? "" : "opacity-55 grayscale-[0.4]"}`}
                      style={found ? { borderColor: SPELLS[b].color + "55" } : undefined}
                    >
                      <div className="flex items-center gap-1.5">
                        <span style={{ color: SPELLS[a].color }}><SpellIcon id={a} size={17} /></span>
                        <span className="text-[#8f7bff] text-xs font-bold">×</span>
                        <span style={{ color: SPELLS[b].color }}><SpellIcon id={b} size={17} /></span>
                      </div>
                      <div className={`mt-1.5 font-display font-bold text-[15px] tracking-wide ${found ? "text-[#f0e8ff]" : "text-[#6a5a99]"}`}>
                        {found ? def.name : "Undiscovered"}
                      </div>
                      <div className="text-[12px] italic leading-snug mt-0.5 text-[#9a8cc7]">
                        {found ? def.lore : `${SPELLS[a].name} meets ${SPELLS[b].name}…`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "bestiary" && (
            <div>
              <p className="text-sm text-[#b9aee0] italic mb-3">
                First blood wakes an entry. {seenEnemies.length} of {ENEMY_ORDER.length} known.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ENEMY_ORDER.map((type, i) => {
                  const def = ENEMY_DEFS[type];
                  const seen = seenEnemies.includes(type);
                  return (
                    <div
                      key={type}
                      className={`arc-entry anim-fade-up-${Math.min(4, (i % 4) + 1)} ${seen ? "" : "is-locked"}`}
                      style={{ ["--entry-accent" as string]: seen ? def.color : "#6a5a99" }}
                    >
                      <div className="arc-entry-cover" aria-hidden>
                        {seen
                          ? <CoverSigil seed={`foe-${type}`} accent={def.color} glow={def.glow} />
                          : <CoverSigil seed={`foe-${type}-locked`} accent="#6a5a99" glow="#8f7bff" />}
                        <span className="arc-entry-glyph" style={{ color: seen ? def.color : "#4a3d70" }}>
                          {seen ? <UiIcon name={def.ranged ? "bolt" : def.flying ? "wave" : "fang"} size={24} />
                            : <UiIcon name="skull" size={24} />}
                        </span>
                      </div>
                      <div className="p-3.5">
                        <div className={`font-display font-bold text-[15px] tracking-wide ${seen ? "text-[#f0e8ff]" : "text-[#6a5a99]"}`}>
                          {seen ? def.name : "???"}
                        </div>
                        {seen ? (
                          <>
                            <div className="text-[12px] italic text-[#9a8cc7] mt-0.5">{enemyBehavior(def)}</div>
                            <div className="mt-2.5 pt-2 border-t border-[#2a1d4d] grid grid-cols-4 gap-1 text-center text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#6a5a99]">
                              <div><div className="text-[#ff8ba0] text-[13px]">{def.hp}</div>hp</div>
                              <div><div className="text-[#f5c96b] text-[13px]">{def.damage}</div>dmg</div>
                              <div><div className="text-[#43e8d8] text-[13px]">{def.speed}</div>spd</div>
                              <div><div className="text-[#8f7bff] text-[13px]">W{def.unlockWave}</div>from</div>
                            </div>
                          </>
                        ) : (
                          <div className="text-[12px] italic text-[#6a5a99] mt-1">
                            First kill to reveal · appears from wave {def.unlockWave}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* elite affixes — always visible (modifiers, not creatures) */}
              <div className="mt-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Elite affixes</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {ELITE_ORDER.map((affix, i) => {
                    const def = ELITE_DEFS[affix];
                    return (
                      <div key={affix} className={`rune-panel p-3.5 arc-entry-hover anim-fade-up-${i + 1}`} style={{ borderColor: def.color + "55" }}>
                        <div className="font-display font-bold text-[14px] tracking-wide" style={{ color: def.color }}>
                          {def.name.toUpperCase()}
                        </div>
                        <div className="text-[12px] text-[#c9bdf0] mt-1 leading-snug">
                          ×{def.hpMult.toFixed(2)} health · ×{def.spdMult.toFixed(2)} speed{def.resist > 0 ? ` · ${Math.round(def.resist * 100)}% resist` : ""}
                        </div>
                        <div className="text-[11px] italic text-[#9a8cc7] mt-0.5">
                          {affix === "blazing" ? "Detonates on death — keep your distance." :
                           affix === "swift" ? "Blur-fast — cut it down mid-charge." :
                           affix === "bulwark" ? "A wall — bring heavy runes." :
                           "Drains on contact — don't linger."}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "tyrants" && (
            <div>
              <p className="text-sm text-[#b9aee0] italic mb-3">
                Five tyrants, shuffled by the seed — a different order every run. Fell one to know it.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BOSS_ORDER.map((id, i) => {
                  const boss = BOSS_DEFS.find((b) => b.id === id)!;
                  const seen = seenBosses.includes(id);
                  return (
                    <div key={id} className={`arc-entry anim-fade-up-${Math.min(4, i + 1)} ${seen ? "" : "is-locked"}`} style={{ ["--entry-accent" as string]: seen ? boss.color : "#6a5a99" }}>
                      <div className="p-4 flex items-center gap-4">
                        <div className="arc-boss-sigil shrink-0" style={{ borderColor: seen ? boss.color + "66" : "#2a1d4d" }}>
                          {seen
                            ? <BossSigil boss={boss} size={86} />
                            : <UiIcon name="skull" size={36} />}
                        </div>
                        <div className="min-w-0">
                          <div className={`font-display font-bold text-lg tracking-wide ${seen ? "text-[#f0e8ff]" : "text-[#6a5a99]"}`}>
                            {seen ? boss.name.toUpperCase() : "???"}
                          </div>
                          <div className={`text-[12px] italic ${seen ? "" : "text-[#6a5a99]"}`} style={{ color: seen ? boss.color : undefined }}>
                            {seen ? boss.title : "a tyrant, unnamed"}
                          </div>
                          {seen ? (
                            <>
                              <p className="text-[12px] text-[#c9bdf0] mt-1.5 leading-snug">{boss.mechanics}</p>
                              <div className="mt-2 flex gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6a5a99]">
                                <span>{boss.hp} hp</span>
                                <span>{boss.damage} dmg</span>
                                <span>{boss.speed} spd</span>
                              </div>
                            </>
                          ) : (
                            <div className="text-[12px] italic text-[#6a5a99] mt-1.5">
                              Somewhere in the ten-wave sets — kill it to reveal.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "records" && (
            <div>
              <p className="text-sm text-[#b9aee0] italic mb-3">The lifetime ledger of every trial.</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { v: String(meta.runs), l: "Trials entered", c: "#f5c96b" },
                  { v: String(meta.bestWave), l: "Best wave", c: "#43e8d8" },
                  { v: meta.bestScore.toLocaleString(), l: "Best score", c: "#ffe9ad" },
                  { v: String(meta.victories), l: "Rifts sealed", c: "#ff4d6b" },
                  { v: meta.totalKills.toLocaleString(), l: "Foes felled", c: "#ff8ba0" },
                  { v: Math.round(meta.totalDamage).toLocaleString(), l: "Damage woven", c: "#9a7bff" },
                  { v: formatTime(meta.totalTimeSec), l: "Time in the rift", c: "#7ed957" },
                  { v: `${meta.combosFound.length}/${COMBO_COUNT}`, l: "Resonances", c: "#6bf0c2" },
                  { v: `${seenEnemies.length}/${ENEMY_ORDER.length}`, l: "Bestiary known", c: "#d05bff" },
                  { v: `${seenBosses.length}/${BOSS_ORDER.length}`, l: "Tyrants known", c: "#ffb08a" },
                  { v: meta.shards.toLocaleString(), l: "Glyphs held", c: "#f5c96b" },
                  { v: `${meta.upgrades.vitality + meta.upgrades.power + meta.upgrades.focus + meta.upgrades.swiftness}/${MAX_UPGRADE_LEVEL * 4}`, l: "Reliquary pips", c: "#c9955a" },
                ].map((r, i) => (
                  <div key={r.l} className={`rune-panel p-4 text-center arc-entry-hover anim-fade-up-${Math.min(4, (i % 4) + 1)}`}>
                    <div className="font-display text-2xl font-bold" style={{ color: r.c }}>{r.v}</div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[#8f7bff] mt-1">{r.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-center shrink-0">
          <button onClick={onBack} onMouseEnter={() => sfx.uiHover()} className="btn-ghost px-8 py-3">Return to the Gate</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- tribute gate ------------------------------ */

/* The TRIBUTE gate. Three scalable stat rewards (+health, critical damage,
   armor, ...). Selection is MANDATORY — there is deliberately no skip button.
   Stack badges show what the player already holds. */
export function RewardOverlay({ rewards, tiers, wave, onPick }: {
  rewards: UpgradeChoice[];
  tiers: Record<string, number>;
  wave: number;
  onPick: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center overflow-y-auto px-4" style={{ background: "rgba(6,4,14,0.82)" }}>
      <div className="text-center w-full max-w-3xl py-6 my-auto">
        <div className="anim-fade-up text-[11px] font-bold uppercase tracking-[0.38em] text-[#6bf0c2]">Wave {wave} cleared — the rift owes you</div>
        <h2 className="anim-fade-up font-display text-4xl md:text-5xl font-black text-[#f5e3b3] tracking-wide mt-1" style={{ textShadow: "0 0 30px rgba(107,240,194,0.35)" }}>
          CLAIM YOUR TRIBUTE
        </h2>
        <p className="anim-fade-up-1 text-sm text-[#b9aee0] italic mt-2">Power, freely given. One of these is yours — choose.</p>
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {rewards.map((r, i) => {
            const owned = tiers[r.id] ?? 0;
            return (
              <button key={r.id} onClick={() => onPick(r.id)} onMouseEnter={() => sfx.uiHover()} className={`boon-card p-5 text-left anim-fade-up-${i + 1}`}>
                <div className="flex items-center justify-between">
                  <span className="w-11 h-11 grid place-items-center border" style={{ color: r.color, borderColor: r.color + "55", background: r.color + "12" }}>
                    <BoonIcon name={r.icon} size={24} />
                  </span>
                  <span className="flex items-center gap-2">
                    {owned > 0 && (
                      <span className="text-[10px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 border" style={{ color: r.color, borderColor: r.color + "55" }}>
                        held ×{owned}
                      </span>
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f7bff]">{r.kind}</span>
                  </span>
                </div>
                <div className="font-display font-bold text-lg text-[#f0e8ff] tracking-wide mt-3">{r.name.toUpperCase()}</div>
                <div className="text-[13px] text-[#c9bdf0] mt-1.5 leading-snug">{r.desc}</div>
              </button>
            );
          })}
        </div>
        <p className="anim-fade-up-2 text-[11px] text-[#6a5a99] italic mt-5">
          The gate does not close until a tribute is taken — this choice cannot be skipped.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- settings --------------------------------- */

/* Comprehensive settings, reachable from the menu AND from the pause overlay
   mid-run (volume/graphics changes apply live). Sections: Audio
   (master/music/sfx sliders), Graphics (quality preset + shake + damage
   numbers), Accessibility (V1.0: UI size, announcement text size, reduce
   flashes, high-contrast HUD), Touch controls (V1.1: control size, opacity,
   floating/docked stick, handedness mirror), Gameplay (aim assist + Rift
   Mercy), Data (reset). */

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const meta = useArchmageStore((s) => s.meta);
  const patchSettings = useArchmageStore((s) => s.patchSettings);
  const setMercyTier = useArchmageStore((s) => s.setMercyTier);
  const resetProgress = useArchmageStore((s) => s.resetProgress);
  const [confirmReset, setConfirmReset] = useState(false);
  const s = meta.settings;

  const slider = (label: string, key: "master" | "music" | "sfx", icon: string, hint: string) => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-[#b9aee0] shrink-0"><UiIcon name={icon} size={16} /></span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">{label}</span>
          <span className="text-[12px] font-black tabular-nums text-[#ffe9ad]">{s[key]}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={s[key]}
          aria-label={label}
          onChange={(e) => patchSettings({ [key]: Number(e.target.value) })}
          className="settings-slider"
        />
        <div className="text-[10.5px] text-[#6a5a99] italic mt-0.5">{hint}</div>
      </div>
    </div>
  );

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(6,4,14,0.86)" }} role="dialog" aria-label="Settings">
      <div className="rune-panel rune-frame relative w-full max-w-xl max-h-[92vh] overflow-y-auto px-6 sm:px-8 py-7 anim-fade-up">
        <Corners />
        <button onClick={onClose} className="btn-ghost absolute top-4 right-4 px-3 py-2" title="Close settings">
          <UiIcon name="pause" size={14} />
        </button>
        <div className="text-[11px] font-bold uppercase tracking-[0.34em] text-[#9a7bff]">Configure the trial</div>
        <h2 className="font-display text-4xl font-black text-[#f5e3b3] tracking-wide mt-1">SETTINGS</h2>

        {/* audio */}
        <div className="mt-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Audio</div>
          <div className="border border-[rgba(154,123,255,0.28)] bg-[rgba(13,9,25,0.6)] px-4 py-3">
            {slider("Master volume", "master", "sound", "Everything — set to 0 to silence the rift")}
            {slider("Music", "music", "wave", "Adaptive score — calms in the menu, fights with you, pounds under tyrants")}
            {slider("Sound effects", "sfx", "bolt", "Casts, impacts, tributes and tyrants")}
          </div>
        </div>

        {/* graphics */}
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Graphics</div>
          <div className="border border-[rgba(154,123,255,0.28)] bg-[rgba(13,9,25,0.6)] px-4 py-3">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Quality</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Render resolution, particles and ambient motes</div>
              </div>
              <div className="flex shrink-0" role="group" aria-label="Graphics quality">
                {GFX_LABELS.map((lbl, lvl) => (
                  <button
                    key={lbl}
                    onClick={() => { sfx.click(); patchSettings({ gfx: lvl as 0 | 1 | 2 }); }}
                    aria-pressed={s.gfx === lvl}
                    className={`aim-seg ${s.gfx === lvl ? "on" : ""}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Screen shake</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Camera kick on heavy impacts (off automatically if your OS prefers reduced motion)</div>
              </div>
              <input
                type="checkbox"
                checked={s.screenShake}
                onChange={(e) => { sfx.click(); patchSettings({ screenShake: e.target.checked }); }}
                className="accent-[#f5c96b] w-5 h-5 shrink-0"
              />
            </label>
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Damage numbers</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Floating combat numbers on every hit — disable for a cleaner read or extra performance</div>
              </div>
              <input
                type="checkbox"
                checked={s.dmgNumbers}
                onChange={(e) => { sfx.click(); patchSettings({ dmgNumbers: e.target.checked }); }}
                className="accent-[#f5c96b] w-5 h-5 shrink-0"
              />
            </label>
            {/* Patch 10.1 — custom UI scaling moved to the Accessibility
                section below (V1.0: it belongs with text size, flash
                reduction and high contrast). */}
          </div>
        </div>

        {/* V1.0 final — ACCESSIBILITY SUITE: UI size, announcement text
            size, flash reduction and high-contrast HUD. Every option is
            live — the HUD re-scales and the next banner renders at the new
            text size without restarting the run. */}
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Accessibility</div>
          <div className="border border-[rgba(154,123,255,0.28)] bg-[rgba(13,9,25,0.6)] px-4 py-3">
            <div className="flex items-center gap-3 py-1.5">
              <span className="text-[#b9aee0] shrink-0"><UiIcon name="settings" size={16} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">UI size</span>
                  <span className="text-[12px] font-black tabular-nums text-[#ffe9ad]">{Math.round(s.hudScale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={75}
                  max={150}
                  step={5}
                  value={Math.round(s.hudScale * 100)}
                  aria-label="UI size"
                  onChange={(e) => { sfx.click(); patchSettings({ hudScale: Number(e.target.value) / 100 }); }}
                  className="settings-slider"
                />
                <div className="text-[10.5px] text-[#6a5a99] italic mt-0.5">The whole combat interface — vitals, wave plate, spell bar and touch controls</div>
              </div>
            </div>
            <div className="flex items-center gap-3 py-1.5">
              <span className="text-[#b9aee0] shrink-0"><UiIcon name="book" size={16} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Announcement text size</span>
                  <span className="text-[12px] font-black tabular-nums text-[#ffe9ad]">{Math.round((s.textScale ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={75}
                  max={150}
                  step={5}
                  value={Math.round((s.textScale ?? 1) * 100)}
                  aria-label="Announcement text size"
                  onChange={(e) => { sfx.click(); patchSettings({ textScale: Number(e.target.value) / 100 }); }}
                  className="settings-slider"
                />
                <div className="text-[10.5px] text-[#6a5a99] italic mt-0.5">Every in-game announcement — wave calls, spawn whispers, boss alerts — centered and compact</div>
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Reduce flashes</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Dampen the red damage vignette and death flash — kinder to photosensitive eyes</div>
              </div>
              <input
                type="checkbox"
                checked={!!s.reduceFlash}
                onChange={(e) => { sfx.click(); patchSettings({ reduceFlash: e.target.checked }); }}
                className="accent-[#f5c96b] w-5 h-5 shrink-0"
              />
            </label>
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">High-contrast HUD</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Solid panels, brighter borders and a scrim behind announcements — maximum legibility</div>
              </div>
              <input
                type="checkbox"
                checked={!!s.highContrast}
                onChange={(e) => { sfx.click(); patchSettings({ highContrast: e.target.checked }); }}
                className="accent-[#f5c96b] w-5 h-5 shrink-0"
              />
            </label>
            <div className="text-[10.5px] text-[#6a5a99] italic border-t border-[rgba(154,123,255,0.22)] pt-2 mt-1">
              More comfort: screen shake and damage numbers live in Graphics; aim assist and Rift Mercy in Gameplay.
            </div>
          </div>
        </div>

        {/* V1.1 — TOUCH CONTROLS: the customizable in-run control layer. Every
            option applies live (size, opacity, stick model, hand mirror) and
            persists — tuned once, correct on every device. */}
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Touch controls</div>
          <div className="border border-[rgba(154,123,255,0.28)] bg-[rgba(13,9,25,0.6)] px-4 py-3">
            <div className="flex items-center gap-3 py-1.5">
              <span className="text-[#b9aee0] shrink-0"><UiIcon name="target" size={16} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Control size</span>
                  <span className="text-[12px] font-black tabular-nums text-[#ffe9ad]">{Math.round((s.touchScale ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={75}
                  max={140}
                  step={5}
                  value={Math.round((s.touchScale ?? 1) * 100)}
                  aria-label="Touch control size"
                  onChange={(e) => { sfx.click(); patchSettings({ touchScale: Number(e.target.value) / 100 }); }}
                  className="settings-slider"
                />
                <div className="text-[10.5px] text-[#6a5a99] italic mt-0.5">Every touch button and the move stick — bigger for confident thumbs, smaller to clear the arena</div>
              </div>
            </div>
            <div className="flex items-center gap-3 py-1.5">
              <span className="text-[#b9aee0] shrink-0"><UiIcon name="wave" size={16} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Control opacity</span>
                  <span className="text-[12px] font-black tabular-nums text-[#ffe9ad]">{Math.round((s.touchOpacity ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={5}
                  value={Math.round((s.touchOpacity ?? 1) * 100)}
                  aria-label="Touch control opacity"
                  onChange={(e) => { sfx.click(); patchSettings({ touchOpacity: Number(e.target.value) / 100 }); }}
                  className="settings-slider"
                />
                <div className="text-[10.5px] text-[#6a5a99] italic mt-0.5">Fade the whole control layer — see more rift, same inputs</div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Movement stick</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Floating spawns the stick under your finger — exact directional control anywhere; Docked anchors it to the corner</div>
              </div>
              <div className="flex shrink-0" role="group" aria-label="Movement stick mode">
                {(["floating", "docked"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { sfx.click(); patchSettings({ stickMode: m }); }}
                    aria-pressed={(s.stickMode ?? "floating") === m}
                    className={`aim-seg ${(s.stickMode ?? "floating") === m ? "on" : ""}`}
                  >
                    {m === "floating" ? "FLOATING" : "DOCKED"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Control side</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">Mirrors the thumb zones — move stick and action arc swap corners for left-handed play</div>
              </div>
              <div className="flex shrink-0" role="group" aria-label="Control side">
                {(["right", "left"] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => { sfx.click(); patchSettings({ handSide: h }); }}
                    aria-pressed={(s.handSide ?? "right") === h}
                    className={`aim-seg ${(s.handSide ?? "right") === h ? "on" : ""}`}
                  >
                    {h === "right" ? "RIGHT-HAND" : "LEFT-HAND"}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10.5px] text-[#6a5a99] italic border-t border-[rgba(154,123,255,0.22)] pt-2 mt-1">
              Touch layer: move stick · DASH · VOLLEY · SPELL · FIRE · SURGE · the spell strip — all live-adjustable.
            </div>
          </div>
        </div>

        {/* gameplay */}
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Gameplay</div>
          <div className="border border-[rgba(154,123,255,0.28)] bg-[rgba(13,9,25,0.6)] px-4 py-3">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">Aim assist</div>
                <div className="text-[10.5px] text-[#6a5a99] italic">The weave curves toward deserving foes</div>
              </div>
              <div className="flex shrink-0" role="group" aria-label="Aim assist level">
                {AIM_LABELS.map((lbl, lvl) => (
                  <button
                    key={lbl}
                    onClick={() => { sfx.click(); patchSettings({ aimAssist: lvl as 0 | 1 | 2 }); }}
                    aria-pressed={s.aimAssist === lvl}
                    className={`aim-seg ${s.aimAssist === lvl ? "on" : ""}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#c9bdf0]">
                  Rift Mercy <span className="text-[#6bf0c2] font-black">{s.mercy ? "ON" : "OFF"}</span>
                </div>
                <div className="text-[10.5px] text-[#6a5a99] italic">The per-death assist ladder — defense, attack, fewer spawns, softer foes.</div>
              </div>
              <input
                type="checkbox"
                checked={s.mercy}
                onChange={(e) => { sfx.click(); patchSettings({ mercy: e.target.checked }); }}
                className="accent-[#f5c96b] w-5 h-5 shrink-0"
              />
            </label>
            {/* Patch 9.0 — the mercy LADDER: every death banks a tier (cleared
                by a triumph). AUTO uses them all; a manual chip opts down for
                players who find the accumulated assist too generous. */}
            {s.mercy && meta.mercyDeaths > 0 && (
              <div className="mt-1.5 border-t border-[rgba(154,123,255,0.22)] pt-2.5">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6bf0c2] mb-1.5">
                  Mercy tier — {meta.mercyDeaths} banked {meta.mercyDeaths === 1 ? "death" : "deaths"}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rift Mercy tier">
                  <button
                    onClick={() => { sfx.click(); setMercyTier(-1); }}
                    aria-pressed={meta.mercyTierSel === -1}
                    className={`aim-seg ${meta.mercyTierSel === -1 ? "on" : ""}`}
                    title="Use every banked death — the full ladder"
                  >
                    AUTO {Math.round(mercyTierBase(Math.min(meta.mercyDeaths, MERCY_MAX_TIER)) * 100)}%
                  </button>
                  {Array.from({ length: Math.min(meta.mercyDeaths, MERCY_MAX_TIER) }, (_, t) => t + 1).map((t) => (
                    <button
                      key={t}
                      onClick={() => { sfx.click(); setMercyTier(t); }}
                      aria-pressed={meta.mercyTierSel === t}
                      className={`aim-seg ${meta.mercyTierSel === t ? "on" : ""}`}
                      title={`Tier ${t}: ${Math.round(mercyTierBase(t) * 100)}% base assist`}
                    >
                      T{t} {Math.round(mercyTierBase(t) * 100)}%
                    </button>
                  ))}
                  <button
                    onClick={() => { sfx.click(); setMercyTier(0); }}
                    aria-pressed={meta.mercyTierSel === 0}
                    className={`aim-seg ${meta.mercyTierSel === 0 ? "on" : ""}`}
                    title="No assist — the honest rift"
                  >
                    NONE
                  </button>
                </div>
                <div className="text-[10.5px] text-[#6a5a99] italic mt-1.5">
                  Each tier grants its percentage to defense, attack (+75% of it), spawn thinning (−60%) and foe softening (−35% HP / −25% speed). A triumphant run clears the ladder.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* data */}
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#f5c96b] mb-2">Data</div>
          <div className="border border-[rgba(255,77,107,0.3)] bg-[rgba(30,9,18,0.6)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#ff8ba0]">Reset progress</div>
                <div className="text-[10.5px] text-[#8f6a75] italic">Wipes glyphs, Reliquary upgrades, the Arcanum and every discovery. Settings are kept.</div>
              </div>
              {!confirmReset ? (
                <button onClick={() => { sfx.click(); setConfirmReset(true); }} className="btn-ghost px-4 py-2.5 text-sm text-[#ff8ba0] border-[rgba(255,77,107,0.4)] hover:bg-[rgba(255,77,107,0.12)] shrink-0">
                  Reset
                </button>
              ) : (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => { resetProgress(); setConfirmReset(false); }} className="px-4 py-2.5 text-sm font-display font-bold tracking-[0.14em] uppercase border border-[rgba(255,77,107,0.6)] text-[#ff4d6b] bg-[rgba(255,77,107,0.14)] hover:bg-[rgba(255,77,107,0.25)]">
                    Erase everything
                  </button>
                  <button onClick={() => { sfx.click(); setConfirmReset(false); }} className="btn-ghost px-4 py-2.5 text-sm">
                    Keep
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button onClick={onClose} className="btn-gold px-10 py-3">Back</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- pause ---------------------------------- */

export function PauseOverlay({ onResume, onRestart, onAbandon, onSettings }: {
  onResume: () => void; onRestart: () => void; onAbandon: () => void; onSettings: () => void;
}) {
  const meta = useArchmageStore((s) => s.meta);
  const muted = meta.settings.master <= 0;
  return (
    <div className="absolute inset-0 z-40 bg-[rgba(8,5,18,0.78)] flex items-center justify-center px-4">
      <div className="rune-panel rune-frame px-10 py-9 max-w-md w-full text-center anim-fade-up">
        <Corners />
        <div className="text-[11px] font-bold uppercase tracking-[0.38em] text-[#9a7bff]">The trial is suspended</div>
        <h2 className="font-display text-4xl font-black text-[#f5e3b3] tracking-wide mt-2">STASIS</h2>
        <p className="text-sm italic text-[#b9aee0] mt-2">Even the rift must catch its breath.</p>
        <div className="mt-7 flex flex-col gap-3">
          <button onClick={onResume} onMouseEnter={() => sfx.uiHover()} className="btn-gold py-3 flex items-center justify-center gap-2">
            <UiIcon name="play" size={18} /> Resume
          </button>
          <button onClick={onRestart} onMouseEnter={() => sfx.uiHover()} className="btn-ghost py-2.5 flex items-center justify-center gap-2">
            <UiIcon name="refresh" size={16} /> Restart trial
          </button>
          <div className="flex gap-3">
            <button onClick={onSettings} onMouseEnter={() => sfx.uiHover()} className="btn-ghost py-2.5 flex-1 flex items-center justify-center gap-2">
              <UiIcon name="settings" size={16} /> Settings
            </button>
            <button onClick={onAbandon} onMouseEnter={() => sfx.uiHover()} className="btn-ghost py-2.5 flex-1 text-[#ff8ba0] border-[rgba(255,77,107,0.4)] hover:bg-[rgba(255,77,107,0.12)]">
              Abandon
            </button>
          </div>
        </div>
        <div className="mt-6 text-[12px] text-[#8f7bff]">
          <span className="keycap mr-1">P</span> or <span className="keycap mx-1">ESC</span> to resume {muted ? "· muted" : ""}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- game over ------------------------------- */

/* Patch 7.0: no death quotes (story is gone) — the screen is a pure RUN
   RECAP: stats, glyphs claimed, merges, transmutations, resonances, plus a
   copy-seed button for sharing the run. */

export function GameOverScreen({ stats, onRetry, onMenu }: { stats: RunStats; onRetry: () => void; onMenu: () => void }) {
  const seed = useArchmageStore((s) => s.seed);
  const meta = useArchmageStore((s) => s.meta);
  const [copied, setCopied] = useState(false);
  const mm = Math.floor(stats.timeSec / 60);
  const ss = Math.floor(stats.timeSec % 60).toString().padStart(2, "0");
  const triumph = !!stats.triumph;
  /* Patch 10.0 — endless echo: the rift WAS sealed, then the mage fell to the
     echo. The eulogy says so. */
  const endless = !!stats.endless;
  /* Patch 9.0 — mercy ladder preview: this death banked a new tier (or a
     triumph cleared the ladder). Show exactly what the next run carries. */
  const mercyOn = meta.settings.mercy;
  const nextTier = Math.min(meta.mercyDeaths, MERCY_MAX_TIER);
  const nextBase = mercyTierBase(nextTier);

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(seed);
      setCopied(true);
      sfx.click();
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable — ignore */ }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-4" style={{ background: triumph ? "radial-gradient(900px 600px at 50% 45%, rgba(120,90,20,0.28), rgba(8,5,18,0.9))" : "radial-gradient(900px 600px at 50% 45%, rgba(120,20,50,0.25), rgba(8,5,18,0.9))" }}>
      <div className="rune-panel rune-frame px-9 py-8 max-w-xl w-full text-center anim-fade-up max-h-[92vh] overflow-y-auto">
        <Corners />
        <div className="text-[11px] font-bold uppercase tracking-[0.38em] flex items-center justify-center gap-2" style={{ color: triumph ? "#f5c96b" : "#ff4d6b" }}>
          <UiIcon name={triumph ? "gate" : "skull"} size={16} /> {endless ? "The echo claimed you — but the rift stayed sealed" : triumph ? "All five tyrants have fallen" : "The trial ends"}
        </div>
        <h2 className="font-display text-4xl md:text-5xl font-black tracking-wide mt-2" style={triumph ? { color: "#ffe9ad", textShadow: "0 0 34px rgba(245,201,107,0.6)" } : { color: "#ffb3c0", textShadow: "0 0 34px rgba(255,77,107,0.5)" }}>
          {endless ? "THE ECHO PREVAILS" : triumph ? "THE RIFT IS SEALED" : "CLAIMED BY THE RIFT"}
        </h2>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { v: String(stats.wave), l: "Wave reached" },
            { v: stats.score.toLocaleString(), l: "Score" },
            { v: String(stats.kills), l: "Foes felled" },
            { v: `${mm}:${ss}`, l: "Survived" },
          ].map((s) => (
            <div key={s.l} className="border border-[rgba(154,123,255,0.32)] bg-[rgba(18,11,36,0.7)] px-2 py-3">
              <div className="font-display text-2xl font-bold text-[#f0e8ff]">{s.v}</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#8f7bff] mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 border border-[rgba(245,201,107,0.4)] bg-[rgba(245,201,107,0.07)] py-3">
          <span className="text-[#ffe9ad]"><UiIcon name="gem" size={20} /></span>
          <span className="font-display text-2xl font-black text-[#ffe9ad]">+{stats.shards}</span>
          <span className="text-[12px] uppercase tracking-wider text-[#b9aee0]">aether glyphs claimed</span>
        </div>

        {/* Patch 9.0 — the Rift Mercy ladder readout */}
        {mercyOn && !triumph && nextTier > 0 && (
          <div className="mt-3 flex items-center justify-center gap-3 border border-[rgba(107,240,194,0.4)] bg-[rgba(107,240,194,0.07)] py-2.5">
            <span className="text-[#6bf0c2]"><UiIcon name="shield" size={18} /></span>
            <span className="text-[12px] font-bold uppercase tracking-wider text-[#6bf0c2]">
              Rift Mercy — Tier {nextTier} next run ({Math.round(nextBase * 100)}%→{Math.round((nextBase + 0.02) * 100)}%)
            </span>
          </div>
        )}
        {mercyOn && triumph && meta.mercyDeaths === 0 && (
          <div className="mt-3 text-center text-[12px] font-bold uppercase tracking-wider text-[#6bf0c2]">
            The rift no longer shows mercy — the ladder is cleared
          </div>
        )}

        {stats.merges && stats.merges.length > 0 && (
          <div className="mt-4 text-left">
            <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#ffe9ad] mb-1.5">
              Spells merged this trial — {stats.merges.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stats.merges.map((name) => (
                <span key={name} className="inline-flex items-center gap-1.5 border border-[rgba(255,233,173,0.35)] bg-[rgba(255,233,173,0.06)] px-2 py-1 text-[12px] text-[#ffe9ad] font-bold">
                  <UiIcon name="rings" size={12} /> {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {stats.evolutions && stats.evolutions.length > 0 && (
          <div className="mt-4 text-left">
            <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#ffe9ad] mb-1.5">
              Spells transmuted this trial — {stats.evolutions.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stats.evolutions.map((name) => (
                <span key={name} className="inline-flex items-center gap-1.5 border border-[rgba(255,233,173,0.35)] bg-[rgba(255,233,173,0.06)] px-2 py-1 text-[12px] text-[#ffe9ad] font-bold">
                  <UiIcon name="star" size={12} /> {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {stats.newCombos.length > 0 && (
          <div className="mt-4 text-left">
            <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#6bf0c2] mb-1.5">
              Resonances woven this trial — {stats.newCombos.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stats.newCombos.map((k) => {
                const [a, b] = k.split("+") as [ElementId, ElementId];
                return (
                  <span key={k} className="inline-flex items-center gap-1.5 border border-[rgba(255,233,173,0.35)] bg-[rgba(255,233,173,0.06)] px-2 py-1 text-[12px] text-[#ffe9ad] font-bold">
                    <SpellIcon id={a} size={13} /><SpellIcon id={b} size={13} />
                    {COMBOS[k]?.name ?? k}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button onClick={onRetry} onMouseEnter={() => sfx.uiHover()} className="btn-gold px-8 py-3 flex items-center justify-center gap-2">
            <UiIcon name="refresh" size={17} /> {triumph ? "Descend Again" : "Rise Again"}
          </button>
          <button onClick={onMenu} onMouseEnter={() => sfx.uiHover()} className="btn-ghost px-8 py-3">Return to the Gate</button>
          <button onClick={copySeed} onMouseEnter={() => sfx.uiHover()} className="btn-ghost px-4 py-3 text-xs flex items-center gap-2" title="Copy this run's seed">
            <UiIcon name="dice" size={14} /> {copied ? "Copied!" : `Seed: ${seed}`}
          </button>
        </div>
      </div>
    </div>
  );
}
