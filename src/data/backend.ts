/**
 * One interface, two implementations:
 *  - SupabaseBackend: the real thing (Postgres + RLS + Realtime + Storage).
 *  - DemoBackend: a local, in-browser server for testing Partner A and B in two tabs.
 * The UI only talks to this interface, and only ever hands it ciphertext.
 */
import type { PublicJwk, Sealed } from "@/crypto/e2ee";
import type {
  BroadcastEvent,
  ChangeTable,
  CycleRow,
  JoinMethodRow,
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
} from "./types";

export interface RealtimeHandlers {
  onChange(tables: ChangeTable[]): void;
  onBroadcast(event: BroadcastEvent): void;
}

export interface Backend {
  readonly kind: "supabase" | "demo";

  // Session
  getUserId(): Promise<string | null>;
  onAuthChange(cb: (userId: string | null) => void): () => void;
  sendOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<void>;
  signOut(): Promise<void>;

  // Pairing
  getMyRoomId(): Promise<string | null>;
  createRoom(args: { lookup: string; expiresAt: string; publicKey: PublicJwk; tz: string }): Promise<string>;
  refreshPairingCode(lookup: string, expiresAt: string): Promise<void>;
  cancelRoom(): Promise<void>;
  joinRoom(lookup: string, publicKey: PublicJwk, method: JoinMethodRow): Promise<JoinResult>;
  deliverRoomKey(env: Sealed): Promise<void>;
  confirmRoomKey(): Promise<void>;

  // Reads (RLS-filtered on the server)
  fetchRoom(roomId: string): Promise<RoomRow | null>;
  fetchMembers(roomId: string): Promise<MemberRow[]>;
  fetchCycles(roomId: string): Promise<CycleRow[]>;
  fetchTasks(roomId: string, cycleId: string): Promise<TaskRow[]>;
  fetchTasksByIds(ids: string[]): Promise<TaskRow[]>;
  fetchScores(roomId: string, cycleId: string): Promise<ScoreRow[]>;
  fetchUnseenKisses(userId: string): Promise<KissRow[]>;
  fetchKissStats(): Promise<KissStats>;
  fetchOwed(): Promise<OwedRow[]>;
  fetchPosts(roomId: string, roomType: RoomType): Promise<PostRow[]>;
  fetchReactions(roomId: string): Promise<ReactionRow[]>;
  fetchRounds(roomId: string): Promise<RevealRoundRow[]>;
  fetchSpotify(roomId: string): Promise<SpotifyRow | null>;
  fetchVaultSealedCount(): Promise<number>;

  // Writes
  updateRoom(roomId: string, patch: RoomUpdate): Promise<void>;
  updateMyMember(userId: string, patch: MemberUpdate): Promise<void>;
  addTask(roomId: string, cycleId: string, userId: string, title: Sealed): Promise<TaskRow>;
  renameTask(taskId: string, title: Sealed): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  completeTask(taskId: string, proofPath: string | null): Promise<TaskRow>;
  proposeEod(): Promise<void>;
  nudgeEod(): Promise<void>;
  cancelEod(): Promise<void>;
  confirmEod(): Promise<string>;
  setDare(cycleId: string, dare: Sealed): Promise<void>;
  completeDare(cycleId: string): Promise<void>;
  sendKiss(roomId: string, fromUserId: string, kiss: NewKiss): Promise<KissRow>;
  markKissesDelivered(ids: string[]): Promise<void>;
  catchKisses(ids: string[]): Promise<number>;
  createPost(roomId: string, authorId: string, post: NewPost): Promise<PostRow>;
  deletePost(postId: string): Promise<void>;
  burnPost(postId: string): Promise<void>;
  startRevealRound(roomId: string, userId: string): Promise<RevealRoundRow>;
  toggleReaction(roomId: string, userId: string, postId: string, sticker: Sticker, on: boolean): Promise<void>;
  requestVaultUnlock(): Promise<boolean>;
  cancelVaultUnlock(): Promise<void>;
  setSpotify(roomId: string, patch: { jam?: Sealed | null; track?: Sealed | null }): Promise<void>;
  savePushSubscription(roomId: string, userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<void>;

  // Encrypted media blobs
  uploadMedia(path: string, data: Uint8Array): Promise<void>;
  downloadMedia(path: string): Promise<Uint8Array>;
  removeMedia(path: string): Promise<void>;

  // Realtime
  subscribe(roomId: string, handlers: RealtimeHandlers): () => void;
  broadcast(roomId: string, event: BroadcastEvent): Promise<void>;
}

/** Media lives at <room>/<author>/<random>. Matches the storage policies. */
export function mediaPath(roomId: string, userId: string): string {
  return `${roomId}/${userId}/${crypto.randomUUID()}`;
}

/** Turn Postgres/PostgREST errors into a short sentence for a snackbar. */
export function friendlyError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Something went wrong. Try again.";
}
