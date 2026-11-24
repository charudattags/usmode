/**
 * Local demo server. A faithful TypeScript copy of the SQL functions, triggers
 * and RLS read rules in supabase/migrations, operating on a plain JSON state.
 * Pure: every function takes the state, the acting user and `now`.
 * It only ever stores ciphertext, exactly like the real server.
 */
import { backchodiWindow } from "@/engine/time";
import type {
  ChangeTable,
  CycleRow,
  JoinResult,
  KissRow,
  KissStats,
  MemberRow,
  MemberUpdate,
  NewKiss,
  NewPost,
  OwedRow,
  PostRow,
  ReactionRow,
  RevealRoundRow,
  RoomRow,
  RoomType,
  RoomUpdate,
  ScoreRow,
  SpotifyRow,
  Sticker,
  TaskRow,
} from "../types";
import type { PublicJwk, Sealed } from "@/crypto/e2ee";

export interface DemoDb {
  rooms: RoomRow[];
  members: MemberRow[];
  cycles: CycleRow[];
  tasks: TaskRow[];
  scores: ScoreRow[];
  kisses: KissRow[];
  rounds: RevealRoundRow[];
  posts: PostRow[];
  reactions: ReactionRow[];
  spotify: SpotifyRow[];
  attempts: { user_id: string; at: string }[];
}

export function emptyDb(): DemoDb {
  return { rooms: [], members: [], cycles: [], tasks: [], scores: [], kisses: [], rounds: [], posts: [], reactions: [], spotify: [], attempts: [] };
}

export class DemoError extends Error {}

const fail = (msg: string): never => {
  throw new DemoError(msg);
};

let seq = 0;
/** Strictly increasing ISO timestamps, like clock_timestamp(). */
function stamp(now: Date): string {
  seq = (seq + 1) % 1000;
  return new Date(now.getTime()).toISOString().replace("Z", `${String(seq).padStart(3, "0")}Z`);
}
function iso(now: Date): string {
  return now.toISOString();
}
const uuid = () => crypto.randomUUID();
export const ts = (s: string) => Date.parse(s.replace(/(\.\d{3})\d+Z$/, "$1Z"));

export interface Ctx {
  db: DemoDb;
  uid: string;
  now: Date;
  changed: Set<ChangeTable>;
}

/* ----------------------------- helpers ---------------------------------- */

export function myMember(db: DemoDb, uid: string): MemberRow | undefined {
  return db.members.find((m) => m.user_id === uid);
}
export function myRoomId(db: DemoDb, uid: string): string | null {
  return myMember(db, uid)?.room_id ?? null;
}
function isMember(db: DemoDb, roomId: string, uid: string): boolean {
  return db.members.some((m) => m.room_id === roomId && m.user_id === uid);
}
function partnerOf(db: DemoDb, roomId: string, uid: string): string | null {
  return db.members.find((m) => m.room_id === roomId && m.user_id !== uid)?.user_id ?? null;
}
function openCycle(db: DemoDb, roomId: string): CycleRow | undefined {
  return db.cycles.find((c) => c.room_id === roomId && c.status !== "closed");
}
function requireRoom(c: Ctx): RoomRow {
  const rid = myRoomId(c.db, c.uid) ?? fail("Not in a room");
  return c.db.rooms.find((r) => r.id === rid) ?? fail("Not in a room");
}

function newCycle(roomId: string, n: number, now: Date): CycleRow {
  return {
    id: uuid(),
    room_id: roomId,
    cycle_number: n,
    status: "active",
    eod_proposed_by: null,
    eod_proposed_at: null,
    eod_nudged_at: null,
    eod_declined_by: null,
    eod_declined_at: null,
    eod_confirmed_at: null,
    winner_user_id: null,
    loser_user_id: null,
    dare_selected_encrypted: null,
    dare_iv: null,
    dare_completed_at: null,
    started_at: iso(now),
    closed_at: null,
  };
}

