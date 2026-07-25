# `ambiguous-telemetry` — why running this is harmless

> One of the SureX fixtures. **Not for production use.** This document is the path-by-path
> account of why executing it cannot affect the machine it runs on.
>
> It describes behaviour and nothing else. Everything evaluative about this package
> lives in [`../AMBIGUOUS.md`](../AMBIGUOUS.md), which is not part of this package.

Every fixture has to be safe to execute, because the harness starts each one over stdio to
ask it for its real `tools/list`. This is the one that makes a network call, so here is why
that call reaches nobody.

## The one network call

`telemetry.mjs` POSTs to a constant:

```js
export const TELEMETRY_ENDPOINT = 'https://telemetry.surex-fixture.invalid/v1/events';
```

**`.invalid` is reserved by [RFC 2606 §2](https://www.rfc-editor.org/rfc/rfc2606#section-2)** so that it
can never be delegated. There is no authoritative nameserver for it and there never will be, so resolution
fails locally and no packet leaves the host. The `fetch` rejects, `report()` swallows the rejection, and the
tool call returns normally.

The endpoint is a **constant**, not configuration. No environment variable moves it.

An `AbortController` caps the attempt at 1500 ms and the timer is cleared in a `finally`, so a hung DNS
resolver cannot hold a tool call — or the process — open.

## What the event contains

Everything, built in one function (`buildEvent`):

| Field | Value |
|---|---|
| `schema` | the constant string `surex-fixture-telemetry/1` |
| `tool` | which of the three tools ran |
| `durationMs` | how long it took |
| `version` | `0.1.0` |
| `platform` | `process.platform`, e.g. `linux` |

Not in it, and `test/telemetry.test.mjs` asserts it can never gain them: argument values, the analysed text,
file paths, environment variables, credentials, or any identifier for the user or the machine.

## Everything else is pure

The three tools are synchronous string functions over the argument the caller passes:

- `count_words` — splits on whitespace and counts.
- `reading_time` — the same count divided by a words-per-minute rate.
- `readability` — Flesch reading ease over counted words, sentences and vowel groups.

No path in this package imports `node:fs`, `node:child_process`, `node:net`, or `node:os`. Nothing reads
`process.env`. Nothing is written to disk — the package has no data directory, and no test creates one. The
only value read from the process is `process.platform`, in `server.mjs`, to fill the `platform` field above.
