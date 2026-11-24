import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  aadFor,
  buildPairingLink,
  createRecoveryKit,
  decryptBlob,
  decryptJSON,
  decryptText,
  deriveCodeSecrets,
  deriveHandshakeKey,
  encryptBlob,
  encryptJSON,
  encryptText,
  exportPublicJwk,
  formatPairingCode,
  generateDeviceKeyPair,
  generatePairingCode,
  generateRoomKeyRaw,
  importRoomKey,
  keyFingerprint,
  newQrSecret,
  normalizePairingCode,
  openRecoveryKit,
  openRoomKeyEnvelope,
  PAIRING_ALPHABET,
  parsePairingFragment,
  safetyNumber,
  sealRoomKeyEnvelope,
} from "@/crypto/e2ee";
import { fromB64 } from "@/crypto/encoding";
import { getOrCreateDeviceIdentity, loadRoomKey, loadRoomKeyRaw, saveRoomKey } from "@/crypto/keystore";

const FAST = 1000; // PBKDF2 iterations for tests only

describe("AES-256-GCM records", () => {
  it("round-trips text and JSON, with a fresh 96-bit IV each time", async () => {
    const key = await importRoomKey(generateRoomKeyRaw());
    const aad = aadFor("room1", "task.title");
    const a = await encryptText(key, "Finish thesis chapter", aad);
    const b = await encryptText(key, "Finish thesis chapter", aad);
    expect(fromB64(a.iv)).toHaveLength(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(a.ct).not.toContain("thesis");
    expect(await decryptText(key, a, aad)).toBe("Finish thesis chapter");
    const j = await encryptJSON(key, { petName: "Bubu" }, aadFor("room1", "config"));
    expect(await decryptJSON(key, j, aadFor("room1", "config"))).toEqual({ petName: "Bubu" });
  });

  it("refuses ciphertext moved to another room or field", async () => {
    const key = await importRoomKey(generateRoomKeyRaw());
    const s = await encryptText(key, "secret", aadFor("room1", "post"));
    await expect(decryptText(key, s, aadFor("room2", "post"))).rejects.toThrow();
    await expect(decryptText(key, s, aadFor("room1", "task.title"))).rejects.toThrow();
  });

  it("refuses a tampered ciphertext", async () => {
    const key = await importRoomKey(generateRoomKeyRaw());
    const s = await encryptText(key, "secret", "x");
    const bytes = fromB64(s.ct);
    bytes[0] ^= 1;
    await expect(decryptText(key, { ct: Buffer.from(bytes).toString("base64"), iv: s.iv }, "x")).rejects.toThrow();
  });

  it("encrypts binary media blobs", async () => {
    const key = await importRoomKey(generateRoomKeyRaw());
    const data = new Uint8Array(5000).map((_, i) => i % 251);
    const blob = await encryptBlob(key, data, "media|r|p");
    expect(blob.byteLength).toBe(12 + 5000 + 16);
    expect(await decryptBlob(key, blob, "media|r|p")).toEqual(data);
  });

  it("makes the room key non-extractable by default", async () => {
    const key = await importRoomKey(generateRoomKeyRaw());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

describe("pairing code", () => {
  it("is 8 symbols from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generatePairingCode();
      expect(c).toHaveLength(8);
      for (const ch of c) expect(PAIRING_ALPHABET).toContain(ch);
    }
    expect(formatPairingCode("K9X4M2QP")).toBe("K9X4-M2QP");
  });
  it("normalizes user input", () => {
    expect(normalizePairingCode(" k9x4-m2qp ")).toBe("K9X4M2QP");
    expect(normalizePairingCode("K9X4-M2Q0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizePairingCode("short")).toBeNull();
  });
  it("derives independent lookup and auth secrets", async () => {
    const s1 = await deriveCodeSecrets("K9X4M2QP", FAST);
    const s2 = await deriveCodeSecrets("k9x4-m2qp", FAST);
    expect(s1.lookup).toBe(s2.lookup);
    expect(s1.lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(s1.auth).toString("hex")).not.toBe(s1.lookup);
  });
  it("puts the link secret only in the URL fragment", () => {
    const link = buildPairingLink("https://usmode.app", { code: "K9X4M2QP", qrSecret: newQrSecret() });
    const u = new URL(link);
    expect(u.search).toBe("");
    expect(parsePairingFragment(u.hash)?.code).toBe("K9X4M2QP");
  });
});

describe("ECDH handshake", () => {
  async function run(opts: { method: "qr" | "code"; bCode?: string; swapKey?: boolean }) {
    const roomId = "room-123";
    const code = "K9X4M2QP";
    const qr = newQrSecret();
    const a = await generateDeviceKeyPair();
    const b = await generateDeviceKeyPair();
    const evil = await generateDeviceKeyPair();
    const aPub = await exportPublicJwk(a.publicKey);
    const bPub = await exportPublicJwk(b.publicKey);
    const evilPub = await exportPublicJwk(evil.publicKey);
    const aSecrets = await deriveCodeSecrets(code, FAST);
    const bSecrets = await deriveCodeSecrets(opts.bCode ?? code, FAST);
    const raw = generateRoomKeyRaw();
    // A sees B's key (or the attacker's, if the server swapped it).
    const kekA = await deriveHandshakeKey({
      myPrivateKey: a.privateKey,
      theirPublicJwk: opts.swapKey ? evilPub : bPub,
      auth: aSecrets.auth,
      qrSecret: qr,
      roomId,
      method: opts.method,
    });
    const env = await sealRoomKeyEnvelope(kekA, raw, roomId);
    const kekB = await deriveHandshakeKey({
      myPrivateKey: b.privateKey,
      theirPublicJwk: aPub,
      auth: bSecrets.auth,
      qrSecret: qr,
      roomId,
      method: opts.method,
    });
    return { raw, open: () => openRoomKeyEnvelope(kekB, env, roomId) };
  }

  it("delivers the room key over QR and over typed code", async () => {
    for (const method of ["qr", "code"] as const) {
      const r = await run({ method });
      expect(await r.open()).toEqual(r.raw);
    }
  });
  it("fails if the server swaps a public key", async () => {
    const r = await run({ method: "code", swapKey: true });
    await expect(r.open()).rejects.toThrow();
  });
  it("fails with the wrong code", async () => {
    const r = await run({ method: "code", bCode: "K9X4M2QR" });
    await expect(r.open()).rejects.toThrow();
  });
});

describe("recovery kit and fingerprints", () => {
  it("round-trips with the passphrase and rejects a wrong one", async () => {
    const raw = generateRoomKeyRaw();
    const kit = await createRecoveryKit(raw, "room-1", "correct horse battery", FAST);
    expect(JSON.stringify(kit)).not.toContain(Buffer.from(raw).toString("base64"));
    expect(await openRecoveryKit(kit, "correct horse battery")).toEqual(raw);
    await expect(openRecoveryKit(kit, "wrong horse battery")).rejects.toThrow("Wrong passphrase");
    await expect(createRecoveryKit(raw, "room-1", "short")).rejects.toThrow();
  });
  it("gives both partners the same safety number", async () => {
    const a = await exportPublicJwk((await generateDeviceKeyPair()).publicKey);
    const b = await exportPublicJwk((await generateDeviceKeyPair()).publicKey);
    const n1 = await safetyNumber("room", a, b);
    expect(n1).toBe(await safetyNumber("room", b, a));
    expect(n1).toMatch(/^(\d{5} ){5}\d{5}$/);
    expect(await keyFingerprint(a)).toMatch(/^([0-9A-F]{4} ){3}[0-9A-F]{4}$/);
  });
});

describe("keystore", () => {
  it("stores the device key pair and room key in IndexedDB", async () => {
    const id1 = await getOrCreateDeviceIdentity("user-a");
    const id2 = await getOrCreateDeviceIdentity("user-a");
    expect(id1.publicJwk).toEqual(id2.publicJwk);
    expect(id1.keyPair.privateKey.extractable).toBe(false);
    const raw = generateRoomKeyRaw();
    await saveRoomKey("user-a", "room-9", raw);
    const key = await loadRoomKey("user-a", "room-9");
    expect(key?.extractable).toBe(false);
    expect(await loadRoomKeyRaw("user-a", "room-9")).toEqual(raw);
    expect(await loadRoomKey("user-b", "room-9")).toBeNull();
  });
});
