# ws-reconnect

[![ci](https://github.com/p-vbordei/ws-reconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/ws-reconnect/actions/workflows/ci.yml)

Three small, framework-agnostic helpers for building robust WebSocket clients. No `WebSocket` implementation included — bring your own. These are the pieces around it.

```ts
import { backoff, BackoffState, checkSequence, describeCloseCode } from "@p-vbordei/ws-reconnect";

// 1. Compute next reconnect delay
const ms = backoff(attempt, { baseMs: 250, maxMs: 30_000, jitter: "full" });

// 2. Or use the stateful helper
const state = new BackoffState({ baseMs: 250, maxMs: 30_000 });
ws.addEventListener("open",  () => state.reset());
ws.addEventListener("close", () => setTimeout(reconnect, state.next()));

// 3. Detect gaps in a server-sequenced message stream
const r = checkSequence(prevSeq, msg.seq);
if (r.kind === "gap")   triggerResync(r.missing);
if (r.kind === "reset") clearLocalCache();

// 4. Decide whether to retry from a close code
const info = describeCloseCode(event.code);
if (!info.retriable) abort();
```

## Install

```sh
npm install @p-vbordei/ws-reconnect
```

## API

### `backoff(attempt, opts?): number`

Returns the delay (ms) for a 1-based attempt number. Clamped to `maxMs`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `baseMs` | `number` | `250` | Delay for attempt #1 (no jitter) |
| `maxMs` | `number` | `30000` | Cap |
| `factor` | `number` | `2` | Multiplier per attempt |
| `jitter` | `"none" \| "full" \| "equal"` | `"full"` | See below |
| `random` | `() => number` | `Math.random` | Injectable for tests |

Jitter strategies:
- `none` — deterministic exponential
- `full` — `random() * cappedExponential` (recommended; avoids reconnect stampedes)
- `equal` — `half + random() * half`

### `class BackoffState(opts?)`

```ts
state.next()    // returns delay AND increments the internal attempt counter
state.reset()   // back to zero
state.attempts  // current count
```

### `checkSequence(prev, next, opts?): SequenceCheck`

Classifies the relationship between two sequence numbers:

| `kind` | Meaning |
|---|---|
| `continuous` | `next === prev + 1` (happy path) |
| `gap` | `next > prev + 1` — server may have dropped messages; trigger resync. Includes `missing: number`. |
| `duplicate` | `next === prev` — replay, safe to ignore |
| `rewind` | `next < prev` by a small amount — likely server bug or out-of-order |
| `reset` | `next < prev` by more than `resetThreshold * wrapAt` — server restarted |

| Option | Type | Default |
|---|---|---|
| `wrapAt` | `number` | `Number.MAX_SAFE_INTEGER` |
| `resetThreshold` | `number` | `0.5` |

### `describeCloseCode(code): CloseCodeInfo`

Returns `{ code, name, description, retriable }`. Covers all standard RFC 6455 codes (1000–1015) plus common application codes (4401 unauthorized, 4429 rate-limited, ...). Unknown codes return a sensible default rather than throwing.

## Why these three?

Every WebSocket client I've written needs the same three pieces. They never live well inside the socket class itself — they want unit tests, they want injection-friendly clocks, they want to be shared across both web and Node clients. Easier to pull them out.

## License

Apache-2.0 © Vlad Bordei
