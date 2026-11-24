"use client";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useRoom } from "@/state/RoomProvider";
import { useFx } from "../animations/FxProvider";
import { Composer } from "../media/Composer";
import { Segmented } from "../ui/primitives";
import { BoastCard } from "./PostCard";

export function BoastRoom() {
  const room = useRoom();
  const fx = useFx();
  const [tag, setTag] = useState<"flex" | "roast">("flex");
  const [filter, setFilter] = useState<"all" | "flex" | "roast">("all");
  const posts = room.posts.boast.filter((p) => filter === "all" || p.tag === filter);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setTag("flex")}
          aria-pressed={tag === "flex"}
          className={`flex-1 rounded-[20px] py-3 text-lg font-black tracking-wide transition-all ${tag === "flex" ? "scale-[1.02] bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"}`}
        >
          🔥 FLEX
        </button>
        <button
          onClick={() => setTag("roast")}
          aria-pressed={tag === "roast"}
          className={`flex-1 rounded-[20px] py-3 text-lg font-black tracking-wide transition-all ${tag === "roast" ? "scale-[1.02] bg-tertiary text-on-tertiary" : "bg-surface-container-high text-on-surface-variant"}`}
        >
          😈 ROAST
        </button>
      </div>
      <Composer
        roomType="boast"
        tag={tag}
        placeholder={tag === "flex" ? "Show off: progress, desk setup, gym selfie, that meal…" : `Trash-talk ${room.names.partner}, vent about the day, drop the meme…`}
        sendLabel={tag === "flex" ? "Flex" : "Roast"}
        onPosted={() => {
          fx.burst(0.5, 0.35, { count: tag === "flex" ? 120 : 60, spread: 90 });
          fx.shake();
        }}
      />
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "flex", label: "🔥 Flex" },
          { value: "roast", label: "😈 Roast" },
        ]}
      />
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {posts.map((p) => (
            <BoastCard key={p.id} p={p} />
          ))}
        </AnimatePresence>
        {posts.length === 0 && <p className="py-8 text-center text-on-surface-variant">Nothing here yet. Start the trash talk.</p>}
      </div>
    </div>
  );
}
