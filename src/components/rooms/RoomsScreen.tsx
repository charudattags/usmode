"use client";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRoom } from "@/state/RoomProvider";
import { PageHeader, SettingsLink } from "../shell/TabShell";
import { Icon, type IconName } from "../ui/Icon";
import { IconButton, springs } from "../ui/primitives";
import { BoastRoom } from "./BoastRoom";
import { CallRoom } from "./CallRoom";
import { ConfessionRoom } from "./ConfessionRoom";
import { JamRoom } from "./JamRoom";

type RoomId = "call" | "jam" | "boast" | "confession";

const ROOMS: Record<RoomId, { title: string; blurb: string; icon: IconName; emoji: string; card: string; backdrop: string; dark: boolean }> = {
  call: {
    title: "Call Room",
    blurb: "Video, audio, silent co-work",
    icon: "phone",
    emoji: "📞",
    card: "bg-primary text-on-primary",
    backdrop: "linear-gradient(160deg, #0f1020 0%, #1d1838 50%, #2a1530 100%)",
    dark: true,
  },
  jam: {
    title: "Jam Room",
    blurb: "Spotify, now playing, requests",
    icon: "music",
    emoji: "🎧",
    card: "bg-tertiary-container text-on-tertiary-container",
    backdrop: "radial-gradient(circle at 50% 20%, #2b1e3d 0%, #0d0b12 70%)",
    dark: true,
  },
  boast: {
    title: "Flex & Roast",
    blurb: "Show off. Talk trash.",
    icon: "flame",
    emoji: "🔥",
    card: "bg-secondary-container text-on-secondary-container",
    backdrop: "var(--md-sys-color-surface)",
    dark: false,
  },
  confession: {
    title: "Confession Room",
    blurb: "Soft. Private. Mutual reveal.",
    icon: "eye",
    emoji: "🕯️",
    card: "text-white",
    backdrop: "radial-gradient(ellipse at 50% 0%, #4a1d3f 0%, #23102a 45%, #0e0812 100%)",
    dark: true,
  },
};

const ORDER: RoomId[] = ["call", "jam", "boast", "confession"];

function readRoomParam(): RoomId | null {
  if (typeof window === "undefined") return null;
  const r = new URLSearchParams(window.location.search).get("r");
  return r && r in ROOMS ? (r as RoomId) : null;
}

export function RoomsScreen() {
  const room = useRoom();
  // Only rendered on the client after the room is ready, so the URL is readable here.
  const [open, setOpenState] = useState<RoomId | null>(readRoomParam);

  useEffect(() => {
    const onPop = () => setOpenState(readRoomParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setOpen = useCallback((id: RoomId | null) => {
    setOpenState(id);
    const url = id ? `/rooms?r=${id}` : "/rooms";
    if (id) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const counts: Record<RoomId, ReactNode> = {
    call: room.room?.cowork_started_at ? "Co-work running" : null,
    jam: room.spotify.track ? `♪ ${room.spotify.track.title}` : null,
    boast: room.posts.boast.length ? `${room.posts.boast.length} posts` : null,
    confession: room.rounds.some((r) => !r.revealed_at && r.submitted_user_ids.length === 1 && !r.submitted_user_ids.includes(room.userId ?? "")) ? "🫣 Reveal waiting" : null,
  };

  return (
    <LayoutGroup>
      <PageHeader title="Rooms" subtitle="Four spaces, one tap away" actions={<SettingsLink />} />
      <div className="grid auto-rows-[150px] grid-cols-2 gap-3">
        {ORDER.map((id, i) => {
          const r = ROOMS[id];
          const big = i === 0 || i === 3;
          return (
            <motion.button
              key={id}
              layoutId={`room-${id}`}
              onClick={() => setOpen(id)}
              whileTap={{ scale: 0.96 }}
              transition={springs.soft}
              className={`relative overflow-hidden rounded-[28px] p-4 text-left ${r.card} ${big ? "col-span-2" : ""}`}
              style={id === "confession" ? { background: r.backdrop } : undefined}
            >
              <motion.span layoutId={`room-emoji-${id}`} className="absolute -right-2 -top-2 text-7xl opacity-90">
                {r.emoji}
              </motion.span>
              <span className="absolute bottom-4 left-4 right-4">
                <motion.span layoutId={`room-title-${id}`} className="display block text-2xl font-black">
                  {r.title}
                </motion.span>
                <span className="block text-sm opacity-80">{r.blurb}</span>
                {counts[id] && <span className="mt-1 inline-block truncate rounded-full bg-black/15 px-2 py-0.5 text-xs font-semibold">{counts[id]}</span>}
              </span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {open && (
          <motion.section
            key={open}
            layoutId={`room-${open}`}
            transition={springs.soft}
            className="fixed inset-0 z-[45] overflow-y-auto"
            style={{ background: ROOMS[open].backdrop, borderRadius: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={ROOMS[open].title}
          >
            {open === "confession" && (
              <div className="pointer-events-none fixed inset-0" aria-hidden>
                <div className="absolute left-1/2 top-1/4 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-300/20 blur-3xl" style={{ animation: "breathe 6s ease-in-out infinite" }} />
              </div>
            )}
            <div className={`relative mx-auto max-w-xl px-4 pb-16 pt-[max(env(safe-area-inset-top),16px)] ${ROOMS[open].dark ? "text-white" : ""}`}>
              <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 px-4 py-3 backdrop-blur-md">
                <IconButton icon="back" label="Back to rooms" onClick={() => window.history.length > 1 && readRoomParam() ? window.history.back() : setOpen(null)} className={ROOMS[open].dark ? "!text-white" : ""} />
                <motion.span layoutId={`room-emoji-${open}`} className="text-3xl">
                  {ROOMS[open].emoji}
                </motion.span>
                <motion.h2 layoutId={`room-title-${open}`} className={`display text-2xl font-black ${open === "confession" ? "font-serif italic" : ""}`}>
                  {ROOMS[open].title}
                </motion.h2>
                <span className="ml-auto flex items-center gap-1 text-xs opacity-70">
                  <Icon name="lock" size={14} /> E2EE
                </span>
              </div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                {open === "call" && <CallRoom />}
                {open === "jam" && <JamRoom />}
                {open === "boast" && <BoastRoom />}
                {open === "confession" && <ConfessionRoom />}
              </motion.div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}
