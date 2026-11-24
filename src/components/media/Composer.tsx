"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { friendlyError } from "@/data/backend";
import type { PostTag, RoomType } from "@/data/types";
import { compressImage, recordVoice, uploadEncrypted, VOICE_MAX_MS, type VoiceRecording } from "@/lib/media";
import type { PostPayload } from "@/state/config";
import { aad, useRoom } from "@/state/RoomProvider";
import { useToast } from "@/state/toast";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/primitives";

export interface ComposerProps {
  roomType: RoomType;
  tag?: PostTag | null;
  placeholder: string;
  allowPhoto?: boolean;
  allowVoice?: boolean;
  ephemeral?: boolean;
  revealRoundId?: string | null;
  /** Called after a successful post (e.g. to fire effects). */
  onPosted?: () => void;
  extra?: ReactNode;
  tone?: "default" | "twilight";
  sendLabel?: string;
}

type Attachment = { kind: "image"; bytes: Uint8Array; mime: string; preview: string } | { kind: "audio"; bytes: Uint8Array; mime: string; durationMs: number };

export function Composer({ roomType, tag = null, placeholder, allowPhoto = true, allowVoice = true, ephemeral = false, revealRoundId = null, onPosted, extra, tone = "default", sendLabel = "Post" }: ComposerProps) {
  const room = useRoom();
  const toast = useToast();
  const [text, setText] = useState("");
  const [att, setAtt] = useState<Attachment | null>(null);
  const [rec, setRec] = useState<VoiceRecording | null>(null);
  const [recMs, setRecMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!rec) return;
    const start = performance.now();
    const id = setInterval(() => setRecMs(performance.now() - start), 100);
    return () => clearInterval(id);
  }, [rec]);

  useEffect(() => () => {
    if (att?.kind === "image") URL.revokeObjectURL(att.preview);
  }, [att]);

  async function startRec() {
    try {
      const r = await recordVoice();
      setRec(r);
      setRecMs(0);
      r.done
        .then((v) => setAtt({ kind: "audio", ...v }))
        .catch((e) => toast.show({ tone: "error", icon: "🎙️", text: friendlyError(e) }))
        .finally(() => setRec(null));
    } catch (e) {
      toast.show({ tone: "error", icon: "🎙️", text: e instanceof DOMException ? "Microphone permission was denied. Text and photos still work." : friendlyError(e) });
    }
  }

  async function pickPhoto(f: File) {
    try {
      const { bytes, mime } = await compressImage(f);
      setAtt({ kind: "image", bytes, mime, preview: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime })) });
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
  }

  async function send() {
    if (!room.roomId || !room.userId || !room.key) return;
    const t = text.trim();
    if (!t && !att) return;
    setBusy(true);
    try {
      let mediaPath: string | null = null;
      const payload: PostPayload = {};
      if (t) payload.text = t.slice(0, 2000);
      if (att) {
        mediaPath = await uploadEncrypted(room.backend, room.key, room.roomId, room.userId, att.bytes);
        payload.mediaKind = att.kind;
        payload.mime = att.mime;
        if (att.kind === "audio") payload.durationMs = Math.round(att.durationMs);
      }
      const sealed = await room.seal(aad.post(room.roomId, roomType, room.userId), payload);
      const ok = await room.run(
        () => room.backend.createPost(room.roomId!, room.userId!, { room_type: roomType, tag, payload: sealed, media_path: mediaPath, reveal_round_id: revealRoundId, ephemeral }),
        ["room_posts", "reveal_rounds"],
      );
      if (ok) {
        if (roomType === "vault") room.broadcast({ type: "vault_drop" });
        setText("");
        setAtt(null);
        onPosted?.();
      }
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(false);
  }

  const shell = tone === "twilight" ? "bg-white/8 text-white ring-1 ring-white/15" : "bg-surface-container-high";
  return (
    <div className={`rounded-[28px] p-3 ${shell}`}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={2000}
        rows={2}
        className={`w-full resize-none bg-transparent px-2 py-1 outline-none ${tone === "twilight" ? "font-serif text-lg placeholder:text-white/50" : "placeholder:text-on-surface-variant"}`}
        aria-label={placeholder}
      />
      <AnimatePresence>
        {att && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="relative mb-2 px-2">
            {att.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={att.preview} alt="Photo to send" className="max-h-48 rounded-2xl object-cover" />
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-container px-4 py-2 text-sm text-on-primary-container">
                <Icon name="mic" size={18} /> Voice note · {Math.round(att.durationMs / 1000)}s
              </div>
            )}
            <button onClick={() => setAtt(null)} aria-label="Remove attachment" className="absolute left-3 top-1 rounded-full bg-scrim/60 p-1 text-white">
              <Icon name="close" size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-1">
        {allowPhoto && (
          <>
            <IconButton icon="image" label="Add photo" onClick={() => file.current?.click()} disabled={!!rec} />
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])} />
          </>
        )}
        {allowVoice &&
          (rec ? (
            <button onClick={() => rec.stop()} className="flex items-center gap-2 rounded-full bg-error px-3 py-1.5 text-sm font-semibold text-on-error">
              <span className="h-2 w-2 animate-pulse rounded-full bg-on-error" />
              <span className="tabular">{(recMs / 1000).toFixed(1)}s / {VOICE_MAX_MS / 1000}s</span>
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <IconButton icon="mic" label="Record a 15-second voice note" onClick={startRec} />
          ))}
        <div className="flex-1">{extra}</div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={send}
          disabled={busy || (!text.trim() && !att) || !!rec}
          className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-40"
        >
          <Icon name="send" size={18} />
          {busy ? "Encrypting…" : sendLabel}
        </motion.button>
      </div>
    </div>
  );
}
