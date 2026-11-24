"use client";
/**
 * Calls hand off to the phone's own dialer (tel:) — or FaceTime on Apple
 * devices for video — instead of running WebRTC in the app. Silent Co-Work
 * stays in-app: a Pomodoro both phones derive from one shared start time, plus
 * floating reactions over the private broadcast channel.
 */
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatClock, pomodoroPhase } from "@/engine/time";
import { sounds, vibrate } from "@/lib/device";
import { cleanPhone } from "@/state/config";
import { useRoom } from "@/state/RoomProvider";
import { useNow } from "@/state/useNow";
import { Icon } from "../ui/Icon";
import { Button, Segmented, springs } from "../ui/primitives";
import { FloatingReactions } from "./FloatingReactions";

function isApple(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
}

export function CallRoom() {
  const room = useRoom();
  const [mode, setMode] = useState<"video" | "audio" | "cowork">("audio");
  const phone = room.partner ? cleanPhone(room.config.phones[room.partner.user_id] ?? "") : "";
  const dial = phone.replace(/[\s-]/g, "");

  // A real link (not JS navigation) so the phone hands it straight to the dialer / FaceTime.
  const href = dial ? (mode === "video" && isApple() ? `facetime:${dial}` : `tel:${dial}`) : undefined;
  function markInRoom() {
    void room.backend.updateMyMember(room.userId!, { status_code: "in_room" }).then(() => room.refresh(["members"]));
  }

  return (
    <div className="space-y-5 text-white">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "video", label: "Video", icon: "video" },
          { value: "audio", label: "Audio", icon: "phone" },
          { value: "cowork", label: "Co-work", icon: "timer" },
        ]}
      />
      {mode !== "cowork" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <motion.div className="relative" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={springs.bouncy}>
            <span className="absolute inset-0 rounded-full bg-primary/40" style={{ animation: "pulse-ring 1.8s ease-out infinite" }} />
            <span className="relative flex h-32 w-32 items-center justify-center rounded-full bg-primary-container text-6xl">{room.names.partnerAvatar}</span>
          </motion.div>
          <div>
            <p className="display text-3xl font-black">{mode === "video" ? "Full video hangout" : "Audio-only chill"}</p>
            <p className="mt-1 text-white/70">
              {mode === "video" ? (isApple() ? "Opens FaceTime." : "Opens your phone app; switch to video on the call screen.") : "Opens your phone app."}
            </p>
          </div>
          {href ? (
            <motion.a
              href={href}
              onClick={markInRoom}
              whileTap={{ scale: 0.94 }}
              transition={springs.bouncy}
              className="inline-flex h-14 items-center gap-2 rounded-full bg-primary px-7 font-semibold text-on-primary shadow-[0_0_40px_var(--md-sys-color-primary)]"
            >
              <Icon name={mode === "video" ? "video" : "phone"} size={20} />
              Call {room.names.partner}
            </motion.a>
          ) : (
            <div className="max-w-xs rounded-[28px] bg-white/10 p-4 text-sm">
              {room.names.partner} hasn&apos;t added a phone number yet. They can add it under <strong>Vibe → ✏️ Customize room</strong>. It&apos;s stored end-to-end encrypted.
            </div>
          )}
          <p className="max-w-xs text-xs text-white/50">The call itself runs on your phone carrier or FaceTime, not through USMODE.</p>
        </div>
      ) : (
        <CoWork />
      )}
    </div>
  );
}

function CoWork() {
  const room = useRoom();
  const now = useNow(500);
  const r = room.room;
  const started = r?.cowork_started_at ? new Date(r.cowork_started_at) : null;
  const cfg = { focusMin: r?.cowork_focus_min ?? 25, breakMin: r?.cowork_break_min ?? 5 };
  const phase = started && now ? pomodoroPhase(started, new Date(now), cfg) : null;
  const lastPhase = useRef<string | null>(null);
  const phaseKey = phase ? `${phase.round}-${phase.phase}` : null;

  useEffect(() => {
    if (!phaseKey) return;
    if (lastPhase.current && phaseKey !== lastPhase.current) {
      sounds.chime();
      vibrate([80, 60, 80]);
    }
    lastPhase.current = phaseKey;
  }, [phaseKey]);

  async function start(focusMin: number, breakMin: number) {
    await room.run(
      () => room.backend.updateRoom(room.roomId!, { cowork_started_at: new Date().toISOString(), cowork_started_by: room.userId, cowork_focus_min: focusMin, cowork_break_min: breakMin }),
      ["rooms"],
    );
    void room.backend.updateMyMember(room.userId!, { status_code: "in_room" }).then(() => room.refresh(["members"]));
  }
  async function stop() {
    await room.run(() => room.backend.updateRoom(room.roomId!, { cowork_started_at: null, cowork_started_by: null }), ["rooms"]);
    void room.backend.updateMyMember(room.userId!, { status_code: "free" }).then(() => room.refresh(["members"]));
  }

  const total = phase ? (phase.phase === "focus" ? cfg.focusMin : cfg.breakMin) * 60000 : 1;
  const frac = phase ? 1 - phase.remainingMs / total : 0;
  const R = 90;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      <p className="text-sm text-white/70">Silent body-doubling. Mics and cameras stay off; the timer is synced on both phones.</p>
      <div className="relative h-56 w-56">
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="12" />
          <motion.circle cx="100" cy="100" r={R} fill="none" stroke={phase?.phase === "break" ? "var(--md-sys-color-tertiary)" : "var(--md-sys-color-primary)"} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - frac) }} transition={{ duration: 0.5 }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {phase ? (
            <>
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-white/70">{phase.phase === "focus" ? `Focus · round ${phase.round}` : "Break"}</span>
              <span className="tabular text-5xl font-bold">{formatClock(phase.remainingMs)}</span>
            </>
          ) : (
            <span className="text-white/70">Not running</span>
          )}
        </div>
      </div>
      {phase ? (
        <Button variant="tonal" icon="stop" onClick={stop}>
          End session
        </Button>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button icon="play" onClick={() => start(25, 5)}>
            25 / 5
          </Button>
          <Button variant="tonal" onClick={() => start(50, 10)}>
            50 / 10
          </Button>
        </div>
      )}
      {phase && <p className="text-xs text-white/60">Started by {r?.cowork_started_by === room.userId ? "you" : room.names.partner}</p>}
      <FloatingReactions scope="cowork" emojis={["💪", "☕", "🔥", "😴", "❤️", "👀"]} />
      <p className="flex items-center gap-1 text-xs text-white/50">
        <Icon name="info" size={14} /> Want to hear each other? Use the Audio tab to call.
      </p>
    </div>
  );
}
