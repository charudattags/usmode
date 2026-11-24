/**
 * Pairing protocol (client side).
 *
 * Partner A (creator)
 *   1. Makes a device ECDH key pair, a 256-bit room key, an 8-char code and a
 *      128-bit link secret. Sends only PBKDF2(code)[lookup half] + public key.
 *   2. When B joins, derives the handshake key from ECDH + PBKDF2(code)[auth half]
 *      (+ link secret if B scanned the QR) and posts the sealed room key.
 * Partner B (joiner)
 *   1. Sends the lookup half + its public key; gets A's public key back. The
 *      server locks the room at 2 members and burns the code.
 *   2. Opens the envelope with the same derivation, stores the room key, and
 *      tells the server to delete the envelope.
 */
import {
  buildPairingLink,
  deriveCodeSecrets,
  deriveHandshakeKey,
  generatePairingCode,
  generateRoomKeyRaw,
  newQrSecret,
  normalizePairingCode,
  openRoomKeyEnvelope,
  sealRoomKeyEnvelope,
  type JoinMethod,
} from "@/crypto/e2ee";
import { fromB64, toB64 } from "@/crypto/encoding";
import {
  clearPendingPairing,
  getOrCreateDeviceIdentity,
  loadPendingPairing,
  loadRoomKey,
  loadRoomKeyRaw,
  savePendingPairing,
  saveRoomKey,
} from "@/crypto/keystore";
import type { Backend } from "@/data/backend";
import type { MemberRow, RoomRow } from "@/data/types";

export const CODE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Invite {
  roomId: string;
  code: string;
  link: string;
  expiresAt: string;
}

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export async function createRoomAndInvite(backend: Backend, userId: string): Promise<Invite> {
  const identity = await getOrCreateDeviceIdentity(userId);
  const code = generatePairingCode();
  const secrets = await deriveCodeSecrets(code);
  const qrSecret = newQrSecret();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const roomId = await backend.createRoom({ lookup: secrets.lookup, expiresAt, publicKey: identity.publicJwk, tz });
  await saveRoomKey(userId, roomId, generateRoomKeyRaw());
  await savePendingPairing(userId, { role: "creator", roomId, code, auth: toB64(secrets.auth), qrSecret, method: null, expiresAt });
  return { roomId, code, expiresAt, link: buildPairingLink(origin(), { code, qrSecret }) };
}

/** The creator's current invite (survives reloads), refreshed if expired. */
export async function currentInvite(backend: Backend, userId: string, room: RoomRow): Promise<Invite | null> {
  const p = await loadPendingPairing(userId);
  if (!p || p.role !== "creator" || p.roomId !== room.id || room.is_locked) return null;
  if (!p.expiresAt || Date.parse(p.expiresAt) <= Date.now() || !room.pairing_expires_at) return refreshInvite(backend, userId, room.id);
  return { roomId: p.roomId, code: p.code, expiresAt: p.expiresAt, link: buildPairingLink(origin(), { code: p.code, qrSecret: p.qrSecret! }) };
}

export async function refreshInvite(backend: Backend, userId: string, roomId: string): Promise<Invite> {
  const code = generatePairingCode();
  const secrets = await deriveCodeSecrets(code);
  const qrSecret = newQrSecret();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await backend.refreshPairingCode(secrets.lookup, expiresAt);
  await savePendingPairing(userId, { role: "creator", roomId, code, auth: toB64(secrets.auth), qrSecret, method: null, expiresAt });
  return { roomId, code, expiresAt, link: buildPairingLink(origin(), { code, qrSecret }) };
}

export class PairingError extends Error {}

