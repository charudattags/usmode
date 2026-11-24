# USMODE

A private, installable web app (PWA) for exactly two people in a long-distance relationship: a daily 100-point race, a digital kiss loop, ambient status, four hangout rooms, and a 2-hour daily hangout hub. Everything personal is **end-to-end encrypted** on the two phones; the server stores ciphertext.

- **Vibe:** room name, partner status, kiss counter with "Send kiss", anti-crankiness battery (1–5, ≤2 flips tonight to Cozy Mode), 30-minute "Just got home" decompression timer, Customize Room (name, pet names, avatars, phone number, Backchodi time, Material You colour from a picker or a photo).
- **Arena:** 100 points split across your tasks (always exactly 100.0), live race bar with OVERTAKE!, optional encrypted photo proof, first-to-100 winner, and a mutual end-of-day handshake (propose → confirm / not yet / nudge / cancel).
- **Rooms:** Call (hands off to the phone app: `tel:` or FaceTime; plus Silent Co-Work with a synced Pomodoro and floating reactions), Spotify Jam (now playing, Jam link, song requests, reactions), Flex & Roast feed (photos, 15 s voice notes, stickers), Confession room (mutual reveal and hold-to-read that burns after reading).
- **Backchodi:** a vault sealed until the daily window (mutual "unlock early"), daily verdict, weekly tally and streaks, and the physics dare wheel for the loser.
- **Kisses:** completing a task puts your partner in kiss debt. Kisses are stored with `delivered_to_recipient` / `seen_at`. Any time the recipient opens the app, comes back to it or signs in, a full-screen pop-up shows until they **Catch** them, and a caught kiss never shows again.

## Quick start (no backend needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase keys the app runs on a **local demo server** in your browser (IndexedDB + Web Locks + BroadcastChannel, with the same rules as the SQL). Tap **I'm Partner A**, then **Create our room**, then **Open Partner B window**. The two tabs pair over the real ECDH handshake and sync live. With Supabase configured, the demo is still available from the sign-in screen (hide it with `NEXT_PUBLIC_ENABLE_DEMO=false`).

## Folder structure

```
src/
  app/                      Next.js App Router (all client screens)
    (tabs)/vibe|arena|rooms|backchodi/   the 4 tabs
    pair/                   invite-link landing (#join=CODE&s=SECRET, fragment only)
    settings/               E2EE badge, fingerprints, recovery kit, app lock, prefs
    spotify-callback/       Spotify PKCE redirect
    manifest.ts             PWA manifest
  crypto/
    e2ee.ts                 AES-256-GCM records and blobs, ECDH P-256, PBKDF2, recovery kit, fingerprints
    keystore.ts             IndexedDB key storage (non-extractable CryptoKeys)
    encoding.ts             base64/hex/bytes helpers
  engine/                   pure rules, no UI, no clock reads
    scoring.ts              100-point split, winner logic, overtake
    eod.ts                  end-of-day state machine, weekly tally, streaks
    time.ts                 Backchodi window across time zones, countdowns, Pomodoro
    wheel.ts                dare-wheel physics integrator
  theme/materialYou.ts      seed (or image) → full M3 tonal roles as CSS variables
  data/
    backend.ts              one Backend interface
    supabase/backend.ts     Postgres + RLS + Realtime + Storage
    demo/server.ts          TypeScript copy of the SQL rules (pure)
    demo/backend.ts         two-tab demo transport
  state/
    RoomProvider.tsx        loads, decrypts, live-refreshes; partner-event toasts
    pairing.ts              pairing protocol (creator + joiner halves)
    config.ts               encrypted room config + input sanitizers
  components/
    animations/             FxProvider (confetti, +PTS pills, shake, OVERTAKE!, GSAP kiss spectacle), AmbientBackground
    ui/                     M3 primitives: buttons, sheet, switch, segmented, Material Shapes, icons
    vibe/ arena/ rooms/ backchodi/ settings/ onboarding/ media/ shell/
  lib/                      media capture + encrypted upload, Spotify, device (haptics, sound, push, WebAuthn lock)
supabase/
  migrations/               schema, RLS, functions, storage + realtime policies
  functions/notify/         Edge Function: content-free Web Push
  tests/supabase_stubs.sql  auth/storage/realtime stand-ins for local SQL tests
public/sw.js                service worker (offline shell, push)
tests/unit/                 Vitest: crypto, scoring, EOD, time, wheel, theme, demo end-to-end
tests/sql/                  Vitest + pg: row-level security against real Postgres
tests/e2e/two-partners.mjs  Playwright: two partners, 18 checks
```

## Environment variables

