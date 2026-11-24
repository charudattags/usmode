"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Current time in ms, quantized to `everyMs`, re-rendering on that cadence.
 * Returns 0 during server rendering so markup never depends on the clock.
 */
export function useNow(everyMs = 1000): number {
  return useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, everyMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / everyMs) * everyMs,
    () => 0,
  );
}

function readReducedPref(): boolean {
  let pref = "system";
  try {
    pref = JSON.parse(localStorage.getItem("usmode-prefs") ?? "{}").reducedMotion ?? "system";
  } catch {
    /* ignore */
  }
  return pref === "on" || (pref === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(readReducedPref());
    const id = requestAnimationFrame(read);
    mq.addEventListener("change", read);
    window.addEventListener("usmode-prefs", read);
    return () => {
      cancelAnimationFrame(id);
      mq.removeEventListener("change", read);
      window.removeEventListener("usmode-prefs", read);
    };
  }, []);
  return reduced;
}
