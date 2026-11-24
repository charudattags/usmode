/**
 * Public configuration only. NEXT_PUBLIC_* values ship to the browser, so only
 * the Supabase anon key (safe by design with RLS) and public client IDs belong here.
 */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  spotifyClientId: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  /** Show the "Try the two-tab demo" entry. On by default; set to "false" to hide in production. */
  demoEnabled: (process.env.NEXT_PUBLIC_ENABLE_DEMO ?? "true") !== "false",
};

export const supabaseConfigured = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);
