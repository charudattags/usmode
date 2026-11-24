"use client";
import { useEffect, useRef, useState } from "react";
import { useRoom } from "@/state/RoomProvider";
import { vibrate } from "@/lib/device";

interface Floater {
  id: number;
  emoji: string;
  x: number;
  dx: number;
}

/** Emoji that float up on both screens. Sent over the private broadcast channel, never stored. */
export function FloatingReactions({ scope, emojis }: { scope: "cowork" | "jam"; emojis: string[] }) {
  const room = useRoom();
  const [items, setItems] = useState<Floater[]>([]);
  const next = useRef(1);

  const spawn = (emoji: string) => {
    const id = next.current++;
    setItems((l) => [...l.slice(-30), { id, emoji, x: 10 + Math.random() * 80, dx: -40 + Math.random() * 80 }]);
    setTimeout(() => setItems((l) => l.filter((f) => f.id !== id)), 2600);
  };

  useEffect(
    () =>
      room.onBroadcast((e) => {
        if (e.type === "reaction" && e.scope === scope && emojis.includes(e.emoji)) {
          spawn(e.emoji);
          vibrate(10);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.onBroadcast, scope],
  );

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[55] overflow-hidden" aria-hidden>
        {items.map((f) => (
          <span key={f.id} className="absolute bottom-28 text-4xl" style={{ left: `${f.x}%`, animation: "float-up 2.5s ease-out forwards", ["--dx" as string]: `${f.dx}px` }}>
            {f.emoji}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {emojis.map((e) => (
          <button
            key={e}
            onClick={() => {
              spawn(e);
              room.broadcast({ type: "reaction", emoji: e, scope });
            }}
            className="h-12 w-12 rounded-full bg-white/10 text-2xl ring-1 ring-white/15 transition-transform active:scale-75"
            aria-label={`Send ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </>
  );
}
