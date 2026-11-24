/** Small device helpers: haptics, sounds, notifications, app lock, push. All opt-in, all optional. */
import { fromB64Url, randomBytes, toB64Url } from "@/crypto/encoding";
import { env } from "./env";

export function vibrate(pattern: number | number[]) {
  try {
    if (prefs().haptics && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* not supported */
  }
}

/* ---------------------------- preferences ------------------------------ */

export interface Prefs {
  sound: boolean;
  haptics: boolean;
  reducedMotion: "system" | "on" | "off";
  theme: "system" | "light" | "dark";
}
const PREFS_KEY = "usmode-prefs";
const DEFAULT_PREFS: Prefs = { sound: true, haptics: true, reducedMotion: "system", theme: "system" };

export function prefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}
export function savePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...p }));
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event("usmode-prefs"));
}

/* ------------------------------- sound --------------------------------- */

let audioCtx: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (typeof window === "undefined" || !prefs().sound) return null;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Short synthesized blip (no audio files to load). */
export function blip(freq: number, ms = 60, type: OscillatorType = "triangle", gain = 0.08) {
  const ac = ctx();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + ms / 1000 + 0.02);
}

export const sounds = {
  tick: () => blip(1800, 25, "square", 0.03),
  pop: () => blip(660, 90, "sine", 0.08),
  chime: () => {
    blip(880, 260, "sine", 0.06);
    setTimeout(() => blip(1320, 320, "sine", 0.05), 120);
    setTimeout(() => blip(1760, 380, "sine", 0.04), 240);
  },
  whoosh: () => blip(220, 200, "sawtooth", 0.02),
};

/* --------------------------- notifications ----------------------------- */

export function notificationsAllowed(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export async function askNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  return Notification.requestPermission();
}

/** Content-free local notification, only when the app is in the background. */
export function localNotify(title: string, body: string) {
  if (!notificationsAllowed() || document.visibilityState === "visible") return;
  try {
    void navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, { body, icon: "/icons/icon-192.png", tag: "usmode" }));
  } catch {
    /* ignore */
  }
}

/* -------------------------------- push --------------------------------- */

export const pushConfigured = () => Boolean(env.vapidPublicKey);

export async function subscribePush(): Promise<{ endpoint: string; p256dh: string; auth: string } | null> {
  if (!pushConfigured() || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64Url(env.vapidPublicKey) }));
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
}

/* ------------------------- app lock (WebAuthn) -------------------------- */

export const appLockSupported = () =>
  typeof window !== "undefined" && "PublicKeyCredential" in window && typeof navigator.credentials?.create === "function";

/** Registers a device passkey (Face ID / fingerprint / device PIN). Returns its id. */
export async function registerAppLock(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "USMODE" },
      user: { id: randomBytes(16), name: "usmode-app-lock", displayName: "USMODE app lock" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("App lock wasn't set up.");
  return toB64Url(new Uint8Array(cred.rawId));
}

/** Asks the device to verify the user. Local gate only; keys never leave the device either way. */
export async function verifyAppLock(credentialId: string): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: "public-key", id: fromB64Url(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return Boolean(res);
  } catch {
    return false;
  }
}
