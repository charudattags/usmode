"use client";
/**
 * Guaranteed pop-up on app reopen. The store re-checks unseen kisses on open,
 * focus, visibilitychange and sign-in (and live via realtime). While any are
 * waiting this full-screen modal intercepts everything until they're caught.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useRoom } from "@/state/RoomProvider";
import { useFx } from "./animations/FxProvider";
import { Button, Shape, springs } from "./ui/primitives";
import { KISS_STYLES } from "./kissStyles";

export function KissPopup() {
  const room = useRoom();
  const fx = useFx();
  const [busy, setBusy] = useState(false);
  const delivered = useRef(new Set<string>());
  const kisses = room.phase === "ready" ? room.unseenKisses : [];
  const total = kisses.reduce((s, k) => s + k.kiss_count, 0);
  const open = kisses.length > 0;

  const idsKey = kisses.map((k) => k.id).join(",");
  const firstStyle = kisses[0]?.kiss_style;
  useEffect(() => {
    if (!idsKey || !firstStyle) return;
    const fresh = idsKey.split(",").filter((id) => !delivered.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => delivered.current.add(id));
      void room.backend.markKissesDelivered(fresh).catch(() => {});
    }
    void fx.kiss(firstStyle, { incoming: true });
    // Coming back to the app with kisses still waiting replays the spectacle.
    const onVis = () => document.visibilityState === "visible" && void fx.kiss(firstStyle, { incoming: true });
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  async function catchAll() {
    setBusy(true);
    const ids = kisses.map((k) => k.id);
    const style = kisses.find((k) => k.kiss_style === "attack10")?.kiss_style ?? kisses[0].kiss_style;
    void fx.kiss(style);
    fx.burst(0.5, 0.75, { spread: 120, count: 140 });
    await room.run(() => room.backend.catchKisses(ids), ["kisses"]);
    setBusy(false);
  }

  const first = kisses[0];
  const styleInfo = first ? KISS_STYLES[first.kiss_style] : null;
  const label = kisses.length > 1 ? `Catch all ${total} kisses` : `Catch kiss (+${total})`;

  return (
    <AnimatePresence>
      {open && first && styleInfo && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden px-6 text-center"
          role="alertdialog"
          aria-modal="true"
          aria-label="You got a kiss"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          style={{ background: "radial-gradient(circle at 50% 45%, var(--md-sys-color-primary-container), var(--md-sys-color-surface) 75%)" }}
        >
          {/* Pulsing radial bloom */}
          <div className="absolute left-1/2 top-[40%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/30" style={{ animation: "pulse-ring 1.6s ease-out infinite" }} />
          <div className="absolute left-1/2 top-[40%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-tertiary/30" style={{ animation: "pulse-ring 1.6s ease-out 0.8s infinite" }} />

          <motion.div initial={{ scale: 0.2, rotate: -25 }} animate={{ scale: 1, rotate: 0 }} transition={springs.bouncy} className="relative mb-6">
            <Shape kind="burst" spin className="h-44 w-44 text-primary">
              <span className="text-7xl">{styleInfo.emoji}</span>
            </Shape>
            {kisses.length > 1 && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...springs.bouncy, delay: 0.3 }} className="tabular absolute -right-2 -top-2 rounded-full bg-tertiary px-3 py-1 text-lg font-bold text-on-tertiary">
                ×{total}
              </motion.span>
            )}
          </motion.div>

          <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            {styleInfo.label}
          </motion.p>
          <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }} className="display mt-2 text-4xl font-black">
            {room.names.partner} sent you {total > 1 ? `${total} kisses` : "a kiss"}
          </motion.h1>

          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-4 max-h-40 w-full max-w-sm space-y-2 overflow-y-auto">
            {kisses.map((k) => (
              <li key={k.id} className="glass rounded-2xl px-4 py-2 text-left text-sm">
                <span className="mr-1">{KISS_STYLES[k.kiss_style].emoji}</span>
                {k.taskTitle ? (
                  <>
                    for finishing <strong>&ldquo;{k.taskTitle}&rdquo;</strong>
                  </>
                ) : (
                  <>just because</>
                )}
                {k.note && <span className="mt-0.5 block font-serif italic text-on-surface-variant">&ldquo;{k.note}&rdquo;</span>}
              </li>
            ))}
          </motion.ul>

          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.soft, delay: 0.5 }} className="mt-8">
            <Button size="lg" icon="kiss" onClick={catchAll} disabled={busy} className="shadow-[0_0_40px_var(--md-sys-color-primary)]">
              {label}
            </Button>
          </motion.div>
          <p className="mt-4 text-xs text-on-surface-variant">USMODE • end-to-end encrypted</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
