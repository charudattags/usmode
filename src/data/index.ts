import { env, supabaseConfigured } from "@/lib/env";
import type { Backend } from "./backend";
import { DemoBackend } from "./demo/backend";
import { SupabaseBackend } from "./supabase/backend";

let demo: DemoBackend | null = null;
let live: SupabaseBackend | null = null;

export type Mode = "demo" | "live";

const MODE_KEY = "usmode-mode";

/** Live when Supabase is configured and the user didn't pick the demo in this tab. */
export function currentMode(): Mode {
  if (typeof window === "undefined") return "live";
  const v = sessionStorage.getItem(MODE_KEY);
  if (v === "demo" && env.demoEnabled) return "demo";
  if (!supabaseConfigured()) return "demo";
  return "live";
}

export function setMode(mode: Mode) {
  sessionStorage.setItem(MODE_KEY, mode);
}

export function getBackend(): Backend {
  if (currentMode() === "demo") return (demo ??= new DemoBackend());
  return (live ??= new SupabaseBackend(env.supabaseUrl, env.supabaseAnonKey));
}

export function getDemoBackend(): DemoBackend {
  return (demo ??= new DemoBackend());
}
