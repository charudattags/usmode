"use client";
import { useEffect, useRef, useState } from "react";
import { decryptedObjectUrl } from "@/lib/media";
import { useRoom } from "@/state/RoomProvider";
import { Icon } from "../ui/Icon";

/** Downloads ciphertext, decrypts on this device, shows it from a local blob: URL. */
export function EncryptedImage({ path, alt, className = "" }: { path: string; alt: string; className?: string }) {
  const { backend, key } = useRoom();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    decryptedObjectUrl(backend, key, path, "image/jpeg")
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [backend, key, path]);
  if (err) return <div className={`flex items-center justify-center bg-surface-container-highest text-sm text-on-surface-variant ${className}`}>🔒 Couldn&apos;t decrypt</div>;
  if (!url) return <div className={`animate-pulse bg-surface-container-highest ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={`object-cover ${className}`} draggable={false} />;
}

export function VoicePlayer({ path, mime, durationMs }: { path: string; mime: string; durationMs?: number }) {
  const { backend, key } = useRoom();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!key) return;
    if (!audio.current) {
      setLoading(true);
      try {
        const url = await decryptedObjectUrl(backend, key, path, mime);
        const a = new Audio(url);
        a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
        a.onended = () => {
          setPlaying(false);
          setProgress(0);
        };
        audio.current = a;
      } catch {
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      await audio.current.play();
      setPlaying(true);
    }
  }
  useEffect(() => () => audio.current?.pause(), []);
  const bars = 24;
  return (
    <button onClick={toggle} className="flex w-full items-center gap-3 rounded-2xl bg-surface-container-high px-3 py-2" aria-label={playing ? "Pause voice note" : "Play voice note"}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">{loading ? "…" : <Icon name={playing ? "pause" : "play"} size={18} />}</span>
      <span className="flex h-8 flex-1 items-center gap-[3px]">
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full ${i / bars < progress ? "bg-primary" : "bg-outline-variant"}`}
            style={{ height: `${30 + Math.abs(Math.sin(i * 1.7 + path.length)) * 70}%` }}
          />
        ))}
      </span>
      {durationMs ? <span className="tabular text-xs text-on-surface-variant">{Math.round(durationMs / 1000)}s</span> : null}
    </button>
  );
}
