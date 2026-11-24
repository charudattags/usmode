"use client";
import { useEffect, useState } from "react";

/** Current time in ms, re-rendering every `everyMs`. Reads the clock only in effects. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => {
      let pref = "system";
      try {
        pref = JSON.parse(localStorage.getItem("usmode-prefs") ?? "{}").reducedMotion ?? "system";
      } catch {
        /* ignore */
      }
      setReduced(pref === "on" || (pref === "system" && mq.matches));
    };
    read();
    mq.addEventListener("change", read);
    window.addEventListener("usmode-prefs", read);
    return () => {
      mq.removeEventListener("change", read);
      window.removeEventListener("usmode-prefs", read);
    };
  }, []);
  return reduced;
}
