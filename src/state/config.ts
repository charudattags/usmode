/** The room's private settings. Stored only as one AES-GCM blob in rooms.encrypted_config. */
import type { SchemeVariant } from "@/theme/materialYou";

export interface RoomConfig {
  v: 1;
  roomName: string;
  /** petNames[userId] = what that user calls their partner. */
  petNames: Record<string, string>;
  /** phones[userId] = that user's own number, for the Call room hand-off. */
  phones: Record<string, string>;
  avatars: Record<string, string>;
  dares: string[];
  variant: SchemeVariant;
}

export const DEFAULT_DARES = [
  "30-sec overly dramatic apology voice note",
  "Winner picks the next 2 movies in a row",
  "Coffee/dessert debt at the next meetup",
  "Sing the chorus of a song the winner picks",
  "Send your most unflattering selfie",
  "Write a 3-line poem about the winner",
];

export const AVATARS = ["🦊", "🐻", "🐼", "🐯", "🐰", "🐸", "🦁", "🐨", "🐧", "🦄", "🐙", "🐝"];

export function defaultConfig(): RoomConfig {
  return { v: 1, roomName: "Our Room", petNames: {}, phones: {}, avatars: {}, dares: [...DEFAULT_DARES], variant: "tonal" };
}

/** Accept only the fields we know, with sane limits (the partner's device wrote this). */
export function sanitizeConfig(raw: unknown): RoomConfig {
  const d = defaultConfig();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const rec = (v: unknown, max: number) => {
    const out: Record<string, string> = {};
    if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) if (typeof val === "string") out[k.slice(0, 64)] = val.slice(0, max);
    return out;
  };
  const dares = Array.isArray(o.dares) ? o.dares.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.slice(0, 120)).slice(0, 12) : d.dares;
  return {
    v: 1,
    roomName: str(o.roomName, 40) || d.roomName,
    petNames: rec(o.petNames, 30),
    phones: rec(o.phones, 20),
    avatars: rec(o.avatars, 8),
    dares: dares.length >= 2 ? dares : d.dares,
    variant: o.variant === "vibrant" || o.variant === "expressive" ? o.variant : "tonal",
  };
}

/** Phone numbers: digits, +, spaces and dashes only, so tel: links can't be abused. */
export function cleanPhone(s: string): string {
  return s.replace(/[^\d+\-\s]/g, "").slice(0, 20).trim();
}

export interface PostPayload {
  text?: string;
  mediaKind?: "image" | "audio";
  mime?: string;
  durationMs?: number;
  song?: { title: string; artists?: string; uri?: string };
}

export interface TrackMeta {
  title: string;
  artists: string;
  albumArt: string | null;
  uri: string | null;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  at: string;
}

export function sanitizePayload(raw: unknown): PostPayload {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PostPayload = {};
  if (typeof o.text === "string") out.text = o.text.slice(0, 2000);
  if (o.mediaKind === "image" || o.mediaKind === "audio") out.mediaKind = o.mediaKind;
  if (typeof o.mime === "string" && /^(image|audio)\/[\w.+-]+(;\s*codecs=[\w.,"'-]+)?$/.test(o.mime)) out.mime = o.mime;
  if (typeof o.durationMs === "number") out.durationMs = Math.min(Math.max(0, o.durationMs), 60_000);
  if (o.song && typeof o.song === "object") {
    const s = o.song as Record<string, unknown>;
    if (typeof s.title === "string") {
      out.song = { title: s.title.slice(0, 120) };
      if (typeof s.artists === "string") out.song.artists = s.artists.slice(0, 120);
      if (typeof s.uri === "string" && /^spotify:track:[A-Za-z0-9]{10,40}$/.test(s.uri)) out.song.uri = s.uri;
    }
  }
  return out;
}

/** Only Spotify-owned https links are opened from a Jam invite. */
export function safeSpotifyUrl(s: string): string | null {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "https:") return null;
    if (!/^(open\.spotify\.com|spotify\.link|spotify\.app\.link)$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Album art comes from Spotify's CDN only. */
export function safeArtUrl(s: unknown): string | null {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && /(^|\.)scdn\.co$|(^|\.)spotifycdn\.com$/.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