See [`.env.example`](.env.example).

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web | Supabase project URL. Empty means demo mode. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Anon key. Safe in the browser: RLS plus ciphertext-only tables. |
| `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` | web | Spotify app Client ID (PKCE, no secret). Optional. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | web | Web Push public key. Optional. |
| `NEXT_PUBLIC_ENABLE_DEMO` | web | Show the two-tab demo entry (default `true`). |
| `WEBHOOK_SECRET` | Edge Function secret | Shared secret the Database Webhooks send. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Edge Function secrets | Web Push signing. Never in the web app. |
| `DATABASE_URL` | local only | Postgres for `npm run test:sql`. |

No LiveKit or WebRTC keys are needed: calls hand off to the phone's own dialer or FaceTime.

## Supabase setup

1. Create a project. In **Authentication → Providers**, keep Email on. In **Authentication → Email Templates → Magic Link**, include `{{ .Token }}` so users get a 6-digit code. Codes work better than links inside an installed PWA.
2. Apply the migrations, in order: `supabase db push` with the Supabase CLI, or paste each file from `supabase/migrations/` into the SQL editor. This creates the tables, RLS policies and functions, the private `media` storage bucket, Realtime publication entries, and the private-broadcast policies.
3. Put the URL and anon key in `.env.local`.
4. Optional, for push:
   ```bash
   npx web-push generate-vapid-keys
   supabase secrets set WEBHOOK_SECRET=<random> VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv> VAPID_SUBJECT=mailto:you@example.com
   supabase functions deploy notify --no-verify-jwt
   ```
   Then add three **Database Webhooks** (kisses INSERT, tasks UPDATE, daily_cycles UPDATE) that POST to the `notify` function with header `x-usmode-webhook-secret: <WEBHOOK_SECRET>`, and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. On iOS, push only works once the app is added to the Home Screen (iOS 16.4+).

## Spotify setup (optional)

Create an app at developer.spotify.com, add `https://<your-domain>/spotify-callback` (and your dev origin) as a Redirect URI, and set `NEXT_PUBLIC_SPOTIFY_CLIENT_ID`. Each partner connects their own account. Tokens stay in that phone's storage, and the "now playing" card is shared through the room as ciphertext. Spotify's API can't create a Jam, so you start one in Spotify and paste the invite link (only `open.spotify.com` / `spotify.link` links are accepted). "Queue" on a partner's request needs Spotify Premium and an active player. In development mode Spotify limits an app to a small allowlist of users; add both partners in the dashboard.

## Security model

**What the server never sees:** task titles, proof photos, kiss notes, room name, pet names, avatars, phone numbers, dares, posts, photos, voice notes, confessions, vault drops, the Spotify Jam link and the now-playing track. Each is AES-256-GCM with a fresh 96-bit IV, and the AAD binds it to its room and field (e.g. `room|task.title:<user>`), so ciphertext can't be moved between rows. Media is encrypted as bytes (`iv || ct`) before upload and decrypted into local `blob:` URLs. Photos are re-encoded through a canvas first, which also strips EXIF/GPS.

**What the server does see (needed to run the rules):** who is in the room, task counts and completion times, scores, winner/loser, battery level, status, timers, kiss style and count, sticker names, timestamps. Push notifications are generic ("💋 Incoming kiss") and contain no content.

**Pairing (strict 2-device lock):**
1. Partner A's phone makes an ECDH P-256 key pair (private key non-extractable), a 256-bit room key, an 8-character code (32-symbol alphabet with no 0/O/1/I; 40 bits) and a 128-bit link secret. PBKDF2-SHA256 (600,000 rounds) turns the code into 512 bits: the first half is the **lookup** sent to the server; the second half (**auth**) never leaves the phone.
2. Partner B enters the code or opens the QR link (`/pair#join=…&s=…`; the fragment never reaches the server). `join_room` locks the room at two members and burns the code in one transaction, rate-limited to 10 attempts per hour per account.
3. Both phones derive the handshake key as HKDF(ECDH secret, salt = SHA-256(auth ‖ link secret if QR), info = room + method). A seals the room key with it; B opens it, and the server deletes the envelope. If anyone in the middle swapped public keys, B's decryption fails loudly instead of trusting the wrong key.
4. Settings shows each device's fingerprint and a shared **safety number**; compare them once on a call. The QR path is the strongest (128-bit secret outside the server). The typed-code path relies on the 40-bit code and the 600k-round PBKDF2, which makes an offline guess slow and costly but not impossible for a well-funded attacker who also controls the server; comparing the safety number closes that gap.

