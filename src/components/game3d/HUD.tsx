"use client";


import { useRef, useEffect } from "react";
import type { HudSnapshot } from "@/game3d/types";
import { BOSS_DEFS, elementColor } from "@/game3d/content";
import { ICON, PORTRAIT, bossPortrait, elementIcon } from "@/game3d/palette";
import { useRiftStore } from "@/game3d/store";

export type HudApply = (snap: HudSnapshot) => void;

/* ARCHMAGE: RIFTBOUND — v3.1 Pixel Reforged in-game HUD.
   Zero re-renders on the hot path: the shell registers our `apply` callback
   and pushes HudSnapshots at ~30 Hz straight into DOM refs.
   Art direction (concept 05 — Combat HUD & Battlefield, v3.1 asset pass):
   ornate gold octagonal Stormcaller portrait + pill bars with pixel icon
   sockets (heart/flask/bolt) top-left, SOLO RUN plate beneath, act/wave
   banner + tyrant bar top-center, score plaque + labeled currency pills +
   populated tactical minimap + rift objectives right, ability bar with
   keycaps + diamond pips + conic SURGE ring on a gold filigree base. */

const SLOT_KEYS = ["1", "2", "3"];
/* 3 static off-screen threat markers (v2.2) — boss first, max 3 at once */
const THREAT_MARKER_KEYS = [0, 1, 2];
const ROMAN = ["I", "II", "III", "IV", "V"];

/* ------------------------------------------------------------------ */
/*  v3.2 UNIFIED ICON REGISTRY — one import serves HUD, hub, Vault,    */
/*  Runes and Codex (src/game3d/palette.ts). Icon parity by            */
/*  construction: the sprite the HUD shows IS the sprite the menus     */
/*  show.                                                              */
/* ------------------------------------------------------------------ */
const elementIconSrc = elementIcon;
const PORTRAIT_STORMCALLER = PORTRAIT.player;
const bossBustSrc = bossPortrait;
/** Gold beveled keycap tab — one system for every ability slot (concept 05:
 *  diamond gold keycaps atop the cards; hangs half above the frame). */
function HudKeycap({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <span
      aria-hidden
      className="absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] border-2 border-b-[3px] border-[#b8822e] bg-gradient-to-b from-[#ffe9ad] via-[#f0c060] to-[#c9a227] font-mono text-[10px] font-black uppercase leading-none tracking-[0.08em] text-[#241408] [text-shadow:0_1px_0_rgba(255,255,255,0.4)] shadow-[0_2px_0_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.55)]"
      style={{ height: 17, minWidth: wide ? 46 : 19, padding: "0 6px" }}
    >
      {children}
    </span>
  );
}

