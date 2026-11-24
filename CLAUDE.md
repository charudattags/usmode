# USMODE

Private, end-to-end encrypted PWA for exactly two partners. Read README.md first (features, security model, decisions).

## Stack
Next.js 16 (App Router, Turbopack, Cache Components) + TypeScript strict, Tailwind v4, framer-motion, GSAP, canvas-confetti,
@material/material-color-utilities, Supabase (Postgres + RLS, Auth email OTP, Realtime, Storage, Edge Functions), Web Crypto only.
Next 16 differs from older versions: read `node_modules/next/dist/docs/` before changing framework-level code (see AGENTS.md).

## Rules (don't break)
- Anything personal is encrypted on the device before it leaves (`src/crypto/e2ee.ts`, AAD helpers in `src/state/RoomProvider.tsx`). The server only gets ciphertext.
- New table → `room_id`, RLS limited to the room's members, column-level grants, and a test in `tests/sql/rls.test.ts`.
- Rule changes go in **both** the SQL migration and `src/data/demo/server.ts`, so the demo behaves like production.
- `src/engine/` is pure: no UI imports, no `Date.now()`; pass `now` in.
- Calls hand off to the phone (`tel:` / FaceTime). No in-app WebRTC.
- Push payloads and logs never contain content, names or ids.

## Commands
`npm run dev` · `npm run check` (typecheck + lint + unit) · `npm run test:sql` (needs DATABASE_URL) · `npm run test:e2e` (needs a running app) · `npm run build`