function recomputeScore(c: Ctx, cycleId: string, userId: string) {
  const cycle = c.db.cycles.find((x) => x.id === cycleId);
  if (!cycle) return;
  const mine = c.db.tasks.filter((t) => t.cycle_id === cycleId && t.user_id === userId);
  const n = mine.length;
  const done = mine.filter((t) => t.is_completed).length;
  let s = c.db.scores.find((x) => x.cycle_id === cycleId && x.user_id === userId);
  if (!s) {
    s = { cycle_id: cycleId, user_id: userId, room_id: cycle.room_id, task_count: 0, completed_count: 0, reached_100_at: null };
    c.db.scores.push(s);
  }
  s.task_count = n;
  s.completed_count = done;
  s.reached_100_at = n > 0 && done === n ? (s.reached_100_at ?? stamp(c.now)) : null;
  c.changed.add("cycle_scores");
}

function vaultUnlockTime(room: RoomRow, now: Date): string {
  const w = backchodiWindow(now, room.backchodi_start_time.slice(0, 5), room.backchodi_tz, room.backchodi_minutes);
  return w.open ? iso(now) : iso(w.opensAt);
}

/* ------------------------------ pairing --------------------------------- */

export function createRoom(c: Ctx, a: { lookup: string; expiresAt: string; publicKey: PublicJwk; tz: string }): string {
  if (myMember(c.db, c.uid)) fail("You are already in a room");
  const exp = Date.parse(a.expiresAt);
  if (exp <= c.now.getTime() || exp > c.now.getTime() + 24 * 3600_000) fail("Pairing codes last up to 24 hours");
  const id = uuid();
  c.db.rooms.push({
    id,
    created_by: c.uid,
    pairing_code_hash: a.lookup,
    pairing_expires_at: a.expiresAt,
    is_locked: false,
    join_method: null,
    key_envelope: null,
    key_envelope_iv: null,
    encrypted_config: null,
    config_iv: null,
    theme_seed_hex: "#d0436e",
    backchodi_start_time: "21:00:00",
    backchodi_tz: a.tz || "UTC",
    backchodi_minutes: 120,
    vault_early_unlock_at: null,
    cowork_started_at: null,
    cowork_started_by: null,
    cowork_focus_min: 25,
    cowork_break_min: 5,
    created_at: iso(c.now),
    updated_at: iso(c.now),
  });
  c.db.members.push(newMember(id, c.uid, a.publicKey, c.now));
  c.db.cycles.push(newCycle(id, 1, c.now));
  c.db.spotify.push({ room_id: id, jam_url_encrypted: null, jam_iv: null, current_track_encrypted: null, track_iv: null, updated_by: null, updated_at: iso(c.now) });
  c.changed.add("rooms").add("members").add("daily_cycles");
  return id;
}

function newMember(roomId: string, uid: string, jwk: PublicJwk, now: Date): MemberRow {
  return {
    id: uuid(),
    room_id: roomId,
    user_id: uid,
    public_key_jwk: jwk,
    battery_level: 3,
    status_code: "free",
    decompression_ends_at: null,
    vault_unlock_requested_at: null,
    last_seen_at: iso(now),
    joined_at: stamp(now),
  };
}

export function refreshPairingCode(c: Ctx, lookup: string, expiresAt: string) {
  const r = c.db.rooms.find((x) => x.created_by === c.uid && !x.is_locked) ?? fail("No unpaired room to refresh");
  r.pairing_code_hash = lookup;
  r.pairing_expires_at = expiresAt;
  c.changed.add("rooms");
}

export function cancelRoom(c: Ctx) {
  const r = c.db.rooms.find((x) => x.created_by === c.uid && !x.is_locked) ?? fail("No unpaired room to cancel");
  const id = r.id;
  for (const k of ["rooms", "members", "cycles", "spotify"] as const) {
    const arr = c.db[k] as { id?: string; room_id?: string }[];
    (c.db[k] as unknown[]) = arr.filter((x) => (k === "rooms" ? x.id !== id : x.room_id !== id));
  }
  c.changed.add("rooms").add("members");
}