export function HUD({
  register,
  vignetteScale = 1
}: {
  register: (apply: HudApply | null) => void;
  /* v2.2: low-HP/hit-flash vignette intensity (settings.vignette, 0..1) */
  vignetteScale?: number;
}) {
  /* the nameplate level — a lifetime metric, read once per meta change */
  const meta = useRiftStore(s => s.meta);
  const level = Math.floor((meta.totalKills * 2 + meta.bestWave * 30 + meta.combosFound.length * 120 + meta.victories * 800 + meta.runs * 40) / 1000) + 1;

  const hpFill = useRef<HTMLDivElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const aeFill = useRef<HTMLDivElement>(null);
  const aeText = useRef<HTMLSpanElement>(null);
  const surgeFill = useRef<HTMLDivElement>(null);
  const surgePct = useRef<HTMLSpanElement>(null);
  const surgeRing = useRef<HTMLDivElement>(null);
  const surgeRingTxt = useRef<HTMLSpanElement>(null);
  const surgeWrap = useRef<HTMLDivElement>(null);
  const surgeLabel = useRef<HTMLSpanElement>(null);
  const mercyBadge = useRef<HTMLDivElement>(null);
  const mercyPct = useRef<HTMLSpanElement>(null);
  const waveNum = useRef<HTMLSpanElement>(null);
  const waveBar = useRef<HTMLDivElement>(null);
  const biomeName = useRef<HTMLSpanElement>(null);
  const actNum = useRef<HTMLSpanElement>(null);
  const bossWrap = useRef<HTMLDivElement>(null);
  const bossName = useRef<HTMLSpanElement>(null);
  const bossTitle = useRef<HTMLDivElement>(null);
  const bossFill = useRef<HTMLDivElement>(null);
  const bossCounter = useRef<HTMLSpanElement>(null);
  const bossBust = useRef<HTMLImageElement>(null);
  const bossSkull = useRef<SVGSVGElement>(null);
  const scoreText = useRef<HTMLSpanElement>(null);
  const seedText = useRef<HTMLSpanElement>(null);
  const glyphText = useRef<HTMLSpanElement>(null);
  const foesText = useRef<HTMLSpanElement>(null);
  const slotRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const slotCd = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const weaveWrap = useRef<HTMLDivElement>(null);
  const weaveFill = useRef<HTMLDivElement>(null);
  const blinkPip = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const surgeGlow = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const objRows = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const soloHp = useRef<HTMLSpanElement>(null);
  /* v2.2: off-screen threat markers — 3 static arrows, driven purely by
   * style writes from the ~30 Hz snapshot stream (zero re-renders) */
  const threatRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  useEffect(() => {
    const scale = vignetteScale;
    let lastHp = Infinity;
    let vignetteT = 0;
    const apply: HudApply = (s) => {
      /* ---- vitals ---- */
      if (hpFill.current) hpFill.current.style.width = `${Math.max(0, s.hp / s.hpMax * 100)}%`;
      if (hpText.current) hpText.current.textContent = `${Math.ceil(Math.max(0, s.hp))} / ${Math.round(s.hpMax)}`;
      if (aeFill.current) aeFill.current.style.width = `${s.aether / s.aetherMax * 100}%`;
      if (aeText.current) aeText.current.textContent = `${Math.floor(s.aether)} / ${Math.round(s.aetherMax)}`;
      if (surgeFill.current) surgeFill.current.style.width = `${s.surge * 100}%`;
      if (surgePct.current) surgePct.current.textContent = `${Math.round(s.surge * 100)}%`;
      if (surgeWrap.current) {
        const ready = s.surge >= 1;
        surgeWrap.current.dataset.ready = ready ? "1" : "0";
        surgeWrap.current.style.opacity = s.surgeActive > 0 ? "0.45" : "1";
      }
      if (surgeLabel.current) {
        surgeLabel.current.textContent = s.surgeActive > 0 ? `SURGING ${s.surgeActive.toFixed(1)}s` : s.surge >= 1 ? "SURGE READY" : "SURGE";
      }
      /* the conic SURGE ring — gold progress arc with centered % */
      if (surgeRing.current) {
        surgeRing.current.style.background = s.surge >= 1
          ? "conic-gradient(#f0c060 0deg, #ffd97a 360deg)"
          : `conic-gradient(#f0c060 ${s.surge * 360}deg, rgba(84,64,130,0.95) 0deg)`;
        surgeRing.current.style.boxShadow = s.surge >= 1 ? "0 0 18px rgba(240,192,96,0.55)" : "none";
      }
      if (surgeRingTxt.current) {
        surgeRingTxt.current.textContent = s.surgeActive > 0 ? `${s.surgeActive.toFixed(1)}s` : `${Math.round(s.surge * 100)}%`;
      }
      if (surgeGlow.current) {
        surgeGlow.current.style.opacity = s.surgeActive > 0 ? `${0.25 + Math.min(0.2, s.surgeActive * 0.05)}` : "0";
      }
      if (mercyBadge.current) {
        mercyBadge.current.style.display = s.mercy > 0.001 ? "flex" : "none";
        if (mercyPct.current) mercyPct.current.textContent = `${Math.round(s.mercy * 100)}%`;
      }
      /* hurt vignette */
      if (s.hp < lastHp - 0.5) vignetteT = 1;
      lastHp = s.hp;
      /* low-vitality heartbeat — a slow crimson pulse while under 30% hp */
      const lowHp = s.hp > 0 && s.hp / s.hpMax < 0.3;
      if (lowHp && vignette.current) {
        vignette.current.style.opacity = `${(0.18 + 0.16 * Math.sin(performance.now() / 260)) * scale}`;
      } else if (vignetteT > 0 && vignette.current) {
        vignetteT = Math.max(0, vignetteT - 0.1);
        vignette.current.style.opacity = `${vignetteT * 0.55 * scale}`;
      } else if (vignette.current && vignette.current.style.opacity !== "0") {
        vignette.current.style.opacity = "0";
      }
      /* ---- wave banner: ✦ Act II · Cursed Grove ✦ / Wave 12 / 50 ---- */
      if (waveNum.current) waveNum.current.textContent = `${Math.max(1, s.wave)}`;
      if (actNum.current) actNum.current.textContent = ROMAN[Math.min(4, Math.floor((Math.max(1, s.wave) - 1) / 10))];
      if (biomeName.current) biomeName.current.textContent = s.biomeName ?? "";
      if (waveBar.current) waveBar.current.style.width = `${s.waveProgress * 100}%`;
      /* ---- tyrant bar ---- */
      if (bossWrap.current) {
        const boss = s.boss;
        bossWrap.current.style.display = boss ? "flex" : "none";
        if (boss) {
          if (bossName.current) bossName.current.textContent = boss.name.toUpperCase();
          if (bossTitle.current) bossTitle.current.textContent = boss.title;
          if (bossFill.current) {
            bossFill.current.style.width = `${Math.max(0, boss.hp / boss.hpMax * 100)}%`;
            bossFill.current.style.background = boss.color;
          }
          if (bossCounter.current) bossCounter.current.textContent = `${Math.ceil(Math.max(0, boss.hp)).toLocaleString()} / ${Math.round(boss.hpMax).toLocaleString()}`;
          /* the tyrant's own bust — swapped only when the name changes */
          if (bossBust.current && bossSkull.current && bossBust.current.dataset.k !== boss.name) {
            const src = bossBustSrc(boss.name);
            bossBust.current.dataset.k = boss.name;
            bossBust.current.src = src ?? "";
            bossBust.current.style.display = src ? "block" : "none";
            bossSkull.current.style.display = src ? "none" : "block";
          }
        }
      }
      /* ---- score + currency cluster ---- */
      if (scoreText.current) scoreText.current.textContent = s.score.toLocaleString();
      if (seedText.current && seedText.current.textContent !== s.seed) seedText.current.textContent = s.seed;
      if (glyphText.current) glyphText.current.textContent = s.glyphs.toLocaleString();
      if (foesText.current) foesText.current.textContent = `${s.enemiesLeft}`;
      /* ---- spell slots ---- */
      for (let i = 0; i < 3; i++) {
        const slot = slotRefs[i].current;
        const cd = slotCd[i].current;
        if (!slot || !cd) continue;
        const selected = s.selected === i;
        slot.dataset.sel = selected ? "1" : "0";
        slot.dataset.empty = s.spellIds[i] ? "0" : "1";
        slot.style.borderColor = selected ? s.spellColors[i] : "rgba(184,134,11,0.55)";
        slot.style.boxShadow = selected ? `0 0 18px ${s.spellColors[i]}55` : "none";
        const nameEl = slot.querySelector("[data-slot-name]") as HTMLElement | null;
        if (nameEl && nameEl.textContent !== s.spellNames[i]) nameEl.textContent = s.spellNames[i];
        const iconEl = slot.querySelector("[data-slot-icon]") as HTMLImageElement | null;
        if (iconEl) {
          const el = (s.spellIds[i] || "").split("+")[0];
          if (iconEl.dataset.el !== el) {
            iconEl.dataset.el = el;
            iconEl.src = el ? elementIconSrc(el) : "";
            iconEl.style.visibility = el ? "visible" : "hidden";
          }
          iconEl.style.filter = el ? `brightness(1.5) saturate(1.25) contrast(1.08) drop-shadow(0 0 2px rgba(255,255,255,0.85)) drop-shadow(0 0 9px ${s.spellColors[i]})` : "none";
        }
        /* element-colored aura behind the icon — lifts dark pixel art off
         * the dark card (audit: icons read as murky blobs) */
        const glowEl = slot.querySelector("[data-slot-glow]") as HTMLElement | null;
        if (glowEl) {
          const hasSpell = !!s.spellIds[i];
          if (glowEl.dataset.col !== s.spellColors[i]) {
            glowEl.dataset.col = s.spellColors[i];
            glowEl.style.background = hasSpell ? `radial-gradient(circle at 50% 46%, ${s.spellColors[i]}40, transparent 68%)` : "none";
          }
        }
        const pipEls = slot.querySelectorAll("[data-slot-pip]");
        pipEls.forEach((pip, j) => {
          (pip as HTMLElement).style.background = j <= i ? "#d9a441" : "rgba(58,44,104,0.8)";
        });
        cd.style.height = `${(1 - s.cooldowns[i]) * 100}%`;
        /* cooldown seconds — a big centered numeral while cooling, nothing
         * while ready (the READY chorus shouted over the icons; concept 05
         * cards stay quiet until they actually need the number) */
        const cdTextEl = slot.querySelector("[data-slot-cd]") as HTMLElement | null;
        const hasSpell = !!s.spellIds[i];
        const secs = s.cooldownSeconds?.[i] ?? 0;
        const txt = !hasSpell || secs <= 0.1 ? "" : secs >= 3 ? `${Math.ceil(secs)}` : secs.toFixed(1);
        if (cdTextEl) {
          if (cdTextEl.textContent !== txt) cdTextEl.textContent = txt;
          cdTextEl.style.visibility = txt ? "visible" : "hidden";
        }
        const aria = !hasSpell ? `Spell slot ${i + 1}, empty` : secs > 0.1 ? `Spell slot ${i + 1}, ${s.spellNames[i]}, cooldown ${secs.toFixed(1)} seconds` : `Spell slot ${i + 1}, ${s.spellNames[i]}, ready`;
        if (slot.getAttribute("aria-label") !== aria) slot.setAttribute("aria-label", aria);
        const evoEl = slot.querySelector("[data-slot-evo]") as HTMLElement | null;
        if (evoEl) evoEl.style.visibility = s.spellEvolved?.[i] ? "visible" : "hidden";
      }
      /* ---- resonance weave window (diamond-timer chip above the bar) ---- */
      if (weaveWrap.current && weaveFill.current) {
        const active = s.castWindow > 0;
        weaveWrap.current.style.opacity = active ? "1" : "0";
        if (active) {
          weaveFill.current.style.width = `${s.castWindow * 100}%`;
          const last = s.lastCastElement;
          weaveWrap.current.style.borderColor = last ? elementColor(last) : "#f5c96b";
        }
      }
      /* ---- blink card: recharge curtain (shrinks to 0 when ready) ---- */
      if (blinkPip.current) {
        blinkPip.current.style.height = `${Math.max(0, (1 - s.blinkCd) * 100)}%`;
      }
      /* ---- resume countdown ---- */
      if (countdownRef.current) {
        const c = s.countdown ?? 0;
        countdownRef.current.style.display = c > 0 ? "block" : "none";
        if (c > 0) {
          const el = countdownRef.current.firstElementChild;
          if (el) el.textContent = String(Math.ceil(c - 0.2));
        }
      }
      /* ---- minimap (v3.1) — player-centered tactical radar ----
       * World scale: 26 world units map onto the panel half-extent — dense
       * enough for readable blips, wide enough that the circular arena
       * fence (r = 50, ARENA_RADIUS) reads as a dim violet arc whenever the
       * fight drifts toward the rim. A 10-unit lattice gives the dark panel
       * a terrain hint even before the first blip arrives. */
      const mm = minimap.current;
      if (mm) {
        const ctx = mm.getContext("2d");
        const W = mm.width, H = mm.height;
        if (ctx) {
          const RANGE = 26;
          const sx = (x: number) => W / 2 + ((x - s.px) / RANGE) * (W / 2);
          const sy = (z: number) => H / 2 + ((z - s.pz) / RANGE) * (H / 2);
          const cx = (v: number, max: number) => Math.max(3, Math.min(max - 3, v));
          ctx.clearRect(0, 0, W, H);
          /* field */
          ctx.fillStyle = "#0d0916";
          ctx.fillRect(0, 0, W, H);
          const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.14, W / 2, H / 2, W * 0.72);
          grad.addColorStop(0, "rgba(122,63,212,0.12)");
          grad.addColorStop(1, "rgba(26,15,46,0.55)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
          /* clipped world layer: lattice + arena fence + blips */
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.clip();
          /* faint 10-unit lattice */
          ctx.strokeStyle = "rgba(154,143,181,0.13)";
          ctx.lineWidth = 1;
          for (let g = -50; g <= 50; g += 10) {
            ctx.beginPath();
            ctx.moveTo(sx(g), 0);
            ctx.lineTo(sx(g), H);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, sy(g));
            ctx.lineTo(W, sy(g));
            ctx.stroke();
          }
          /* arena fence — the circular r=50 boundary as a dim violet arc */
          const fenceR = (50 / RANGE) * (W / 2);
          ctx.strokeStyle = "rgba(201,160,255,0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx(0), sy(0), fenceR, 0, Math.PI * 2);
          ctx.stroke();
          /* the player's aura ring — a 10-unit reach hint */
          ctx.strokeStyle = "rgba(255,217,122,0.18)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, (10 / RANGE) * (W / 2), 0, Math.PI * 2);
          ctx.stroke();
          /* blips — foes crimson, elites amber, tyrants violet skulls */
          for (const b of s.blips ?? []) {
            const mx = cx(sx(b.x), W);
            const my = cx(sy(b.z), H);
            if (b.k === 2) {
              ctx.fillStyle = "rgba(201,160,255,0.22)";
              ctx.beginPath();
              ctx.arc(mx, my, 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#c9a0ff";
              ctx.beginPath();
              ctx.arc(mx, my, 4.4, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#2a1846";
              ctx.fillRect(mx - 2.4, my - 1.6, 1.6, 1.6);
              ctx.fillRect(mx + 0.8, my - 1.6, 1.6, 1.6);
            } else if (b.k === 1) {
              ctx.fillStyle = "rgba(255,176,64,0.25)";
              ctx.beginPath();
              ctx.arc(mx, my, 5.4, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#ffb040";
              ctx.beginPath();
              ctx.arc(mx, my, 3.1, 0, Math.PI * 2);
              ctx.fill();
            } else {
              /* common foe — crimson dot with a dark rim for panel contrast */
              ctx.fillStyle = "rgba(10,6,16,0.85)";
              ctx.beginPath();
              ctx.arc(mx, my, 3.3, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#ff5a7a";
              ctx.beginPath();
              ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.restore();
          /* the archmage — gold four-pointed star, screen-up = -Z */
          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.fillStyle = "rgba(255,217,122,0.2)";
          ctx.beginPath();
          ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffd97a";
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
            const rad = i % 2 === 0 ? 5.5 : 2.2;
            ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      /* ---- rift objectives (v3.1) — clean strings, live boss aware ----
       * Fixed wording: no template stray characters; the tyrant line names
       * the ACTUAL act boss from BOSS_DEFS (or the live boss when present). */
      const nextBossWave = Math.ceil(Math.max(1, s.wave) / 10) * 10;
      const bossIdx = Math.min(BOSS_DEFS.length - 1, Math.max(0, Math.floor((Math.max(1, s.wave) - 1) / 10)));
      const tyrantName = s.boss ? s.boss.name : BOSS_DEFS[bossIdx].name;
      const objs: [boolean, string][] = [
        [s.wave >= nextBossWave, `Survive to Wave ${nextBossWave}`],
        [s.wave > nextBossWave || (s.wave === nextBossWave && !s.boss), `Defeat the ${tyrantName}`],
        [s.glyphs >= 150, `Collect Glyphs ${Math.min(s.glyphs, 150)}/150`]
      ];
      for (let i = 0; i < 3; i++) {
        const row = objRows[i].current;
        if (!row) continue;
        row.dataset.done = objs[i][0] ? "1" : "0";
        const label = row.querySelector("[data-obj-label]");
        if (label && label.textContent !== objs[i][1]) label.textContent = objs[i][1];
        const check = row.querySelector("[data-obj-check]") as HTMLElement | null;
        if (check) check.style.visibility = objs[i][0] ? "visible" : "hidden";
        const box = row.firstElementChild as HTMLElement | null;
        if (box) {
          box.style.borderColor = objs[i][0] ? "#40d060" : "rgba(154,143,181,0.5)";
          box.style.background = objs[i][0] ? "rgba(64,208,96,0.12)" : "transparent";
        }
      }
      /* ---- solo plate HP echo ---- */
      if (soloHp.current) soloHp.current.style.width = `${Math.max(0, s.hp / s.hpMax * 100)}%`;
      /* ---- off-screen threat markers ---- */
      const threats = s.threats ?? [];
      for (let i = 0; i < 3; i++) {
        const r = threatRefs[i].current;
        if (!r) continue;
        const t = threats[i];
        if (!t) {
          r.style.display = "none";
          continue;
        }
        r.style.display = "block";
        r.style.color = t.kind === "boss" ? "#ff4d6b" : "#c9a0ff";
        r.style.transform = `rotate(${t.angle}deg)`;
        r.dataset.threatKind = t.kind;
      }
    };
    register(apply);
    return () => register(null);
  }, [register, vignetteScale]);

  return (
    <div data-hud-root className="pointer-events-none absolute inset-0 select-none font-sans text-white">
      {/* surge bloom + hurt vignette */}
      <div ref={surgeGlow} className="absolute inset-0 opacity-0 transition-opacity duration-300" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(245,201,107,0.5) 100%)" }} />
      <div ref={vignette} className="absolute inset-0 opacity-0" style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(255,45,80,0.65) 100%)", transition: "opacity 0.12s linear" }} />

      {/* off-screen threat markers */}
      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        {THREAT_MARKER_KEYS.map(i => (
          <div key={i} ref={threatRefs[i]} style={{ display: "none", position: "absolute", left: "50%", top: "50%" }}>
            <div className="flex flex-col items-center" style={{ transform: "translate(-50%, -50%)" }}>
              <div className="tc-threat-arrow" style={{ transform: "translateY(-32vh)" }}>
                <svg viewBox="0 0 24 24" className="size-5 drop-shadow-[0_0_6px_rgba(0,0,0,0.8)]"><path d="M12 3 L20 19 L12 15 L4 19 Z" fill="currentColor" /></svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* resume countdown */}
      <div ref={countdownRef} style={{ display: "none" }} className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 text-center" aria-live="polite">
        <span className="font-display text-7xl font-black text-[#f2e8c9] [text-shadow:0_0_40px_rgba(245,201,107,0.6)]">3</span>
      </div>

      {/* ================= PLAYER FRAME (top-left) ================= */}
      <div className="safe-t safe-x absolute left-3 top-3 w-[228px] sm:left-5 sm:top-5 sm:w-[290px] lg:w-[318px]">
        <div className="px-panel px-corners flex items-center gap-2.5 px-2.5 py-1.5 sm:py-2">
          {/* octagonal gold portrait + hanging hex crest */}
          <span aria-hidden className="relative block size-16 shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#f0c060] to-[#b8822e] p-[2px] shadow-[0_0_18px_rgba(217,164,65,0.35)] sm:size-[72px]">
            <span className="relative block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#1e1430]">
              {/* violet rim-light behind the bust — lifts the dark pixel art */}
              <span aria-hidden className="absolute inset-0" style={{ clipPath: "polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)", background: "radial-gradient(circle at 50% 34%, rgba(199,125,255,0.42), rgba(30,20,48,0) 72%)" }} />
              <img src={PORTRAIT_STORMCALLER()} alt="" width={72} height={72} draggable={false} className="relative size-full object-cover [image-rendering:pixelated]" style={{ filter: "brightness(1.16) saturate(1.1)" }} />
            </span>
          </span>
          {/* hexagonal class crest, hung under the portrait */}
          <span aria-hidden className="absolute -bottom-[8px] left-[30px] block size-[13px] [clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)] bg-gradient-to-b from-[#f0c060] to-[#b8822e] p-[1.5px] shadow-[0_0_8px_rgba(217,164,65,0.7)] sm:left-[36px]">
            <span className="flex size-full items-center justify-center [clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)] bg-[#241740]">
              <svg viewBox="0 0 24 24" className="size-2 text-[#c9a0ff]"><path d="M13 2 L4.5 13.5 L11 13.5 L9.5 22 L19.5 9.5 L12.5 9.5 Z" fill="currentColor" /></svg>
            </span>
          </span>
          <span className="min-w-0 flex-1">
            {/* nameplate — class identity + lifetime level */}
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-display truncate text-[13px] font-bold text-[#f2e8c9] sm:text-[15px]">Stormcaller</span>
              <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#f0c060]">
                <span aria-hidden className="inline-block size-[5px] rotate-45 bg-[#f0c060]" />
                Lv. {level}
              </span>
            </span>
            {/* HP — pixel heart socket, crimson-magenta fill */}
            <span className="mt-1 flex items-center gap-1.5 sm:mt-1.5">
              <span className="px-socket size-5! overflow-hidden sm:size-[22px]!">
                <img src={ICON.heart()} alt="" width={16} height={16} draggable={false} className="size-4 [image-rendering:pixelated]" />
              </span>
              <span className="px-bar relative h-3 flex-1">
                <span ref={hpFill} className="px-bar-fill absolute inset-y-0 left-0" style={{ width: "100%", background: "linear-gradient(90deg,#e02040,#ff5a7a)" }} />
                <span aria-hidden className="absolute inset-y-0 left-1.5 flex items-center text-[7px] font-black uppercase tracking-[0.16em] text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.95)]">HP</span>
                <span ref={hpText} className="absolute inset-0 flex items-center justify-end pr-1.5 text-[9px] font-extrabold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">100 / 100</span>
              </span>
            </span>
            {/* AETHER — pixel flask socket, violet fill */}
            <span className="mt-1 flex items-center gap-1.5">
              <span className="px-socket size-5! overflow-hidden sm:size-[22px]!" style={{ boxShadow: "inset 0 0 0 1px rgba(166,107,240,0.45)" }}>
                <img src={ICON.flask()} alt="" width={16} height={16} draggable={false} className="size-4 [image-rendering:pixelated]" />
              </span>
              <span className="px-bar relative h-3 flex-1">
                <span ref={aeFill} className="px-bar-fill absolute inset-y-0 left-0" style={{ width: "100%", background: "linear-gradient(90deg,#6a3df0,#a66bf0)" }} />
                <span aria-hidden className="absolute inset-y-0 left-1.5 flex items-center text-[7px] font-black uppercase tracking-[0.16em] text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.95)]">Aether</span>
                <span ref={aeText} className="absolute inset-0 flex items-center justify-end pr-1.5 text-[9px] font-extrabold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">100 / 100</span>
              </span>
            </span>
            {/* SURGE — bolt socket, amber fill + numeric % (tinted track so
                the empty meter still reads as a meter) */}
            <span className="mt-1 flex items-center gap-1.5">
              <span className="px-socket size-5! sm:size-[22px]!">
                <svg viewBox="0 0 24 24" className="size-3"><path d="M13 2 L4.5 13.5 L11 13.5 L9.5 22 L19.5 9.5 L12.5 9.5 Z" fill="#f5a623" /></svg>
              </span>
              <span className="px-bar relative h-3 flex-1" style={{ borderColor: "rgba(232,148,10,0.5)", background: "linear-gradient(90deg, rgba(232,148,10,0.16), rgba(255,210,74,0.07))" }}>
                <span ref={surgeFill} className="px-bar-fill absolute inset-y-0 left-0" style={{ width: "0%", background: "linear-gradient(90deg,#e8940a,#ffd24a)" }} />
                <span aria-hidden className="absolute inset-y-0 left-1.5 flex items-center text-[7px] font-black uppercase tracking-[0.16em] text-[#ffe9ad]/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.95)]">Surge</span>
                <span ref={surgePct} className="absolute inset-0 flex items-center justify-end pr-1 text-[9px] font-extrabold tabular-nums text-[#ffe9ad] [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">0%</span>
              </span>
            </span>
            {/* rift mercy strip — gold rite, lives inside the panel */}
            <div ref={mercyBadge} style={{ display: "none" }} className="mt-1.5 w-full items-center justify-center gap-1.5 rounded border border-[#f0c060]/45 bg-[#f0c060]/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.18em] text-[#ffd97a]">
              <span aria-hidden className="inline-block size-[5px] rotate-45 bg-[#ffd97a]" />
              <span>Rift Mercy</span>
              <span ref={mercyPct} className="font-black tabular-nums">0%</span>
            </div>
          </span>
        </div>
      </div>

      {/* ================= SOLO RUN PLATE (left, below frame) =================
          The rift answers one call in this build — an honest plate instead of
          a hollow party roster. The slim HP echo doubles as an at-a-glance
          vitals read while the camera is turned away from the frame. */}
      <div data-hud-optional className="safe-x absolute left-3 top-[148px] hidden w-[228px] sm:left-5 sm:top-[182px] sm:block sm:w-[240px] lg:w-[260px]">
        <div className="px-panel px-corners flex items-center gap-2.5 px-2.5 py-1.5">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[#a66bf0]/50 bg-[#1e1430]">
            <svg viewBox="0 0 24 24" className="size-4 text-[#c9a0ff]" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20 C5.5 15.8 8.5 13.5 12 13.5 C15.5 13.5 18.5 15.8 18.5 20" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#c9b8e8]">Solo Run</span>
              <span className="shrink-0 pr-0.5 text-[8px] font-bold uppercase tracking-[0.16em] text-[#9a8fb5]">P1 · You</span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#0a0712]">
              <span ref={soloHp} className="block h-full rounded-full bg-gradient-to-r from-[#e02040] to-[#ff5a7a]" style={{ width: "100%" }} />
            </span>
          </span>
        </div>
      </div>

      {/* ================= WAVE BANNER + BOSS BAR (top-center) =================
          Mobile: the banner cannot fit between the 228px player frame and the
          124px currency column, so it docks below the frame instead. */}
      <div data-hud-wave className="safe-t absolute left-1/2 top-[112px] w-[min(88vw,272px)] -translate-x-1/2 text-center sm:top-5 sm:w-auto">
        <div className="px-panel px-corners min-w-[252px] px-4 pb-1.5 pt-1 sm:min-w-[340px] sm:px-6">
          {/* ✦ Act II · Cursed Grove ✦ */}
          <div className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2e3c0]">
            <span aria-hidden className="text-[11px] leading-none text-[#f0c060]">✦</span>
            <span>Act <span ref={actNum} className="font-extrabold text-[#f0c060]">I</span> · <span ref={biomeName} data-hud-optional className="max-w-44 truncate">Rubble Field</span></span>
            <span aria-hidden className="text-[11px] leading-none text-[#f0c060]">✦</span>
          </div>
          {/* Wave 12 / 50 — one weight, the total merely dimmed */}
          <div className="mt-0.5 flex items-baseline justify-center gap-1.5">
            <span className="font-display text-xl font-black text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.85)] sm:text-2xl">
              Wave <span ref={waveNum} className="tabular-nums text-[#ffd97a]">1</span>
              <span className="mx-1 text-white/35">/</span>
              <span className="tabular-nums text-white/55">50</span>
            </span>
          </div>
          {/* gold underline flourish */}
          <div className="mx-auto mt-1 flex w-40 items-center gap-1.5 sm:w-48">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#d9a441]/70" />
            <span aria-hidden className="inline-block size-[5px] rotate-45 bg-[#d9a441]" />
            <span className="relative h-[5px] flex-1 overflow-hidden rounded-full border border-[#d9a441]/40 bg-[#0a0712]">
              <span ref={waveBar} className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#d9a441] to-[#ffd97a]" style={{ width: "0%" }} />
            </span>
            <span aria-hidden className="inline-block size-[5px] rotate-45 bg-[#d9a441]" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#d9a441]/70" />
          </div>
        </div>
        {/* tyrant bar */}
        <div ref={bossWrap} style={{ display: "none" }} className="px-panel px-corners mt-2 w-[320px] max-w-[calc(100vw_-_1.5rem)] flex-col px-3 py-1.5 sm:w-[420px]">
          <div className="flex items-center gap-2">
            <span className="px-socket !size-[26px] shrink-0 overflow-hidden" style={{ boxShadow: "inset 0 0 0 1px rgba(217,164,65,0.6)" }}>
              {/* the tyrant's pixel bust — swapped live from the boss name */}
              <img ref={bossBust} alt="" width={26} height={26} draggable={false} className="size-[22px] object-cover [image-rendering:pixelated]" style={{ display: "none" }} />
              <svg ref={bossSkull} viewBox="0 0 24 24" className="size-4"><path d="M12 2 C8 2 6 5 6 8 C6 10 7 11.5 8 12.5 C6.5 13 5.5 14.5 5.5 16 L8 15.5 L7 19 L9.5 17.5 L10 21 L12 18.5 L14 21 L14.5 17.5 L17 19 L16 15.5 L18.5 16 C18.5 14.5 17.5 13 16 12.5 C17 11.5 18 10 18 8 C18 5 16 2 12 2 Z" fill="#e8e4d8" /><circle cx="9.5" cy="8" r="1.4" fill="#c9a0ff" /><circle cx="14.5" cy="8" r="1.4" fill="#c9a0ff" /></svg>
            </span>
            <span ref={bossName} className="font-display flex-1 truncate text-left text-sm font-bold text-white" />
            <span ref={bossCounter} className="text-[10px] font-bold tabular-nums text-[#f2e3c0]/80">0 / 0</span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border border-white/15 bg-[#0a0712]">
            <div ref={bossFill} className="relative h-full rounded-full transition-[width] duration-150" style={{ width: "100%", background: "#ff4d6b" }}>
              <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0) 55%)" }} />
            </div>
          </div>
          <span ref={bossTitle} className="mt-0.5 block text-center text-[9px] italic tracking-wide text-[#9a8fb5]" />
        </div>
      </div>

      {/* ================= SCORE + CURRENCY + MINIMAP + OBJECTIVES (right) ================= */}
      <div className="safe-t safe-x absolute right-3 top-3 flex w-[124px] flex-col items-stretch gap-1.5 sm:right-5 sm:top-5 sm:w-[210px]">
        {/* score plaque — laurel + gold numerals + the run's frozen seed */}
        <div className="px-panel px-corners flex items-center gap-2 px-2.5 py-1.5">
          <svg viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" aria-hidden>
            <circle cx="12" cy="10" r="6.5" stroke="#f0c060" strokeWidth="1.8" />
            <path d="M8.5 8.5 C9 6.8 10.4 6 12 6" stroke="#ffe9ad" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M9 19 L10 16 M15 19 L14 16 M10.5 21 L11.5 18 M13.5 21 L12.5 18" stroke="#d9a441" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-[#9a8fb5]">Score</span>
            <span ref={scoreText} className="font-display block text-base font-black tabular-nums leading-tight text-[#f2e8c9]">0</span>
            <span className="mt-px flex items-center gap-1 truncate text-[7.5px] font-bold uppercase tracking-[0.16em] text-[#9a8fb5]/75">
              <span aria-hidden className="inline-block size-[4px] shrink-0 rotate-45 bg-[#9a8fb5]/60" />
              <span ref={seedText} className="truncate font-mono tracking-[0.1em]">—</span>
            </span>
          </span>
        </div>
        {/* labeled currency pills — pixel crystal for glyphs, skull for foes */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-2">
          <div className="px-panel flex flex-col items-center gap-0.5 px-1.5 py-1" style={{ borderColor: "rgba(166,107,240,0.55)" }}>
            <span className="flex w-full items-center gap-1.5">
              <img src={ICON.crystal()} alt="" width={16} height={16} draggable={false} className="size-4 shrink-0 [image-rendering:pixelated] [filter:drop-shadow(0_0_5px_#a66bf0)]" />
              <span ref={glyphText} className="min-w-0 flex-1 truncate text-[13px] font-black tabular-nums leading-none text-[#e8ddff]">0</span>
            </span>
            <span className="text-[7.5px] font-black uppercase tracking-[0.18em] text-[#c9a0ff]">Glyphs</span>
          </div>
          <div className="px-panel flex flex-col items-center gap-0.5 px-1.5 py-1" style={{ borderColor: "rgba(224,32,64,0.5)" }}>
            <span className="flex w-full items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="#ff8fa3" aria-hidden><path d="M12 2 C8 2 6 5 6 8 C6 10 7 11.5 8 12.5 C6.5 13 5.5 14.5 5.5 16 L8 15.5 L7 19 L9.5 17.5 L10 21 L12 18.5 L14 21 L14.5 17.5 L17 19 L16 15.5 L18.5 16 C18.5 14.5 17.5 13 16 12.5 C17 11.5 18 10 18 8 C18 5 16 2 12 2 Z" /><circle cx="9.6" cy="8" r="1.2" fill="#241436" /><circle cx="14.4" cy="8" r="1.2" fill="#241436" /></svg>
              <span ref={foesText} className="min-w-0 flex-1 truncate text-[13px] font-black tabular-nums leading-none text-[#e8ddff]">0</span>
            </span>
            <span className="text-[7.5px] font-black uppercase tracking-[0.18em] text-[#ff8fa3]">Foes</span>
          </div>
        </div>
        {/* minimap — populated tactical radar */}
        <div data-hud-optional className="relative hidden sm:block">
          <div className="px-panel px-corners relative overflow-hidden rounded-lg! p-[3px]" style={{ boxShadow: "0 0 16px rgba(160,64,255,0.25), inset 0 0 12px rgba(14,10,24,0.9)" }}>
            <canvas ref={minimap} width={204} height={140} className="block h-[110px] w-full rounded-md sm:h-[124px]" aria-label="Tactical map" />
          </div>
          <span className="absolute z-10 flex size-5 items-center justify-center rounded-md border border-[#d9a441]/70 bg-[#1e1430]/90 text-[10px] font-black text-[#f0c060] shadow-[0_1px_4px_rgba(0,0,0,0.6)]" style={{ right: 6, top: 6 }}>M</span>
        </div>
        {/* rift objectives */}
        <div data-hud-optional className="hidden sm:block">
          <div className="px-panel px-corners px-2.5 py-2">
            <div className="px-header text-[10px]!">
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="#c9a0ff" strokeWidth="1.8"><path d="M12 3 C15 6 15 9 12 12 C9 9 9 6 12 3 Z" /><path d="M12 12 C15 12 17 14 17 17 M12 12 C9 12 7 14 7 17" /><circle cx="12" cy="19" r="1.6" fill="#c9a0ff" stroke="none" /></svg>
              <span>Rift Objectives</span>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {[0, 1, 2].map(i => (
                <div key={i} ref={objRows[i]} data-done="0" className="flex items-center gap-2 data-[done=1]:opacity-55">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[#9a8fb5]/70 bg-[#0a0712] shadow-[inset_0_1px_3px_rgba(0,0,0,0.85)]">
                    <svg viewBox="0 0 24 24" className="size-3 text-[#40d060]" fill="none" stroke="currentColor" strokeWidth="3.4" style={{ visibility: "hidden" }} data-obj-check><path d="M4.5 12.5 L10 18 L19.5 6.5" /></svg>
                  </span>
                  <span data-obj-label className="truncate text-[11px] font-semibold tabular-nums text-[#f2e3c0]/90">—</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ================= ABILITY BAR (bottom-center) ================= */}
      <div data-hud-slots className="safe-b absolute bottom-4 left-1/2 -translate-x-1/2 sm:bottom-5">
        {/* gold filigree base */}
        <div aria-hidden className="relative mx-auto mb-1 flex w-full items-center gap-2 px-6">
          <span className="h-[3px] flex-1 rounded-full bg-gradient-to-r from-transparent via-[#c9a227] to-[#d9a441] opacity-80" />
          <span className="block size-[9px] rotate-45 border border-[#b8822e] bg-gradient-to-br from-[#a66bf0] to-[#8a4fe0] shadow-[0_0_10px_rgba(138,79,224,0.8)]" />
          <span className="h-[3px] flex-1 rounded-full bg-gradient-to-l from-transparent via-[#c9a227] to-[#d9a441] opacity-80" />
        </div>
        {/* weave window chip */}
        <div ref={weaveWrap} style={{ opacity: 0 }} className="mx-auto mb-1.5 flex w-40 flex-col items-center gap-1 rounded-lg border-2 bg-[#120c1e]/90 px-2 py-1 transition-opacity duration-150">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#c9a0ff]">Weave</span>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <span ref={weaveFill} className="block h-full rounded-full bg-gradient-to-r from-[#a66bf0] to-[#c9a0ff]" style={{ width: "0%" }} />
          </span>
        </div>
        {/* the slot row — every card shares one card/keycap system (audit:
            three different keycap + frame conventions read as three UI kits) */}
        <div className="flex items-end justify-center gap-1.5 pt-2 sm:gap-3 lg:gap-4">
          {/* BLINK — wind-step rite, same gold card, teal identity accents */}
          <div className="relative h-16 w-[58px] sm:h-[4.5rem] sm:w-[76px]">
            <HudKeycap wide>Space</HudKeycap>
            <div className="relative h-full w-full overflow-hidden rounded-xl border-2 border-[#d9a441]/60 bg-gradient-to-b from-[#171026]/95 to-[#0e0817]/95" style={{ boxShadow: "inset 0 0 0 1px rgba(20,12,32,0.9), inset 0 1px 0 rgba(240,192,96,0.14)" }}>
              <span aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 44%, rgba(127,216,255,0.16), transparent 66%)" }} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pt-1.5">
                <svg viewBox="0 0 24 24" className="size-5 text-[#7fd8ff] [filter:drop-shadow(0_0_7px_rgba(127,216,255,0.65))]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12 L10 7 M5 12 L10 17" strokeLinecap="round" /><path d="M10 12 L19 12" strokeLinecap="round" /><path d="M15 8 L19 12 L15 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span className="mt-0.5 text-[9px] font-extrabold tracking-[0.14em] text-[#7fd8ff]">BLINK</span>
              </div>
              <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                <span aria-hidden className="size-[4px] rotate-45 bg-[#7fd8ff]/70" />
                <span aria-hidden className="size-[4px] rotate-45 bg-[#7fd8ff]/70" />
              </div>
              <div ref={blinkPip} className="absolute bottom-0 left-0 right-0 bg-[#06101c]/80" style={{ height: "100%" }} />
            </div>
          </div>
          {/* 3 spell cards — bronze/gold double border, element auras */}
          {SLOT_KEYS.map((key, i) => (
            <div key={key} className="relative h-16 w-[66px] sm:h-[4.5rem] sm:w-[92px] lg:h-20 lg:w-[104px]">
              <HudKeycap>{key}</HudKeycap>
              <div
                ref={slotRefs[i]}
                data-sel="0"
                data-empty="0"
                aria-label={`Spell slot ${i + 1}`}
                className="relative h-full w-full overflow-hidden rounded-xl border-2 bg-gradient-to-b from-[#171026]/95 to-[#0e0817]/95 transition-all duration-100 data-[sel=1]:scale-105 data-[empty=1]:opacity-40"
                style={{ boxShadow: "inset 0 0 0 1px rgba(20,12,32,0.9), inset 0 1px 0 rgba(240,192,96,0.14)" }}
              >
                <span data-slot-glow aria-hidden className="absolute inset-0" />
                <span data-slot-evo aria-hidden className="absolute left-1.5 top-1 text-[9px] font-black text-[#ffd97a] [filter:drop-shadow(0_0_4px_rgba(255,217,122,0.8))]" style={{ visibility: "hidden" }}>✦</span>
                <div className="absolute inset-0 flex flex-col items-center justify-center px-1 pt-1.5">
                  <img data-slot-icon alt="" width={30} height={30} className="relative mb-0.5 h-[30px] w-[30px] [image-rendering:pixelated] sm:h-8 sm:w-8" style={{ visibility: "hidden" }} />
                  <span data-slot-name className="max-w-full truncate text-[9px] font-bold uppercase tracking-wider text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">—</span>
                </div>
                <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                  {[0, 1, 2].map(j => <span key={j} data-slot-pip aria-hidden className="size-[5px] rotate-45" style={{ background: "rgba(58,44,104,0.8)" }} />)}
                </div>
                <div ref={slotCd[i]} className="absolute bottom-0 left-0 right-0 bg-[#060310]/70" style={{ height: "100%" }} />
                <span data-slot-cd aria-hidden className="absolute inset-0 flex items-center justify-center pt-1.5 text-[15px] font-black tabular-nums text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.95),0_0_14px_rgba(0,0,0,0.8)]" style={{ visibility: "hidden" }}>{""}</span>
              </div>
            </div>
          ))}
          {/* SURGE — framed gold medallion with the conic charge ring */}
          <div ref={surgeWrap} data-ready="0" className="group relative flex h-16 w-[58px] flex-col items-center justify-center sm:h-[4.5rem] sm:w-[76px]">
            <HudKeycap>F</HudKeycap>
            <div className="px-breathe relative size-[46px] sm:size-[52px]" style={{ opacity: 1 }}>
              <span aria-hidden className="absolute -inset-[3px] rounded-full border-2 border-[#d9a441]/60 bg-gradient-to-b from-[#171026]/95 to-[#0e0817]/95 shadow-[inset_0_0_0_1px_rgba(20,12,32,0.9)]" />
              <div ref={surgeRing} className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(#f0c060 0deg, rgba(84,64,130,0.95) 0deg)" }} />
              <div className="absolute inset-[5px] flex flex-col items-center justify-center gap-0.5 rounded-full bg-[#120c1e]">
                <svg viewBox="0 0 24 24" className="size-4 text-[#ffd24a] [filter:drop-shadow(0_0_6px_rgba(255,210,74,0.7))]"><path d="M12 3 C13.5 7 16 8.5 16 12 C16 14.8 14.2 17 12 17 C9.8 17 8 14.8 8 12 C8 10.5 8.6 9.3 9.5 8.3 C9.7 9.8 10.6 10.7 11.6 11 C11.3 9 12 6.5 12 3 Z" fill="currentColor" /><path d="M12 18.5 L13 21 L11 21 Z" fill="#ffd97a" /></svg>
                <span ref={surgeRingTxt} className="text-[10px] font-black tabular-nums leading-none text-[#ffe9a8] [text-shadow:0_1px_3px_rgba(0,0,0,0.95),0_0_8px_rgba(255,200,80,0.5)]">0%</span>
              </div>
            </div>
            <span ref={surgeLabel} className="mt-0.5 text-[9px] font-extrabold tracking-[0.14em] text-[#f0c060] group-data-[ready=1]:animate-pulse">SURGE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
