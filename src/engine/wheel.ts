/**
 * Dare-wheel physics. Pure integrator so the animation and the result use the
 * same maths. Angles in radians, 0 = segment 0 starts at the pointer (top) and
 * the wheel spins clockwise.
 */

export interface WheelState {
  angle: number;
  omega: number; // rad/s
  /** Index of the last peg that passed the pointer, for tick sounds. */
  lastPeg: number;
}

export interface WheelOptions {
  segments: number;
  /** Constant friction, rad/s^2. */
  friction?: number;
  /** Fraction of speed kept every time a peg hits the flipper. */
  pegRestitution?: number;
  /** Below this the wheel is considered stopped. */
  stopOmega?: number;
}

const TAU = Math.PI * 2;

export function pegIndex(angle: number, segments: number): number {
  return Math.floor(angle / (TAU / segments));
}

/** Advance by dt seconds. Returns the new state and how many pegs ticked. */
export function stepWheel(s: WheelState, dt: number, o: WheelOptions): { state: WheelState; ticks: number } {
  const friction = o.friction ?? 1.6;
  const rest = o.pegRestitution ?? 0.985;
  const stop = o.stopOmega ?? 0.05;
  if (s.omega <= stop) return { state: { ...s, omega: 0 }, ticks: 0 };
  let omega = Math.max(0, s.omega - friction * dt);
  const angle = s.angle + omega * dt;
  const peg = pegIndex(angle, o.segments);
  const ticks = Math.max(0, peg - s.lastPeg);
  for (let i = 0; i < ticks; i++) omega *= rest;
  if (omega <= stop) omega = 0;
  return { state: { angle, omega, lastPeg: peg }, ticks };
}

/** The segment under the pointer for a wheel rotated by `angle`. */
export function segmentAt(angle: number, segments: number): number {
  const seg = TAU / segments;
  // Rotating the wheel clockwise by `angle` brings the segment at -angle to the top.
  const a = (((-angle) % TAU) + TAU) % TAU;
  return Math.floor(a / seg) % segments;
}

/** Run to rest with a fixed step. Used for tests and to pre-compute the result. */
export function simulateSpin(omega0: number, o: WheelOptions, dt = 1 / 120): { finalAngle: number; segment: number; ticks: number; seconds: number } {
  let state: WheelState = { angle: 0, omega: omega0, lastPeg: 0 };
  let ticks = 0;
  let t = 0;
  while (state.omega > 0 && t < 60) {
    const r = stepWheel(state, dt, o);
    state = r.state;
    ticks += r.ticks;
    t += dt;
  }
  return { finalAngle: state.angle, segment: segmentAt(state.angle, o.segments), ticks, seconds: t };
}

/** Unbiased random launch speed from Web Crypto. */
export function randomLaunchOmega(min = 14, max = 24): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] / 0x1_0000_0000) * (max - min);
}
