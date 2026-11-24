"use client";
import { AnimatePresence, motion } from "framer-motion";
import type { Sticker } from "@/data/types";
import { forgetObjectUrl } from "@/lib/media";
import { useRoom, type PostView } from "@/state/RoomProvider";
import { EncryptedImage, VoicePlayer } from "../media/MediaView";
import { Avatar, IconButton, springs } from "../ui/primitives";

export const STICKERS: { id: Sticker; label: string; emoji: string }[] = [
  { id: "cope", label: "Cope", emoji: "🫠" },
  { id: "show_off", label: "Show-off", emoji: "😎" },
  { id: "beat_you", label: "On my way to beat you", emoji: "🏃" },
  { id: "cry", label: "Cry about it", emoji: "😭" },
];

export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function PostBody({ p, twilight }: { p: PostView; twilight?: boolean }) {
  if (p.broken) return <p className="text-sm opacity-70">🔒 This post couldn&apos;t be decrypted on this device.</p>;
  return (
    <div className="space-y-2">
      {p.payload.text && <p className={`whitespace-pre-wrap break-words ${twilight ? "font-serif text-lg leading-relaxed" : ""}`}>{p.payload.text}</p>}
      {p.encrypted_media_path && p.payload.mediaKind === "image" && <EncryptedImage path={p.encrypted_media_path} alt="Shared photo" className="max-h-96 w-full rounded-2xl" />}
      {p.encrypted_media_path && p.payload.mediaKind === "audio" && <VoicePlayer path={p.encrypted_media_path} mime={p.payload.mime ?? "audio/webm"} durationMs={p.payload.durationMs} />}
    </div>
  );
}

export function BoastCard({ p }: { p: PostView }) {
  const room = useRoom();
  const mine = p.author_id === room.userId;
  const reactions = room.reactions.filter((r) => r.post_id === p.id);
  const flex = p.tag === "flex";
  return (
    <motion.article layout initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={springs.soft} className="rounded-[28px] bg-surface-container-low p-4">
      <header className="mb-3 flex items-center gap-3">
        <Avatar emoji={mine ? room.names.meAvatar : room.names.partnerAvatar} size={36} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{mine ? "You" : room.names.partner}</p>
          <p className="text-xs text-on-surface-variant">{timeAgo(p.created_at)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black tracking-wider ${flex ? "bg-primary text-on-primary" : "bg-tertiary text-on-tertiary"}`}>{flex ? "🔥 FLEX" : "😈 ROAST"}</span>
        {mine && (
          <IconButton
            icon="trash"
            label="Delete post"
            size={34}
            onClick={async () => {
              await room.run(async () => {
                await room.backend.deletePost(p.id);
                if (p.encrypted_media_path) {
                  await room.backend.removeMedia(p.encrypted_media_path).catch(() => {});
                  forgetObjectUrl(p.encrypted_media_path);
                }
              }, ["room_posts", "post_reactions"]);
            }}
          />
        )}
      </header>
      <PostBody p={p} />
      <div className="mt-3 flex flex-wrap gap-2">
        {STICKERS.map((s) => {
          const count = reactions.filter((r) => r.sticker === s.id).length;
          const me = reactions.some((r) => r.sticker === s.id && r.user_id === room.userId);
          return (
            <motion.button
              key={s.id}
              whileTap={{ scale: 1.4, rotate: -8 }}
              transition={springs.bouncy}
              onClick={() => room.run(() => room.backend.toggleReaction(room.roomId!, room.userId!, p.id, s.id, !me), ["post_reactions"])}
              aria-pressed={me}
              className={`relative inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${me ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"}`}
            >
              <span className="text-base">{s.emoji}</span>
              {s.label}
              <AnimatePresence>
                {count > 0 && (
                  <motion.span key={count} initial={{ scale: 2.2, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={springs.bouncy} className="tabular ml-0.5">
                    {count}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
    </motion.article>
  );
}
