"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { StatusCode } from "@/data/types";
import { backchodiWindow, DECOMPRESSION_MINUTES, formatClock, formatCountdown } from "@/engine/time";
import { useRoom } from "@/state/RoomProvider";
import { useNow } from "@/state/useNow";
import { sounds, vibrate } from "@/lib/device";
import { useFx } from "../animations/FxProvider";
import { PageHeader, SettingsLink } from "../shell/TabShell";
import { Icon } from "../ui/Icon";
import { Avatar, Button, Card, Chip, IconButton, SectionTitle, Shape, springs } from "../ui/primitives";
import { CustomizeSheet } from "./CustomizeSheet";
import { SendKissSheet } from "./SendKissSheet";

export const STATUS: Record<StatusCode, { label: string; emoji: string; tone: string }> = {
  locked_in: { label: "Locked In", emoji: "🎯", tone: "bg-primary text-on-primary" },
  decompressing: { label: "Decompressing", emoji: "🌙", tone: "bg-tertiary-container text-on-tertiary-container" },
  low_battery: { label: "Low Battery", emoji: "🪫", tone: "bg-error-container text-on-error-container" },
  free: { label: "Free", emoji: "🌿", tone: "bg-secondary-container text-on-secondary-container" },
  in_room: { label: "In a Room", emoji: "🚪", tone: "bg-primary-container text-on-primary-container" },
};

/** Effective status: a finished decompression timer reads as Free even if that phone is asleep. */
export function effectiveStatus(code: StatusCode, decompEnds: string | null, now: number): StatusCode {
  if (code === "decompressing" && (!decompEnds || Date.parse(decompEnds) <= now)) return "free";
  return code;
}

export function StatusPill({ code }: { code: StatusCode }) {
  const s = STATUS[code];
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={code}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.6, opacity: 0 }}
        transition={springs.bouncy}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${s.tone}`}
      >
        <span>{s.emoji}</span>
        {s.label}
      </motion.span>
    </AnimatePresence>
  );
}

function lastSeen(iso: string, now: number): string {
  const m = Math.floor((now - Date.parse(iso)) / 60000);
  if (m < 2) return "active now";
  if (m < 60) return `seen ${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `seen ${h}h ago` : `seen ${Math.floor(h / 24)}d ago`;
}