export function joinRoom(c: Ctx, lookup: string, jwk: PublicJwk, method: "qr" | "code"): JoinResult {
  const hourAgo = c.now.getTime() - 3600_000;
  if (c.db.attempts.filter((a) => a.user_id === c.uid && Date.parse(a.at) > hourAgo).length >= 10) {
    return { ok: false, error: "Too many pairing attempts. Try again in an hour." };
  }
  c.db.attempts.push({ user_id: c.uid, at: iso(c.now) });
  if (myMember(c.db, c.uid)) return { ok: false, error: "You are already in a room" };
  const r = c.db.rooms.find((x) => x.pairing_code_hash === lookup);
  if (!r) return { ok: false, error: "That code doesn't match a room" };
  if (r.is_locked) return { ok: false, error: "This room is already full" };
  if (r.pairing_expires_at && Date.parse(r.pairing_expires_at) <= c.now.getTime()) return { ok: false, error: "That code has expired" };
  if (c.db.members.filter((m) => m.room_id === r.id).length >= 2) return { ok: false, error: "This room is already full" };
  c.db.members.push(newMember(r.id, c.uid, jwk, c.now));
  r.is_locked = true;
  r.pairing_code_hash = null;
  r.pairing_expires_at = null;
  r.join_method = method;
  c.changed.add("rooms").add("members");
  const creator = c.db.members.find((m) => m.room_id === r.id && m.user_id === r.created_by)!;
  return { ok: true, room_id: r.id, partner_public_key: creator.public_key_jwk };
}

export function deliverRoomKey(c: Ctx, env: Sealed) {
  const r = c.db.rooms.find((x) => x.created_by === c.uid && x.is_locked) ?? fail("No paired room to deliver a key to");
  r.key_envelope = env.ct;
  r.key_envelope_iv = env.iv;
  c.changed.add("rooms");
}

export function confirmRoomKey(c: Ctx) {
  const r = requireRoom(c);
  if (r.created_by !== c.uid && r.key_envelope) {
    r.key_envelope = null;
    r.key_envelope_iv = null;
    c.changed.add("rooms");
  }
}

/* ------------------------------- updates -------------------------------- */

const ROOM_COLUMNS: (keyof RoomUpdate)[] = [
  "encrypted_config",
  "config_iv",
  "theme_seed_hex",
  "backchodi_start_time",
  "backchodi_tz",
  "cowork_started_at",
  "cowork_started_by",
  "cowork_focus_min",
  "cowork_break_min",
];

export function updateRoom(c: Ctx, roomId: string, patch: RoomUpdate) {
  const r = c.db.rooms.find((x) => x.id === roomId);
  if (!r || !isMember(c.db, roomId, c.uid) || !r.is_locked) return;
  for (const k of Object.keys(patch) as (keyof RoomUpdate)[]) {
    if (!ROOM_COLUMNS.includes(k)) fail(`permission denied for column ${k}`);
  }
  if (patch.theme_seed_hex !== undefined && !/^#[0-9a-fA-F]{6}$/.test(patch.theme_seed_hex)) fail("Invalid colour");
  if (patch.backchodi_tz !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: patch.backchodi_tz });
    } catch {
      fail(`Unknown time zone ${patch.backchodi_tz}`);
    }
  }
  if (patch.backchodi_start_time !== undefined && patch.backchodi_start_time.length === 5) patch = { ...patch, backchodi_start_time: `${patch.backchodi_start_time}:00` };
  Object.assign(r, patch, { updated_at: iso(c.now) });
  c.changed.add("rooms");
}

export function updateMyMember(c: Ctx, patch: MemberUpdate) {
  const m = myMember(c.db, c.uid);
  if (!m) return;
  if (patch.battery_level !== undefined && (patch.battery_level < 1 || patch.battery_level > 5)) fail("Battery is 1 to 5");
  Object.assign(m, patch);
  c.changed.add("members");
}

/* -------------------------------- tasks --------------------------------- */

export function addTask(c: Ctx, roomId: string, cycleId: string, userId: string, title: Sealed): TaskRow {
  if (userId !== c.uid || !isMember(c.db, roomId, c.uid)) fail("new row violates row-level security policy");
  const cycle = c.db.cycles.find((x) => x.id === cycleId);
  if (!cycle || cycle.room_id !== roomId) fail("Task must belong to this room's day");
  if (cycle!.status === "closed") fail("That day is closed");
  if (c.db.tasks.filter((t) => t.cycle_id === cycleId && t.user_id === userId).length >= 50) fail("At most 50 tasks a day");
  const t: TaskRow = {
    id: uuid(),
    room_id: roomId,
    cycle_id: cycleId,
    user_id: userId,
    encrypted_title: title.ct,
    iv: title.iv,
    is_completed: false,
    completed_at: null,
    encrypted_proof_path: null,
    created_at: stamp(c.now),
  };
  c.db.tasks.push(t);
  c.changed.add("tasks");
  recomputeScore(c, cycleId, userId);
  return t;
}

