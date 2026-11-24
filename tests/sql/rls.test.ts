import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, freshDb, jwk, lookup, type Q, type TestDb } from "./harness";

let db: TestDb;
const A = randomUUID(); // creates the room
const B = randomUUID(); // joins
const C = randomUUID(); // outsider with their own room
const D = randomUUID(); // late joiner
let roomId = "";
let roomC = "";
let code = "";

async function join(q: Q, lk: string, method: "qr" | "code") {
  const [{ r }] = await q<{ r: Record<string, unknown> }>("select public.join_room($1, $2, $3) as r", [lk, jwk(), method]);
  return r;
}

const later = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function createRoom(user: string, lk: string): Promise<string> {
  const rows = await as(db, user, (q) => q<{ id: string }>("select public.create_room($1, $2, $3, 'Asia/Kolkata') as id", [lk, later(), jwk()]));
  return rows[0].id;
}

beforeAll(async () => {
  db = await freshDb();
  await admin(db, "insert into auth.users (id) values ($1), ($2), ($3), ($4)", [A, B, C, D]);
  code = lookup();
  roomId = await createRoom(A, code);
  roomC = await createRoom(C, lookup());
});

afterAll(async () => {
  await db?.drop();
});

describe("pairing and the two-person lock", () => {
  it("only the creator can see an unpaired room", async () => {
    expect(await as(db, A, (q) => q("select id from public.rooms"))).toHaveLength(1);
    expect(await as(db, B, (q) => q("select id from public.rooms"))).toHaveLength(0);
    await expect(as(db, null, (q) => q("select id from public.rooms"))).rejects.toThrow(/permission denied/);
  });

  it("rejects a wrong code", async () => {
    await expect(as(db, B, (q) => join(q, lookup(), "code"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/doesn't match/) });
  });

  it("joins with the right code, then locks and clears the code", async () => {
    const res = await as(db, B, (q) => join(q, code, "qr"));
    expect(res).toMatchObject({ ok: true, room_id: roomId, partner_public_key: { crv: "P-256" } });
    const [room] = await admin(db, "select is_locked, pairing_code_hash, join_method from public.rooms where id = $1", [roomId]);
    expect(room).toEqual({ is_locked: true, pairing_code_hash: null, join_method: "qr" });
  });

  it("refuses a third device, even with the old code", async () => {
    await expect(as(db, D, (q) => join(q, code, "code"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/doesn't match/) });
    const [{ n }] = await admin<{ n: string }>(db, "select count(*) as n from public.members where room_id = $1", [roomId]);
    expect(Number(n)).toBe(2);
  });

  it("blocks direct inserts into members and rooms", async () => {
    await expect(as(db, D, (q) => q("insert into public.members (room_id, user_id, public_key_jwk) values ($1, $2, $3)", [roomId, D, jwk()]))).rejects.toThrow(/permission denied/);
    await expect(as(db, D, (q) => q("insert into public.rooms (created_by) values ($1)", [D]))).rejects.toThrow(/permission denied/);
  });

  it("rate-limits code guessing to 10 an hour", async () => {
    for (let i = 0; i < 9; i++) {
      await expect(as(db, D, (q) => join(q, lookup(), "code"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/doesn't match/) });
    }
    await expect(as(db, D, (q) => join(q, lookup(), "code"))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
  });

  it("hands over the key envelope from A to B, then clears it", async () => {
    await expect(as(db, B, (q) => q("select public.deliver_room_key('x', 'y')"))).rejects.toThrow(/No paired room/);
    await as(db, A, (q) => q("select public.deliver_room_key('ciphertext', 'iv')"));
    const [r] = await as(db, B, (q) => q("select key_envelope from public.rooms"));
    expect(r.key_envelope).toBe("ciphertext");
    await as(db, B, (q) => q("select public.confirm_room_key()"));
    const [r2] = await admin(db, "select key_envelope from public.rooms where id = $1", [roomId]);
    expect(r2.key_envelope).toBeNull();
  });
});

describe("owner-only visibility", () => {
  it("an outsider sees nothing of another couple's room", async () => {
    for (const t of ["rooms", "members", "daily_cycles", "tasks", "kisses", "room_posts", "cycle_scores", "spotify_sessions", "reveal_rounds", "post_reactions"]) {
      const rows = await as(db, C, (q) => q<{ room_id?: string; id?: string }>(`select * from public.${t}`));
      for (const r of rows) expect(r.room_id ?? r.id).not.toBe(roomId);
    }
  });

  it("members can only update their own member row, and only allowed columns", async () => {
    await as(db, A, (q) => q("update public.members set battery_level = 2, status_code = 'decompressing' where user_id = $1", [A]));
    const res = await as(db, A, (q) => q("update public.members set battery_level = 5 where user_id = $1 returning id", [B]));
    expect(res).toHaveLength(0);
    await expect(as(db, A, (q) => q("update public.members set room_id = $1 where user_id = $2", [roomC, A]))).rejects.toThrow(/permission denied/);
  });

  it("room settings are editable by members but pairing columns are not", async () => {
    await as(db, B, (q) => q("update public.rooms set encrypted_config = 'ct', config_iv = 'iv', theme_seed_hex = '#123456'"));
    await expect(as(db, B, (q) => q("update public.rooms set is_locked = false"))).rejects.toThrow(/permission denied/);
    await expect(as(db, B, (q) => q("update public.rooms set backchodi_tz = 'Not/AZone'"))).rejects.toThrow(/Unknown time zone/);
    const res = await as(db, C, (q) => q("update public.rooms set theme_seed_hex = '#000000' where id = $1 returning id", [roomId]));
    expect(res).toHaveLength(0);
  });

  it("stores only ciphertext for sensitive fields", async () => {
    const cols = await admin<{ table_name: string; column_name: string }>(
      db,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and data_type = 'text'
       order by 1, 2`,
    );
    const allowed = /^(encrypted_.*|.*_encrypted|iv|.*_iv|key_envelope|pairing_code_hash|theme_seed_hex|backchodi_tz|sticker|endpoint|p256dh|auth)$/;
    for (const c of cols) expect(`${c.table_name}.${c.column_name}`).toMatch(new RegExp(`\\.${allowed.source.slice(1, -1)}$`));
  });
});

describe("the 100-point race and the end-of-day handshake", () => {
  let cycle1 = "";
  let taskB = "";

  it("partners add their own tasks only", async () => {
    [{ id: cycle1 }] = await as(db, A, (q) => q<{ id: string }>("select id from public.daily_cycles where status = 'active'"));
    await as(db, A, (q) => q("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'ct', 'iv')", [roomId, cycle1, A]));
    [{ id: taskB }] = await as(db, B, (q) =>
      q<{ id: string }>("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'ct', 'iv') returning id", [roomId, cycle1, B]),
    );
    await as(db, B, (q) => q("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'ct2', 'iv')", [roomId, cycle1, B]));
    await expect(
      as(db, B, (q) => q("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'x', 'iv')", [roomId, cycle1, A])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db, C, (q) => q("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'x', 'iv')", [roomId, cycle1, C])),
    ).rejects.toThrow(/row-level security/);
  });

  it("a partner can't tick off the other's task", async () => {
    const res = await as(db, A, (q) => q("update public.tasks set is_completed = true where id = $1 returning id", [taskB]));
    expect(res).toHaveLength(0);
  });

  it("server stamps the moment someone reaches 100, and clients can't fake it", async () => {
    await as(db, A, (q) => q("update public.tasks set is_completed = true where user_id = $1", [A]));
    const [s] = await as(db, B, (q) => q("select task_count, completed_count, reached_100_at from public.cycle_scores where user_id = $1", [A]));
    expect(s.task_count).toBe(1);
    expect(s.completed_count).toBe(1);
    expect(s.reached_100_at).not.toBeNull();
    await expect(as(db, B, (q) => q("update public.cycle_scores set reached_100_at = '2000-01-01' where user_id = $1", [B]))).rejects.toThrow(/permission denied/);
    await expect(as(db, B, (q) => q("update public.daily_cycles set winner_user_id = $1", [B]))).rejects.toThrow(/permission denied/);
  });

  it("completed tasks stay completed and can't be deleted", async () => {
    await expect(as(db, A, (q) => q("update public.tasks set is_completed = false where user_id = $1", [A]))).rejects.toThrow(/stay completed/);
    await expect(as(db, A, (q) => q("delete from public.tasks where user_id = $1", [A]))).rejects.toThrow(/can't be deleted/);
  });

  it("adding a task drops you below 100 and clears your mark; deleting it restores", async () => {
    const [{ id }] = await as(db, A, (q) =>
      q<{ id: string }>("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'ct', 'iv') returning id", [roomId, cycle1, A]),
    );
    let [s] = await admin(db, "select reached_100_at from public.cycle_scores where user_id = $1", [A]);
    expect(s.reached_100_at).toBeNull();
    await as(db, A, (q) => q("delete from public.tasks where id = $1", [id]));
    [s] = await admin(db, "select reached_100_at from public.cycle_scores where user_id = $1", [A]);
    expect(s.reached_100_at).not.toBeNull();
  });

  it("needs both partners: the proposer can't confirm their own proposal", async () => {
    await as(db, A, (q) => q("select public.propose_eod()"));
    await expect(as(db, A, (q) => q("select public.confirm_eod()"))).rejects.toThrow(/partner has to confirm/);
    await expect(as(db, C, (q) => q("select public.confirm_eod()"))).rejects.toThrow(/Nobody has proposed/);
  });

  it("the partner can say 'not yet', and the proposer can propose again and nudge", async () => {
    await as(db, B, (q) => q("select public.cancel_eod()"));
    const [c] = await admin(db, "select status, eod_declined_by from public.daily_cycles where id = $1", [cycle1]);
    expect(c).toEqual({ status: "active", eod_declined_by: B });
    await as(db, A, (q) => q("select public.propose_eod()"));
    await as(db, A, (q) => q("select public.nudge_eod()"));
    await expect(as(db, B, (q) => q("select public.nudge_eod()"))).rejects.toThrow(/Nothing to nudge/);
  });

  it("confirmation closes the day with the first-to-100 winner and opens a fresh day", async () => {
    await as(db, B, (q) => q("select public.confirm_eod()"));
    const [c] = await admin(db, "select status, winner_user_id, loser_user_id, closed_at from public.daily_cycles where id = $1", [cycle1]);
    expect(c.status).toBe("closed");
    expect(c.winner_user_id).toBe(A);
    expect(c.loser_user_id).toBe(B);
    const open = await admin(db, "select cycle_number, status from public.daily_cycles where room_id = $1 and status <> 'closed'", [roomId]);
    expect(open).toEqual([{ cycle_number: 2, status: "active" }]);
  });

  it("closed days are frozen", async () => {
    await expect(
      as(db, B, (q) => q("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'x', 'iv')", [roomId, cycle1, B])),
    ).rejects.toThrow(/closed/);
    await expect(as(db, B, (q) => q("update public.tasks set is_completed = true where id = $1", [taskB]))).rejects.toThrow(/closed/);
  });

  it("only the loser spins the dare, once; either can mark it done", async () => {
    await expect(as(db, A, (q) => q("select public.set_dare($1, 'ct', 'iv')", [cycle1]))).rejects.toThrow(/loser/);
    await as(db, B, (q) => q("select public.set_dare($1, 'ct', 'iv')", [cycle1]));
    await expect(as(db, B, (q) => q("select public.set_dare($1, 'ct2', 'iv')", [cycle1]))).rejects.toThrow(/once/);
    await expect(as(db, C, (q) => q("select public.complete_dare($1)", [cycle1]))).rejects.toThrow();
    await as(db, A, (q) => q("select public.complete_dare($1)", [cycle1]));
  });
});

describe("kisses", () => {
  let taskB = "";
  let kissId = "";

  beforeAll(async () => {
    const [{ id: cycle }] = await admin<{ id: string }>(db, "select id from public.daily_cycles where room_id = $1 and status = 'active'", [roomId]);
    [{ id: taskB }] = await as(db, B, (q) =>
      q<{ id: string }>("insert into public.tasks (room_id, cycle_id, user_id, encrypted_title, iv) values ($1, $2, $3, 'ct', 'iv') returning id", [roomId, cycle, B]),
    );
  });

  it("can't kiss for a task that isn't finished, or for your own task", async () => {
    await expect(
      as(db, A, (q) => q("insert into public.kisses (room_id, from_user_id, to_user_id, trigger_task_id) values ($1, $2, $3, $4)", [roomId, A, B, taskB])),
    ).rejects.toThrow(/completed/);
    await as(db, B, (q) => q("update public.tasks set is_completed = true where id = $1", [taskB]));
    await expect(
      as(db, B, (q) => q("insert into public.kisses (room_id, from_user_id, to_user_id, trigger_task_id) values ($1, $2, $3, $4)", [roomId, B, A, taskB])),
    ).rejects.toThrow(/completed/);
  });

  it("shows the owed kiss, sends it once, and can't be sent to yourself or as someone else", async () => {
    const owed = await as(db, A, (q) => q("select task_id from public.owed_kisses()"));
    expect(owed.map((o) => o.task_id)).toContain(taskB);
    [{ id: kissId }] = await as(db, A, (q) =>
      q<{ id: string }>(
        "insert into public.kisses (room_id, from_user_id, to_user_id, trigger_task_id, kiss_style) values ($1, $2, $3, $4, 'attack10') returning id",
        [roomId, A, B, taskB],
      ),
    );
    const [k] = await admin(db, "select kiss_count, seen_at, delivered_to_recipient from public.kisses where id = $1", [kissId]);
    expect(k).toEqual({ kiss_count: 10, seen_at: null, delivered_to_recipient: false });
    expect(await as(db, A, (q) => q("select task_id from public.owed_kisses()"))).toHaveLength(0);
    await expect(
      as(db, A, (q) => q("insert into public.kisses (room_id, from_user_id, to_user_id, trigger_task_id) values ($1, $2, $3, $4)", [roomId, A, B, taskB])),
    ).rejects.toThrow(/duplicate key/);
    await expect(as(db, A, (q) => q("insert into public.kisses (room_id, from_user_id, to_user_id) values ($1, $2, $3)", [roomId, A, A]))).rejects.toThrow();
    await expect(as(db, A, (q) => q("insert into public.kisses (room_id, from_user_id, to_user_id) values ($1, $2, $3)", [roomId, B, A]))).rejects.toThrow(/row-level security/);
    await expect(as(db, C, (q) => q("insert into public.kisses (room_id, from_user_id, to_user_id) values ($1, $2, $3)", [roomId, C, A]))).rejects.toThrow(/row-level security/);
  });

  it("only the recipient catches it, and only once; seen_at can't be set directly", async () => {
    await expect(as(db, B, (q) => q("update public.kisses set seen_at = now()"))).rejects.toThrow(/permission denied/);
    const [{ n: byA }] = await as(db, A, (q) => q<{ n: number }>("select public.catch_kisses($1) as n", [[kissId]]));
    expect(byA).toBe(0);
    await as(db, B, (q) => q("select public.mark_kisses_delivered($1)", [[kissId]]));
    const [{ n }] = await as(db, B, (q) => q<{ n: number }>("select public.catch_kisses($1) as n", [[kissId]]));
    expect(n).toBe(10);
    const [{ n: again }] = await as(db, B, (q) => q<{ n: number }>("select public.catch_kisses($1) as n", [[kissId]]));
    expect(again).toBe(0);
    const [stats] = await as(db, A, (q) => q("select * from public.kiss_stats()"));
    expect(stats).toEqual({ today: 10, all_time: 10 });
  });
});

describe("vault seal, mutual reveal and burn-after-reading", () => {
  async function setWindow(openNow: boolean) {
    // Put the window either around now, or 6 hours away, in UTC.
    const tz = "UTC";
    const start = new Date(Date.now() + (openNow ? -30 : 6 * 60) * 60000);
    const hh = String(start.getUTCHours()).padStart(2, "0");
    const mm = String(start.getUTCMinutes()).padStart(2, "0");
    await admin(db, "update public.rooms set backchodi_tz = $1, backchodi_start_time = $2 where id = $3", [tz, `${hh}:${mm}`, roomId]);
  }

  it("seals vault drops outside the window: hidden row, count only", async () => {
    await setWindow(false);
    await as(db, A, (q) => q("insert into public.room_posts (room_id, room_type, author_id, encrypted_payload, iv) values ($1, 'vault', $2, 'ct', 'iv')", [roomId, A]));
    expect(await as(db, A, (q) => q("select id from public.room_posts where room_type = 'vault'"))).toHaveLength(1);
    expect(await as(db, B, (q) => q("select id from public.room_posts where room_type = 'vault'"))).toHaveLength(0);
    const [{ n }] = await as(db, B, (q) => q<{ n: number }>("select public.vault_sealed_count() as n"));
    expect(n).toBe(1);
  });

  it("opens early only when both ask", async () => {
    const [{ u1 }] = await as(db, B, (q) => q<{ u1: boolean }>("select public.request_vault_unlock() as u1"));
    expect(u1).toBe(false);
    expect(await as(db, B, (q) => q("select id from public.room_posts where room_type = 'vault'"))).toHaveLength(0);
    const [{ u2 }] = await as(db, A, (q) => q<{ u2: boolean }>("select public.request_vault_unlock() as u2"));
    expect(u2).toBe(true);
    expect(await as(db, B, (q) => q("select id from public.room_posts where room_type = 'vault'"))).toHaveLength(1);
  });

  it("drops made while the window is open are readable right away", async () => {
    await setWindow(true);
    await as(db, A, (q) => q("insert into public.room_posts (room_id, room_type, author_id, encrypted_payload, iv) values ($1, 'vault', $2, 'ct-open', 'iv')", [roomId, A]));
    const rows = await as(db, B, (q) => q("select encrypted_payload from public.room_posts where room_type = 'vault'"));
    expect(rows.map((r) => r.encrypted_payload)).toContain("ct-open");
  });

  it("mutual reveal stays hidden until both submit", async () => {
    const [{ id: round }] = await as(db, A, (q) => q<{ id: string }>("insert into public.reveal_rounds (room_id, started_by) values ($1, $2) returning id", [roomId, A]));
    await as(db, A, (q) =>
      q("insert into public.room_posts (room_id, room_type, tag, author_id, encrypted_payload, iv, reveal_round_id) values ($1, 'confession', 'mutual_reveal', $2, 'a-secret', 'iv', $3)", [roomId, A, round]),
    );
    expect(await as(db, B, (q) => q("select id from public.room_posts where reveal_round_id = $1", [round]))).toHaveLength(0);
    const [rr] = await as(db, B, (q) => q("select submitted_user_ids, revealed_at from public.reveal_rounds where id = $1", [round]));
    expect(rr.submitted_user_ids).toEqual([A]);
    expect(rr.revealed_at).toBeNull();
    await as(db, B, (q) =>
      q("insert into public.room_posts (room_id, room_type, tag, author_id, encrypted_payload, iv, reveal_round_id) values ($1, 'confession', 'mutual_reveal', $2, 'b-secret', 'iv', $3)", [roomId, B, round]),
    );
    expect(await as(db, B, (q) => q("select id from public.room_posts where reveal_round_id = $1", [round]))).toHaveLength(2);
    expect(await as(db, A, (q) => q("select id from public.room_posts where reveal_round_id = $1", [round]))).toHaveLength(2);
    await expect(
      as(db, A, (q) =>
        q("insert into public.room_posts (room_id, room_type, tag, author_id, encrypted_payload, iv, reveal_round_id) values ($1, 'confession', 'mutual_reveal', $2, 'late', 'iv', $3)", [roomId, A, round]),
      ),
    ).rejects.toThrow();
  });

  it("burn-after-reading: only the recipient can burn, and it's gone for both", async () => {
    const [{ id }] = await as(db, A, (q) =>
      q<{ id: string }>("insert into public.room_posts (room_id, room_type, author_id, encrypted_payload, iv, ephemeral) values ($1, 'confession', $2, 'ct', 'iv', true) returning id", [roomId, A]),
    );
    await expect(as(db, A, (q) => q("select public.burn_post($1)", [id]))).rejects.toThrow(/Nothing to burn/);
    await as(db, B, (q) => q("select public.burn_post($1)", [id]));
    expect(await admin(db, "select id from public.room_posts where id = $1", [id])).toHaveLength(0);
  });

  it("posts can't be authored as the partner", async () => {
    await expect(
      as(db, B, (q) => q("insert into public.room_posts (room_id, room_type, tag, author_id, encrypted_payload, iv) values ($1, 'boast', 'flex', $2, 'ct', 'iv')", [roomId, A])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("encrypted media in storage", () => {
  it("uploads only into your own folder in your room", async () => {
    await as(db, A, (q) => q("insert into storage.objects (bucket_id, name) values ('media', $1)", [`${roomId}/${A}/photo1`]));
    await expect(as(db, A, (q) => q("insert into storage.objects (bucket_id, name) values ('media', $1)", [`${roomId}/${B}/sneaky`]))).rejects.toThrow(/row-level security/);
    await expect(as(db, C, (q) => q("insert into storage.objects (bucket_id, name) values ('media', $1)", [`${roomId}/${C}/x`]))).rejects.toThrow(/row-level security/);
    await expect(as(db, A, (q) => q("insert into storage.objects (bucket_id, name) values ('media', $1)", [`not-a-uuid/${A}/x`]))).rejects.toThrow(/row-level security/);
  });

  it("the partner can download a blob only while its post is visible", async () => {
    const path = `${roomId}/${A}/vaultpic`;
    await as(db, A, (q) => q("insert into storage.objects (bucket_id, name) values ('media', $1)", [path]));
    // Seal: window far away, no early unlock after this post.
    const start = new Date(Date.now() + 6 * 3600000);
    await admin(db, "update public.rooms set backchodi_tz = 'UTC', backchodi_start_time = $1, vault_early_unlock_at = null where id = $2", [
      `${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")}`,
      roomId,
    ]);
    await as(db, A, (q) =>
      q("insert into public.room_posts (room_id, room_type, author_id, encrypted_payload, iv, encrypted_media_path) values ($1, 'vault', $2, 'ct', 'iv', $3)", [roomId, A, path]),
    );
    expect(await as(db, B, (q) => q("select name from storage.objects where name = $1", [path]))).toHaveLength(0);
    expect(await as(db, A, (q) => q("select name from storage.objects where name = $1", [path]))).toHaveLength(1);
    await as(db, A, (q) =>
      q("insert into public.room_posts (room_id, room_type, tag, author_id, encrypted_payload, iv, encrypted_media_path) values ($1, 'boast', 'flex', $2, 'ct', 'iv', $3)", [roomId, A, `${roomId}/${A}/photo1`]),
    );
    expect(await as(db, B, (q) => q("select name from storage.objects where name = $1", [`${roomId}/${A}/photo1`]))).toHaveLength(1);
    expect(await as(db, C, (q) => q("select name from storage.objects where name = $1", [`${roomId}/${A}/photo1`]))).toHaveLength(0);
  });

  it("a post can only point at media in its author's folder", async () => {
    await expect(
      as(db, B, (q) =>
        q("insert into public.room_posts (room_id, room_type, tag, author_id, encrypted_payload, iv, encrypted_media_path) values ($1, 'boast', 'roast', $2, 'ct', 'iv', $3)", [roomId, B, `${roomId}/${A}/vaultpic`]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("realtime broadcast channel", () => {
  it("only members can use room:<id>", async () => {
    await as(db, A, (q) => q("insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'ping')", [`room:${roomId}`]), { topic: `room:${roomId}` });
    expect(await as(db, B, (q) => q("select id from realtime.messages"), { topic: `room:${roomId}` })).toHaveLength(1);
    await expect(
      as(db, C, (q) => q("insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'ping')", [`room:${roomId}`]), { topic: `room:${roomId}` }),
    ).rejects.toThrow(/row-level security/);
    expect(await as(db, C, (q) => q("select id from realtime.messages"), { topic: `room:${roomId}` })).toHaveLength(0);
  });
});

describe("push subscriptions", () => {
  it("are private to their owner", async () => {
    await as(db, A, (q) => q("insert into public.push_subscriptions (room_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://push.example/1', 'k', 'a')", [roomId, A]));
    expect(await as(db, B, (q) => q("select id from public.push_subscriptions"))).toHaveLength(0);
    expect(await as(db, A, (q) => q("select id from public.push_subscriptions"))).toHaveLength(1);
  });
});
