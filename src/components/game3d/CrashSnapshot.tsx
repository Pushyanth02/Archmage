"use client";

import { useEffect, useState } from "react";
import { TriangleAlert, RotateCcw, Copy, Check } from "lucide-react";
import { useRiftStore } from "@/game3d/store";
import { GAME_VERSION } from "@/game3d/content";
import { Button } from "@/components/ui/button";

/* ARCHMAGE: RIFTBOUND (3D Edition) — crash snapshot overlay (v2.2, scope
   report §6). Offline-first by design: window errors are caught, a SANITIZED
   snapshot (game version, seed, active wave, settings summary and the error
   message/stack head) is rendered with a copy-to-clipboard button — nothing
   is uploaded, no user data beyond the game's own state is included, and the
   player can dismiss-and-reload or keep playing blind. One overlay per page
   load: after a dismissal we stop re-arming (a crash loop must not trap the
   player in overlay hell). */

interface CrashInfo {
  message: string;
  stackHead: string;
  at: number;
}

/** Settings worth reporting — a compact, non-identifying summary. */
function settingsSummary(s: Record<string, unknown>): string {
  const keys = ["quality", "brightness", "fov", "autoQuality", "reduceFlashes", "palette", "fpsCap", "hudDensity", "batterySaver"];
  return keys.map(k => `${k}=${String(s[k])}`).join(" ");
}

export function CrashSnapshot() {
  const [crash, setCrash] = useState<CrashInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    const onErr = (ev: ErrorEvent) => {
      if (dismissed) return;
      setCrash({
        message: String(ev.message ?? "Unknown fault").slice(0, 300),
        stackHead: String(ev.error?.stack ?? "").split("\n").slice(0, 4).join("\n").slice(0, 500),
        at: Date.now()
      });
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      if (dismissed) return;
      setCrash({
        message: `Unhandled promise rejection: ${String(ev.reason ?? "?").slice(0, 260)}`,
        stackHead: "",
        at: Date.now()
      });
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [dismissed]);

  if (!crash) return null;
  const st = useRiftStore.getState();
  const wave = (window as unknown as { __archmageLastWave?: number }).__archmageLastWave ?? "?";
  const snapshot = [
    `ARCHMAGE: RIFTBOUND v${GAME_VERSION} crash report`,
    `seed: ${st.seed}`,
    `wave: ${wave}`,
    `settings: ${settingsSummary(st.meta.settings as unknown as Record<string, unknown>)}`,
    ``,
    `error: ${crash.message}`,
    crash.stackHead ? `stack:\n${crash.stackHead}` : ""
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snapshot);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused (permissions) — the textarea below stays selectable */
    }
  };

  return <div className="dark fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md" role="alertdialog" aria-label="The rift broke — crash snapshot">
      <div className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-[#ff4d6b]/30 bg-[#14080f]/95 p-6 shadow-[0_0_70px_rgba(255,77,107,0.18)]">
      <div className="flex items-center gap-2 text-[#ff4d6b]">
        <TriangleAlert className="size-5" />
        <h2 className="font-serif text-xl font-bold uppercase tracking-[0.12em]">The Rift Broke</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/55">
        Something shattered inside the engine. Nothing was uploaded — this snapshot stays on your device.
        Copy it into a bug report and the seed will rebuild this exact rift.
      </p>
      <pre className="rift-scroll mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/50 p-3 font-mono text-[10px] leading-relaxed text-white/70" aria-label="Crash snapshot">{snapshot}</pre>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button onClick={copy} className="h-11 rounded-lg border border-[#f5c96b]/50 bg-[#f5c96b]/10 text-xs font-bold uppercase tracking-[0.2em] text-[#f5c96b] hover:bg-[#f5c96b]/20">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy snapshot"}
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()} className="h-11 rounded-lg border-white/15 bg-black/30 text-xs font-bold uppercase tracking-[0.2em] text-white/70 hover:bg-white/5 hover:text-white">
          <RotateCcw className="size-4" />
          Reload the rift
        </Button>
      </div>
      <button type="button" onClick={() => setDismissed(true)} className="mt-3 w-full text-center text-[10px] uppercase tracking-[0.25em] text-white/30 transition-colors hover:text-white/60">
        Keep going without reloading
      </button>
    </div>
    </div>;
}