function ownOpenTask(c: Ctx, taskId: string): TaskRow {
  const t = c.db.tasks.find((x) => x.id === taskId && x.user_id === c.uid) ?? fail("Task not found");
  const cycle = c.db.cycles.find((x) => x.id === t.cycle_id);
  if (cycle?.status === "closed") fail("That day is closed");
  return t;
}

export function renameTask(c: Ctx, taskId: string, title: Sealed) {
  const t = ownOpenTask(c, taskId);
  if (t.is_completed) fail("Completed tasks can't be renamed");
  t.encrypted_title = title.ct;
  t.iv = title.iv;
  c.changed.add("tasks");
}

export function deleteTask(c: Ctx, taskId: string) {
  const t = ownOpenTask(c, taskId);
  if (t.is_completed) fail("Completed tasks can't be deleted");
  c.db.tasks = c.db.tasks.filter((x) => x.id !== taskId);
  c.changed.add("tasks");
  recomputeScore(c, t.cycle_id, t.user_id);
}

export function completeTask(c: Ctx, taskId: string, proofPath: string | null): TaskRow {
  const t = ownOpenTask(c, taskId);
  if (!t.is_completed) {
    t.is_completed = true;
    t.completed_at = stamp(c.now);
  }
  if (proofPath) t.encrypted_proof_path = proofPath;
  c.changed.add("tasks");
  recomputeScore(c, t.cycle_id, t.user_id);
  return { ...t };
}

/* --------------------------------- EOD ---------------------------------- */

export function proposeEod(c: Ctx) {
  const r = requireRoom(c);
  if (c.db.members.filter((m) => m.room_id === r.id).length < 2) fail("Your partner hasn't joined yet");
  const cy = openCycle(c.db, r.id);
  if (!cy || cy.status !== "active") fail("The day isn't open");
  Object.assign(cy!, { status: "eod_pending", eod_proposed_by: c.uid, eod_proposed_at: iso(c.now), eod_nudged_at: null, eod_declined_by: null, eod_declined_at: null });
  c.changed.add("daily_cycles");
}

export function nudgeEod(c: Ctx) {
  const r = requireRoom(c);
  const cy = openCycle(c.db, r.id);
  if (!cy || cy.status !== "eod_pending" || cy.eod_proposed_by !== c.uid) fail("Nothing to nudge");
  cy!.eod_nudged_at = iso(c.now);
  c.changed.add("daily_cycles");
}

export function cancelEod(c: Ctx) {
  const r = requireRoom(c);
  const cy = openCycle(c.db, r.id);
  if (!cy || cy.status !== "eod_pending") fail("Nothing to cancel");
  const byProposer = cy!.eod_proposed_by === c.uid;
  Object.assign(cy!, {
    status: "active",
    eod_declined_by: byProposer ? null : c.uid,
    eod_declined_at: byProposer ? null : iso(c.now),
    eod_proposed_by: null,
    eod_proposed_at: null,
    eod_nudged_at: null,
  });
  c.changed.add("daily_cycles");
}

export function confirmEod(c: Ctx): string {
  const r = requireRoom(c);
  const cy = openCycle(c.db, r.id);
  if (!cy || cy.status !== "eod_pending") fail("Nobody has proposed ending the day");
  if (cy!.eod_proposed_by === c.uid) fail("Your partner has to confirm");
  const members = c.db.members.filter((m) => m.room_id === r.id).sort((a, b) => ts(a.joined_at) - ts(b.joined_at));
  const reached = (u: string) => c.db.scores.find((s) => s.cycle_id === cy!.id && s.user_id === u)?.reached_100_at ?? null;
  const [a, b] = members;
  const ra = reached(a.user_id);
  const rb = reached(b.user_id);
  let win: string | null = null;
  let lose: string | null = null;
  // Compare full precision (stamp() adds sub-millisecond digits).
  if (ra && (!rb || ra < rb)) [win, lose] = [a.user_id, b.user_id];
  else if (rb && (!ra || rb < ra)) [win, lose] = [b.user_id, a.user_id];
  Object.assign(cy!, { status: "closed", eod_confirmed_at: iso(c.now), closed_at: iso(c.now), winner_user_id: win, loser_user_id: lose });
  c.db.cycles.push(newCycle(r.id, cy!.cycle_number + 1, c.now));
  c.changed.add("daily_cycles");
  return cy!.id;
}

