/**
 * USMODE end-to-end encryption. Native Web Crypto (SubtleCrypto) only.
 *
 * - Records: AES-256-GCM, fresh random 96-bit IV per record, AAD binds the
 *   ciphertext to its room and field so it can't be replayed elsewhere.
 * - Media: the same, on raw bytes. Wire format is iv(12) || ciphertext.
 * - Pairing: ECDH P-256 between the two devices. The handshake key also mixes
 *   in a secret derived from the pairing code (PBKDF2-SHA256, 600k iterations)
 *   and, when the QR/link is used, a 128-bit secret that only travels in the
 *   URL fragment. A server that swaps public keys can't open the envelope.
 * - Recovery kit: room key encrypted under PBKDF2-SHA256(passphrase, 600k).
 */
import {
  type Bytes,
  concatBytes,
  fromB64,
  fromB64Url,
  fromUtf8,
  own,
  randomBytes,
  toB64,
  toB64Url,
  toHex,
  utf8,
} from "./encoding";

export const PBKDF2_ITERATIONS = 600_000;
export const IV_BYTES = 12;

/** Ciphertext + IV, both base64. This is the only shape that leaves the device. */
export interface Sealed {
  ct: string;
  iv: string;
}

const subtle = (): SubtleCrypto => {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is not available (needs HTTPS or localhost).");
  return globalThis.crypto.subtle;
};

/* ------------------------------------------------------------------ */
/* Room master key                                                     */
/* ------------------------------------------------------------------ */

export function generateRoomKeyRaw(): Bytes {
  return randomBytes(32);
}

export async function importRoomKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error("Room key must be 256 bits");
  return subtle().importKey("raw", own(raw), { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

/** AAD format: "<roomId>|<kind>". Kind is e.g. "task.title", "post", "config". */
export function aadFor(roomId: string, kind: string): string {
  return `${roomId}|${kind}`;
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array, aad: string): Promise<{ ct: Bytes; iv: Bytes }> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad), tagLength: 128 }, key, own(data));
  return { ct: new Uint8Array(ct), iv };
}

export async function decryptBytes(key: CryptoKey, ct: Uint8Array, iv: Uint8Array, aad: string): Promise<Bytes> {
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv: own(iv), additionalData: utf8(aad), tagLength: 128 },
    key,
    own(ct),
  );
  return new Uint8Array(pt);
}

export async function encryptText(key: CryptoKey, text: string, aad: string): Promise<Sealed> {
  const { ct, iv } = await encryptBytes(key, utf8(text), aad);
  return { ct: toB64(ct), iv: toB64(iv) };
}

export async function decryptText(key: CryptoKey, sealed: Sealed, aad: string): Promise<string> {
  return fromUtf8(await decryptBytes(key, fromB64(sealed.ct), fromB64(sealed.iv), aad));
}

export async function encryptJSON(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  return encryptText(key, JSON.stringify(value), aad);
}

export async function decryptJSON<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  return JSON.parse(await decryptText(key, sealed, aad)) as T;
}

/** Binary blob for Storage: iv(12) || ciphertext+tag. */
export async function encryptBlob(key: CryptoKey, data: Uint8Array, aad: string): Promise<Bytes> {
  const { ct, iv } = await encryptBytes(key, data, aad);
  return concatBytes(iv, ct);
}

export async function decryptBlob(key: CryptoKey, blob: Uint8Array, aad: string): Promise<Bytes> {
  if (blob.byteLength <= IV_BYTES + 16) throw new Error("Encrypted blob is too short");
  return decryptBytes(key, blob.subarray(IV_BYTES), blob.subarray(0, IV_BYTES), aad);
}

/* ------------------------------------------------------------------ */
/* Device identity (ECDH P-256)                                        */
/* ------------------------------------------------------------------ */

export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/** Private key is non-extractable: it can be stored in IndexedDB but never read out. */
export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

