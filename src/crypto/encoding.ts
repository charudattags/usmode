// Byte <-> string helpers shared by the crypto modules.
// Everything returns Uint8Array<ArrayBuffer> so values can be passed straight to SubtleCrypto.

export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function utf8(s: string): Bytes {
  const raw = enc.encode(s);
  const copy = new Uint8Array(new ArrayBuffer(raw.byteLength));
  copy.set(raw);
  return copy;
}

export function fromUtf8(b: Uint8Array): string {
  return dec.decode(b);
}

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fromB64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(s: string): Bytes {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** Copies any Uint8Array view into a fresh ArrayBuffer-backed array. */
export function own(b: Uint8Array | ArrayBuffer): Bytes {
  const src = b instanceof Uint8Array ? b : new Uint8Array(b);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}
