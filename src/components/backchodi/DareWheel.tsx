"use client";
import { motion, useAnimate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { randomLaunchOmega, segmentAt, stepWheel, type WheelState } from "@/engine/wheel";
import { sounds, vibrate } from "@/lib/device";
import { useFx } from "../animations/FxProvider";
import { Button } from "../ui/primitives";

const TAU = Math.PI * 2;

/**
 * Physics dare wheel: real angular velocity, constant friction, and each peg
 * that hits the flipper costs a little speed (tick + flipper bounce). The
 * result is whatever segment ends up under the pointer.
 */
export function DareWheel({ dares, canSpin, onResult }: { dares: string[]; canSpin: boolean; onResult: (dare: string) => Promise<void> }) {
  const fx = useFx();
  const n = dares.length;
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [flipper, animateFlipper] = useAnimate();
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function spin() {
    if (spinning || !canSpin) return;
    setSpinning(true);
    setWinner(null);
    let state: WheelState = { angle, omega: fx.reduced ? 40 : randomLaunchOmega(), lastPeg: Math.floor(angle / (TAU / n)) };
    if (fx.reduced) {
      // No long animation: jump straight to a random resting angle.
      state = { angle: angle + randomLaunchOmega(6, 6 + TAU), omega: 0, lastPeg: 0 };
      setAngle(state.angle);
      void finish(state.angle);
      return;
    }
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const r = stepWheel(state, dt, { segments: n });
      state = r.state;
      setAngle(state.angle);
      if (r.ticks > 0) {
        sounds.tick();
        vibrate(6);
        if (flipper.current) void animateFlipper(flipper.current, { rotate: [0, -28, 0] }, { duration: 0.12 });
      }
      if (state.omega > 0) raf.current = requestAnimationFrame(loop);
      else void finish(state.angle);
    };
    raf.current = requestAnimationFrame(loop);
  }

  async function finish(a: number) {
    const seg = segmentAt(a, n);
    setWinner(seg);
    sounds.chime();
    vibrate([60, 40, 160]);
    fx.burst(0.5, 0.45, { spread: 140, count: 160 });
    await new Promise((r) => setTimeout(r, 1200));
    await onResult(dares[seg]);
    setSpinning(false);
  }

  const R = 140;
  const seg = TAU / n;
  const slice = (i: number) => {
    const a0 = i * seg - Math.PI / 2;
    const a1 = (i + 1) * seg - Math.PI / 2;
    const p = (a: number) => `${150 + R * Math.cos(a)} ${150 + R * Math.sin(a)}`;
    return `M150 150 L${p(a0)} A${R} ${R} 0 ${seg > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {/* Flipper / pointer */}
        <motion.div ref={flipper} className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2" style={{ transformOrigin: "50% 0%" }}>
          <svg width="28" height="40" viewBox="0 0 28 40" aria-hidden>
            <path d="M14 40 L2 6 Q14 -4 26 6 Z" fill="var(--md-sys-color-on-surface)" />
          </svg>
        </motion.div>
        <svg viewBox="0 0 300 300" className="h-72 w-72 drop-shadow-xl" role="img" aria-label="Dare wheel">
          <g transform={`rotate(${(angle * 180) / Math.PI} 150 150)`}>
            {dares.map((d, i) => (
              <g key={i} opacity={winner === null || winner === i ? 1 : 0.25} style={{ transition: "opacity .4s" }}>
                <path d={slice(i)} fill={i % 2 ? "var(--md-sys-color-primary)" : "var(--md-sys-color-tertiary)"} stroke="var(--md-sys-color-surface)" strokeWidth="3" />
                <text
                  x="150"
                  y="150"
                  transform={`rotate(${((i + 0.5) * seg * 180) / Math.PI - 90} 150 150) translate(70 4)`}
                  fill={i % 2 ? "var(--md-sys-color-on-primary)" : "var(--md-sys-color-on-tertiary)"}
                  fontSize="11"
                  fontWeight="700"
                >
                  {d.length > 18 ? `${d.slice(0, 17)}…` : d}
                </text>
              </g>
            ))}
            {dares.map((_, i) => {
              const a = i * seg - Math.PI / 2;
              return <circle key={`peg-${i}`} cx={150 + (R - 4) * Math.cos(a)} cy={150 + (R - 4) * Math.sin(a)} r="5" fill="var(--md-sys-color-surface)" />;
            })}
          </g>
          <circle cx="150" cy="150" r="22" fill="var(--md-sys-color-surface)" />
          <text x="150" y="156" textAnchor="middle" fontSize="18">
            😈
          </text>
        </svg>
        {winner !== null && <div className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)", animation: "breathe 1.2s ease-in-out infinite" }} />}
      </div>
      {winner !== null && (
        <motion.p initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="display max-w-xs text-center text-2xl font-black">
          {dares[winner]}
        </motion.p>
      )}
      {canSpin && (
        <Button size="lg" onClick={spin} disabled={spinning}>
          {spinning ? "Spinning…" : "Spin the wheel"}
        </Button>
      )}
    </div>
  );
}
