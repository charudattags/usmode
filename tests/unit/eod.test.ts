import { describe, expect, it } from "vitest";
import { applyEod, weeklyTally, winStreak } from "@/engine/eod";

describe("mutual end-of-day handshake", () => {
  it("needs the other partner to confirm", () => {
    const p = applyEod({ status: "active", eodProposedBy: null }, { type: "propose", by: "a" });
    expect(p.ok && p.next).toEqual({ status: "eod_pending", eodProposedBy: "a" });
    if (!p.ok) throw new Error();
    expect(applyEod(p.next, { type: "confirm", by: "a" }).ok).toBe(false);
    const c = applyEod(p.next, { type: "confirm", by: "b" });
    expect(c.ok && c.closes).toBe(true);
  });
  it("can be cancelled by either partner", () => {
    const pending = { status: "eod_pending" as const, eodProposedBy: "a" };
    for (const by of ["a", "b"]) {
      const r = applyEod(pending, { type: "cancel", by });
      expect(r.ok && r.next.status).toBe("active");
    }
  });
  it("can't confirm without a proposal", () => {
    expect(applyEod({ status: "active", eodProposedBy: null }, { type: "confirm", by: "b" }).ok).toBe(false);
  });
});

describe("stats", () => {
  const cycles = [
    { cycleNumber: 1, closedAt: "2026-11-10T20:00:00Z", winnerUserId: "a", loserUserId: "b" },
    { cycleNumber: 2, closedAt: "2026-11-20T20:00:00Z", winnerUserId: "b", loserUserId: "a" },
    { cycleNumber: 3, closedAt: "2026-11-21T20:00:00Z", winnerUserId: null, loserUserId: null },
    { cycleNumber: 4, closedAt: "2026-11-22T20:00:00Z", winnerUserId: "a", loserUserId: "b" },
    { cycleNumber: 5, closedAt: "2026-11-23T20:00:00Z", winnerUserId: "a", loserUserId: "b" },
  ];
  it("weekly tally counts only the last 7 days", () => {
    const t = weeklyTally(cycles, new Date("2026-11-24T12:00:00Z"), ["a", "b"]);
    expect(t).toEqual({ wins: { a: 2, b: 1 }, draws: 1, days: 4 });
  });
  it("win streak counts back from the latest day", () => {
    expect(winStreak(cycles, "a")).toBe(2);
    expect(winStreak(cycles, "b")).toBe(0);
  });
});
