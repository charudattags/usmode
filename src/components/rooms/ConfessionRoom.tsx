"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { forgetObjectUrl } from "@/lib/media";
import { useRoom, type PostView } from "@/state/RoomProvider";
import { Composer } from "../media/Composer";
import { Switch } from "../ui/primitives";
import { PostBody, timeAgo } from "./PostCard";

const SEEN_KEY = "usmode-reveals-seen";
function seenReveals(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function markRevealSeen(id: string) {
  try {
    const s = seenReveals();
    s.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* storage blocked */
  }
}

export function ConfessionRoom() {
  const room = useRoom();
  const [mutualChoice, setMutual] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const openRound = room.rounds.find((r) => !r.revealed_at && !r.submitted_user_ids.includes(room.userId ?? "") && r.submitted_user_ids.length > 0);
  const myWaitingRound = room.rounds.find((r) => !r.revealed_at && r.submitted_user_ids.includes(room.userId ?? ""));
  const [roundChoice, setRoundId] = useState<string | null>(null);
  // Answering the partner's open round is always a mutual reveal into that round.
  const mutual = mutualChoice || Boolean(openRound);
  const roundId = openRound?.id ?? roundChoice;

  async function prepareRound(): Promise<string | null> {
    if (openRound) return openRound.id;
    const rr = await room.run(() => room.backend.startRevealRound(room.roomId!, room.userId!), ["reveal_rounds"]);
    return rr?.id ?? null;
  }

  const posts = room.posts.confession;
  const revealedRounds = room.rounds.filter((r) => r.revealed_at);
  const standalone = posts.filter((p) => !p.reveal_round_id);

  return (
    <div className="space-y-5 text-white">
      <p className="text-center font-serif text-lg italic text-white/70">Soft voice. No judging. Just us.</p>

      {/* Mutual reveal invite from partner */}
      <AnimatePresence>
        {openRound && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative overflow-hidden rounded-[28px] p-5 ring-1 ring-white/20">
            <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-400/30 to-indigo-500/30" />
            <div className="absolute inset-0 backdrop-blur-2xl" />
            <div className="relative space-y-1 text-center">
              <p className="text-3xl">🫣</p>
              <p className="font-serif text-xl">{room.names.partner} wrote something for a mutual reveal.</p>
              <p className="text-sm text-white/70">It stays frosted until you write yours. Then both unveil at once.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2 rounded-[28px] bg-white/5 p-3 ring-1 ring-white/10">
        <Switch checked={mutual} onChange={(v) => { setMutual(v); if (!v) setRoundId(null); }} label="Mutual reveal" description="Both stay blurred until both of you submit" disabled={!!openRound || !!myWaitingRound} />
        <Switch checked={ephemeral} onChange={setEphemeral} label="Hold to read · burns after" description="They hold to read it once, then it's gone" />
      </div>

      {myWaitingRound ? (
        <div className="rounded-[28px] bg-white/5 p-5 text-center ring-1 ring-white/10">
          <p className="font-serif text-lg">Yours is sealed behind frosted glass.</p>
          <p className="text-sm text-white/60">Waiting for {room.names.partner} to write theirs…</p>
        </div>
      ) : (
        <RoundAwareComposer mutual={mutual} ephemeral={ephemeral} roundId={roundId} prepareRound={prepareRound} onPosted={() => setRoundId(null)} />
      )}

      <div className="space-y-4">
        {revealedRounds.map((r) => {
          const pair = posts.filter((p) => p.reveal_round_id === r.id);
          if (pair.length < 2) return null;
          return <RevealPair key={r.id} roundId={r.id} posts={pair} />;
        })}
        {standalone.map((p) => (
          <ConfessionCard key={p.id} p={p} />
        ))}
        {posts.length === 0 && <p className="py-6 text-center font-serif italic text-white/50">The first confession is the hardest.</p>}
      </div>
    </div>
  );
}

function RoundAwareComposer({ mutual, ephemeral, roundId, prepareRound, onPosted }: { mutual: boolean; ephemeral: boolean; roundId: string | null; prepareRound: () => Promise<string | null>; onPosted: () => void }) {
  const [created, setCreated] = useState<string | null>(null);
  const rid = roundId ?? created;
  // A mutual reveal needs a round before posting; create it when the toggle turns on.
  useEffect(() => {
    if (!mutual || rid) return;
    let alive = true;
    void prepareRound().then((id) => alive && setCreated(id));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the toggle flips
  }, [mutual]);
  return (
    <Composer
      roomType="confession"
      tag={mutual ? "mutual_reveal" : null}
      revealRoundId={mutual ? rid : null}
      ephemeral={ephemeral}
      allowPhoto={false}
      allowVoice={!ephemeral}
      tone="twilight"
      placeholder={mutual ? "Write yours. Neither of you sees until both are in…" : "Something you've been meaning to say…"}
      sendLabel={mutual ? "Seal it" : "Confess"}
      onPosted={() => {
        setCreated(null);
        onPosted();
      }}
    />
  );
}

function RevealPair({ roundId, posts }: { roundId: string; posts: PostView[] }) {
  const [shatter, setShatter] = useState(() => !seenReveals().has(roundId));
  useEffect(() => {
    if (!shatter) return;
    const t = setTimeout(() => {
      setShatter(false);
      markRevealSeen(roundId);
    }, 1400);
    return () => clearTimeout(t);
  }, [shatter, roundId]);
  return (
    <div className="relative">
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Mutual reveal</p>
      <div className="grid gap-3">
        {posts.map((p) => (
          <ConfessionCard key={p.id} p={p} />
        ))}
      </div>
      <AnimatePresence>{shatter && <GlassShatter />}</AnimatePresence>
    </div>
  );
}

/** Frosted glass that cracks into shards and falls away. */
function GlassShatter() {
  const cols = 6;
  const rows = 5;
  return (
    <motion.div className="pointer-events-none absolute inset-0 grid overflow-hidden rounded-[28px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} exit={{ opacity: 0 }}>
      {Array.from({ length: cols * rows }, (_, i) => {
        const cx = (i % cols) - cols / 2;
        const cy = Math.floor(i / cols) - rows / 2;
        return (
          <motion.span
            key={i}
            className="bg-white/25 backdrop-blur-xl"
            style={{ clipPath: i % 2 ? "polygon(0 0,100% 10%,85% 100%,5% 90%)" : "polygon(10% 0,100% 0,90% 95%,0 100%)" }}
            initial={{ opacity: 1, x: 0, y: 0, rotate: 0 }}
            animate={{ opacity: 0, x: cx * 60, y: cy * 60 + 120, rotate: cx * 30 }}
            transition={{ delay: 0.3 + ((i * 37) % 10) / 33, duration: 0.9, ease: "easeIn" }}
          />
        );
      })}
    </motion.div>
  );
}

function ConfessionCard({ p }: { p: PostView }) {
  const room = useRoom();
  const mine = p.author_id === room.userId;
  if (p.ephemeral && !mine) return <HoldToRead p={p} />;
  return (
    <motion.article layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-[28px] bg-white/8 p-5 ring-1 ring-white/10">
      <p className="mb-2 text-xs text-white/50">
        {mine ? "You" : room.names.partner} · {timeAgo(p.created_at)}
        {p.ephemeral && " · burns after reading"}
      </p>
      <PostBody p={p} twilight />
      {mine && (
        <button
          className="mt-3 text-xs text-white/50 underline-offset-4 hover:underline"
          onClick={() =>
            room.run(async () => {
              await room.backend.deletePost(p.id);
              if (p.encrypted_media_path) await room.backend.removeMedia(p.encrypted_media_path).catch(() => {});
            }, ["room_posts"])
          }
        >
          Delete
        </button>
      )}
    </motion.article>
  );
}

/** Press and hold to read. Letting go after reading burns it for both of you. */
function HoldToRead({ p }: { p: PostView }) {
  const room = useRoom();
  const [holding, setHolding] = useState(false);
  const readFor = useRef(0);
  const since = useRef(0);
  const burned = useRef(false);

  async function burn() {
    if (burned.current) return;
    burned.current = true;
    await room.run(async () => {
      if (p.encrypted_media_path) {
        await room.backend.removeMedia(p.encrypted_media_path).catch(() => {});
        forgetObjectUrl(p.encrypted_media_path);
      }
      await room.backend.burnPost(p.id);
    }, ["room_posts"]);
  }
  const start = () => {
    since.current = performance.now();
    setHolding(true);
  };
  const end = () => {
    if (!holding) return;
    readFor.current += performance.now() - since.current;
    setHolding(false);
    if (readFor.current > 1200) void burn();
  };

  return (
    <motion.article layout className="relative select-none overflow-hidden rounded-[28px] bg-white/8 p-5 ring-1 ring-white/10" onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}>
      <p className="mb-2 text-xs text-white/50">
        {room.names.partner} · {timeAgo(p.created_at)} · burns after reading
      </p>
      <motion.div animate={{ filter: holding ? "blur(0px)" : "blur(14px)", opacity: holding ? 1 : 0.6 }} transition={{ duration: 0.25 }}>
        <PostBody p={p} twilight />
      </motion.div>
      {!holding && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/40 px-4 py-2 text-sm font-semibold">👆 Hold to read</span>
        </div>
      )}
    </motion.article>
  );
}
