// Supabase Edge Function (Deno): sends content-free Web Push to the partner.
//
// Wire it up with Database Webhooks (Dashboard → Database → Webhooks), all
// pointing at this function with header `x-usmode-webhook-secret: <WEBHOOK_SECRET>`:
//   * kisses        INSERT
//   * tasks         UPDATE
//   * daily_cycles  UPDATE
//
// Secrets (supabase secrets set ...): WEBHOOK_SECRET, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// Payloads never include task titles, notes, names or anything decrypted;
// the server can't read those anyway.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import webpush from "npm:web-push@4.0.0";

type Row = Record<string, unknown>;
interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Row | null;
  old_record: Row | null;
}

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

async function partnerOf(roomId: string, userId: string): Promise<string | null> {
  const { data } = await admin.from("members").select("user_id").eq("room_id", roomId).neq("user_id", userId).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

async function membersOf(roomId: string): Promise<string[]> {
  const { data } = await admin.from("members").select("user_id").eq("room_id", roomId);
  return (data ?? []).map((m) => m.user_id as string);
}

/** Decide who gets told what. Generic wording only. */
async function route(p: WebhookPayload): Promise<{ to: string[]; title: string; body: string } | null> {
  const r = p.record ?? {};
  const o = p.old_record ?? {};
  if (p.table === "kisses" && p.type === "INSERT") {
    return { to: [String(r.to_user_id)], title: "💋 Incoming kiss", body: "Open USMODE to catch it." };
  }
  if (p.table === "tasks" && p.type === "UPDATE" && r.is_completed === true && o.is_completed === false) {
    const to = await partnerOf(String(r.room_id), String(r.user_id));
    return to ? { to: [to], title: "💋 You owe a kiss", body: "Your partner just finished a task." } : null;
  }
  if (p.table === "daily_cycles" && p.type === "UPDATE") {
    if (r.status === "eod_pending" && o.status !== "eod_pending" && r.eod_proposed_by) {
      const to = await partnerOf(String(r.room_id), String(r.eod_proposed_by));
      return to ? { to: [to], title: "🏁 Wrap up today?", body: "Your partner wants to lock the scoreboard." } : null;
    }
    if (r.status === "eod_pending" && r.eod_nudged_at && r.eod_nudged_at !== o.eod_nudged_at && r.eod_proposed_by) {
      const to = await partnerOf(String(r.room_id), String(r.eod_proposed_by));
      return to ? { to: [to], title: "👉 Nudge", body: "Your partner is waiting to end the day." } : null;
    }
    if (r.status === "closed" && o.status !== "closed") {
      return { to: await membersOf(String(r.room_id)), title: "🔒 Day locked", body: "Today's verdict is in. Check Backchodi." };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = req.headers.get("x-usmode-webhook-secret") ?? "";
  if (!safeEqual(secret, env("WEBHOOK_SECRET"))) return new Response("Unauthorized", { status: 401 });

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (payload.schema !== "public") return new Response("ignored", { status: 200 });

  const msg = await route(payload);
  if (!msg || msg.to.length === 0) return new Response("no-op", { status: 200 });

  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", msg.to);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
        JSON.stringify({ title: msg.title, body: msg.body }),
        { TTL: 60 * 60 * 12, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // Gone or not found: the browser unsubscribed. Clean up.
      if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  // Log counts only: no user ids, no content.
  console.log(JSON.stringify({ table: payload.table, type: payload.type, sent }));
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
