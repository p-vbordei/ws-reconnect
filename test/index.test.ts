import { describe, it, expect } from "vitest";
import { backoff, BackoffState, checkSequence, describeCloseCode } from "../src/index.js";

const fixed = (v: number) => () => v;

describe("backoff: deterministic (no jitter)", () => {
  it("doubles each attempt", () => {
    const o = { baseMs: 100, factor: 2, jitter: "none" as const };
    expect(backoff(1, o)).toBe(100);
    expect(backoff(2, o)).toBe(200);
    expect(backoff(3, o)).toBe(400);
    expect(backoff(4, o)).toBe(800);
  });

  it("clamps to maxMs", () => {
    const o = { baseMs: 100, factor: 2, maxMs: 500, jitter: "none" as const };
    expect(backoff(10, o)).toBe(500);
  });

  it("zero/negative attempt → 0", () => {
    expect(backoff(0)).toBe(0);
    expect(backoff(-1)).toBe(0);
  });
});

describe("backoff: full jitter", () => {
  it("bounded by capped raw", () => {
    const o = { baseMs: 100, factor: 2, maxMs: 1000, jitter: "full" as const };
    const max = backoff(2, { ...o, random: fixed(0.999999) });
    const min = backoff(2, { ...o, random: fixed(0) });
    expect(max).toBe(199); // floor(0.999999 * 200)
    expect(min).toBe(0);
  });

  it("never exceeds maxMs", () => {
    const o = { baseMs: 1000, factor: 10, maxMs: 5000, jitter: "full" as const, random: fixed(0.999999) };
    expect(backoff(10, o)).toBeLessThanOrEqual(5000);
  });
});

describe("backoff: equal jitter", () => {
  it("returns half + random*half", () => {
    const o = { baseMs: 200, factor: 2, jitter: "equal" as const, random: fixed(0) };
    expect(backoff(1, o)).toBe(100); // half of 200
    const o2 = { ...o, random: fixed(0.999999) };
    expect(backoff(1, o2)).toBe(199);
  });
});

describe("BackoffState", () => {
  it("increments attempt counter", () => {
    const s = new BackoffState({ baseMs: 100, factor: 2, jitter: "none" });
    expect(s.next()).toBe(100);
    expect(s.next()).toBe(200);
    expect(s.next()).toBe(400);
    expect(s.attempts).toBe(3);
    s.reset();
    expect(s.attempts).toBe(0);
    expect(s.next()).toBe(100);
  });
});

describe("checkSequence", () => {
  it("continuous", () => {
    expect(checkSequence(10, 11).kind).toBe("continuous");
  });
  it("gap", () => {
    const r = checkSequence(10, 15);
    expect(r.kind).toBe("gap");
    if (r.kind === "gap") expect(r.missing).toBe(4);
  });
  it("duplicate", () => {
    expect(checkSequence(10, 10).kind).toBe("duplicate");
  });
  it("rewind (small backwards step)", () => {
    expect(checkSequence(10, 8).kind).toBe("rewind");
  });
  it("reset (large backwards step exceeding threshold)", () => {
    const r = checkSequence(900, 5, { wrapAt: 1000, resetThreshold: 0.5 });
    expect(r.kind).toBe("reset");
  });
  it("rewind when below resetThreshold", () => {
    const r = checkSequence(600, 500, { wrapAt: 1000, resetThreshold: 0.5 });
    expect(r.kind).toBe("rewind");
  });
});

describe("describeCloseCode", () => {
  it.each([
    [1000, "NORMAL_CLOSURE", false],
    [1001, "GOING_AWAY", true],
    [1006, "ABNORMAL_CLOSURE", true],
    [1008, "POLICY_VIOLATION", false],
    [1011, "INTERNAL_ERROR", true],
    [1013, "TRY_AGAIN_LATER", true],
    [4401, "UNAUTHORIZED", false],
    [4429, "RATE_LIMITED", true],
  ])("%d → %s (retriable=%s)", (code, name, retriable) => {
    const info = describeCloseCode(code as number);
    expect(info.name).toBe(name);
    expect(info.retriable).toBe(retriable);
  });

  it("classifies unknown 4xxx as application code", () => {
    expect(describeCloseCode(4500).name).toBe("APPLICATION");
  });
  it("classifies unknown 3xxx as registered code", () => {
    expect(describeCloseCode(3001).name).toBe("REGISTERED");
  });
  it("classifies fully unknown codes", () => {
    expect(describeCloseCode(9999).name).toBe("UNKNOWN");
  });
});
