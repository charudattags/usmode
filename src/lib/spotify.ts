/**
 * Spotify Web API, Authorization Code + PKCE (no client secret in the app).
 * Tokens stay on this device only. Each partner connects their own account;
 * the "now playing" card is shared through the room as ciphertext.
 */
import { toB64Url, utf8, randomBytes } from "@/crypto/encoding";
import { env } from "./env";
import type { TrackMeta } from "@/state/config";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = ["user-read-currently-playing", "user-read-playback-state", "user-modify-playback-state"];

const TOKENS_KEY = (uid: string) => `usmode-spotify-${uid}`;
const VERIFIER_KEY = "usmode-spotify-verifier";
const STATE_KEY = "usmode-spotify-state";

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export const spotifyConfigured = () => Boolean(env.spotifyClientId);
export const redirectUri = () => `${window.location.origin}/spotify-callback`;

export async function beginSpotifyLogin(userId: string) {
  if (!spotifyConfigured()) throw new Error("Add NEXT_PUBLIC_SPOTIFY_CLIENT_ID to connect Spotify.");
  const verifier = toB64Url(randomBytes(64));
  const challenge = toB64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
  const state = `${userId}.${toB64Url(randomBytes(16))}`;
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.spotifyClientId,
    scope: SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: redirectUri(),
    state,
  });
  const url = new URL(AUTH_URL);
  url.search = params.toString();
  window.location.assign(url);
}

/** Called on /spotify-callback. Returns the user id the login was for. */
export async function finishSpotifyLogin(search: URLSearchParams): Promise<string> {
  const err = search.get("error");
  if (err) throw new Error(err === "access_denied" ? "Spotify access was declined." : `Spotify said: ${err}`);
  const code = search.get("code");
  const state = search.get("state");
  const expected = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!code || !state || state !== expected || !verifier) throw new Error("Spotify login didn't match. Try again.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: env.spotifyClientId, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error("Couldn't finish the Spotify login.");
  const userId = state.split(".")[0];
  saveTokens(userId, await res.json());
  return userId;
}

function saveTokens(userId: string, t: { access_token: string; refresh_token?: string; expires_in: number }, prev?: Tokens) {
  const tokens: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? prev?.refresh_token ?? "",
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  localStorage.setItem(TOKENS_KEY(userId), JSON.stringify(tokens));
}

export function isSpotifyConnected(userId: string): boolean {
  try {
    return Boolean(localStorage.getItem(TOKENS_KEY(userId)));
  } catch {
    return false;
  }
}

export function disconnectSpotify(userId: string) {
  localStorage.removeItem(TOKENS_KEY(userId));
}

async function accessToken(userId: string): Promise<string | null> {
  const raw = localStorage.getItem(TOKENS_KEY(userId));
  if (!raw) return null;
  const t = JSON.parse(raw) as Tokens;
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: env.spotifyClientId }),
  });
  if (!res.ok) {
    disconnectSpotify(userId);
    return null;
  }
  const next = await res.json();
  saveTokens(userId, next, t);
  return next.access_token as string;
}

async function api(userId: string, path: string, init?: RequestInit): Promise<Response | null> {
  const token = await accessToken(userId);
  if (!token) return null;
  return fetch(`${API}${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
}

interface SpotifyTrack {
  name: string;
  uri: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { images: { url: string; width: number }[] };
}

export async function currentlyPlaying(userId: string): Promise<TrackMeta | null> {
  const res = await api(userId, "/me/player/currently-playing");
  if (!res || res.status === 204 || !res.ok) return null;
  const j = (await res.json()) as { is_playing: boolean; progress_ms: number; item: SpotifyTrack | null; currently_playing_type: string };
  if (!j.item || j.currently_playing_type !== "track") return null;
  const art = [...j.item.album.images].sort((a, b) => b.width - a.width)[0]?.url ?? null;
  return {
    title: j.item.name,
    artists: j.item.artists.map((a) => a.name).join(", "),
    albumArt: art,
    uri: j.item.uri,
    isPlaying: j.is_playing,
    progressMs: j.progress_ms,
    durationMs: j.item.duration_ms,
    at: new Date().toISOString(),
  };
}

export async function searchTracks(userId: string, q: string): Promise<{ title: string; artists: string; uri: string }[]> {
  const res = await api(userId, `/search?${new URLSearchParams({ q, type: "track", limit: "5" })}`);
  if (!res?.ok) return [];
  const j = (await res.json()) as { tracks: { items: SpotifyTrack[] } };
  return j.tracks.items.map((t) => ({ title: t.name, artists: t.artists.map((a) => a.name).join(", "), uri: t.uri }));
}

/** Needs Spotify Premium and an active player. */
export async function addToQueue(userId: string, uri: string): Promise<void> {
  const res = await api(userId, `/me/player/queue?${new URLSearchParams({ uri })}`, { method: "POST" });
  if (!res) throw new Error("Connect Spotify first.");
  if (res.status === 404) throw new Error("Start playing something in Spotify first.");
  if (res.status === 403) throw new Error("Adding to the queue needs Spotify Premium.");
  if (!res.ok) throw new Error("Spotify didn't accept that.");
}