export async function joinRoom(backend: Backend, userId: string, rawCode: string, qrSecret: string | null): Promise<string> {
  const code = normalizePairingCode(rawCode);
  if (!code) throw new PairingError("Codes are 8 letters and numbers, like K9X4-M2QP.");
  const identity = await getOrCreateDeviceIdentity(userId);
  const secrets = await deriveCodeSecrets(code);
  const method: JoinMethod = qrSecret ? "qr" : "code";
  const res = await backend.joinRoom(secrets.lookup, identity.publicJwk, method);
  if (!res.ok) throw new PairingError(res.error);
  await savePendingPairing(userId, { role: "joiner", roomId: res.room_id, code, auth: toB64(secrets.auth), qrSecret, method, expiresAt: null });
  return res.room_id;
}

export type HandshakeState =
  | { step: "waiting_for_partner" } // creator: B hasn't joined
  | { step: "delivering" } // creator: B joined, sealing the key
  | { step: "waiting_for_key" } // joiner: A's device hasn't sealed the key yet
  | { step: "waiting_for_confirm" } // creator: delivered, B hasn't opened it yet
  | { step: "done" }
  | { step: "failed"; reason: string };

/**
 * Advances whichever half of the handshake this device owns. Safe to call on
 * every room/members change; it's idempotent.
 */
export async function advanceHandshake(backend: Backend, userId: string, room: RoomRow, members: MemberRow[]): Promise<HandshakeState> {
  const haveKey = Boolean(await loadRoomKey(userId, room.id));
  const pending = await loadPendingPairing(userId);
  const partner = members.find((m) => m.user_id !== userId);
  const isCreator = room.created_by === userId;

  if (isCreator) {
    if (!haveKey) return { step: "failed", reason: "This device doesn't have the room key. Restore it from your recovery kit." };
    if (!room.is_locked || !partner) return { step: "waiting_for_partner" };
    if (room.key_envelope) return { step: "waiting_for_confirm" };
    if (!pending || pending.role !== "creator" || pending.roomId !== room.id) return { step: "done" };
    // Partner joined and no envelope yet: seal the room key for them.
    const identity = await getOrCreateDeviceIdentity(userId);
    const raw = await loadRoomKeyRaw(userId, room.id);
    if (!raw) return { step: "failed", reason: "Room key missing on this device." };
    const method = room.join_method ?? "code";
    const kek = await deriveHandshakeKey({
      myPrivateKey: identity.keyPair.privateKey,
      theirPublicJwk: partner.public_key_jwk,
      auth: fromB64(pending.auth),
      qrSecret: method === "qr" ? pending.qrSecret : null,
      roomId: room.id,
      method,
    });
    await backend.deliverRoomKey(await sealRoomKeyEnvelope(kek, raw, room.id));
    await clearPendingPairing(userId);
    return { step: "waiting_for_confirm" };
  }

  // Joiner
  if (haveKey) {
    if (room.key_envelope) await backend.confirmRoomKey();
    return { step: "done" };
  }
  if (!room.key_envelope || !room.key_envelope_iv) return { step: "waiting_for_key" };
  if (!pending || pending.role !== "joiner" || pending.roomId !== room.id) {
    return { step: "failed", reason: "This device lost its pairing secrets. Restore from a recovery kit." };
  }
  const creator = members.find((m) => m.user_id === room.created_by);
  if (!creator) return { step: "waiting_for_key" };
  const identity = await getOrCreateDeviceIdentity(userId);
  const kek = await deriveHandshakeKey({
    myPrivateKey: identity.keyPair.privateKey,
    theirPublicJwk: creator.public_key_jwk,
    auth: fromB64(pending.auth),
    qrSecret: pending.method === "qr" ? pending.qrSecret : null,
    roomId: room.id,
    method: pending.method ?? "code",
  });
  try {
    const raw = await openRoomKeyEnvelope(kek, { ct: room.key_envelope, iv: room.key_envelope_iv }, room.id);
    await saveRoomKey(userId, room.id, raw);
  } catch {
    return {
      step: "failed",
      reason: "The key exchange didn't verify. Either the code was different or someone in the middle swapped keys. Nothing was decrypted.",
    };
  }
  await clearPendingPairing(userId);
  await backend.confirmRoomKey();
  return { step: "done" };
}
