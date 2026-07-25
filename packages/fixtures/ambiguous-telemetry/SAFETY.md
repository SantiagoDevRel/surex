# `ambiguous-telemetry` — why running this is harmless

> One of the SureX review fixtures. **Not for production use.** This document is the
> path-by-path account of why executing it cannot affect the machine it runs on. The
> argument for what its verdict *should* be lives in [`../AMBIGUOUS.md`](../AMBIGUOUS.md).

The reviewer runs a candidate server to obtain its real `tools/list`, so every fixture
has to be safe to execute. This one is the awkward case: it is the fixture whose whole
point is that it makes a network call. Here is why that call reaches nobody.

## The one network call

`telemetry.mjs` POSTs to a constant:

```js
export const TELEMETRY_ENDPOINT = 'https://telemetry.surex-fixture.invalid/v1/events';
```

**`.invalid` is reserved by [RFC 2606 §2](https://www.rfc-editor.org/rfc/rfc2606#section-2)**
precisely so that it can never be delegated. There is no authoritative nameserver for it
and there never will be, so resolution fails locally and no packet leaves the host. The
`fetch` rejects, `report()` swallows the rejection, and the tool call returns normally.

This is deliberate, and it is the only concession the fixture makes to being safe:

- The endpoint is a **constant**, not configuration. It cannot be pointed somewhere real
  by an environment variable, which is what separates this fixture from
  `ambiguous-broad`, where an unbounded destination is the argument.
- It is still a **genuine, undeclared outbound POST in the source**. A reviewer reading
  the code sees exactly the finding it is meant to see. Nothing about the reserved TLD
  makes the mismatch between the tool descriptions and the code any smaller.

An `AbortController` caps the attempt at 1500 ms and the timer is cleared in a
`finally`, so a hung DNS resolver cannot hold a tool call — or the process — open.

## What the event contains

Everything, in one function (`buildEvent`):

| Field | Value |
|---|---|
| `schema` | the constant string `surex-fixture-telemetry/1` |
| `tool` | which of the three tools ran |
| `durationMs` | how long it took |
| `version` | `0.1.0` |
| `platform` | `process.platform`, e.g. `linux` |

What it does **not** contain, and what `test/telemetry.test.mjs` asserts it never gains:
no argument values, no analysed text, no file paths, no environment variables, no
credentials, and no identifier for the user or the machine. The event says a tool ran.
It does not say what it ran on, or who ran it.

## Everything else is pure

The three tools are synchronous string functions over the argument the caller passes:

- `count_words` — splits on whitespace and counts.
- `reading_time` — the same count divided by a words-per-minute rate.
- `readability` — Flesch reading ease over counted words, sentences and vowel groups.

No path in this package imports `node:fs`, `node:child_process`, `node:net`, or
`node:os`. Nothing reads `process.env`. Nothing is written to disk — the package has no
data directory, and no test creates one. The only value read from the process is
`process.platform`, in `server.mjs`, to fill the `platform` field above.

## Capability surface a scanner should report

```
network     telemetry.mjs:62  fetch()
filesystem, exec, env, credentials: absent
```

`network` present on a server whose every tool description reads purely local **is the
finding**. It is supposed to be visible.
