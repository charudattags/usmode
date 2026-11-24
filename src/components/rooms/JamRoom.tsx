"use client";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "@/data/backend";
import { addToQueue, beginSpotifyLogin, currentlyPlaying, disconnectSpotify, isSpotifyConnected, searchTracks, spotifyConfigured } from "@/lib/spotify";
import { safeSpotifyUrl, type TrackMeta } from "@/state/config";
import { aad, useRoom } from "@/state/RoomProvider";
import { useToast } from "@/state/toast";
import { seedFromImageUrl } from "@/theme/materialYou";
import { Icon } from "../ui/Icon";
import { Button, IconButton, TextField } from "../ui/primitives";
import { FloatingReactions } from "./FloatingReactions";
import { timeAgo } from "./PostCard";

export function JamRoom() {
  const room = useRoom();
  const toast = useToast();
  // Rendered only after the room is open on the client, so localStorage is available.
  const [connected, setConnected] = useState(() => isSpotifyConnected(room.userId ?? ""));
  const [glowFor, setGlowFor] = useState<{ art: string; color: string } | null>(null);
  const [jamInput, setJamInput] = useState("");
  const track = room.spotify.track;
  const uid = room.userId ?? "";

  // While connected, publish what I'm playing (encrypted) so the card syncs to both phones.
  const poll = useCallback(async () => {
    if (!room.roomId || !isSpotifyConnected(uid)) return;
    try {
      const now = await currentlyPlaying(uid);
      if (!now) return;
      const cur = room.spotify.track;
      if (cur && cur.uri === now.uri && cur.isPlaying === now.isPlaying && room.spotify.updatedBy === uid) return;
      const sealed = await room.seal(aad.track(room.roomId), now);
      await room.run(() => room.backend.setSpotify(room.roomId!, { track: sealed }), ["spotify_sessions"]);
    } catch {
      /* network hiccup: try next tick */
    }
  }, [room, uid]);

  useEffect(() => {
    if (!connected) return;
    void poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [connected, poll]);

  // Album-art colour glow.
  const art = track?.albumArt ?? null;
  const glow = art && glowFor?.art === art ? glowFor.color : null;
  useEffect(() => {
    if (!art) return;
    let alive = true;
    seedFromImageUrl(art)
      .then((color) => alive && setGlowFor({ art, color }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [art]);

  async function saveJam() {
    const url = safeSpotifyUrl(jamInput);
    if (!url) return toast.show({ tone: "error", icon: "⚠️", text: "Paste a Spotify Jam link (open.spotify.com or spotify.link)." });
    const sealed = await room.seal(aad.jam(room.roomId!), url);
    await room.run(() => room.backend.setSpotify(room.roomId!, { jam: sealed }), ["spotify_sessions"]);
    setJamInput("");
  }

  return (
    <div className="space-y-6 text-white">
      {/* Vinyl player */}
      <div className="relative flex flex-col items-center gap-4 py-4">
        <div className="absolute inset-x-0 top-6 mx-auto h-64 w-64 rounded-full blur-3xl transition-colors duration-1000" style={{ background: glow ?? "var(--md-sys-color-primary)", opacity: 0.55 }} />
        <motion.div
          className="relative h-64 w-64 rounded-full shadow-2xl"
          style={{ background: "repeating-radial-gradient(circle, #111 0 2px, #1c1c1c 2px 4px)" }}
          animate={track?.isPlaying ? { rotate: 360 } : { rotate: 0 }}
          transition={track?.isPlaying ? { repeat: Infinity, duration: 6, ease: "linear" } : { duration: 0.6 }}
        >
          <div className="absolute inset-[30%] overflow-hidden rounded-full ring-4 ring-black/60">
            {track?.albumArt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.albumArt} alt="" crossOrigin="anonymous" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary text-3xl">🎵</div>
            )}
          </div>
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-300" />
        </motion.div>
        <div className="relative text-center">
          {track ? (
            <>
              <p className="display text-2xl font-black">{track.title}</p>
              <p className="text-white/70">{track.artists}</p>
              <p className="mt-1 text-xs text-white/50">
                {track.isPlaying ? "▶ Now playing" : "⏸ Paused"} on {room.spotify.updatedBy === uid ? "your" : `${room.names.partner}'s`} Spotify · {timeAgo(track.at)}
              </p>
              {track.uri && (
                <a className="mt-2 inline-block text-sm font-semibold text-primary-container underline-offset-4 hover:underline" href={`https://open.spotify.com/track/${track.uri.split(":").pop()}`} target="_blank" rel="noopener noreferrer">
                  Open in Spotify
                </a>
              )}
            </>
          ) : (
            <p className="text-white/70">Nothing playing yet.</p>
          )}
        </div>
      </div>

      {/* Spotify connection */}
      <section className="rounded-[28px] bg-white/8 p-4 ring-1 ring-white/10">
        {!spotifyConfigured() ? (
          <p className="text-sm text-white/70">
            Live “Now playing” needs a Spotify app. Add <code className="tabular">NEXT_PUBLIC_SPOTIFY_CLIENT_ID</code> (see README). Jam links, requests and reactions work without it.
          </p>
        ) : connected ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">Spotify connected. Your track syncs every 15 s.</p>
            <Button
              size="sm"
              variant="tonal"
              onClick={() => {
                disconnectSpotify(uid);
                setConnected(false);
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">Connect your Spotify to share what you&apos;re playing. Tokens stay on this phone.</p>
            <Button size="sm" icon="music" onClick={() => beginSpotifyLogin(uid).catch((e) => toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) }))}>
              Connect
            </Button>
          </div>
        )}
      </section>

      {/* Jam session */}
      <section className="space-y-3 rounded-[28px] bg-white/8 p-4 ring-1 ring-white/10">
        <h3 className="display text-lg font-bold">Spotify Jam</h3>
        {room.spotify.jamUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="music" onClick={() => window.open(room.spotify.jamUrl!, "_blank", "noopener,noreferrer")}>
              Join the Jam
            </Button>
            <Button variant="text" onClick={() => room.run(() => room.backend.setSpotify(room.roomId!, { jam: null }), ["spotify_sessions"])}>
              Clear
            </Button>
          </div>
        ) : (
          <p className="text-sm text-white/70">
            Start a Jam in Spotify (tap the speaker icon → Start a Jam → Share), then paste the invite link here.{" "}
            <a href="spotify:" className="font-semibold text-primary-container">
              Open Spotify
            </a>
          </p>
        )}
        <div className="flex gap-2">
          <TextField className="flex-1" label="Jam invite link" value={jamInput} onChange={setJamInput} onEnter={saveJam} placeholder="https://spotify.link/…" />
          <IconButton icon="send" label="Save Jam link" variant="filled" size={56} onClick={saveJam} disabled={!jamInput.trim()} />
        </div>
      </section>

      <SongRequests connected={connected} />

      <section className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">React to this track</p>
        <FloatingReactions scope="jam" emojis={["🔥", "💃", "😭", "🥵", "🎶", "💀"]} />
      </section>
    </div>
  );
}

