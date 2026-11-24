/**
 * The 100-point daily race. Pure functions, no clocks, no UI.
 *
 * All maths is done in integer tenths of a point (1000 tenths = 100 points),
 * so totals are exact. With N tasks each task is worth floor(1000/N) tenths and
 * the final task takes whatever is left, so the sum is always exactly 100.0.
 */

export const DAILY_BUDGET_TENTHS = 1000;
/** Above 1000 tasks a task would be worth 0.0; keep it humane. */
export const MAX_TASKS_PER_DAY = 50;

export function taskWeightsTenths(n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new Error("Task count must be a non-negative integer");
  if (n === 0) return [];
  if (n > MAX_TASKS_PER_DAY) throw new Error(`At most ${MAX_TASKS_PER_DAY} tasks a day`);
  const base = Math.floor(DAILY_BUDGET_TENTHS / n);
  const weights = new Array<number>(n).fill(base);
  weights[n - 1] = DAILY_BUDGET_TENTHS - base * (n - 1);
  return weights;
}

export interface ScorableTask {
  id: string;
  isCompleted: boolean;
}

export type Weighted<T> = T & { weightTenths: number };

/** Tasks must already be in display order (oldest first). */
export function weighTasks<T extends ScorableTask>(tasks: readonly T[]): Weighted<T>[] {
  const w = taskWeightsTenths(tasks.length);
  return tasks.map((t, i) => ({ ...t, weightTenths: w[i] }));
}

export function scoreTenths(tasks: readonly ScorableTask[]): number {
  return weighTasks(tasks).reduce((s, t) => s + (t.isCompleted ? t.weightTenths : 0), 0);
}

/** 100/100 needs at least one task, all complete. */
export function hasReached100(tasks: readonly ScorableTask[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.isCompleted);
}

export function formatPoints(tenths: number): string {
  const sign = tenths < 0 ? "-" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}`;
}

/** Points a task is worth right now (what the "+XX.X PTS" pill shows). */
export function pointsFor(tasks: readonly ScorableTask[], taskId: string): number {
  return weighTasks(tasks).find((t) => t.id === taskId)?.weightTenths ?? 0;
}

export interface RaceProgress {
  userId: string;
  /** Server timestamp of the moment this partner last reached 100/100, or null. */
  reachedAt: string | null;
}

export type Verdict =
  | { kind: "winner"; winnerUserId: string; loserUserId: string }
  | { kind: "draw" };

/**
 * First to 100 wins. Exact timestamp ties, or nobody reaching 100, are a draw
 * (no dare that day).
 */
export function dayVerdict(a: RaceProgress, b: RaceProgress): Verdict {
  const ta = a.reachedAt ? Date.parse(a.reachedAt) : null;
  const tb = b.reachedAt ? Date.parse(b.reachedAt) : null;
  if (ta === null && tb === null) return { kind: "draw" };
  if (ta !== null && (tb === null || ta < tb)) return { kind: "winner", winnerUserId: a.userId, loserUserId: b.userId };
  if (tb !== null && (ta === null || tb < ta)) return { kind: "winner", winnerUserId: b.userId, loserUserId: a.userId };
  return { kind: "draw" };
}

/** The provisional winner while the day is still open. */
export function provisionalWinner(a: RaceProgress, b: RaceProgress): string | null {
  const v = dayVerdict(a, b);
  return v.kind === "winner" ? v.winnerUserId : null;
}

/** True when `me` just went ahead of `them` (drives the OVERTAKE! banner). */
export function isOvertake(prevMine: number, prevTheirs: number, nextMine: number, nextTheirs: number): boolean {
  return prevMine <= prevTheirs && nextMine > nextTheirs;
}