export async function exportPublicJwk(pub: CryptoKey): Promise<PublicJwk> {
  const jwk = await subtle().exportKey("jwk", pub);
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("Unexpected public key");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export function isPublicJwk(v: unknown): v is PublicJwk {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.kty === "EC" && o.crv === "P-256" && typeof o.x === "string" && typeof o.y === "string";
}

export async function importPublicJwk(jwk: PublicJwk): Promise<CryptoKey> {
  if (!isPublicJwk(jwk)) throw new Error("Invalid partner public key");
  return subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

/* ------------------------------------------------------------------ */
/* Pairing code                                                        */
/* ------------------------------------------------------------------ */

/** 32 symbols, no 0/O/1/I. 8 symbols = 40 bits. */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 8;

export function generatePairingCode(): string {
  // 256 is a multiple of 32, so masking the low 5 bits is unbiased.
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  return Array.from(bytes, (b) => PAIRING_ALPHABET[b & 31]).join("");
}

/** Uppercases, drops separators. Returns null if anything else is wrong. */
export function normalizePairingCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (s.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of s) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return s;
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface CodeSecrets {
  /** Sent to the server to find the room. Hex. */
  lookup: string;
  /** Never leaves the device. Mixed into the handshake key. */
  auth: Bytes;
}

/**
 * One PBKDF2 call, 512 bits out. PBKDF2 output blocks are computed
 * independently, so the server learning the first 256 bits (lookup) tells it
 * nothing about the second 256 bits (auth) without brute-forcing the code
 * through 600k iterations per guess.
 */
export async function deriveCodeSecrets(code: string, iterations = PBKDF2_ITERATIONS): Promise<CodeSecrets> {
  const norm = normalizePairingCode(code);
  if (!norm) throw new Error("Invalid pairing code");
  const base = await subtle().importKey("raw", utf8(norm), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: utf8("usmode/pair/v1"), iterations },
    base,
    512,
  );
  const all = new Uint8Array(bits);
  return { lookup: toHex(all.subarray(0, 32)), auth: own(all.subarray(32, 64)) };
}

export type JoinMethod = "qr" | "code";

/** Link/QR payload. Everything after # stays in the browser. */
export interface PairingLink {
  code: string;
  qrSecret: string; // base64url, 16 bytes
}

export function newQrSecret(): string {
  return toB64Url(randomBytes(16));
}

export function buildPairingLink(origin: string, link: PairingLink): string {
  const frag = new URLSearchParams({ join: link.code, s: link.qrSecret });
  return `${origin}/pair#${frag.toString()}`;
}

export function parsePairingFragment(hash: string): PairingLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = normalizePairingCode(params.get("join") ?? "");
  const s = params.get("s");
  if (!code || !s) return null;
  try {
    if (fromB64Url(s).byteLength !== 16) return null;
  } catch {
    return null;
  }
  return { code, qrSecret: s };
}

/**
 * Handshake key = HKDF-SHA256(
 *   ikm  = ECDH(my private, their public),
 *   salt = SHA-256("usmode/pair/salt/v1" || auth || qrSecret?),
 *   info = "usmode/pair/kek/v1|<roomId>|<method>")
 */