export function VibeScreen() {
  const room = useRoom();
  const fx = useFx();
  const now = useNow(1000);
  const [kissOpen, setKissOpenState] = useState(false);
  const [customOpen, setCustomOpenState] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const setKissOpen = (v: boolean) => {
    if (v) setSheetKey((k) => k + 1);
    setKissOpenState(v);
  };
  const setCustomOpen = (v: boolean) => {
    if (v) setSheetKey((k) => k + 1);
    setCustomOpenState(v);
  };
  const me = room.me;
  const partner = room.partner;
  if (!me) return null;

  const myStatus = effectiveStatus(me.status_code, me.decompression_ends_at, now);
  const theirStatus = partner ? effectiveStatus(partner.status_code, partner.decompression_ends_at, now) : "free";
  const owed = room.owed.length;

  async function setStatus(code: StatusCode) {
    await room.run(() => room.backend.updateMyMember(room.userId!, { status_code: code, ...(code !== "decompressing" ? { decompression_ends_at: null } : {}) }), ["members"]);
  }
  async function setBattery(level: number) {
    vibrate(15);
    sounds.tick();
    const patch: { battery_level: number; status_code?: StatusCode } = { battery_level: level };
    if (level <= 2 && myStatus === "free") patch.status_code = "low_battery";
    if (level >= 3 && myStatus === "low_battery") patch.status_code = "free";
    await room.run(() => room.backend.updateMyMember(room.userId!, patch), ["members"]);
  }
  async function justGotHome() {
    const ends = new Date(Date.now() + DECOMPRESSION_MINUTES * 60000).toISOString();
    await room.run(() => room.backend.updateMyMember(room.userId!, { status_code: "decompressing", decompression_ends_at: ends }), ["members"]);
    fx.burst(0.5, 0.6, { count: 40, spread: 50 });
  }

  const myDecompLeft = myStatus === "decompressing" && me.decompression_ends_at ? Date.parse(me.decompression_ends_at) - now : 0;
  const theirDecompLeft = partner && theirStatus === "decompressing" && partner.decompression_ends_at ? Date.parse(partner.decompression_ends_at) - now : 0;
  const win = room.room && now ? backchodiWindow(new Date(now), room.room.backchodi_start_time.slice(0, 5), room.room.backchodi_tz, room.room.backchodi_minutes) : null;

  return (
    <>
      <PageHeader
        title={room.config.roomName}
        subtitle={
          <span className="inline-flex items-center gap-1 text-primary">
            <Icon name="shield" size={16} /> E2EE locked • 2/2 devices
          </span>
        }
        actions={
          <>
            <IconButton icon="pencil" label="Customize room" onClick={() => setCustomOpen(true)} />
            <SettingsLink />
          </>
        }
      />

      {/* Partner card */}
      <Card className="elev-1 flex items-center gap-4" layout>
        <Avatar emoji={room.names.partnerAvatar} size={64} ring />
        <div className="min-w-0 flex-1">
          <p className="display truncate text-2xl font-bold">{room.names.partner}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {partner && <StatusPill code={theirStatus} />}
            {partner && <span className="text-xs text-on-surface-variant">{lastSeen(partner.last_seen_at, now)}</span>}
          </div>
          {theirDecompLeft > 0 && (
            <p className="tabular mt-2 text-sm text-on-surface-variant">
              🌙 Recharging · ready in <strong>{formatClock(theirDecompLeft)}</strong>
            </p>
          )}
        </div>
        {partner && <BatteryGlyph level={partner.battery_level} />}
      </Card>

      {/* Kiss counter hero */}
      <motion.div layout className="relative mt-4 overflow-hidden rounded-[28px] bg-primary-container p-5 text-on-primary-container">
        <div className="flex items-center gap-5">
          <Shape kind="scallop" spin className="h-28 w-28 shrink-0 text-primary">
            <div className="flex flex-col items-center text-on-primary">
              <motion.span key={room.kissStats.today} initial={{ scale: 1.6 }} animate={{ scale: 1 }} transition={springs.bouncy} className="tabular text-4xl font-bold leading-none">
                {room.kissStats.today}
              </motion.span>
              <span className="text-[10px] font-bold uppercase tracking-widest">today</span>
            </div>
          </Shape>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] opacity-80">Kiss counter</p>
            <p className="tabular text-lg">
              <strong>{room.kissStats.all_time}</strong> all-time
            </p>
            {owed > 0 ? (
              <p className="mt-1 text-sm font-semibold">
                You owe {room.names.partner} {owed} kiss{owed > 1 ? "es" : ""} 💋
              </p>
            ) : (
              <p className="mt-1 text-sm opacity-80">All kisses paid up.</p>
            )}
          </div>
        </div>
        <div className="relative mt-4">
          {owed > 0 && <span className="absolute inset-0 rounded-full bg-primary" style={{ animation: "pulse-ring 1.4s ease-out infinite" }} />}
          <Button size="lg" icon="kiss" className="relative w-full" onClick={() => setKissOpen(true)}>
            Send kiss
          </Button>
        </div>
      </motion.div>

      {/* My status */}
      <SectionTitle>My status</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {(["locked_in", "free", "in_room"] as StatusCode[]).map((c) => (
          <Chip key={c} selected={myStatus === c} onClick={() => setStatus(c)} icon={<span>{STATUS[c].emoji}</span>}>
            {STATUS[c].label}
          </Chip>
        ))}
        {myStatus === "low_battery" && <StatusPill code="low_battery" />}
      </div>

      {/* Battery */}
      <SectionTitle>Anti-crankiness battery</SectionTitle>
      <Card className="elev-1">
        <div className="flex items-end justify-between gap-2" role="radiogroup" aria-label="Battery level">
          {[1, 2, 3, 4, 5].map((l) => {
            const on = l <= me.battery_level;
            const color = me.battery_level <= 2 ? "bg-error" : me.battery_level === 3 ? "bg-tertiary" : "bg-primary";
            return (
              <motion.button
                key={l}
                role="radio"
                aria-checked={me.battery_level === l}
                aria-label={`Battery ${l} of 5`}
                onClick={() => setBattery(l)}
                whileTap={{ scale: 0.85 }}
                transition={springs.bouncy}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <motion.span className={`w-full rounded-lg ${on ? color : "bg-surface-container-highest"}`} initial={false} animate={{ height: 24 + l * 10, scaleY: on ? 1 : 0.92 }} transition={springs.nav} />
                <span className="tabular text-xs text-on-surface-variant">{l}</span>
              </motion.button>
            );
          })}
        </div>
        <AnimatePresence>
          {room.cozyMode && (
            <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 text-sm text-on-surface-variant">
              🛋️ Someone&apos;s running low, so tonight&apos;s hangout is <strong>Passive Cozy Mode</strong>: a quiet call or a watch party, no pressure.
            </motion.p>
          )}
        </AnimatePresence>
      </Card>

      {/* Decompression */}
      <SectionTitle>Decompression</SectionTitle>
      <Card className="elev-1">
        {myDecompLeft > 0 ? (
          <div className="flex items-center gap-4">
            <DecompRing left={myDecompLeft} total={DECOMPRESSION_MINUTES * 60000} />
            <div className="flex-1">
              <p className="font-semibold">Recharging</p>
              <p className="text-sm text-on-surface-variant">{room.names.partner} can see this. We&apos;ll tell them when you&apos;re ready.</p>
              <Button size="sm" variant="text" className="-ml-3 mt-1" onClick={() => setStatus("free")}>
                I&apos;m ready now
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-on-surface-variant">Tap when you walk in the door. A {DECOMPRESSION_MINUTES}-minute chill timer runs on both phones.</p>
            <Button icon="home" onClick={justGotHome}>
              Just got home
            </Button>
          </div>
        )}
      </Card>

      {/* Tonight */}
      {win && (
        <>
          <SectionTitle>Tonight</SectionTitle>
          <Card className="elev-1 flex items-center gap-4">
            <span className="text-4xl">{room.cozyMode ? "🛋️" : "🎉"}</span>
            <div className="flex-1">
              <p className="font-semibold">{room.cozyMode ? "Cozy Mode hangout" : "Backchodi hangout"}</p>
              <p className="tabular text-sm text-on-surface-variant">
                {win.open
                  ? `Live now · ${formatCountdown(win.closesAt.getTime() - now)} left`
                  : `${win.opensAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · in ${formatCountdown(win.opensAt.getTime() - now)}`}
              </p>
            </div>
          </Card>
        </>
      )}

      <SendKissSheet key={`kiss-${sheetKey}`} open={kissOpen} onClose={() => setKissOpen(false)} />
      <CustomizeSheet key={`custom-${sheetKey}`} open={customOpen} onClose={() => setCustomOpen(false)} />
    </>
  );
}

function BatteryGlyph({ level }: { level: number }) {
  const color = level <= 2 ? "bg-error" : level === 3 ? "bg-tertiary" : "bg-primary";
  return (
    <div className="flex flex-col items-center gap-1" aria-label={`Partner battery ${level} of 5`}>
      <div className="flex h-14 w-7 flex-col-reverse gap-0.5 rounded-lg border-2 border-outline p-0.5">
        {[1, 2, 3, 4, 5].map((l) => (
          <motion.span key={l} layout className={`flex-1 rounded-sm ${l <= level ? color : "bg-transparent"}`} />
        ))}
      </div>
      <span className="tabular text-xs text-on-surface-variant">{level}/5</span>
    </div>
  );
}

function DecompRing({ left, total }: { left: number; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} className="fill-none stroke-surface-container-highest" strokeWidth="8" />
        <motion.circle cx="40" cy="40" r={r} className="fill-none stroke-tertiary" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - frac) }} transition={{ duration: 0.8 }} />
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-sm font-bold">{formatClock(left)}</span>
    </div>
  );
}