export function setDare(c: Ctx, cycleId: string, dare: Sealed) {
  const cy = c.db.cycles.find((x) => x.id === cycleId);
  if (!cy || cy.status !== "closed" || cy.loser_user_id !== c.uid || cy.dare_selected_encrypted) fail("Only the day's loser can spin, once");
  cy!.dare_selected_encrypted = dare.ct;
  cy!.dare_iv = dare.iv;
  c.changed.add("daily_cycles");
}

export function completeDare(c: Ctx, cycleId: string) {
  const cy = c.db.cycles.find((x) => x.id === cycleId);
  if (!cy || cy.status !== "closed" || !cy.dare_selected_encrypted || cy.dare_completed_at || ![cy.winner_user_id, cy.loser_user_id].includes(c.uid)) {
    fail("No dare to mark done");
  }
  cy!.dare_completed_at = iso(c.now);
  c.changed.add("daily_cycles");
}

/* -------------------------------- kisses -------------------------------- */

export function sendKiss(c: Ctx, roomId: string, fromUserId: string, k: NewKiss): KissRow {
  if (fromUserId !== c.uid || !isMember(c.db, roomId, c.uid)) fail("new row violates row-level security policy");
  if (k.to_user_id !== partnerOf(c.db, roomId, c.uid)) fail("Kisses go to your partner");
  if (k.trigger_task_id) {
    const t = c.db.tasks.find((x) => x.id === k.trigger_task_id);
    if (!t || t.room_id !== roomId || t.user_id !== k.to_user_id || !t.is_completed) fail("A kiss can only be for a task your partner completed");
    if (c.db.kisses.some((x) => x.trigger_task_id === k.trigger_task_id && x.from_user_id === c.uid)) fail("You already sent a kiss for that task");
  }
  const row: KissRow = {
    id: uuid(),
    room_id: roomId,
    cycle_id: openCycle(c.db, roomId)?.id ?? null,
    from_user_id: c.uid,
    to_user_id: k.to_user_id,
    trigger_task_id: k.trigger_task_id,
    kiss_style: k.kiss_style,
    kiss_count: k.kiss_style === "attack10" ? 10 : 1,
    encrypted_note: k.note?.ct ?? null,
    iv: k.note?.iv ?? null,
    created_at: iso(c.now),
    delivered_to_recipient: false,
    seen_at: null,
  };
  c.db.kisses.push(row);
  c.changed.add("kisses");
  return row;
}

export function markKissesDelivered(c: Ctx, ids: string[]) {
  for (const k of c.db.kisses) if (ids.includes(k.id) && k.to_user_id === c.uid) k.delivered_to_recipient = true;
  c.changed.add("kisses");
}

export function catchKisses(c: Ctx, ids: string[]): number {
  let n = 0;
  for (const k of c.db.kisses) {
    if (ids.includes(k.id) && k.to_user_id === c.uid && !k.seen_at) {
      k.seen_at = iso(c.now);
      k.delivered_to_recipient = true;
      n += k.kiss_count;
    }
  }
  c.changed.add("kisses");
  return n;
}

export function kissStats(db: DemoDb, uid: string): KissStats {
  const rid = myRoomId(db, uid);
  if (!rid) return { today: 0, all_time: 0 };
  const start = openCycle(db, rid)?.started_at;
  const seen = db.kisses.filter((k) => k.room_id === rid && k.seen_at);
  return {
    all_time: seen.reduce((s, k) => s + k.kiss_count, 0),
    today: seen.filter((k) => start && Date.parse(k.seen_at!) >= Date.parse(start)).reduce((s, k) => s + k.kiss_count, 0),
  };
}

