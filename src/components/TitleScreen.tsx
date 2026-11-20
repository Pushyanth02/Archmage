"use client";

/* Thin React mount for the framework-free title screen. React renders a
   single empty root; the vanilla-TS layer (src/main.ts) injects the markup
   and owns the DOM from there. The effect is idempotent — dispose() fully
   tears down listeners, the WebGL context and the tree, so StrictMode's
   double-invoke in development is harmless. */

import { useEffect, useRef } from "react";
import { startTitleScreen } from "@/main";
import type { TitleApp } from "@/main";
import "../style.css";

export default function TitleScreen() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const app: TitleApp = startTitleScreen(root);
    return () => app.dispose();
  }, []);

  return <div className="title-root" ref={rootRef} />;
}
