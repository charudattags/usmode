/**
 * Device key storage in IndexedDB.
 *
 * - The ECDH device key pair is stored as CryptoKey objects (private key non-extractable).
 * - The room key is stored twice: a non-extractable CryptoKey for everyday
 *   encrypt/decrypt, and the raw bytes sealed under a non-extractable device
 *   vault key, used only to hand the key to the partner during pairing and to
 *   build a recovery kit. Nothing here is ever sent to the server.
 *
 * Every record is namespaced by user id so the two-tab demo can hold both
 * partners in one browser profile.
 */
import { openDB, type IDBPDatabase } from "idb";
import { decryptBytes, encryptBytes, importRoomKey, type PublicJwk, exportPublicJwk, generateDeviceKeyPair } from "./e2ee";
import { fromB64, toB64 } from "./encoding";

const DB_NAME = "usmode-keys";
const STORE = "keys";

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

async function get<T>(key: string): Promise<T | undefined> {
  return (await db()).get(STORE, key) as Promise<T | undefined>;
}
async function put(key: string, value: unknown): Promise<void> {
  await (await db()).put(STORE, value, key);
}
async function del(key: string): Promise<void> {
  await (await db()).delete(STORE, key);
}

async function vaultKey(userId: string): Promise<CryptoKey> {
  const k = `${userId}:vault`;
  const existing = await get<CryptoKey>(k);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await put(k, key);
  return key;
}

export interface DeviceIdentity {
  keyPair: CryptoKeyPair;
  publicJwk: PublicJwk;
}

export async function getOrCreateDeviceIdentity(userId: string): Promise<DeviceIdentity> {
  const k = `${userId}:device`;
  const existing = await get<DeviceIdentity>(k);
  if (existing?.keyPair?.privateKey) return existing;
  const keyPair = await generateDeviceKeyPair();
  const identity = { keyPair, publicJwk: await exportPublicJwk(keyPair.publicKey) };
  await put(k, identity);
  return identity;
}

interface StoredRoomKey {
  roomId: string;
  key: CryptoKey;
  sealedRaw: { ct: string; iv: string };
}

export async function saveRoomKey(userId: string, roomId: string, raw: Uint8Array): Promise<CryptoKey> {
  const key = await importRoomKey(raw, false);
  const { ct, iv } = await encryptBytes(await vaultKey(userId), raw, `vault|${roomId}`);
  const rec: StoredRoomKey = { roomId, key, sealedRaw: { ct: toB64(ct), iv: toB64(iv) } };
  await put(`${userId}:room:${roomId}`, rec);
  return key;
}

export async function loadRoomKey(userId: string, roomId: string): Promise<CryptoKey | null> {
  const rec = await get<StoredRoomKey>(`${userId}:room:${roomId}`);
  return rec?.key ?? null;
}

/** Only for the pairing envelope and the recovery kit. */
export async function loadRoomKeyRaw(userId: string, roomId: string): Promise<Uint8Array | null> {
  const rec = await get<StoredRoomKey>(`${userId}:room:${roomId}`);
  if (!rec) return null;
  return decryptBytes(await vaultKey(userId), fromB64(rec.sealedRaw.ct), fromB64(rec.sealedRaw.iv), `vault|${roomId}`);
}

/** Pending pairing secrets for the room creator (code auth + QR secret). */
export interface PendingPairing {
  roomId: string;
  code: string;
  auth: string; // base64
  qrSecret: string;
  expiresAt: string;
}

export async function savePendingPairing(userId: string, p: PendingPairing): Promise<void> {
  await put(`${userId}:pairing`, p);
}
export async function loadPendingPairing(userId: string): Promise<PendingPairing | undefined> {
  return get<PendingPairing>(`${userId}:pairing`);
}
export async function clearPendingPairing(userId: string): Promise<void> {
  await del(`${userId}:pairing`);
}

/** App-lock (WebAuthn) credential id, if the user turned it on. */
export async function saveAppLockCredential(userId: string, credentialId: string | null): Promise<void> {
  if (credentialId) await put(`${userId}:applock`, credentialId);
  else await del(`${userId}:applock`);
}
export async function loadAppLockCredential(userId: string): Promise<string | undefined> {
  return get<string>(`${userId}:applock`);
}

export async function forgetUser(userId: string): Promise<void> {
  const d = await db();
  const keys = (await d.getAllKeys(STORE)) as string[];
  await Promise.all(keys.filter((k) => k.startsWith(`${userId}:`)).map((k) => d.delete(STORE, k)));
}
