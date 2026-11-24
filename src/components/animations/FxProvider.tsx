"use client";
/**
 * One full-screen effects layer for the whole app: confetti bursts, floating
 * "+XX.X PTS" pills, the 2px damped screen shake, the OVERTAKE! flash and the
 * Digital Kiss spectacle. Everything animates transform/opacity only, and is
 * toned down when reduced motion is on.
 */
import confetti from "canvas-confetti";
import { AnimatePresence, motion, useAnimate } from "framer-motion";
import { gsap } from "gsap";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotionPref } from "@/state/useNow";
import type { KissStyle } from "@/data/types";
import { sounds, vibrate } from "@/lib/device";

interface Pill {
  id: number;
  text: string;
  x: number;
  y: number;
}

interface Fx {
  burst(x?: number, y?: number, opts?: { angle?: number; spread?: number; count?: number }): void;
  hearts(): void;
  pill(text: string, x: number, y: number): void;
  shake(): void;
  overtake(): void;
  kiss(style: KissStyle, opts?: { incoming?: boolean }): Promise<void>;
  reduced: boolean;
}

const Ctx = createContext<Fx | null>(null);

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#d0436e";
}

export function FxProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotionPref();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fire = useRef<confetti.CreateTypes | null>(null);
  const [pills, setPills] = useState<Pill[]>([]);
  const [overtaking, setOvertaking] = useState(0);
  const [scope, animate] = useAnimate();
  const kissLayer = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (!canvasRef.current) return;
    fire.current = confetti.create(canvasRef.current, { resize: true, useWorker: true, disableForReducedMotion: true });
    return () => fire.current?.reset();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduced);
  }, [reduced]);

  const colors = () => [cssColor("--md-sys-color-primary"), cssColor("--md-sys-color-tertiary"), cssColor("--md-sys-color-secondary"), "#ffffff"];

  const burst = useCallback<Fx["burst"]>(
    (x = 0.5, y = 0.5, o = {}) => {
      if (reduced) return;
      void fire.current?.({
        particleCount: o.count ?? 90,
        angle: o.angle ?? 90,
        spread: o.spread ?? 70,
        startVelocity: 42,
        origin: { x, y },
        colors: colors(),
        scalar: 1.05,
        ticks: 180,
      });
    },
    [reduced],
  );

  const heartShape = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      return confetti.shapeFromPath({ path: "M12 21s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.1-8 11-8 11z" });
    } catch {
      return null;
    }
  }, []);

  const hearts = useCallback(() => {
    if (reduced) return;
    const shapes = heartShape ? [heartShape] : undefined;
    const base = { colors: ["#ff4d8d", "#ff8fb1", "#ffd1dc", cssColor("--md-sys-color-primary")], shapes, scalar: 2, ticks: 220 };
    void fire.current?.({ ...base, particleCount: 50, spread: 100, origin: { x: 0.5, y: 0.6 }, startVelocity: 45 });
    setTimeout(() => void fire.current?.({ ...base, particleCount: 30, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } }), 150);
    setTimeout(() => void fire.current?.({ ...base, particleCount: 30, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } }), 300);
  }, [reduced, heartShape]);

  const pill = useCallback((text: string, x: number, y: number) => {
    const id = nextId.current++;
    setPills((p) => [...p, { id, text, x, y }]);
    setTimeout(() => setPills((p) => p.filter((q) => q.id !== id)), 1600);
  }, []);

  const shake = useCallback(() => {
    if (reduced || !scope.current) return;
    void animate(scope.current, { x: [0, -2, 2, -1.5, 1.5, -0.5, 0] }, { duration: 0.35 });
  }, [reduced, animate, scope]);

  const overtake = useCallback(() => {
    setOvertaking((n) => n + 1);
    vibrate([20, 30, 60]);
    sounds.whoosh();
  }, []);

  const kiss = useCallback<Fx["kiss"]>(
    async (style, opts = {}) => {
      const layer = kissLayer.current;
      vibrate(style === "attack10" ? [40, 30, 40, 30, 40, 30, 120] : [60, 40, 120]);
      sounds.chime();
      if (!layer) return;
      if (reduced) {
        layer.textContent = style === "forehead" ? "😚" : style === "flying" ? "😘" : "💋";
        layer.style.display = "flex";
        await new Promise((r) => setTimeout(r, 900));
        layer.style.display = "none";
        return;
      }
      const stamps = style === "attack10" ? 10 : style === "flying" ? 6 : 4;
      const emoji = style === "forehead" ? "😚" : style === "flying" ? "😘" : "💋";
      layer.innerHTML = "";
      layer.style.display = "block";
      const bloom = document.createElement("div");
      bloom.className = "absolute inset-0";
      bloom.style.background = `radial-gradient(circle at 50% 55%, ${cssColor("--md-sys-color-primary")}aa, transparent 60%)`;
      const ring = document.createElement("div");
      ring.className = "absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-[6px]";
      ring.style.borderColor = "#ff8fb1";
      const lips = document.createElement("div");
      lips.className = "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9rem] leading-none";
      lips.textContent = emoji;
      layer.append(bloom, ring, lips);
      const stampEls: HTMLDivElement[] = [];
      for (let i = 0; i < stamps; i++) {
        const s = document.createElement("div");
        s.className = "absolute text-5xl";
        s.textContent = "💋";
        s.style.left = `${8 + Math.random() * 80}%`;
        s.style.top = `${8 + Math.random() * 80}%`;
        s.style.rotate = `${-30 + Math.random() * 60}deg`;
        layer.append(s);
        stampEls.push(s);
      }
      await new Promise<void>((resolve) => {
        const tl = gsap.timeline({ onComplete: resolve });
        tl.fromTo(bloom, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power2.out" })
          .fromTo(lips, { scale: opts.incoming ? 3 : 0.2, opacity: 0, rotate: -20 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.55, ease: "elastic.out(1, 0.5)" }, 0)
          .fromTo(ring, { scale: 0.3, opacity: 1 }, { scale: 6, opacity: 0, duration: 0.9, ease: "power3.out" }, 0.15)
          .fromTo(stampEls, { scale: 0, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 0.35, ease: "back.out(3)", stagger: style === "attack10" ? 0.09 : 0.14 }, 0.3)
          .to(bloom, { opacity: 0.5, yoyo: true, repeat: 1, duration: 0.3 }, 0.6)
          .to([lips, ...stampEls], { opacity: 0, scale: 1.3, duration: 0.4, ease: "power2.in", stagger: 0.02 }, "+=0.5")
          .to(bloom, { opacity: 0, duration: 0.35 }, "<");
        hearts();
      });
      layer.style.display = "none";
      layer.innerHTML = "";
    },
    [reduced, hearts],
  );

  const value = useMemo<Fx>(() => ({ burst, hearts, pill, shake, overtake, kiss, reduced }), [burst, hearts, pill, shake, overtake, kiss, reduced]);

  return (
    <Ctx.Provider value={value}>
      <div ref={scope} className="min-h-dvh">
        {children}
      </div>
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[70] h-full w-full" aria-hidden />
      <div ref={kissLayer} className="pointer-events-none fixed inset-0 z-[75] hidden items-center justify-center text-8xl" aria-hidden>
        💋
      </div>
      <div className="pointer-events-none fixed inset-0 z-[72]" aria-live="polite">
        <AnimatePresence>
          {pills.map((p) => (
            <motion.span
              key={p.id}
              className="tabular absolute -translate-x-1/2 rounded-full bg-tertiary px-3 py-1 text-sm font-bold text-on-tertiary"
              style={{ left: p.x, top: p.y, boxShadow: "0 0 18px var(--md-sys-color-tertiary)" }}
              initial={{ y: 0, opacity: 0, scale: 0.6 }}
              animate={{ y: -90, opacity: [0, 1, 1, 0], scale: [0.6, 1.25, 1, 1] }}
              transition={{ duration: 1.4, ease: "easeOut" }}
            >
              {p.text}
            </motion.span>
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {overtaking > 0 && (
            <motion.div
              key={overtaking}
              className="absolute inset-x-0 top-24 flex justify-center"
              initial={{ opacity: 0, scale: 1.6 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [1.6, 1, 1, 0.9] }}
              transition={{ duration: 1.6 }}
              onAnimationComplete={() => setOvertaking(0)}
            >
              <span className="display rounded-2xl bg-tertiary px-6 py-3 text-3xl font-black italic tracking-tight text-on-tertiary" style={{ boxShadow: "0 0 40px var(--md-sys-color-tertiary)" }}>
                ⚡ OVERTAKE!
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useFx(): Fx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFx outside FxProvider");
  return c;
}
