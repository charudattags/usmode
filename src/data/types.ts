/**
 * Row shapes, exactly as stored (snake_case, ciphertext for anything sensitive).
 * Both backends (Supabase and the local demo) return these.
 */
import type { PublicJwk, Sealed } from "@/crypto/e2ee";

export type StatusCode = "locked_in" | "decompressing" | "low_battery" | "free" | "in_room";
export type CycleStatusRow = "active" | "eod_pending" | "closed";
export type RoomType = "boast" | "confession" | "vault" | "jam";
export type PostTag = "flex" | "roast" | "mutual_reveal";
export type KissStyle = "forehead" | "smooch" | "flying" | "attack10";
export type JoinMethodRow = "qr" | "code";
export type Sticker = "cope" | "show_off" | "beat_you" | "cry" | "fire" | "heart";

export interface RoomRow {
  id: string;
  created_by: string;
  pairing_code_hash: string | null;
  pairing_expires_at: string | null;
  is_locked: boolean;
  join_method: JoinMethodRow | null;
  key_envelope: string | null;
  key_envelope_iv: string | null;
  encrypted_config: string | null;
  config_iv: string | null;
  theme_seed_hex: string;
  backchodi_start_time: string; // "21:00:00"
  backchodi_tz: string;
  backchodi_minutes: number;
  vault_early_unlock_at: string | null;
  cowork_started_at: string | null;
  cowork_started_by: string | null;
  cowork_focus_min: number;
  cowork_break_min: number;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  room_id: string;
  user_id: string;
  public_key_jwk: PublicJwk;
  battery_level: number;
  status_code: StatusCode;
  decompression_ends_at: string | null;
  vault_unlock_requested_at: string | null;
  last_seen_at: string;
  joined_at: string;
}

export interface CycleRow {
  id: string;
  room_id: string;
  cycle_number: number;
  status: CycleStatusRow;
  eod_proposed_by: string | null;
  eod_proposed_at: string | null;
  eod_nudged_at: string | null;
  eod_declined_by: string | null;
  eod_declined_at: string | null;
  eod_confirmed_at: string | null;
  winner_user_id: string | null;
  loser_user_id: string | null;
  dare_selected_encrypted: string | null;
  dare_iv: string | null;
  dare_completed_at: string | null;
  started_at: string;
  closed_at: string | null;
}

export interface TaskRow {
  id: string;
  room_id: string;
  cycle_id: string;
  user_id: string;
  encrypted_title: string;
  iv: string;
  is_completed: boolean;
  completed_at: string | null;
  encrypted_proof_path: string | null;
  created_at: string;
}

export interface ScoreRow {
  cycle_id: string;
  user_id: string;
  room_id: string;
  task_count: number;
  completed_count: number;
  reached_100_at: string | null;
}

export interface KissRow {
  id: string;
  room_id: string;
  cycle_id: string | null;
  from_user_id: string;
  to_user_id: string;
  trigger_task_id: string | null;
  kiss_style: KissStyle;
  kiss_count: number;
  encrypted_note: string | null;
  iv: string | null;
  created_at: string;
  delivered_to_recipient: boolean;
  seen_at: string | null;
}

export interface RevealRoundRow {
  id: string;
  room_id: string;
  started_by: string;
  submitted_user_ids: string[];
  created_at: string;
  revealed_at: string | null;
}

export interface PostRow {
  id: string;
  room_id: string;
  room_type: RoomType;
  tag: PostTag | null;
  author_id: string;
  encrypted_payload: string;
  iv: string;
  encrypted_media_path: string | null;
  reveal_round_id: string | null;
  is_revealed: boolean;
  ephemeral: boolean;
  unlocks_at: string | null;
  created_at: string;
}

export interface ReactionRow {
  post_id: string;
  room_id: string;
  user_id: string;
  sticker: Sticker;
  created_at: string;
}

export interface SpotifyRow {
  room_id: string;
  jam_url_encrypted: string | null;
  jam_iv: string | null;
  current_track_encrypted: string | null;
  track_iv: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface OwedRow {
  task_id: string;
  encrypted_title: string;
  iv: string;
  completed_at: string;
}

export interface KissStats {
  today: number;
  all_time: number;
}

export type JoinResult =
  | { ok: true; room_id: string; partner_public_key: PublicJwk }
  | { ok: false; error: string };

export type ChangeTable =
  | "rooms"
  | "members"
  | "daily_cycles"
  | "cycle_scores"
  | "tasks"
  | "kisses"
  | "reveal_rounds"
  | "room_posts"
  | "post_reactions"
  | "spotify_sessions";

/** Ephemeral, content-free pings over the room's private broadcast channel. */
export type BroadcastEvent =
  | { type: "reaction"; emoji: string; scope: "cowork" | "jam" }
  | { type: "kiss_sent"; style: KissStyle }
  | { type: "vault_drop" }
  | { type: "refresh"; tables: ChangeTable[] };

export interface RoomUpdate {
  encrypted_config?: string;
  config_iv?: string;
  theme_seed_hex?: string;
  backchodi_start_time?: string;
  backchodi_tz?: string;
  cowork_started_at?: string | null;
  cowork_started_by?: string | null;
  cowork_focus_min?: number;
  cowork_break_min?: number;
}

export interface MemberUpdate {
  battery_level?: number;
  status_code?: StatusCode;
  decompression_ends_at?: string | null;
  last_seen_at?: string;
  public_key_jwk?: PublicJwk;
}

export interface NewPost {
  room_type: RoomType;
  tag: PostTag | null;
  payload: Sealed;
  media_path: string | null;
  reveal_round_id: string | null;
  ephemeral: boolean;
}

export interface NewKiss {
  to_user_id: string;
  trigger_task_id: string | null;
  kiss_style: KissStyle;
  note: Sealed | null;
}
