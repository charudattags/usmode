/**
 * Time helpers for the Backchodi window and countdowns. Pure: `now` is always passed in.
 * The window is stored as a wall-clock start time ("21:00") in the IANA time
 * zone of whoever set it, so it lands at the right moment for both partners
 * even when they live in different zones.
 */

export const BACKCHODI_MINUTES = 120;
export const DECOMPRESSION_MINUTES = 30;

/** Offset of `tz` from UTC at instant `at`, in minutes (e.g. +330 for Asia/Kolkata). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Calendar date (y, m, d) of instant `at` as seen in `tz`. */
export function zonedDate(at: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n("year"), m: n("month"), d: n("day") };
}

/** UTC instant for wall time y-m-d hh:mm in `tz`. Handles DST by re-checking the offset. */
export function zonedWallTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off) {
    off = off2;
    t = guess - off * 60000;
  }
  return new Date(t);
}

export function parseHHMM(s: string): { hh: number; mm: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? { hh: Number(m[1]), mm: Number(m[2]) } : null;
}

export interface WindowState {
  open: boolean;
  /** Start of the current window if open, otherwise the next one. */
  opensAt: Date;
  closesAt: Date;
}

export function backchodiWindow(now: Date, startHHMM: string, tz: string, minutes = BACKCHODI_MINUTES): WindowState {
  const hm = parseHHMM(startHHMM) ?? { hh: 21, mm: 0 };
  const today = zonedDate(now, tz);
  // Check yesterday's window (it may run past midnight), today's, then tomorrow's.
  for (const dayShift of [-1, 0, 1]) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayShift));
    const start = zonedWallTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hm.hh, hm.mm, tz);
    const end = new Date(start.getTime() + minutes * 60000);
    if (now < end) return { open: now >= start, opensAt: start, closesAt: end };
  }
  // Unreachable: tomorrow's window always ends after now.
  throw new Error("Could not compute window");
}

/** "1h 05m", "4m 09s", "0s". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Shared Pomodoro: both phones derive the phase from the same start instant. */
export interface PomodoroConfig {
  focusMin: number;
  breakMin: number;
}

export function pomodoroPhase(startedAt: Date, now: Date, cfg: PomodoroConfig): { phase: "focus" | "break"; round: number; remainingMs: number } {
  const focus = cfg.focusMin * 60000;
  const brk = cfg.breakMin * 60000;
  const cycle = focus + brk;
  const elapsed = Math.max(0, now.getTime() - startedAt.getTime());
  const round = Math.floor(elapsed / cycle) + 1;
  const inCycle = elapsed % cycle;
  return inCycle < focus
    ? { phase: "focus", round, remainingMs: focus - inCycle }
    : { phase: "break", round, remainingMs: cycle - inCycle };
}