**Keys at rest:** IndexedDB holds non-extractable `CryptoKey`s. The raw room key is kept only wrapped under a separate non-extractable device key, used solely for the handshake and the recovery kit. **Recovery kit:** the room key encrypted under PBKDF2-SHA256(passphrase, 600k), offered right after pairing and in Settings. **App lock:** an optional WebAuthn platform passkey (fingerprint / face / device PIN) that re-locks after 5 minutes in the background. It's a local gate; it doesn't add encryption.

**Server rules (RLS + SECURITY DEFINER functions):** every table is readable only by its room's two members; columns are granted one by one (clients can't touch `winner_user_id`, `seen_at`, `is_locked`, …). Scores and the reached-100 timestamp are computed by triggers. Completed tasks can't be un-ticked or deleted, closed days are frozen, only the loser can spin the dare (once), and only the recipient can catch a kiss. The **vault seal** and **mutual-reveal blur** are enforced on the server: the partner's device can't download those rows, or their media, until they unlock. Storage downloads follow row visibility. The Realtime broadcast channel `room:<id>` is private to the two members.

**Web app hardening:** strict CSP (only self, Supabase and Spotify hosts), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, a narrow Permissions-Policy. Decrypted text renders as plain React text (no HTML injection); only `https` links open, with `noopener noreferrer`; phone numbers and Spotify URLs are sanitised.

## Testing

```bash
npm run check        # typecheck + lint + unit tests
npm run test:sql     # RLS tests against a real Postgres (DATABASE_URL)
npm run test:e2e     # two partners in two tabs (needs a running app + Playwright)
```

- **Unit (48):** AES-GCM round trips, AAD binding, tamper detection, non-extractable keys, the full ECDH handshake (QR, typed code, swapped key, wrong code), the recovery kit, safety numbers, the 100-point split for 1–50 tasks, winner and draw rules, the EOD state machine, the weekly tally and streaks, time zones and DST, the cross-midnight window, Pomodoro sync, wheel physics, the M3 palette, and a demo-server run that checks no plaintext is stored.
- **SQL (35):** an outsider sees nothing; the room locks at two and the code burns; the guess rate limit; key envelope handover; column-level write limits; server-stamped first-to-100; frozen completed tasks and closed days; the mutual EOD (proposer can't confirm, not yet, nudge); dare once and loser only; kiss rules (partner's completed task only, one per task, recipient-only catch, no direct `seen_at`); vault seal and two-person early unlock; mutual reveal hidden until both write; burn after reading; storage paths and downloads following row visibility; private broadcast; private push subscriptions.
- **E2E (18 checks):** pairing over the typed code, matching safety numbers, encrypted config sync, the 33.3/33.3/33.4 split, the owed-kiss toast, the reopen pop-up with catch-once, OVERTAKE/winner, not-yet → confirm EOD, the dare wheel, the vault seal and early unlock, the flex post with a sticker, the mutual reveal, the call hand-off link. It passes against both `next dev` and `next start` with no browser errors.

## Design decisions and deviations from the brief

- **Calls hand off to the phone app** (per the owner's decision): `tel:` (FaceTime on Apple devices for video). No WebRTC, LiveKit or TURN. Silent Co-Work stays in-app.
- **Next.js 16** (App Router, Turbopack, Cache Components). Every screen is client-rendered because all its data is decrypted on the device. Instant-navigation validation is set to `manual-warning`, and the root opts out.
- **Spotify track metadata is encrypted** too (the brief allowed plaintext `current_track_meta`).
- **End-of-day fields live on `daily_cycles`** (not `rooms`), with extra `eod_nudged_at` / `eod_declined_*` columns for the nudge and "not yet".
- **Winner rules:** the first to have every task done (≥1 task) wins, by server timestamp. Adding a task afterwards drops you below 100 and clears your mark. If nobody reaches 100, or both do at the exact same instant, the day is a **draw** with no dare.
- **Completed tasks are final** (no un-ticking), so kiss debt and the race can't be gamed.
- **"Today"** for the kiss counter means since the current day (cycle) started, because days end by handshake rather than at midnight.
- **Hold-to-read confessions are text only**: you can't hold a card and tap play at the same time.
- **Vault unlock time** is computed by the server from the room's window in the time zone of whoever set it, so it lands correctly for partners in different time zones.

## Known limitations

- The Supabase, Spotify and Web Push pieces were built against those libraries' bundled type definitions and documentation. The Supabase project itself (Realtime, Storage, Edge Function, webhooks) hasn't been run live here; the SQL is tested on plain PostgreSQL 16 with Supabase stand-ins (`supabase/tests/supabase_stubs.sql`).
- Push needs the Edge Function and webhooks; without them, notifications are in-app (and local notifications while the app is open in the background).
- Recovering on a new phone needs the recovery kit; the safety number changes afterwards (by design).
- Decompression "ready" pings when either partner's app is open at that moment (there's no scheduled server job).
