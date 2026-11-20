"use client";


import { useRef, useEffect } from "react";
import type { HudSnapshot } from "@/game3d/types";
import { elementColor } from "@/game3d/content";
import { assetPath } from "@/lib/asset-path";
import { useRiftStore } from "@/game3d/store";

export type HudApply = (snap: HudSnapshot) => void;

/* ARCHMAGE: RIFTBOUND — v3.0 Pixel Reforged in-game HUD.
   Zero re-renders on the hot path: the shell registers our `apply` callback
   and pushes HudSnapshots at ~30 Hz straight into DOM refs.
   Art direction (concept 05 — Combat HUD & Battlefield):
   octagonal portrait + pill bars with icon sockets top-left, act/wave banner
   + tyrant bar top-center, score chip + currency pills + minimap + rift
   objectives right, party plate left, ability bar with keycaps + diamond
   pips + conic SURGE ring on a gold filigree base at the bottom. */

const SLOT_KEYS = ["1", "2", "3"];
/* 3 static off-screen threat markers (v2.2) — boss first, max 3 at once */
const THREAT_MARKER_KEYS = [0, 1, 2];
const ROMAN = ["I", "II", "III", "IV", "V"];

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
  const surgeRing = useRef<HTMLDivElement>(null);
  const surgeRingTxt = useRef<HTMLSpanElement>(null);
  const surgeWrap = useRef<HTMLDivElement>(null);
  const surgeLabel = useRef<HTMLSpanElement>(null);
  const mercyBadge = useRef<HTMLDivElement>(null);
  const waveNum = useRef<HTMLSpanElement>(null);
  const waveBar = useRef<HTMLDivElement>(null);
  const biomeName = useRef<HTMLSpanElement>(null);
  const actNum = useRef<HTMLSpanElement>(null);
  const bossWrap = useRef<HTMLDivElement>(null);
  const bossName = useRef<HTMLSpanElement>(null);
  const bossTitle = useRef<HTMLDivElement>(null);
  const bossFill = useRef<HTMLDivElement>(null);
  const bossCounter = useRef<HTMLSpanElement>(null);
  const scoreText = useRef<HTMLSpanElement>(null);
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
  const partyHp = useRef<HTMLSpanElement>(null);
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
        const pct = Math.round(s.surge * 100);
        surgeRing.current.style.background = s.surge >= 1
          ? "conic-gradient(#f0c060 0deg, #ffd97a 360deg)"
          : `conic-gradient(#f0c060 ${s.surge * 360}deg, rgba(58,44,104,0.85) 0deg)`;
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
        mercyBadge.current.textContent = `RIFT MERCY ${Math.round(s.mercy * 100)}%`;
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
        }
      }
      /* ---- score + currency cluster ---- */
      if (scoreText.current) scoreText.current.textContent = s.score.toLocaleString();
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
            iconEl.src = el ? assetPath(`/assets/icons/element-${el}.png`) : "";
            iconEl.style.visibility = el ? "visible" : "hidden";
          }
        }
        const pipEls = slot.querySelectorAll("[data-slot-pip]");
        pipEls.forEach((pip, j) => {
          (pip as HTMLElement).style.background = j <= i ? "#d9a441" : "rgba(58,44,104,0.8)";
        });
        cd.style.height = `${(1 - s.cooldowns[i]) * 100}%`;
        const cdTextEl = slot.querySelector("[data-slot-cd]") as HTMLElement | null;
        const hasSpell = !!s.spellIds[i];
        const secs = s.cooldownSeconds?.[i] ?? 0;
        const txt = !hasSpell ? "" : secs > 0.1 ? (secs >= 3 ? `${Math.ceil(secs)}` : secs.toFixed(1)) : "READY";
        if (cdTextEl) {
          if (cdTextEl.textContent !== txt) {
            cdTextEl.textContent = txt;
            cdTextEl.style.color = txt === "READY" ? "#ffd97a" : "rgba(255,255,255,0.92)";
          }
        }
        const aria = !hasSpell ? `Spell slot ${i + 1}, empty` : txt === "READY" ? `Spell slot ${i + 1}, ${s.spellNames[i]}, ready` : `Spell slot ${i + 1}, ${s.spellNames[i]}, cooldown ${txt} seconds`;
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
      /* ---- minimap (v3.0) — player-centered tactical dots ---- */
      const mm = minimap.current;
      if (mm) {
        const ctx = mm.getContext("2d");
        const W = mm.width, H = mm.height;
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          /* field */
          ctx.fillStyle = "#0e0a18";
          ctx.fillRect(0, 0, W, H);
          /* subtle purple corner vignette */
          const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.75);
          grad.addColorStop(0, "rgba(122,63,212,0.05)");
          grad.addColorStop(1, "rgba(90,40,160,0.30)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
          /* blips — 44 world units across the map */
          const RANGE = 22;
          const toMap = (x: number, z: number): [number, number] => [
            W / 2 + Math.max(-W / 2 + 3, Math.min(W / 2 - 3, ((x - s.px) / RANGE) * (W / 2))),
            H / 2 + Math.max(-H / 2 + 3, Math.min(H / 2 - 3, ((z - s.pz) / RANGE) * (H / 2)))
          ];
          for (const b of s.blips ?? []) {
            const [mx, my] = toMap(b.x, b.z);
            ctx.fillStyle = b.k === 2 ? "#ff4d6b" : b.k === 1 ? "#ffb040" : "#ff7a50";
            const r = b.k === 2 ? 4 : b.k === 1 ? 3 : 2.2;
            ctx.beginPath();
            ctx.arc(mx, my, r, 0, Math.PI * 2);
            ctx.fill();
            if (b.k === 2) {
              ctx.strokeStyle = "rgba(255,77,107,0.5)";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          /* the archmage — gold four-pointed star, screen-up = -Z */
          ctx.save();
          ctx.translate(W / 2, H / 2);
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
      /* ---- rift objectives (v3.0) — derived from live run state ---- */
      const nextBossWave = Math.ceil(Math.max(1, s.wave) / 10) * 10;
      const objs: [boolean, string][] = [
        [s.wave >= nextBossWave, `Survive to Wave ${nextBossWave}`],
        [s.wave > nextBossWave || (s.wave === nextBossWave && !s.boss), `Defeat the Wave ${nextBossWave} Tyrant`],
        [s.glyphs >= 150, `Collect Glyphs ${Math.min(s.glyphs, 150)} / 150`]
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
        if (box) box.style.borderColor = objs[i][0] ? "#40d060" : "rgba(154,143,181,0.5)";
      }
      /* ---- party plate HP ---- */
      if (partyHp.current) partyHp.current.style.width = `${Math.max(0, s.hp / s.hpMax * 100)}%`;
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

  const OCT = "polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)";

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
        <span className="font-serif text-7xl font-black text-[#f2e8c9] [text-shadow:0_0_40px_rgba(245,201,107,0.6)]">3</span>
      </div>

      {/* ================= PLAYER FRAME (top-left) ================= */}
      <div className="safe-t safe-x absolute left-3 top-3 w-[248px] sm:left-5 sm:top-5 sm:w-[290px] lg:w-[320px]">
        <div className="px-panel px-corners flex items-center gap-2.5 px-2.5 py-2">
          {/* octagonal portrait + hanging diamond crest */}
          <span aria-hidden className="relative block size-16 shrink-0 [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-gradient-to-b from-[#f0c060] to-[#b8822e] p-[2px] sm:size-[72px]">
            <span className="block size-full [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)] bg-[#1e1430]">
              <img src={assetPath("/assets/sprites/player-idle.png")} alt="" width={72} height={72} draggable={false} className="size-full scale-[1.7] object-contain [image-rendering:pixelated]" style={{ objectPosition: "50% 18%" }} />
            </span>
          </span>
          <span aria-hidden className="absolute -bottom-[7px] left-[34px] size-[9px] rotate-45 border border-[#b8822e] bg-gradient-to-br from-[#f0c060] to-[#d9a441] shadow-[0_0_8px_rgba(217,164,65,0.7)]" />
          <span className="min-w-0 flex-1">
            {/* nameplate */}
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-serif truncate text-[15px] font-bold text-[#f2e8c9]">Archmage</span>
              <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#f0c060]">
                <span aria-hidden className="inline-block size-[5px] rotate-45 bg-[#f0c060]" />
                Lv. {level}
              </span>
            </span>
            {/* HP */}
            <span className="mt-1.5 flex items-center gap-1.5">
              <span className="px-socket size-[22px]!"><svg viewBox="0 0 24 24" className="size-3"><path d="M12 21 C7 16.5 3 13 3 8.8 C3 5.9 5.2 4 7.6 4 C9.4 4 11 5 12 6.6 C13 5 14.6 4 16.4 4 C18.8 4 21 5.9 21 8.8 C21 13 17 16.5 12 21 Z" fill="#ff5a7a" /></svg></span>
              <span className="px-bar relative h-[13px] flex-1">
                <span ref={hpFill} className="px-bar-fill absolute inset-y-0 left-0" style={{ width: "100%", background: "linear-gradient(90deg,#e02040,#ff5a7a)" }} />
                <span ref={hpText} className="absolute inset-0 flex items-center justify-end pr-1.5 text-[9px] font-extrabold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">100 / 100</span>
              </span>
            </span>
            {/* aether */}
            <span className="mt-1 flex items-center gap-1.5">
              <span className="px-socket size-[22px]!"><svg viewBox="0 0 24 24" className="size-3"><path d="M12 2 L17 9 L12 22 L7 9 Z" fill="#6fa8ff" /><path d="M12 2 L17 9 L12 22 Z" fill="#8fc0ff" /></svg></span>
              <span className="px-bar relative h-[11px] flex-1">
                <span ref={aeFill} className="px-bar-fill absolute inset-y-0 left-0" style={{ width: "100%", background: "linear-gradient(90deg,#2a6ff0,#6fa8ff)" }} />
                <span ref={aeText} className="absolute inset-0 flex items-center justify-end pr-1.5 text-[9px] font-extrabold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">100 / 100</span>
              </span>
            </span>
            {/* surge energy */}
            <span className="mt-1 flex items-center gap-1.5">
              <span className="px-socket size-[22px]!"><svg viewBox="0 0 24 24" className="size-3"><path d="M13 2 L4.5 13.5 L11 13.5 L9.5 22 L19.5 9.5 L12.5 9.5 Z" fill="#f5a623" /></svg></span>
              <span className="px-bar relative h-[9px] flex-1">
                <span ref={surgeFill} className="px-bar-fill absolute inset-y-0 left-0" style={{ width: "0%", background: "linear-gradient(90deg,#e8940a,#ffd24a)" }} />
              </span>
            </span>
          </span>
        </div>
        <div ref={mercyBadge} style={{ display: "none" }} className="mt-1.5 hidden w-fit items-center rounded-md border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300">RIFT MERCY</div>
      </div>

      {/* ================= PARTY PLATE (left, below frame) ================= */}
      <div data-hud-optional className="safe-x absolute left-3 top-[150px] hidden w-[248px] sm:left-5 sm:top-[178px] sm:block sm:w-[240px] lg:w-[260px]">
        <div className="px-panel px-corners px-2.5 py-2">
          <div className="px-header text-[10px]!">
            <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19 C3.5 15.5 6 13.5 9 13.5 C12 13.5 14.5 15.5 14.5 19" /><circle cx="16.5" cy="9" r="2.4" /><path d="M15.5 13.8 C18.3 13.9 20.5 15.6 20.5 18.6" /></svg>
            <span>Party (1/1)</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-[#a66bf0]/25 bg-[#120c1e]/70 px-1.5 py-1.5">
            <span aria-hidden className="block size-8 shrink-0 overflow-hidden rounded-md border-2 border-[#a66bf0]/70 bg-[#1e1430]">
              <img src={assetPath("/assets/sprites/player-idle.png")} alt="" width={32} height={32} className="size-full object-contain [image-rendering:pixelated]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between">
                <span className="truncate text-[11px] font-bold text-white">You</span>
                <svg viewBox="0 0 24 24" className="size-3 text-[#4cd964]" fill="currentColor"><rect x="4" y="13" width="3" height="6" rx="0.5" /><rect x="10" y="9" width="3" height="10" rx="0.5" /><rect x="16" y="5" width="3" height="14" rx="0.5" /></svg>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#0a0712]">
                <span ref={partyHp} className="block h-full rounded-full bg-gradient-to-r from-[#3aa832] to-[#4cd964]" style={{ width: "100%" }} />
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ================= WAVE BANNER + BOSS BAR (top-center) ================= */}
      <div data-hud-wave className="safe-t absolute left-1/2 top-3 -translate-x-1/2 text-center sm:top-4">
        <div className="px-panel px-corners min-w-[280px] px-4 pb-1.5 pt-1 sm:min-w-[340px] sm:px-6">
          {/* ✦ Act II · Cursed Grove ✦ */}
          <div className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2e3c0]">
            <span aria-hidden className="inline-block size-[6px] rotate-45 bg-[#f0c060]" />
            <span>Act <span ref={actNum} className="font-extrabold text-[#f0c060]">I</span> · <span ref={biomeName} data-hud-optional className="max-w-44 truncate">Rubble Field</span></span>
            <span aria-hidden className="inline-block size-[6px] rotate-45 bg-[#f0c060]" />
          </div>
          {/* Wave 12 / 50 */}
          <div className="mt-0.5 flex items-baseline justify-center gap-1.5">
            <span className="font-serif text-xl font-black text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.85)] sm:text-2xl">
              Wave <span ref={waveNum} className="tabular-nums text-[#ffd97a]">1</span>
              <span className="mx-1 text-white/40">/</span>
              <span className="text-white/70">50</span>
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
            <span className="px-socket !size-[26px] shrink-0">
              <svg viewBox="0 0 24 24" className="size-4"><path d="M12 2 C8 2 6 5 6 8 C6 10 7 11.5 8 12.5 C6.5 13 5.5 14.5 5.5 16 L8 15.5 L7 19 L9.5 17.5 L10 21 L12 18.5 L14 21 L14.5 17.5 L17 19 L16 15.5 L18.5 16 C18.5 14.5 17.5 13 16 12.5 C17 11.5 18 10 18 8 C18 5 16 2 12 2 Z" fill="#e8e4d8" /><circle cx="9.5" cy="8" r="1.4" fill="#c9a0ff" /><circle cx="14.5" cy="8" r="1.4" fill="#c9a0ff" /></svg>
            </span>
            <span ref={bossName} className="font-serif flex-1 truncate text-left text-sm font-bold text-white" />
            <span ref={bossCounter} className="text-[10px] font-bold tabular-nums text-[#f2e3c0]/80">0 / 0</span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border border-white/15 bg-[#0a0712]">
            <div ref={bossFill} className="h-full rounded-full transition-[width] duration-150" style={{ width: "100%", background: "#ff4d6b" }} />
          </div>
          <span ref={bossTitle} className="mt-0.5 block text-center text-[9px] italic tracking-wide text-[#9a8fb5]" />
        </div>
      </div>

      {/* ================= SCORE + CURRENCY + MINIMAP + OBJECTIVES (right) ================= */}
      <div className="safe-t safe-x absolute right-3 top-3 flex w-[186px] flex-col items-stretch gap-1.5 sm:right-5 sm:top-5 sm:w-[210px]">
        {/* score chip */}
        <div className="px-panel px-corners flex items-center gap-2 px-2.5 py-1.5">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none"><circle cx="12" cy="10" r="6.5" stroke="#f0c060" strokeWidth="1.8" /><path d="M8.5 8.5 C9 6.8 10.4 6 12 6" stroke="#ffe9ad" strokeWidth="1.4" strokeLinecap="round" /><path d="M9 19 L10 16 M15 19 L14 16 M10.5 21 L11.5 18 M13.5 21 L12.5 18" stroke="#d9a441" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-[#9a8fb5]">Score</span>
            <span ref={scoreText} className="font-serif block text-base font-black tabular-nums leading-tight text-[#f2e8c9]">0</span>
          </span>
        </div>
        {/* currency pills */}
        <div className="flex gap-1.5">
          <div className="px-panel flex flex-1 items-center gap-1.5 px-2 py-1" style={{ borderColor: "rgba(217,164,65,0.55)" }}>
            <span aria-hidden className="block size-2.5 rotate-45 bg-[#ffd24a] shadow-[0_0_6px_#f0c030]" />
            <span ref={glyphText} className="text-xs font-bold tabular-nums text-[#f2e8c9]">0</span>
          </div>
          <div className="px-panel flex flex-1 items-center gap-1.5 px-2 py-1" style={{ borderColor: "rgba(224,32,64,0.5)" }}>
            <span className="text-[8px] font-black uppercase tracking-wider text-[#ff8fa3]">Foes</span>
            <span ref={foesText} className="text-xs font-bold tabular-nums text-[#f2e8c9]">0</span>
          </div>
        </div>
        {/* minimap */}
        <div data-hud-optional className="relative hidden sm:block">
          <div className="px-panel relative overflow-hidden rounded-lg! p-[3px]" style={{ boxShadow: "0 0 16px rgba(160,64,255,0.25), inset 0 0 12px rgba(14,10,24,0.9)" }}>
            <canvas ref={minimap} width={204} height={140} className="block h-[110px] w-full rounded-md sm:h-[124px]" aria-label="Tactical map" />
          </div>
          <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-md border border-[#d9a441]/70 bg-[#1e1430] text-[10px] font-black text-[#f0c060]">M</span>
        </div>
        {/* rift objectives */}
        <div data-hud-optional className="hidden sm:block">
          <div className="px-panel px-corners px-2.5 py-2">
            <div className="px-header text-[10px]!">
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="#c9a0ff" strokeWidth="1.8"><path d="M12 3 C15 6 15 9 12 12 C9 9 9 6 12 3 Z" /><path d="M12 12 C15 12 17 14 17 17 M12 12 C9 12 7 14 7 17" /><circle cx="12" cy="19" r="1.6" fill="#c9a0ff" stroke="none" /></svg>
              <span>Rift Objectives</span>
            </div>
            <div className="mt-1.5 space-y-1">
              {[0, 1, 2].map(i => (
                <div key={i} ref={objRows[i]} data-done="0" className="flex items-center gap-1.5 data-[done=1]:opacity-55">
                  <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border" style={{ borderColor: "rgba(154,143,181,0.5)" }}>
                    <svg viewBox="0 0 24 24" className="size-3 text-[#40d060]" fill="none" stroke="currentColor" strokeWidth="3.4" style={{ visibility: "hidden" }} data-obj-check><path d="M4.5 12.5 L10 18 L19.5 6.5" /></svg>
                  </span>
                  <span data-obj-label className="truncate text-[10px] font-semibold text-[#f2e3c0]/90">—</span>
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
        <div className="flex items-end justify-center gap-2 sm:gap-3 lg:gap-4">
          {/* BLINK card — cyan */}
          <div className="relative h-16 w-[68px] overflow-hidden rounded-xl border-2 border-[#40c8f0]/70 bg-gradient-to-b from-[#0e2440]/95 to-[#081526]/95 sm:h-[4.5rem] sm:w-[76px]">
            <span className="px-keycap absolute left-1/2 top-0 -translate-x-1/2 rounded-b-none!">SPACE</span>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-3">
              <svg viewBox="0 0 24 24" className="size-5 text-[#7fd8ff] [filter:drop-shadow(0_0_6px_rgba(64,200,240,0.6))]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12 L10 7 M5 12 L10 17" strokeLinecap="round" /><path d="M10 12 L19 12" strokeLinecap="round" /><path d="M15 8 L19 12 L15 16" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="mt-0.5 text-[9px] font-extrabold tracking-[0.14em] text-[#40d0e8]">BLINK</span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-1 pb-1">
              <span aria-hidden className="size-[4px] rotate-45 bg-[#40c8f0]/70" />
              <span aria-hidden className="size-[4px] rotate-45 bg-[#40c8f0]/70" />
            </div>
            <div ref={blinkPip} className="absolute bottom-0 left-0 right-0 bg-[#06101c]/80" style={{ height: "100%" }} />
          </div>
          {/* 3 spell cards — bronze/gold double border */}
          {SLOT_KEYS.map((key, i) => (
            <div
              key={key}
              ref={slotRefs[i]}
              data-sel="0"
              data-empty="0"
              aria-label={`Spell slot ${i + 1}`}
              className="relative h-16 w-[76px] overflow-hidden rounded-xl border-2 bg-gradient-to-b from-[#171026]/95 to-[#0e0817]/95 transition-all duration-100 data-[sel=1]:scale-105 data-[empty=1]:opacity-40 sm:h-[4.5rem] sm:w-[92px] lg:h-20 lg:w-[104px]"
              style={{ boxShadow: "inset 0 0 0 1px rgba(20,12,32,0.9), inset 0 1px 0 rgba(240,192,96,0.14)" }}
            >
              <span className="px-keycap absolute left-1/2 top-0 -translate-x-1/2 rounded-b-none!">{key}</span>
              <span data-slot-evo aria-hidden className="absolute left-1 top-1 text-[9px] font-black text-[#ffd97a]" style={{ visibility: "hidden" }}>✦</span>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-1 pt-2.5">
                <img data-slot-icon alt="" width={26} height={26} className="mb-0.5 h-6 w-6 [image-rendering:pixelated] opacity-95 sm:h-7 sm:w-7" style={{ visibility: "hidden", filter: "drop-shadow(0 0 6px rgba(255,255,255,0.35))" }} />
                <span data-slot-name className="max-w-full truncate text-[9px] font-bold uppercase tracking-wider text-white/85">—</span>
              </div>
              <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                {[0, 1, 2].map(j => <span key={j} data-slot-pip aria-hidden className="size-[5px] rotate-45" style={{ background: "rgba(58,44,104,0.8)" }} />)}
              </div>
              <div ref={slotCd[i]} className="absolute bottom-0 left-0 right-0 bg-[#060310]/70" style={{ height: "100%" }} />
              <span data-slot-cd aria-hidden className="absolute right-1 top-1 rounded bg-[#0a0712]/85 px-1 text-[9px] font-black tabular-nums tracking-wide text-white/90" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.95)" }}>{""}</span>
            </div>
          ))}
          {/* SURGE ring — gold conic */}
          <div ref={surgeWrap} data-ready="0" className="group relative flex h-16 w-[68px] flex-col items-center justify-center sm:h-[4.5rem] sm:w-[76px]">
            <span className="px-keycap absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-b-none!">F</span>
            <div className="px-breathe relative size-[46px] rounded-full sm:size-[52px]" style={{ opacity: 1 }}>
              <div ref={surgeRing} className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(#f0c060 0deg, rgba(58,44,104,0.85) 0deg)" }} />
              <div className="absolute inset-[5px] flex flex-col items-center justify-center gap-0.5 rounded-full bg-[#120c1e]">
                <svg viewBox="0 0 24 24" className="size-4 text-[#f0c060]"><path d="M12 3 C13.5 7 16 8.5 16 12 C16 14.8 14.2 17 12 17 C9.8 17 8 14.8 8 12 C8 10.5 8.6 9.3 9.5 8.3 C9.7 9.8 10.6 10.7 11.6 11 C11.3 9 12 6.5 12 3 Z" fill="currentColor" /><path d="M12 18.5 L13 21 L11 21 Z" fill="#ffd97a" /></svg>
                <span ref={surgeRingTxt} className="text-[9px] font-black tabular-nums leading-none text-[#f2e8c9] [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">0%</span>
              </div>
            </div>
            <span ref={surgeLabel} className="mt-0.5 text-[9px] font-extrabold tracking-[0.14em] text-[#f0c060] group-data-[ready=1]:animate-pulse">SURGE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
