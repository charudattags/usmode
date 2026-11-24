"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { currentDemoIdentity } from "@/data/demo/backend";
import { useRoom } from "@/state/RoomProvider";
import type { Mood } from "@/theme/materialYou";
import { AmbientBackground } from "../animations/AmbientBackground";
import { Splash } from "../onboarding/Onboarding";
import { Icon, type IconName } from "../ui/Icon";
import { Button, springs } from "../ui/primitives";
import { RecoveryKitSheet } from "../settings/RecoveryKitSheet";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/vibe", label: "Vibe", icon: "vibe" },
  { href: "/arena", label: "Arena", icon: "arena" },
  { href: "/rooms", label: "Rooms", icon: "rooms" },
  { href: "/backchodi", label: "Backchodi", icon: "backchodi" },
];

export function TabShell({ children }: { children: ReactNode }) {
  const room = useRoom();
  const router = useRouter();
  const path = usePathname();
  const [kitOpen, setKitOpen] = useState(false);

  useEffect(() => {
    if (room.phase !== "ready" && room.phase !== "booting") router.replace("/");
  }, [room.phase, router]);

  // Offer the recovery kit once, right after pairing.
  useEffect(() => {
    if (room.phase !== "ready" || !room.userId || !room.partner) return;
    const k = `usmode-kit-offered-${room.userId}`;
    try {
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, "1");
        setKitOpen(true);
      }
    } catch {
      /* storage blocked: skip the prompt */
    }
  }, [room.phase, room.userId, room.partner]);

  if (room.phase !== "ready") return <Splash />;

  const mood: Mood = path.startsWith("/arena") ? "arena" : path.startsWith("/backchodi") ? (room.cozyMode ? "cozy" : "backchodi") : room.cozyMode ? "cozy" : "vibe";

  return (
    <>
      <AmbientBackground mood={mood} seed={room.room?.theme_seed_hex ?? "#d0436e"} />
      {room.mode === "demo" && (
        <div className="fixed left-1/2 top-2 z-40 -translate-x-1/2 rounded-full bg-tertiary-container px-3 py-0.5 text-[11px] font-bold tracking-wider text-on-tertiary-container">
          DEMO • Partner {currentDemoIdentity() ?? "?"}
        </div>
      )}
      <EodBanner />
      <main className="mx-auto w-full max-w-xl px-4 pb-32 pt-6">{children}</main>
      <BottomNav path={path} />
      <RecoveryKitSheet open={kitOpen} onClose={() => setKitOpen(false)} onboarding />
    </>
  );
}

function BottomNav({ path }: { path: string }) {
  const room = useRoom();
  const owed = room.owed.length;
  const sealed = room.vaultSealed;
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant/40 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
      <ul className="mx-auto flex max-w-xl items-stretch justify-around px-2 pt-2 pb-3">
        {TABS.map((t) => {
          const active = path.startsWith(t.href);
          const badge = t.href === "/vibe" ? owed : t.href === "/backchodi" ? sealed : 0;
          return (
            <li key={t.href} className="flex-1">
              <Link href={t.href} className="group flex flex-col items-center gap-1" aria-current={active ? "page" : undefined}>
                <span className="relative flex h-8 w-16 items-center justify-center">
                  {active && <motion.span layoutId="nav-pill" transition={springs.nav} className="absolute inset-0 rounded-full bg-secondary-container" />}
                  <motion.span animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }} transition={springs.nav} className={`relative ${active ? "text-on-secondary-container" : "text-on-surface-variant"}`}>
                    <Icon name={t.icon} />
                  </motion.span>
                  {badge > 0 && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="tabular absolute -right-0.5 -top-1 min-w-5 rounded-full bg-error px-1 text-center text-[11px] font-bold leading-5 text-on-error">
                      {badge > 9 ? "9+" : badge}
                    </motion.span>
                  )}
                </span>
                <span className={`text-xs ${active ? "font-bold text-on-surface" : "font-medium text-on-surface-variant"}`}>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Live prompt for the mutual end-of-day handshake, on every tab. */
function EodBanner() {
  const room = useRoom();
  const c = room.openCycle;
  const pending = c?.status === "eod_pending";
  const mine = pending && c?.eod_proposed_by === room.userId;
  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ y: -120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -120, opacity: 0 }}
          transition={springs.nav}
          className="fixed inset-x-0 top-0 z-40 px-3 pt-[max(env(safe-area-inset-top),8px)]"
          role="status"
        >
          <div className="mx-auto max-w-xl rounded-[28px] bg-tertiary-container p-4 text-on-tertiary-container">
            {mine ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl">⏳</span>
                <p className="min-w-0 flex-1 text-sm font-medium">Waiting for {room.names.partner} to lock today&apos;s scoreboard…</p>
                <Button size="sm" variant="tonal" onClick={() => room.run(() => room.backend.nudgeEod(), ["daily_cycles"])}>
                  Nudge
                </Button>
                <Button size="sm" variant="text" onClick={() => room.run(() => room.backend.cancelEod(), ["daily_cycles"])}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div>
                <motion.p animate={{ scale: [1, 1.02, 1] }} transition={{ repeat: Infinity, duration: 1.6 }} className="display text-lg font-bold">
                  🏁 {room.names.partner} wants to wrap up today and lock the scoreboard
                </motion.p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" icon="lock" onClick={() => room.run(() => room.backend.confirmEod(), ["daily_cycles", "tasks", "cycle_scores"])}>
                    Lock it in
                  </Button>
                  <Button size="sm" variant="tonal" onClick={() => room.run(() => room.backend.cancelEod(), ["daily_cycles"])}>
                    Not yet
                  </Button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3 pt-4">
      <div className="min-w-0">
        <h1 className="display truncate text-4xl font-black leading-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-on-surface-variant">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function SettingsLink() {
  return (
    <Link href="/settings" aria-label="Settings" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/5">
      <Icon name="settings" />
    </Link>
  );
}