export async function deriveHandshakeKey(opts: {
  myPrivateKey: CryptoKey;
  theirPublicJwk: PublicJwk;
  auth: Uint8Array;
  qrSecret: string | null;
  roomId: string;
  method: JoinMethod;
}): Promise<CryptoKey> {
  const theirPub = await importPublicJwk(opts.theirPublicJwk);
  const shared = await subtle().deriveBits({ name: "ECDH", public: theirPub }, opts.myPrivateKey, 256);
  if (opts.method === "qr" && !opts.qrSecret) throw new Error("QR join needs the link secret");
  const saltParts: Uint8Array[] = [utf8("usmode/pair/salt/v1"), opts.auth];
  if (opts.method === "qr" && opts.qrSecret) saltParts.push(fromB64Url(opts.qrSecret));
  const salt = new Uint8Array(await subtle().digest("SHA-256", concatBytes(...saltParts)));
  const hkdfBase = await subtle().importKey("raw", own(new Uint8Array(shared)), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: utf8(`usmode/pair/kek/v1|${opts.roomId}|${opts.method}`) },
    hkdfBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Partner A seals the raw room key for partner B. */
export async function sealRoomKeyEnvelope(kek: CryptoKey, rawRoomKey: Uint8Array, roomId: string): Promise<Sealed> {
  const { ct, iv } = await encryptBytes(kek, rawRoomKey, `envelope|${roomId}`);
  return { ct: toB64(ct), iv: toB64(iv) };
}

/** Partner B opens it. Throws if a key was swapped or the code was wrong. */
export async function openRoomKeyEnvelope(kek: CryptoKey, env: Sealed, roomId: string): Promise<Bytes> {
  const raw = await decryptBytes(kek, fromB64(env.ct), fromB64(env.iv), `envelope|${roomId}`);
  if (raw.byteLength !== 32) throw new Error("Envelope did not contain a room key");
  return raw;
}

/* ------------------------------------------------------------------ */
/* Passphrase keys and recovery kit                                    */
/* ------------------------------------------------------------------ */

export async function derivePassphraseKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", utf8(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: own(salt), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface RecoveryKit {
  v: 1;
  kind: "usmode-recovery-kit";
  roomId: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  iv: string;
  ct: string;
}

export const MIN_PASSPHRASE_LENGTH = 10;

export async function createRecoveryKit(
  rawRoomKey: Uint8Array,
  roomId: string,
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<RecoveryKit> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters`);
  const salt = randomBytes(16);
  const key = await derivePassphraseKey(passphrase, salt, iterations);
  const { ct, iv } = await encryptBytes(key, rawRoomKey, `recovery|${roomId}`);
  return {
    v: 1,
    kind: "usmode-recovery-kit",
    roomId,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: toB64(salt) },
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

export async function openRecoveryKit(kit: RecoveryKit, passphrase: string): Promise<Bytes> {
  if (kit?.kind !== "usmode-recovery-kit" || kit.v !== 1) throw new Error("Not a USMODE recovery kit");
  const key = await derivePassphraseKey(passphrase, fromB64(kit.kdf.salt), kit.kdf.iterations);
  try {
    return await decryptBytes(key, fromB64(kit.ct), fromB64(kit.iv), `recovery|${kit.roomId}`);
  } catch {
    throw new Error("Wrong passphrase or damaged kit");
  }
}

/* ------------------------------------------------------------------ */
/* Safety fingerprints                                                 */
/* ------------------------------------------------------------------ */

async function sha256(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle().digest("SHA-256", own(data)));
}

/** Short per-device fingerprint, e.g. "3F9A 0C12 77B4 E801". */
export async function keyFingerprint(jwk: PublicJwk): Promise<string> {
  const h = await sha256(utf8(`usmode/fp/v1|${jwk.x}|${jwk.y}`));
  return toHex(h.subarray(0, 8)).toUpperCase().match(/.{4}/g)!.join(" ");
}

/**
 * Room safety number: the same on both phones only if both see the same two
 * public keys. 6 groups of 5 digits, like Signal.
 */
export async function safetyNumber(roomId: string, a: PublicJwk, b: PublicJwk): Promise<string> {
  const parts = [`${a.x}.${a.y}`, `${b.x}.${b.y}`].sort();
  const h = await sha256(utf8(`usmode/safety/v1|${roomId}|${parts[0]}|${parts[1]}`));
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    const n = ((h[i * 4] << 24) | (h[i * 4 + 1] << 16) | (h[i * 4 + 2] << 8) | h[i * 4 + 3]) >>> 0;
    groups.push(String(n % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}
