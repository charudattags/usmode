"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { KissStyle } from "@/data/types";
import { aad, useRoom } from "@/state/RoomProvider";
import { useFx } from "../animations/FxProvider";
import { clampNote, KISS_STYLES } from "../kissStyles";
import { Button, Sheet, TextField, springs } from "../ui/primitives";

export function SendKissSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const room = useRoom();
  const fx = useFx();
  const [style, setStyle] = useState<KissStyle>("smooch");
  const [note, setNote] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTaskId(room.owed[0]?.task_id ?? null);
  }, [open, room.owed]);

  async function send() {
    if (!room.partner || !room.roomId || !room.userId) return;
    setBusy(true);
    const n = clampNote(note);
    const sealed = n ? await room.seal(aad.kiss(room.roomId, room.userId), n) : null;
    const ok = await room.run(
      () => room.backend.sendKiss(room.roomId!, room.userId!, { to_user_id: room.partner!.user_id, trigger_task_id: taskId, kiss_style: style, note: sealed }),
      ["kisses"],
    );
    setBusy(false);
    if (ok) {
      room.broadcast({ type: "kiss_sent", style });
      onClose();
      setNote("");
      void fx.kiss(style);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Kiss ${room.names.partner}`}>
      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(KISS_STYLES) as KissStyle[]).map((k) => (
          <motion.button
            key={k}
            whileTap={{ scale: 0.93 }}
            transition={springs.bouncy}
            onClick={() => setStyle(k)}
            aria-pressed={style === k}
            className={`rounded-[24px] p-4 text-left transition-colors ${style === k ? "bg-primary-container text-on-primary-container ring-2 ring-primary" : "bg-surface-container-high"}`}
          >
            <span className="text-3xl">{KISS_STYLES[k].emoji}</span>
            <span className="mt-1 block font-semibold">{KISS_STYLES[k].label}</span>
            <span className="block text-xs opacity-75">{KISS_STYLES[k].blurb}</span>
          </motion.button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <label className="block text-sm font-semibold">For</label>
        <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
          {room.owed.map((o) => (
            <button
              key={o.task_id}
              onClick={() => setTaskId(o.task_id)}
              className={`rounded-2xl px-4 py-2 text-left text-sm ${taskId === o.task_id ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container"}`}
            >
              ✅ finishing &ldquo;{o.title}&rdquo;
            </button>
          ))}
          <button onClick={() => setTaskId(null)} className={`rounded-2xl px-4 py-2 text-left text-sm ${taskId === null ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container"}`}>
            💞 Just because
          </button>
        </div>
        <TextField label="Optional note (3 words)" value={note} onChange={(v) => setNote(v.split(/\s+/).length > 4 ? clampNote(v) : v)} maxLength={40} />
        <Button size="lg" className="w-full" icon="kiss" onClick={send} disabled={busy || !room.partner}>
          Send {KISS_STYLES[style].label.toLowerCase()}
        </Button>
      </div>
    </Sheet>
  );
}
