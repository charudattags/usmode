"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { loadAppLockCredential } from "@/crypto/keystore";
import { verifyAppLock, prefs } from "@/lib/device";
import { RoomProvider, useRoom } from "@/state/RoomProvider";
import { ToastProvider, useToast } from "@/state/toast";
import { FxProvider } from "./animations/FxProvider";
import { KissPopup } from "./KissPopup";
import { Button } from "./ui/primitives";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const applyTheme = () => {
      const t = prefs().theme;
      if (t === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
    };
    applyTheme();
    window.addEventListener("usmode-prefs", applyTheme);
    return () => window.removeEventListener("usmode-prefs", applyTheme);
  }, []);
  return (
    <ToastProvider>
      <RoomProvider>
        <FxProvider>
          <AppLockGate>
            {children}
            <KissPopup />
          </AppLockGate>
          <Toaster />
        </FxProvider>
      </RoomProvider>
    </ToastProvider>
  );
}

function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ y: 40, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm ${
              t.tone === "error" ? "bg-error-container text-on-error-container" : t.tone === "love" ? "bg-primary-container text-on-primary-container" : "bg-inverse-surface text-inverse-on-surface"
            }`}
            onClick={() => dismiss(t.id)}
          >
            {t.icon && <span className="text-lg">{t.icon}</span>}
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button className="font-semibold text-inverse-primary" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Optional biometric / device-PIN lock (WebAuthn). Re-locks after 5 minutes in the background. */
function AppLockGate({ children }: { children: ReactNode }) {
  const { userId } = useRoom();
  // Lock state is keyed by user, so switching accounts re-checks automatically.
  const [lock, setLock] = useState<{ userId: string; cred: string | null; locked: boolean } | null>(null);
  const current = lock && lock.userId === userId ? lock : null;
  const cred = current?.cred ?? null;
  const locked = current?.locked ?? false;
  const checking = Boolean(userId) && !current;
  const setLocked = (v: boolean) => setLock((l) => (l ? { ...l, locked: v } : l));

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadAppLockCredential(userId).then((c) => alive && setLock({ userId, cred: c ?? null, locked: Boolean(c) }));
    const onLockChange = () => void loadAppLockCredential(userId).then((c) => alive && setLock((l) => ({ userId, cred: c ?? null, locked: l?.locked ?? false })));
    window.addEventListener("usmode-applock", onLockChange);
    return () => {
      alive = false;
      window.removeEventListener("usmode-applock", onLockChange);
    };
  }, [userId]);

  useEffect(() => {
    if (!cred) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) setLock((l) => (l ? { ...l, locked: true } : l));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cred]);

  if (checking && userId) return null;
  if (locked && cred) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-surface px-8 text-center">
        <div className="text-6xl">🔐</div>
        <h1 className="display text-3xl font-black">USMODE is locked</h1>
        <p className="text-on-surface-variant">Unlock with your fingerprint, face or device PIN.</p>
        <Button size="lg" icon="unlock" onClick={async () => setLocked(!(await verifyAppLock(cred)))}>
          Unlock
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
