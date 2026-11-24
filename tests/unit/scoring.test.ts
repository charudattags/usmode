import { describe, expect, it } from "vitest";
import {
  dayVerdict,
  formatPoints,
  hasReached100,
  isOvertake,
  MAX_TASKS_PER_DAY,
  pointsFor,
  scoreTenths,
  taskWeightsTenths,
  weighTasks,
} from "@/engine/scoring";

const tasks = (n: number, done: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, isCompleted: done.includes(i) }));

describe("100-point engine", () => {
  it("always sums to exactly 100.0 for every task count", () => {
    for (let n = 1; n <= MAX_TASKS_PER_DAY; n++) {
      const w = taskWeightsTenths(n);
      expect(w).toHaveLength(n);
      expect(w.reduce((a, b) => a + b, 0)).toBe(1000);
      // Every task except the last is equal; the last takes the remainder.
      expect(new Set(w.slice(0, -1)).size).toBeLessThanOrEqual(1);
      expect(w[n - 1]).toBeGreaterThanOrEqual(w[0]);
    }
  });

  it("gives 3 tasks 33.3 / 33.3 / 33.4", () => {
    expect(taskWeightsTenths(3).map(formatPoints)).toEqual(["33.3", "33.3", "33.4"]);
  });

  it("gives 7 tasks 14.2 x6 and 14.8 last", () => {
    expect(taskWeightsTenths(7).map(formatPoints)).toEqual(["14.2", "14.2", "14.2", "14.2", "14.2", "14.2", "14.8"]);
  });

  it("rebalances when a task is added or removed", () => {
    expect(scoreTenths(tasks(2, [0]))).toBe(500);
    expect(scoreTenths(tasks(4, [0]))).toBe(250);
    expect(scoreTenths(tasks(1, [0]))).toBe(1000);
  });

  it("needs at least one task to reach 100", () => {
    expect(hasReached100([])).toBe(false);
    expect(hasReached100(tasks(3, [0, 1, 2]))).toBe(true);
    expect(hasReached100(tasks(3, [0, 1]))).toBe(false);
  });

  it("reports the points pill for a task", () => {
    expect(pointsFor(tasks(3), "t2")).toBe(334);
    expect(weighTasks(tasks(3))[0].weightTenths).toBe(333);
  });

  it("rejects silly task counts", () => {
    expect(() => taskWeightsTenths(MAX_TASKS_PER_DAY + 1)).toThrow();
    expect(() => taskWeightsTenths(-1)).toThrow();
    expect(taskWeightsTenths(0)).toEqual([]);
  });
});

describe("winner logic", () => {
  it("first to 100 wins, by exact timestamp", () => {
    const v = dayVerdict(
      { userId: "a", reachedAt: "2026-11-24T10:00:00.001Z" },
      { userId: "b", reachedAt: "2026-11-24T10:00:00.002Z" },
    );
    expect(v).toEqual({ kind: "winner", winnerUserId: "a", loserUserId: "b" });
  });
  it("only one reached 100", () => {
    expect(dayVerdict({ userId: "a", reachedAt: null }, { userId: "b", reachedAt: "2026-11-24T10:00:00Z" })).toEqual({
      kind: "winner",
      winnerUserId: "b",
      loserUserId: "a",
    });
  });
  it("draw when nobody reached 100 or exact tie", () => {
    expect(dayVerdict({ userId: "a", reachedAt: null }, { userId: "b", reachedAt: null })).toEqual({ kind: "draw" });
    const t = "2026-11-24T10:00:00Z";
    expect(dayVerdict({ userId: "a", reachedAt: t }, { userId: "b", reachedAt: t })).toEqual({ kind: "draw" });
  });
  it("detects an overtake", () => {
    expect(isOvertake(300, 500, 600, 500)).toBe(true);
    expect(isOvertake(600, 500, 700, 500)).toBe(false);
  });
});
