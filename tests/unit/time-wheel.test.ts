import { describe, expect, it } from "vitest";
import { backchodiWindow, formatCountdown, pomodoroPhase, tzOffsetMinutes, zonedWallTimeToUtc } from "@/engine/time";
import { segmentAt, simulateSpin } from "@/engine/wheel";

describe("time zones", () => {
  it("knows IST is +5:30 and handles New York DST", () => {
    expect(tzOffsetMinutes(new Date("2026-11-24T00:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(tzOffsetMinutes(new Date("2026-12-01T12:00:00Z"), "America/New_York")).toBe(-300);
  });
  it("converts wall time to UTC", () => {
    expect(zonedWallTimeToUtc(2026, 11, 24, 21, 0, "Asia/Kolkata").toISOString()).toBe("2026-11-24T15:30:00.000Z");
  });
});

describe("Backchodi window", () => {
  const tz = "Asia/Kolkata";
  it("is closed before 21:00 IST and opens at 21:00", () => {
    const w = backchodiWindow(new Date("2026-11-24T10:00:00Z"), "21:00", tz);
    expect(w.open).toBe(false);
    expect(w.opensAt.toISOString()).toBe("2026-11-24T15:30:00.000Z");
  });
  it("is open during the 2 hours", () => {
    const w = backchodiWindow(new Date("2026-11-24T16:00:00Z"), "21:00", tz);
    expect(w.open).toBe(true);
    expect(w.closesAt.toISOString()).toBe("2026-11-24T17:30:00.000Z");
  });
  it("a window that crosses midnight is still open after midnight", () => {
    const w = backchodiWindow(new Date("2026-11-24T18:45:00Z"), "23:30", tz); // 00:15 IST next day
    expect(w.open).toBe(true);
  });
  it("after the window, points to tomorrow", () => {
    const w = backchodiWindow(new Date("2026-11-24T18:00:00Z"), "21:00", tz);
    expect(w.open).toBe(false);
    expect(w.opensAt.toISOString()).toBe("2026-11-25T15:30:00.000Z");
  });
});

describe("countdowns and pomodoro", () => {
  it("formats", () => {
    expect(formatCountdown(3_900_000)).toBe("1h 05m");
    expect(formatCountdown(249_000)).toBe("4m 09s");
  });
  it("derives the same phase on both phones", () => {
    const start = new Date("2026-11-24T10:00:00Z");
    expect(pomodoroPhase(start, new Date("2026-11-24T10:10:00Z"), { focusMin: 25, breakMin: 5 })).toMatchObject({ phase: "focus", round: 1 });
    expect(pomodoroPhase(start, new Date("2026-11-24T10:27:00Z"), { focusMin: 25, breakMin: 5 })).toMatchObject({ phase: "break", round: 1 });
    expect(pomodoroPhase(start, new Date("2026-11-24T10:31:00Z"), { focusMin: 25, breakMin: 5 })).toMatchObject({ phase: "focus", round: 2 });
  });
});

describe("dare wheel", () => {
  it("decelerates to a stop and lands on a valid segment", () => {
    const r = simulateSpin(18, { segments: 6 });
    expect(r.seconds).toBeGreaterThan(1);
    expect(r.seconds).toBeLessThan(20);
    expect(r.ticks).toBeGreaterThan(6);
    expect(r.segment).toBeGreaterThanOrEqual(0);
    expect(r.segment).toBeLessThan(6);
  });
  it("maps angles to the segment under the top pointer", () => {
    const seg = (Math.PI * 2) / 4;
    expect(segmentAt(0.01, 4)).toBe(3); // a tiny clockwise turn brings the last segment under the pointer
    expect(segmentAt(seg * 4 - 0.01, 4)).toBe(0);
  });
});
