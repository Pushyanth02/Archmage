"use client";

/* Thin React mount for the framework-free title screen. React renders a
   single empty root; the vanilla-TS layer (src/main.ts) injects the markup
   and owns the DOM from there. The effect is idempotent — dispose() fully
   tears down listeners, the WebGL context and the tree, so StrictMode's
   double-invoke in development is harmless. */

import { useEffect, useRef } from "react";
import { startTitleScreen } from "@/main";
import type { TitleApp, TitleHooks } from "@/main";
import "../style.css";

/** `onRunArrived` is the host hand-off: fired the moment the SOLO RUN dive
 *  lands, carrying the active seed — the parent swaps this screen for the
 *  playable GameShell. Omit it to keep the standalone seed splash. */
export default function TitleScreen({ onRunArrived }: TitleHooks) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hooksRef = useRef<TitleHooks>({});
  /* keep the hook fresh for the long-lived vanilla-TS layer without touching
     refs during render (react-hooks/refs) */
  useEffect(() => {
    hooksRef.current = { onRunArrived };
  }, [onRunArrived]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const app: TitleApp = startTitleScreen(root, {
      onRunArrived: seed => hooksRef.current.onRunArrived?.(seed),
    });
    return () => app.dispose();
  }, []);

  return <div className="title-root" ref={rootRef} />;
}
