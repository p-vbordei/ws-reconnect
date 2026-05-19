# ws-reconnect

[![ci](https://github.com/p-vbordei/ws-reconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/ws-reconnect/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/%40p-vbordei%2Fws-reconnect.svg)](https://www.npmjs.com/package/@p-vbordei/ws-reconnect)
[![downloads](https://img.shields.io/npm/dm/%40p-vbordei%2Fws-reconnect.svg)](https://www.npmjs.com/package/@p-vbordei/ws-reconnect)
[![bundle](https://img.shields.io/bundlejs/size/%40p-vbordei%2Fws-reconnect)](https://bundlejs.com/?q=%40p-vbordei%2Fws-reconnect)

> Three small, framework-agnostic helpers for building robust WebSocket clients. No `WebSocket` implementation included — bring your own. These are the pieces around it.

```ts
import { backoff, BackoffState, checkSequence, describeCloseCode } from "@p-vbordei/ws-reconnect";

const state = new BackoffState({ baseMs: 250, maxMs: 30_000 });
ws.addEventListener("open",  () => state.reset());
ws.addEventListener("close", () => setTimeout(reconnect, state.next()));

const r = checkSequence(prevSeq, msg.seq);
if (r.kind === "gap")   triggerResync(r.missing);
if (r.kind === "reset") clearLocalCache();

const info = describeCloseCode(event.code);
if (!info.retriable) abort();
```

## Install

```sh
npm install @p-vbordei/ws-reconnect
```

Works with Node 20+, browsers, Bun, Deno. ESM + CJS.

## Why

Every WebSocket client needs the same three pieces:

1. **Exponential backoff with jitter** so clients don't all reconnect at the same moment after an outage.
2. **Sequence-gap detection** to know when the server dropped messages and you need to resync.
3. **Close-code interpretation** so you don't retry forever after a 4401 unauthorized.

These never live well inside the socket class — they want unit tests, injectable clocks, and to be shared across web/Node clients. Easier to pull them out.

## Recipes

### Reconnecting WebSocket client (browser)

```ts
import { BackoffState, describeCloseCode } from "@p-vbordei/ws-reconnect";

class ReconnectingWS {
  private ws?: WebSocket;
  private state = new BackoffState({ baseMs: 250, maxMs: 30_000 });

  constructor(private url: string) { this.connect(); }

  private connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open",  () => this.state.reset());
    this.ws.addEventListener("close", (e) => {
      const info = describeCloseCode(e.code);
      if (info.retriable) {
        setTimeout(() => this.connect(), this.state.next());
      } else {
        console.warn(`won't retry: ${info.name} - ${info.description}`);
      }
    });
  }

  send(data: string) { this.ws?.send(data); }
  close() { this.ws?.close(1000, "client closing"); }
}
```

### Resync on detected gap

```ts
import { checkSequence } from "@p-vbordei/ws-reconnect";

let lastSeq = 0;

ws.onmessage = async (e) => {
  const msg = JSON.parse(e.data);
  const r = checkSequence(lastSeq, msg.seq);

  if (r.kind === "gap") {
    console.warn(`missed ${r.missing} messages, resyncing`);
    await fetchSinceSeq(lastSeq);
  } else if (r.kind === "reset") {
    console.warn("server restarted, clearing cache");
    cache.clear();
  } else if (r.kind === "duplicate") {
    return;  // ignore replays
  }

  lastSeq = msg.seq;
  handle(msg);
};
```

### Tune backoff for fast vs slow services

```ts
import { backoff } from "@p-vbordei/ws-reconnect";

// Real-time game client: reconnect fast
backoff(attempt, { baseMs: 100, maxMs: 2_000, jitter: "equal" });

// Analytics WebSocket: reconnect slow, don't hammer
backoff(attempt, { baseMs: 1_000, maxMs: 60_000, jitter: "full" });
```

### Detect rate-limit close codes

```ts
import { describeCloseCode } from "@p-vbordei/ws-reconnect";

ws.addEventListener("close", (e) => {
  const info = describeCloseCode(e.code);
  if (info.code === 4429) {
    setTimeout(connect, 60_000);  // back off aggressively
  }
});
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

## Caveats

- **Pure helpers — no WebSocket impl.** Bring your own (`WebSocket`, `ws`, `partysocket`, etc.).
- **No heartbeat helper.** Some servers expect periodic pings to keep the connection alive — add your own `setInterval` ping; that's app-specific.

## License

Apache-2.0 © Vlad Bordei
