import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Backend, RealtimeHandlers } from "../backend";
import type {
  BroadcastEvent,
  ChangeTable,
  CycleRow,
  JoinResult,
  KissRow,
  KissStats,
  MemberRow,
  OwedRow,
  PostRow,
  ReactionRow,
  RevealRoundRow,
  RoomRow,
  RoomType,
  ScoreRow,
  SpotifyRow,
  TaskRow,
} from "../types";
import { CHANGE_TABLES } from "../tables";

const MEDIA_BUCKET = "media";

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function list<T>(res: { data: unknown[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
}

function one<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }

  /* Session */
  async getUserId() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
  }
  onAuthChange(cb: (id: string | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }
  async sendOtp(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw new Error(error.message);
  }
  async verifyOtp(email: string, token: string) {
    const { error } = await this.sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw new Error(error.message);
  }
  async signOut() {
    await this.sb.auth.signOut();
  }

  /* Pairing */
  async getMyRoomId() {
    return must(await this.sb.rpc("my_room_id")) as string | null;
  }
  async createRoom(a: { lookup: string; expiresAt: string; publicKey: object; tz: string }) {
    return must(await this.sb.rpc("create_room", { p_lookup: a.lookup, p_expires_at: a.expiresAt, p_public_key: a.publicKey, p_tz: a.tz })) as string;
  }
  async refreshPairingCode(lookup: string, expiresAt: string) {
    must(await this.sb.rpc("refresh_pairing_code", { p_lookup: lookup, p_expires_at: expiresAt }));
  }
  async cancelRoom() {
    must(await this.sb.rpc("cancel_room"));
  }
  async joinRoom(lookup: string, publicKey: object, method: "qr" | "code") {
    return must(await this.sb.rpc("join_room", { p_lookup: lookup, p_public_key: publicKey, p_method: method })) as JoinResult;
  }
  async deliverRoomKey(env: { ct: string; iv: string }) {
    must(await this.sb.rpc("deliver_room_key", { p_ct: env.ct, p_iv: env.iv }));
  }
  async confirmRoomKey() {
    must(await this.sb.rpc("confirm_room_key"));
  }

  /* Reads */
  async fetchRoom(roomId: string) {
    return one<RoomRow | null>(await this.sb.from("rooms").select("*").eq("id", roomId).maybeSingle());
  }
  async fetchMembers(roomId: string) {
    return list<MemberRow>(await this.sb.from("members").select("*").eq("room_id", roomId).order("joined_at"));
  }
  async fetchCycles(roomId: string) {
    return list<CycleRow>(await this.sb.from("daily_cycles").select("*").eq("room_id", roomId).order("cycle_number", { ascending: false }).limit(90));
  }
  async fetchTasks(roomId: string, cycleId: string) {
    return list<TaskRow>(await this.sb.from("tasks").select("*").eq("room_id", roomId).eq("cycle_id", cycleId).order("created_at").order("id"));
  }
  async fetchTasksByIds(ids: string[]) {
    if (!ids.length) return [];
    return list<TaskRow>(await this.sb.from("tasks").select("*").in("id", ids));
  }
  async fetchScores(roomId: string, cycleId: string) {
    return list<ScoreRow>(await this.sb.from("cycle_scores").select("*").eq("room_id", roomId).eq("cycle_id", cycleId));
  }
  async fetchUnseenKisses(userId: string) {
    return list<KissRow>(await this.sb.from("kisses").select("*").eq("to_user_id", userId).is("seen_at", null).order("created_at"));
  }
  async fetchKissStats() {
    const rows = must(await this.sb.rpc("kiss_stats")) as KissStats[];
    return rows[0] ?? { today: 0, all_time: 0 };
  }
  async fetchOwed() {
    return must(await this.sb.rpc("owed_kisses")) as OwedRow[];
  }
  async fetchPosts(roomId: string, roomType: RoomType) {
    return list<PostRow>(await this.sb.from("room_posts").select("*").eq("room_id", roomId).eq("room_type", roomType).order("created_at", { ascending: false }).limit(100));
  }
  async fetchReactions(roomId: string) {
    return list<ReactionRow>(await this.sb.from("post_reactions").select("*").eq("room_id", roomId));
  }
  async fetchRounds(roomId: string) {
    return list<RevealRoundRow>(await this.sb.from("reveal_rounds").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(50));
  }
  async fetchSpotify(roomId: string) {
    return one<SpotifyRow | null>(await this.sb.from("spotify_sessions").select("*").eq("room_id", roomId).maybeSingle());
  }
  async fetchVaultSealedCount() {
    return (must(await this.sb.rpc("vault_sealed_count")) as number) ?? 0;
  }

  /* Writes */
  async updateRoom(roomId: string, patch: object) {
    must(await this.sb.from("rooms").update(patch).eq("id", roomId));
  }
  async updateMyMember(userId: string, patch: object) {
    must(await this.sb.from("members").update(patch).eq("user_id", userId));
  }
  async addTask(roomId: string, cycleId: string, userId: string, title: { ct: string; iv: string }) {
    return one<TaskRow>(
      await this.sb.from("tasks").insert({ room_id: roomId, cycle_id: cycleId, user_id: userId, encrypted_title: title.ct, iv: title.iv }).select("*").single(),
    );
  }
  async renameTask(taskId: string, title: { ct: string; iv: string }) {
    must(await this.sb.from("tasks").update({ encrypted_title: title.ct, iv: title.iv }).eq("id", taskId));
  }
  async deleteTask(taskId: string) {
    must(await this.sb.from("tasks").delete().eq("id", taskId));
  }
  async completeTask(taskId: string, proofPath: string | null) {
    return one<TaskRow>(await this.sb.from("tasks").update({ is_completed: true, encrypted_proof_path: proofPath }).eq("id", taskId).select("*").single());
  }
  async proposeEod() {
    must(await this.sb.rpc("propose_eod"));
  }
  async nudgeEod() {
    must(await this.sb.rpc("nudge_eod"));
  }
  async cancelEod() {
    must(await this.sb.rpc("cancel_eod"));
  }
  async confirmEod() {
    return must(await this.sb.rpc("confirm_eod")) as string;
  }
  async setDare(cycleId: string, dare: { ct: string; iv: string }) {
    must(await this.sb.rpc("set_dare", { p_cycle: cycleId, p_ct: dare.ct, p_iv: dare.iv }));
  }
  async completeDare(cycleId: string) {
    must(await this.sb.rpc("complete_dare", { p_cycle: cycleId }));
  }
  async sendKiss(roomId: string, fromUserId: string, k: { to_user_id: string; trigger_task_id: string | null; kiss_style: string; note: { ct: string; iv: string } | null }) {
    return one<KissRow>(
      await this.sb
        .from("kisses")
        .insert({
          room_id: roomId,
          from_user_id: fromUserId,
          to_user_id: k.to_user_id,
          trigger_task_id: k.trigger_task_id,
          kiss_style: k.kiss_style,
          encrypted_note: k.note?.ct ?? null,
          iv: k.note?.iv ?? null,
        })
        .select("*")
        .single(),
    );
  }
  async markKissesDelivered(ids: string[]) {
    if (ids.length) must(await this.sb.rpc("mark_kisses_delivered", { p_ids: ids }));
  }
  async catchKisses(ids: string[]) {
    return (must(await this.sb.rpc("catch_kisses", { p_ids: ids })) as number) ?? 0;
  }
  async createPost(roomId: string, authorId: string, p: { room_type: string; tag: string | null; payload: { ct: string; iv: string }; media_path: string | null; reveal_round_id: string | null; ephemeral: boolean }) {
    return one<PostRow>(
      await this.sb
        .from("room_posts")
        .insert({
          room_id: roomId,
          room_type: p.room_type,
          tag: p.tag,
          author_id: authorId,
          encrypted_payload: p.payload.ct,
          iv: p.payload.iv,
          encrypted_media_path: p.media_path,
          reveal_round_id: p.reveal_round_id,
          ephemeral: p.ephemeral,
        })
        .select("*")
        .single(),
    );
  }
  async deletePost(postId: string) {
    must(await this.sb.from("room_posts").delete().eq("id", postId));
  }
  async burnPost(postId: string) {
    must(await this.sb.rpc("burn_post", { p_post: postId }));
  }
  async startRevealRound(roomId: string, userId: string) {
    return one<RevealRoundRow>(await this.sb.from("reveal_rounds").insert({ room_id: roomId, started_by: userId }).select("*").single());
  }
  async toggleReaction(roomId: string, userId: string, postId: string, sticker: string, on: boolean) {
    if (on) {
      const { error } = await this.sb.from("post_reactions").insert({ room_id: roomId, user_id: userId, post_id: postId, sticker });
      if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    } else {
      must(await this.sb.from("post_reactions").delete().eq("post_id", postId).eq("user_id", userId).eq("sticker", sticker));
    }
  }
  async requestVaultUnlock() {
    return must(await this.sb.rpc("request_vault_unlock")) as boolean;
  }
  async cancelVaultUnlock() {
    must(await this.sb.rpc("cancel_vault_unlock"));
  }
  async setSpotify(roomId: string, patch: { jam?: { ct: string; iv: string } | null; track?: { ct: string; iv: string } | null }) {
    const row: Record<string, string | null> = {};
    if (patch.jam !== undefined) {
      row.jam_url_encrypted = patch.jam?.ct ?? null;
      row.jam_iv = patch.jam?.iv ?? null;
    }
    if (patch.track !== undefined) {
      row.current_track_encrypted = patch.track?.ct ?? null;
      row.track_iv = patch.track?.iv ?? null;
    }
    must(await this.sb.from("spotify_sessions").update(row).eq("room_id", roomId));
  }
  async savePushSubscription(roomId: string, userId: string, s: { endpoint: string; p256dh: string; auth: string }) {
    await this.sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    must(await this.sb.from("push_subscriptions").insert({ room_id: roomId, user_id: userId, ...s }));
  }

  /* Media */
  async uploadMedia(path: string, data: Uint8Array) {
    const body = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
    const { error } = await this.sb.storage.from(MEDIA_BUCKET).upload(path, body, { contentType: "application/octet-stream", upsert: false });
    if (error) throw new Error(error.message);
  }
  async downloadMedia(path: string) {
    const { data, error } = await this.sb.storage.from(MEDIA_BUCKET).download(path);
    if (error || !data) throw new Error(error?.message ?? "Couldn't download");
    return new Uint8Array(await data.arrayBuffer());
  }
  async removeMedia(path: string) {
    const { error } = await this.sb.storage.from(MEDIA_BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  }

  /* Realtime */
  private channels = new Map<string, RealtimeChannel>();

  subscribe(roomId: string, h: RealtimeHandlers) {
    let db = this.sb.channel(`db:${roomId}`);
    for (const table of CHANGE_TABLES) {
      const filter = table === "rooms" ? `id=eq.${roomId}` : `room_id=eq.${roomId}`;
      db = db.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => h.onChange([table as ChangeTable]));
    }
    db.subscribe();

    const room = this.sb.channel(`room:${roomId}`, { config: { private: true, broadcast: { self: false } } });
    room.on("broadcast", { event: "evt" }, (msg) => h.onBroadcast(msg.payload as BroadcastEvent));
    void this.sb.realtime.setAuth().then(() => room.subscribe());
    this.channels.set(roomId, room);

    return () => {
      void this.sb.removeChannel(db);
      void this.sb.removeChannel(room);
      this.channels.delete(roomId);
    };
  }

  async broadcast(roomId: string, event: BroadcastEvent) {
    const ch = this.channels.get(roomId);
    if (!ch) return;
    await ch.send({ type: "broadcast", event: "evt", payload: event });
  }
}
