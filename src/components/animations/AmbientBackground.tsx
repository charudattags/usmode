"use client";
import { useEffect, useState } from "react";
import { moodColors, type Mood } from "@/theme/materialYou";

/** GPU-friendly animated mesh gradient whose palette follows the room's mood. */
export function AmbientBackground({ mood, seed }: { mood: Mood; seed: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const forced = document.documentElement.dataset.theme;
      setDark(forced ? forced === "dark" : mq.matches);
    };
    read();
    mq.addEventListener("change", read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", read);
      obs.disconnect();
    };
  }, []);
  const [a, b, c] = moodColors(seed, mood, dark);
  const slow = mood === "cozy" || mood === "confession";
  const dur = slow ? 26 : mood === "arena" ? 9 : 16;
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface" aria-hidden>
      <div className="mesh-blob" style={{ background: a, animation: `drift-a ${dur}s ease-in-out infinite`, transition: "background 1.2s" }} />
      <div className="mesh-blob" style={{ background: b, animation: `drift-b ${dur * 1.3}s ease-in-out infinite`, transition: "background 1.2s" }} />
      <div className="mesh-blob" style={{ background: c, animation: `drift-c ${dur * 1.1}s ease-in-out infinite`, transition: "background 1.2s" }} />
      {slow && <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 40%, rgba(255,200,150,0.12), transparent 60%)", animation: "breathe 7s ease-in-out infinite" }} />}
      <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--md-sys-color-surface) ${dark ? 55 : 45}%, transparent)` }} />
    </div>
  );
}
