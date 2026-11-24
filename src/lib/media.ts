/**
 * Media capture and the encrypt-then-upload / download-then-decrypt pipeline.
 * Photos are re-encoded through a canvas (which also strips EXIF/GPS) before
 * encryption; nothing readable ever reaches Storage.
 */
import { decryptBlob, encryptBlob } from "@/crypto/e2ee";
import { mediaPath, type Backend } from "@/data/backend";

export const VOICE_MAX_MS = 15_000;
const IMAGE_MAX_EDGE = 1600;

export async function compressImage(file: Blob, maxEdge = IMAGE_MAX_EDGE, quality = 0.85): Promise<{ bytes: Uint8Array; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode photo"))), "image/jpeg", quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg" };
}

const aad = (path: string) => `media|${path}`;

export async function uploadEncrypted(backend: Backend, key: CryptoKey, roomId: string, userId: string, bytes: Uint8Array): Promise<string> {
  const path = mediaPath(roomId, userId);
  await backend.uploadMedia(path, await encryptBlob(key, bytes, aad(path)));
  return path;
}

const urlCache = new Map<string, Promise<string>>();

/** Decrypts into a local object URL. Cached per path for the session. */
export function decryptedObjectUrl(backend: Backend, key: CryptoKey, path: string, mime: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit) return hit;
  const p = (async () => {
    const data = await backend.downloadMedia(path);
    const plain = await decryptBlob(key, data, aad(path));
    return URL.createObjectURL(new Blob([new Uint8Array(plain)], { type: mime }));
  })();
  p.catch(() => urlCache.delete(path));
  urlCache.set(path, p);
  return p;
}

export function forgetObjectUrl(path: string) {
  const p = urlCache.get(path);
  urlCache.delete(path);
  void p?.then((u) => URL.revokeObjectURL(u)).catch(() => {});
}

/** Pick the best audio container this browser can record. */
function audioMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

export interface VoiceRecording {
  stop(): void;
  done: Promise<{ bytes: Uint8Array; mime: string; durationMs: number }>;
}

/** Records up to 15 s. The mic is only opened when the user taps record. */
export async function recordVoice(maxMs = VOICE_MAX_MS): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record audio.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = audioMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  const started = performance.now();
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<{ bytes: Uint8Array; mime: string; durationMs: number }>((resolve, reject) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (!blob.size) return reject(new Error("Nothing was recorded"));
      resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: type.split(";")[0] === "audio/mp4" ? "audio/mp4" : type, durationMs: Math.min(maxMs, performance.now() - started) });
    };
    rec.onerror = () => reject(new Error("Recording failed"));
  });
  rec.start(250);
  const timer = setTimeout(() => rec.state !== "inactive" && rec.stop(), maxMs);
  return {
    stop() {
      clearTimeout(timer);
      if (rec.state !== "inactive") rec.stop();
    },
    done,
  };
}