function SongRequests({ connected }: { connected: boolean }) {
  const room = useRoom();
  const toast = useToast();
  const uid = room.userId ?? "";
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ title: string; artists: string; uri: string }[]>([]);

  async function search() {
    if (!connected || !q.trim()) return;
    setResults(await searchTracks(uid, q.trim()));
  }
  async function request(song: { title: string; artists?: string; uri?: string }) {
    const sealed = await room.seal(aad.post(room.roomId!, "jam", uid), { song });
    await room.run(() => room.backend.createPost(room.roomId!, uid, { room_type: "jam", tag: null, payload: sealed, media_path: null, reveal_round_id: null, ephemeral: false }), ["room_posts"]);
    setQ("");
    setResults([]);
  }

  return (
    <section className="space-y-3 rounded-[28px] bg-white/8 p-4 ring-1 ring-white/10">
      <h3 className="display text-lg font-bold">Song requests</h3>
      <div className="flex gap-2">
        <TextField className="flex-1" label={connected ? "Search Spotify" : "Song name"} value={q} onChange={setQ} onEnter={() => (connected ? search() : q.trim() && request({ title: q.trim() }))} />
        <IconButton icon={connected ? "eye" : "plus"} label={connected ? "Search" : "Request song"} variant="filled" size={56} onClick={() => (connected ? search() : q.trim() && request({ title: q.trim() }))} disabled={!q.trim()} />
      </div>
      {results.map((r) => (
        <button key={r.uri} onClick={() => request(r)} className="block w-full rounded-2xl bg-white/5 px-4 py-2 text-left text-sm hover:bg-white/10">
          <strong>{r.title}</strong> · <span className="text-white/70">{r.artists}</span>
        </button>
      ))}
      <ul className="space-y-2">
        {room.posts.jam.map((p) => {
          const song = p.payload.song;
          if (!song) return null;
          const mine = p.author_id === uid;
          return (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
              <span className="text-xl">🎵</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{song.title}</p>
                <p className="truncate text-xs text-white/60">
                  {song.artists ? `${song.artists} · ` : ""}
                  {mine ? "you asked" : `${room.names.partner} asked`} · {timeAgo(p.created_at)}
                </p>
              </div>
              {!mine && song.uri && connected && (
                <Button
                  size="sm"
                  variant="tonal"
                  onClick={() =>
                    addToQueue(uid, song.uri!)
                      .then(() => toast.show({ icon: "🎶", text: "Added to your Spotify queue." }))
                      .catch((e) => toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) }))
                  }
                >
                  Queue
                </Button>
              )}
              {mine && <IconButton icon="close" label="Remove request" size={32} onClick={() => room.run(() => room.backend.deletePost(p.id), ["room_posts"])} />}
            </li>
          );
        })}
        {room.posts.jam.length === 0 && <li className="text-sm text-white/50">No requests yet.</li>}
      </ul>
      <p className="flex items-center gap-1 text-xs text-white/40">
        <Icon name="lock" size={12} /> Requests and the Jam link are end-to-end encrypted.
      </p>
    </section>
  );
}

export type { TrackMeta };
