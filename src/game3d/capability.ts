"use client";

import { useSyncExternalStore } from "react";

/* ARCHMAGE: RIFTBOUND (3D Edition) — shared input-capability service (v2.2
   integrity fix, scope report §4.3: "unify input detection").
   ONE live pointer:coarse detector for every consumer (screens' menu rite,
   GameShell's touch layer). Hybrid laptops (touchscreen + mouse primary)
   report coarse=false here — consumers that need a touch upgrade path
   compose this hook with their own one-shot touchstart latch instead of
   keeping a second, divergent detector. */

function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getCoarseSnapshot() {
  return window.matchMedia("(pointer: coarse)").matches;
}
/** True while the device's PRIMARY pointer is coarse (touch-first). */
export function usePointerCoarse(): boolean {
  return useSyncExternalStore(subscribeCoarse, getCoarseSnapshot, () => false);
}
