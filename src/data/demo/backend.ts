/**
 * Two-tab demo backend. Open the app in two windows as Partner A and Partner B:
 * both talk to the same local "server" (IndexedDB, guarded by the Web Locks
 * API), and changes are pushed between tabs over BroadcastChannel, standing in
 * for Supabase Realtime. Like the real server it stores only ciphertext.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { Backend, RealtimeHandlers } from "../backend";
import type { BroadcastEvent, ChangeTable, JoinMethodRow, MemberUpdate, NewKiss, NewPost, RoomType, RoomUpdate, Sticker } from "../types";
import type { PublicJwk, Sealed } from "@/crypto/e2ee";
import * as S from "./server";

const DB_NAME = "usmode-demo-server";
const LOCK = "usmode-demo-server";
const CHANNEL = "usmode-demo";

export type DemoIdentity = "A" | "B";

type Msg =
  | { kind: "change"; tables: ChangeTable[] }
  | { kind: "broadcast"; roomId: string; from: string; event: BroadcastEvent }
  | { kind: "auth" };

let dbp: Promise<IDBPDatabase> | null = null;
function idb() {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore("state");
        d.createObjectStore("media");
      },
    });
  }
  return dbp;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(LOCK, fn);
  return fn();
}

export function demoUserId(identity: DemoIdentity): string {
  const key = `usmode-demo-user-${identity}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function currentDemoIdentity(): DemoIdentity | null {
  const v = sessionStorage.getItem("usmode-demo-identity");
  return v === "A" || v === "B" ? v : null;
}

export function setDemoIdentity(identity: DemoIdentity | null) {
  if (identity) sessionStorage.setItem("usmode-demo-identity", identity);
  else sessionStorage.removeItem("usmode-demo-identity");
}

/** Wipes the local demo server (both partners' data). */
export async function resetDemoServer() {
  const d = await idb();
  await d.clear("state");
  await d.clear("media");
  localStorage.removeItem("usmode-demo-user-A");
  localStorage.removeItem("usmode-demo-user-B");
  new BroadcastChannel(CHANNEL).postMessage({ kind: "change", tables: ["rooms", "members"] } satisfies Msg);
}

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private chan = new BroadcastChannel(CHANNEL);
  private localListeners = new Set<(m: Msg) => void>();
  private authListeners = new Set<(id: string | null) => void>();

  constructor() {
    this.chan.onmessage = (e: MessageEvent<Msg>) => {
      for (const l of this.localListeners) l(e.data);
    };
  }

  close() {
    this.chan.close();
  }

  private uid(): string {
    const ident = currentDemoIdentity();
    if (!ident) throw new Error("Pick Partner A or B first");
    return demoUserId(ident);
  }

  private emit(msg: Msg) {
    this.chan.postMessage(msg);
    for (const l of this.localListeners) l(msg);
  }

  /** Run a write: lock, load, mutate, save, announce. */
  private async tx<T>(fn: (c: S.Ctx) => T): Promise<T> {
    const uid = this.uid();
    const { out, changed } = await withLock(async () => {
      const d = await idb();
      const db = ((await d.get("state", "db")) as S.DemoDb | undefined) ?? S.emptyDb();
      const ctx: S.Ctx = { db, uid, now: new Date(), changed: new Set() };
      const out = fn(ctx);
      await d.put("state", ctx.db, "db");
      return { out, changed: [...ctx.changed] };
    });
    if (changed.length) this.emit({ kind: "change", tables: changed });
    return out;
  }

  private async read<T>(fn: (db: S.DemoDb, uid: string, now: Date) => T): Promise<T> {
    const d = await idb();
    const db = ((await d.get("state", "db")) as S.DemoDb | undefined) ?? S.emptyDb();
    return fn(db, this.uid(), new Date());
  }

  /* Session: identity comes from the tab (A or B), no email needed. */
  async getUserId() {
    const ident = currentDemoIdentity();
    return ident ? demoUserId(ident) : null;
  }
  onAuthChange(cb: (id: string | null) => void) {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }
  notifyAuth() {
    const ident = currentDemoIdentity();
    for (const l of this.authListeners) l(ident ? demoUserId(ident) : null);
  }
  async sendOtp() {
    throw new Error("Demo mode signs you in as Partner A or B; no email needed.");
  }
  async verifyOtp() {
    throw new Error("Demo mode signs you in as Partner A or B; no email needed.");
  }
  async signOut() {
    setDemoIdentity(null);
    this.notifyAuth();
  }

  /* Pairing */
  getMyRoomId() {
    return this.read((db, uid) => S.myRoomId(db, uid));
  }
  createRoom(a: { lookup: string; expiresAt: string; publicKey: PublicJwk; tz: string }) {
    return this.tx((c) => S.createRoom(c, a));
  }
  refreshPairingCode(lookup: string, expiresAt: string) {
    return this.tx((c) => S.refreshPairingCode(c, lookup, expiresAt));
  }
  cancelRoom() {
    return this.tx((c) => S.cancelRoom(c));
  }
  joinRoom(lookup: string, jwk: PublicJwk, method: JoinMethodRow) {
    return this.tx((c) => S.joinRoom(c, lookup, jwk, method));
  }
  deliverRoomKey(env: Sealed) {
    return this.tx((c) => S.deliverRoomKey(c, env));
  }
  confirmRoomKey() {
    return this.tx((c) => S.confirmRoomKey(c));
  }

  /* Reads, with the same visibility rules as RLS */
  fetchRoom(roomId: string) {
    return this.read((db, uid) => (db.members.some((m) => m.room_id === roomId && m.user_id === uid) ? (db.rooms.find((r) => r.id === roomId) ?? null) : null));
  }
  fetchMembers(roomId: string) {
    return this.read((db, uid) =>
      db.members.some((m) => m.room_id === roomId && m.user_id === uid) ? db.members.filter((m) => m.room_id === roomId).sort((a, b) => S.ts(a.joined_at) - S.ts(b.joined_at)) : [],
    );
  }
  fetchCycles(roomId: string) {
    return this.read((db, uid) =>
      S.myRoomId(db, uid) === roomId ? db.cycles.filter((c) => c.room_id === roomId).sort((a, b) => b.cycle_number - a.cycle_number).slice(0, 90) : [],
    );
  }
  fetchTasks(roomId: string, cycleId: string) {
    return this.read((db, uid) =>
      S.myRoomId(db, uid) === roomId
        ? db.tasks.filter((t) => t.room_id === roomId && t.cycle_id === cycleId).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
        : [],
    );
  }
  fetchTasksByIds(ids: string[]) {
    return this.read((db, uid) => db.tasks.filter((t) => ids.includes(t.id) && t.room_id === S.myRoomId(db, uid)));
  }
  fetchScores(roomId: string, cycleId: string) {
    return this.read((db, uid) => (S.myRoomId(db, uid) === roomId ? db.scores.filter((s) => s.cycle_id === cycleId) : []));
  }
  fetchUnseenKisses(userId: string) {
    return this.read((db, uid) => db.kisses.filter((k) => k.to_user_id === userId && userId === uid && !k.seen_at).sort((a, b) => S.ts(a.created_at) - S.ts(b.created_at)));
  }
  fetchKissStats() {
    return this.read((db, uid) => S.kissStats(db, uid));
  }
  fetchOwed() {
    return this.read((db, uid) => S.owedKisses(db, uid));
  }
  fetchPosts(roomId: string, type: RoomType) {
    return this.read((db, uid, now) => S.readPosts(db, uid, roomId, type, now));
  }
  fetchReactions(roomId: string) {
    return this.read((db, uid) => (S.myRoomId(db, uid) === roomId ? db.reactions.filter((r) => r.room_id === roomId) : []));
  }
  fetchRounds(roomId: string) {
    return this.read((db, uid) => (S.myRoomId(db, uid) === roomId ? db.rounds.filter((r) => r.room_id === roomId).sort((a, b) => S.ts(b.created_at) - S.ts(a.created_at)).slice(0, 50) : []));
  }
  fetchSpotify(roomId: string) {
    return this.read((db, uid) => (S.myRoomId(db, uid) === roomId ? (db.spotify.find((s) => s.room_id === roomId) ?? null) : null));
  }
  fetchVaultSealedCount() {
    return this.read((db, uid, now) => S.vaultSealedCount(db, uid, now));
  }

  /* Writes */
  updateRoom(roomId: string, patch: RoomUpdate) {
    return this.tx((c) => S.updateRoom(c, roomId, patch));
  }
  updateMyMember(_userId: string, patch: MemberUpdate) {
    return this.tx((c) => S.updateMyMember(c, patch));
  }
  addTask(roomId: string, cycleId: string, userId: string, title: Sealed) {
    return this.tx((c) => S.addTask(c, roomId, cycleId, userId, title));
  }
  renameTask(taskId: string, title: Sealed) {
    return this.tx((c) => S.renameTask(c, taskId, title));
  }
  deleteTask(taskId: string) {
    return this.tx((c) => S.deleteTask(c, taskId));
  }
  completeTask(taskId: string, proofPath: string | null) {
    return this.tx((c) => S.completeTask(c, taskId, proofPath));
  }
  proposeEod() {
    return this.tx((c) => S.proposeEod(c));
  }
  nudgeEod() {
    return this.tx((c) => S.nudgeEod(c));
  }
  cancelEod() {
    return this.tx((c) => S.cancelEod(c));
  }
  confirmEod() {
    return this.tx((c) => S.confirmEod(c));
  }
  setDare(cycleId: string, dare: Sealed) {
    return this.tx((c) => S.setDare(c, cycleId, dare));
  }
  completeDare(cycleId: string) {
    return this.tx((c) => S.completeDare(c, cycleId));
  }
  sendKiss(roomId: string, from: string, k: NewKiss) {
    return this.tx((c) => S.sendKiss(c, roomId, from, k));
  }
  markKissesDelivered(ids: string[]) {
    return this.tx((c) => S.markKissesDelivered(c, ids));
  }
  catchKisses(ids: string[]) {
    return this.tx((c) => S.catchKisses(c, ids));
  }
  createPost(roomId: string, authorId: string, p: NewPost) {
    return this.tx((c) => S.createPost(c, roomId, authorId, p));
  }
  deletePost(postId: string) {
    return this.tx((c) => S.deletePost(c, postId));
  }
  burnPost(postId: string) {
    return this.tx((c) => S.burnPost(c, postId));
  }
  startRevealRound(roomId: string, userId: string) {
    return this.tx((c) => S.startRevealRound(c, roomId, userId));
  }
  toggleReaction(roomId: string, userId: string, postId: string, sticker: Sticker, on: boolean) {
    return this.tx((c) => S.toggleReaction(c, roomId, userId, postId, sticker, on));
  }
  requestVaultUnlock() {
    return this.tx((c) => S.requestVaultUnlock(c));
  }
  cancelVaultUnlock() {
    return this.tx((c) => S.cancelVaultUnlock(c));
  }
  setSpotify(roomId: string, patch: { jam?: Sealed | null; track?: Sealed | null }) {
    return this.tx((c) => S.setSpotify(c, roomId, patch));
  }
  async savePushSubscription() {
    // The demo server can't send Web Push; notifications show in-app instead.
  }

  /* Media */
  async uploadMedia(path: string, data: Uint8Array) {
    const uid = this.uid();
    if (!path.split("/")[1] || path.split("/")[1] !== uid) throw new Error("new row violates row-level security policy");
    const d = await idb();
    await d.put("media", new Uint8Array(data), path);
  }
  async downloadMedia(path: string) {
    const ok = await this.read((db, uid, now) => S.canReadMedia(db, uid, path, now));
    if (!ok) throw new Error("Object not found");
    const d = await idb();
    const v = (await d.get("media", path)) as Uint8Array | undefined;
    if (!v) throw new Error("Object not found");
    return v;
  }
  async removeMedia(path: string) {
    const ok = await this.read((db, uid) => S.canDeleteMedia(db, uid, path));
    if (!ok) throw new Error("Not allowed");
    const d = await idb();
    await d.delete("media", path);
  }

  /* Realtime */
  subscribe(roomId: string, h: RealtimeHandlers) {
    const me = this.uid();
    const l = (m: Msg) => {
      if (m.kind === "change") h.onChange(m.tables);
      else if (m.kind === "broadcast" && m.roomId === roomId && m.from !== me) h.onBroadcast(m.event);
    };
    this.localListeners.add(l);
    return () => {
      this.localListeners.delete(l);
    };
  }
  async broadcast(roomId: string, event: BroadcastEvent) {
    this.chan.postMessage({ kind: "broadcast", roomId, from: this.uid(), event } satisfies Msg);
  }
}