export function owedKisses(db: DemoDb, uid: string): OwedRow[] {
  const rid = myRoomId(db, uid);
  if (!rid) return [];
  return db.tasks
    .filter((t) => t.room_id === rid && t.user_id !== uid && t.is_completed)
    .filter((t) => !db.kisses.some((k) => k.trigger_task_id === t.id && k.from_user_id === uid))
    .sort((a, b) => ts(a.completed_at!) - ts(b.completed_at!))
    .map((t) => ({ task_id: t.id, encrypted_title: t.encrypted_title, iv: t.iv, completed_at: t.completed_at! }));
}

/* ------------------------- posts, vault, reveal ------------------------- */

/** Same rule as the posts_select RLS policy. */
export function canSeePost(db: DemoDb, uid: string, p: PostRow, now: Date): boolean {
  if (!isMember(db, p.room_id, uid)) return false;
  if (p.author_id === uid) return true;
  if (p.room_type === "vault") {
    const early = db.rooms.find((r) => r.id === p.room_id)?.vault_early_unlock_at;
    return (!!p.unlocks_at && Date.parse(p.unlocks_at) <= now.getTime()) || (!!early && Date.parse(p.created_at) <= Date.parse(early));
  }
  if (p.reveal_round_id) return p.is_revealed;
  return true;
}

export function readPosts(db: DemoDb, uid: string, roomId: string, type: RoomType, now: Date): PostRow[] {
  return db.posts
    .filter((p) => p.room_id === roomId && p.room_type === type && canSeePost(db, uid, p, now))
    .sort((a, b) => ts(b.created_at) - ts(a.created_at))
    .slice(0, 100);
}

export function createPost(c: Ctx, roomId: string, authorId: string, p: NewPost): PostRow {
  if (authorId !== c.uid || !isMember(c.db, roomId, c.uid)) fail("new row violates row-level security policy");
  if (p.media_path && !p.media_path.startsWith(`${roomId}/${authorId}/`)) fail("new row violates row-level security policy");
  if (p.ephemeral && p.room_type !== "confession") fail("Only confessions can be ephemeral");
  const room = c.db.rooms.find((r) => r.id === roomId)!;
  let revealed = true;
  if (p.reveal_round_id) {
    const rr = c.db.rounds.find((x) => x.id === p.reveal_round_id);
    if (!rr || rr.room_id !== roomId) fail("Unknown reveal round");
    if (rr!.revealed_at) fail("That reveal already happened");
    if (c.db.posts.some((x) => x.reveal_round_id === p.reveal_round_id && x.author_id === authorId)) fail("You already wrote yours");
    revealed = false;
  }
  const row: PostRow = {
    id: uuid(),
    room_id: roomId,
    room_type: p.room_type,
    tag: p.tag,
    author_id: authorId,
    encrypted_payload: p.payload.ct,
    iv: p.payload.iv,
    encrypted_media_path: p.media_path,
    reveal_round_id: p.reveal_round_id,
    is_revealed: revealed,
    ephemeral: p.ephemeral,
    unlocks_at: p.room_type === "vault" ? vaultUnlockTime(room, c.now) : null,
    created_at: stamp(c.now),
  };
  c.db.posts.push(row);
  c.changed.add("room_posts");
  if (p.reveal_round_id) {
    const rr = c.db.rounds.find((x) => x.id === p.reveal_round_id)!;
    rr.submitted_user_ids = Array.from(new Set([...rr.submitted_user_ids, authorId]));
    if (rr.submitted_user_ids.length >= 2) {
      rr.revealed_at = iso(c.now);
      for (const x of c.db.posts) if (x.reveal_round_id === rr.id) x.is_revealed = true;
    }
    c.changed.add("reveal_rounds");
  }
  return row;
}

export function deletePost(c: Ctx, postId: string) {
  c.db.posts = c.db.posts.filter((p) => !(p.id === postId && p.author_id === c.uid));
  c.db.reactions = c.db.reactions.filter((r) => c.db.posts.some((p) => p.id === r.post_id));
  c.changed.add("room_posts").add("post_reactions");
}

export function burnPost(c: Ctx, postId: string) {
  const rid = myRoomId(c.db, c.uid);
  const p = c.db.posts.find((x) => x.id === postId && x.ephemeral && x.room_id === rid && x.author_id !== c.uid && (!x.reveal_round_id || x.is_revealed));
  if (!p) fail("Nothing to burn");
  c.db.posts = c.db.posts.filter((x) => x.id !== postId);
  c.changed.add("room_posts");
}

