export interface BackoffOptions {
  /** Initial delay in ms for attempt #1. Default 250. */
  baseMs?: number;
  /** Maximum delay in ms. Default 30_000. */
  maxMs?: number;
  /** Multiplier per attempt. Default 2. */
  factor?: number;
  /** Jitter mode. Default "full". */
  jitter?: "none" | "full" | "equal";
  /** Custom random source returning [0,1). Default Math.random. */
  random?: () => number;
}

/**
 * Compute an exponential-backoff delay (in ms) for a given attempt number.
 *
 * - `attempt` is 1-based: attempt=1 is the first retry.
 * - Output is clamped to `[0, maxMs]` (jitter never exceeds the cap).
 *
 * Jitter modes:
 *  - `none`:  delay = min(base * factor^(attempt-1), max)
 *  - `full`:  delay = random() * min(base * factor^(attempt-1), max)
 *  - `equal`: half deterministic + half random, capped
 */
export function backoff(attempt: number, opts: BackoffOptions = {}): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 0;
  const base = opts.baseMs ?? 250;
  const max = opts.maxMs ?? 30_000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? "full";
  const rand = opts.random ?? Math.random;
  const raw = base * Math.pow(factor, attempt - 1);
  const capped = Math.min(raw, max);
  if (jitter === "none") return Math.floor(capped);
  if (jitter === "full") return Math.floor(rand() * capped);
  // equal
  const half = capped / 2;
  return Math.floor(half + rand() * half);
}

/**
 * A stateful helper around `backoff()`. Tracks attempt count and exposes
 * `next()` / `reset()`.
 */
export class BackoffState {
  private attempt = 0;
  constructor(private readonly opts: BackoffOptions = {}) {}
  next(): number {
    this.attempt += 1;
    return backoff(this.attempt, this.opts);
  }
  reset(): void {
    this.attempt = 0;
  }
  get attempts(): number {
    return this.attempt;
  }
}

export type SequenceCheck =
  | { kind: "continuous"; prev: number; next: number }
  | { kind: "gap"; prev: number; next: number; missing: number }
  | { kind: "duplicate"; prev: number; next: number }
  | { kind: "rewind"; prev: number; next: number }
  | { kind: "reset"; prev: number; next: number };

export interface SequenceCheckOptions {
  /** Maximum legitimate sequence value before a server may roll over to 0/1. Default: Number.MAX_SAFE_INTEGER. */
  wrapAt?: number;
  /** When `next` is below `prev` by more than this fraction of `wrapAt`, treat as a server reset (start from 0/1). Default: 0.5. */
  resetThreshold?: number;
}

/**
 * Classify the relationship between two sequence numbers.
 *
 *  - `continuous`: next = prev + 1
 *  - `gap`:        next > prev + 1 (server may have dropped messages; resync)
 *  - `duplicate`:  next === prev (replay; safe to ignore)
 *  - `rewind`:     next < prev within a small window (likely server bug or out-of-order)
 *  - `reset`:      next < prev far below (server restarted, sequence reset)
 */
export function checkSequence(prev: number, next: number, opts: SequenceCheckOptions = {}): SequenceCheck {
  if (next === prev + 1) return { kind: "continuous", prev, next };
  if (next === prev) return { kind: "duplicate", prev, next };
  if (next > prev + 1) return { kind: "gap", prev, next, missing: next - prev - 1 };
  // next < prev
  const wrap = opts.wrapAt ?? Number.MAX_SAFE_INTEGER;
  const threshold = (opts.resetThreshold ?? 0.5) * wrap;
  if (prev - next > threshold) return { kind: "reset", prev, next };
  return { kind: "rewind", prev, next };
}

export interface CloseCodeInfo {
  code: number;
  name: string;
  description: string;
  /** Whether reconnection makes sense. False for hard policy/auth failures. */
  retriable: boolean;
}

/**
 * Look up a WebSocket close code (RFC 6455 + IANA registry). Returns a useful
 * default for unknown codes rather than throwing.
 */
export function describeCloseCode(code: number): CloseCodeInfo {
  switch (code) {
    case 1000: return { code, name: "NORMAL_CLOSURE", description: "normal closure", retriable: false };
    case 1001: return { code, name: "GOING_AWAY", description: "endpoint going away", retriable: true };
    case 1002: return { code, name: "PROTOCOL_ERROR", description: "protocol error", retriable: true };
    case 1003: return { code, name: "UNSUPPORTED_DATA", description: "unsupported data type", retriable: false };
    case 1005: return { code, name: "NO_STATUS", description: "no status code received", retriable: true };
    case 1006: return { code, name: "ABNORMAL_CLOSURE", description: "abnormal closure (no close frame)", retriable: true };
    case 1007: return { code, name: "INVALID_PAYLOAD", description: "invalid frame payload data", retriable: false };
    case 1008: return { code, name: "POLICY_VIOLATION", description: "policy violation", retriable: false };
    case 1009: return { code, name: "MESSAGE_TOO_BIG", description: "message too big", retriable: false };
    case 1010: return { code, name: "EXTENSION_MISSING", description: "required extension missing", retriable: false };
    case 1011: return { code, name: "INTERNAL_ERROR", description: "server internal error", retriable: true };
    case 1012: return { code, name: "SERVICE_RESTART", description: "service restart", retriable: true };
    case 1013: return { code, name: "TRY_AGAIN_LATER", description: "try again later", retriable: true };
    case 1014: return { code, name: "BAD_GATEWAY", description: "bad gateway", retriable: true };
    case 1015: return { code, name: "TLS_HANDSHAKE", description: "TLS handshake failure", retriable: true };
    case 4401: return { code, name: "UNAUTHORIZED", description: "application: unauthorized", retriable: false };
    case 4403: return { code, name: "FORBIDDEN", description: "application: forbidden", retriable: false };
    case 4408: return { code, name: "TIMEOUT", description: "application: timeout", retriable: true };
    case 4429: return { code, name: "RATE_LIMITED", description: "application: rate limited", retriable: true };
    default:
      if (code >= 4000 && code <= 4999) {
        return { code, name: "APPLICATION", description: "application-defined close code", retriable: true };
      }
      if (code >= 3000 && code <= 3999) {
        return { code, name: "REGISTERED", description: "registered library/framework code", retriable: true };
      }
      return { code, name: "UNKNOWN", description: "unknown close code", retriable: true };
  }
}
