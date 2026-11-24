/**
 * End-of-day handshake rules and post-day stats. Pure, dates passed in.
 * The server runs the same state machine atomically (see the migration's
 * propose_eod / confirm_eod / cancel_eod functions).
 */

export type CycleStatus = "active" | "eod_pending" | "closed";

export interface CycleState {
  status: CycleStatus;
  eodProposedBy: string | null;
}

export type EodAction =
  | { type: "propose"; by: string }
  | { type: "confirm"; by: string }
  | { type: "cancel"; by: string };

export type EodResult = { ok: true; next: CycleState; closes: boolean } | { ok: false; reason: string };

export function applyEod(state: CycleState, action: EodAction): EodResult {
  switch (action.type) {
    case "propose":
      if (state.status !== "active") return { ok: false, reason: "The day isn't open" };
      return { ok: true, closes: false, next: { status: "eod_pending", eodProposedBy: action.by } };
    case "confirm":
      if (state.status !== "eod_pending") return { ok: false, reason: "Nobody has proposed ending the day" };
      if (state.eodProposedBy === action.by) return { ok: false, reason: "Your partner has to confirm" };
      return { ok: true, closes: true, next: { status: "closed", eodProposedBy: state.eodProposedBy } };
    case "cancel":
      if (state.status !== "eod_pending") return { ok: false, reason: "Nothing to cancel" };
      return { ok: true, closes: false, next: { status: "active", eodProposedBy: null } };
  }
}

export interface ClosedCycleSummary {
  cycleNumber: number;
  closedAt: string;
  winnerUserId: string | null;
  loserUserId: string | null;
}

/** Wins per partner over the cycles closed in the last 7 days. */
export function weeklyTally(
  cycles: readonly ClosedCycleSummary[],
  now: Date,
  userIds: readonly [string, string],
): { wins: Record<string, number>; draws: number; days: number } {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const wins: Record<string, number> = { [userIds[0]]: 0, [userIds[1]]: 0 };
  let draws = 0;
  let days = 0;
  for (const c of cycles) {
    if (Date.parse(c.closedAt) < since) continue;
    days++;
    if (c.winnerUserId && c.winnerUserId in wins) wins[c.winnerUserId]++;
    else draws++;
  }
  return { wins, draws, days };
}

/** Consecutive wins ending at the most recently closed day. */
export function winStreak(cycles: readonly ClosedCycleSummary[], userId: string): number {
  const sorted = [...cycles].sort((a, b) => b.cycleNumber - a.cycleNumber);
  let n = 0;
  for (const c of sorted) {
    if (c.winnerUserId === userId) n++;
    else break;
  }
  return n;
}

export function allTimeWins(cycles: readonly ClosedCycleSummary[], userId: string): number {
  return cycles.filter((c) => c.winnerUserId === userId).length;
}