export function startRevealRound(c: Ctx, roomId: string, userId: string): RevealRoundRow {
  if (userId !== c.uid || !isMember(c.db, roomId, c.uid)) fail("new row violates row-level security policy");
  const rr: RevealRoundRow = { id: uuid(), room_id: roomId, started_by: userId, submitted_user_ids: [], created_at: iso(c.now), revealed_at: null };
  c.db.rounds.push(rr);
  c.changed.add("reveal_rounds");
  return rr;
}

export function toggleReaction(c: Ctx, roomId: string, userId: string, postId: string, sticker: Sticker, on: boolean) {
  if (userId !== c.uid || !isMember(c.db, roomId, c.uid)) fail("new row violates row-level security policy");
  if (!c.db.posts.some((p) => p.id === postId && p.room_id === roomId)) fail("Reaction must be on a post in this room");
  const exists = c.db.reactions.some((r) => r.post_id === postId && r.user_id === userId && r.sticker === sticker);
  if (on && !exists) c.db.reactions.push({ post_id: postId, room_id: roomId, user_id: userId, sticker, created_at: iso(c.now) });
  if (!on) c.db.reactions = c.db.reactions.filter((r) => !(r.post_id === postId && r.user_id === userId && r.sticker === sticker));
  c.changed.add("post_reactions");
}

export function requestVaultUnlock(c: Ctx): boolean {
  const r = requireRoom(c);
  const me = myMember(c.db, c.uid)!;
  me.vault_unlock_requested_at = iso(c.now);
  c.changed.add("members");
  const other = c.db.members.find((m) => m.room_id === r.id && m.user_id !== c.uid);
  if (other?.vault_unlock_requested_at && Date.parse(other.vault_unlock_requested_at) > c.now.getTime() - 12 * 3600_000) {
    r.vault_early_unlock_at = stamp(c.now);
    for (const m of c.db.members) if (m.room_id === r.id) m.vault_unlock_requested_at = null;
    c.changed.add("rooms").add("room_posts");
    return true;
  }
  return false;
}

export function cancelVaultUnlock(c: Ctx) {
  const me = myMember(c.db, c.uid);
  if (me) me.vault_unlock_requested_at = null;
  c.changed.add("members");
}

export function vaultSealedCount(db: DemoDb, uid: string, now: Date): number {
  const rid = myRoomId(db, uid);
  if (!rid) return 0;
  return db.posts.filter((p) => p.room_id === rid && p.room_type === "vault" && p.author_id !== uid && !canSeePost(db, uid, p, now)).length;
}

export function setSpotify(c: Ctx, roomId: string, patch: { jam?: Sealed | null; track?: Sealed | null }) {
  if (!isMember(c.db, roomId, c.uid)) return;
  const s = c.db.spotify.find((x) => x.room_id === roomId);
  if (!s) return;
  if (patch.jam !== undefined) {
    s.jam_url_encrypted = patch.jam?.ct ?? null;
    s.jam_iv = patch.jam?.iv ?? null;
  }
  if (patch.track !== undefined) {
    s.current_track_encrypted = patch.track?.ct ?? null;
    s.track_iv = patch.track?.iv ?? null;
  }
  s.updated_by = c.uid;
  s.updated_at = iso(c.now);
  c.changed.add("spotify_sessions");
}

/** Media is readable by its uploader or while a visible row points at it (storage policy). */
export function canReadMedia(db: DemoDb, uid: string, path: string, now: Date): boolean {
  const [room, author] = path.split("/");
  if (!isMember(db, room, uid)) return false;
  if (author === uid) return true;
  return (
    db.posts.some((p) => p.encrypted_media_path === path && canSeePost(db, uid, p, now)) ||
    db.tasks.some((t) => t.encrypted_proof_path === path && isMember(db, t.room_id, uid))
  );
}

export function canDeleteMedia(db: DemoDb, uid: string, path: string): boolean {
  const [room, author] = path.split("/");
  if (!isMember(db, room, uid)) return false;
  return author === uid || db.posts.some((p) => p.encrypted_media_path === path && p.ephemeral && p.author_id !== uid);
}
