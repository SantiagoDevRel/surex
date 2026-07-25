# `@surex/worker` — the write path

This package **writes**. It never serves reads.

`apps/api` holds no wallet and neither does the gate, so compromising either cannot rewrite the registry.
Only this wallet's writes are trusted, and **every consumer read filters on it with `.createdBy`** — never
`ownedBy`, because ownership is transferable via `changeOwnership` and would be attacker-influenceable.

Repo rules live in [`../../AGENTS.md`](../../AGENTS.md); §7 there is the measured-facts list and beats any
doc or SDK README. Everything below is specific to this package.

## Layout

| File | What it owns |
|---|---|
| `src/config.mjs` | project attribute, chain constants, expirations, key loading |
| `src/walrus.mjs` | standalone certified blobs, and quilts, with both Sui digests captured |
| `src/arkiv.mjs` | batched entity writes, full-replacement updates, scoped read-back, pagination |
| `src/entities.mjs` | the five entities of tech spec §4.1, and the invariants the SDK will not enforce |
| `src/licence.mjs` | the licence gate (FR-16) |
| `src/registry.mjs` | official MCP Registry crawl → SXF-1 fingerprintable candidates |
| `src/progress.mjs` | the resumable seed checkpoint |
| `bin/balances.mjs` | preflight. Run it before any seed |

## Commands

```bash
node packages/worker/bin/balances.mjs      # SUI / WAL / GLM, epoch ceiling, shard count
node --test packages/worker/test/*.test.mjs

node scripts/seed.mjs --dry-run            # crawl + licence gate + fingerprints, writes nothing
node scripts/seed.mjs --target 50          # seed; resumes automatically if a checkpoint exists
node scripts/seed.mjs --verify             # re-read from chain AND follow every evidence pointer
node scripts/seed.mjs --repair-pointers    # re-derive quilt patch ids from the certified quilt
node scripts/seed.mjs --reset              # discard the checkpoint and start over
```

## Keys — what to give it, and where they must live

Nothing secret enters this repo. Both keys come from the environment first, and fall back to files
outside it.

| Env var | Falls back to | Address it must be |
|---|---|---|
| `SUREX_SUI_SECRET` | `[sui-testnet]` in `claude-code-environment/.secrets/surex-wallets.txt` | `0x79d8e806…c479ff35` |
| `ARKIV_WRITER_PK` | index **2** (1-based) of `golem-project/tooling/hackathon-wallets/wallets.json` | `0xBD33E185…d0015e6` |

Both writers **assert their own address on construction**. Writing the registry from any other address is
not an error the SDK will report — every consumer read is `.createdBy`-scoped, so it succeeds and is
invisible. That looks exactly like a working seed.

> Do **not** reach for the `[arkiv-writer]` entry in `.secrets/surex-wallets.txt`: it has a zero balance.

Optional: `SUREX_ARKIV_PROJECT` (defaults to `surex-lisbon`, and must match `apps/api`'s
`DEFAULT_PROJECT`), `ARKIV_RPC_URL`, `SUREX_SUI_FULLNODE`.

## Invariants — the things that fail silently if you break them

1. **A seeded head is `unknown`, never `clean`.** `buildVerdictHead` throws on `clean` without a
   `latestReviewKey`. An entry nobody has read the code of must not be the reason someone installs it.
2. **Every entity carries the project attribute.** `updateEntity` is a full replacement, so dropping it on
   a rewrite makes the entity vanish from every scoped query while still existing on chain. `buildUpdate`
   refuses to emit one without it.
3. **Numeric attributes must be integers** — and they are *asserted*, not truncated. Truncating a severity
   of 1.5 to 1 would quietly move it a band below what the caller meant, and the gate's block threshold
   reads that number. Timestamps are epoch **milliseconds** (verified to round-trip exactly on Braga).
4. **`expiresIn` is seconds and must be a positive even integer**; `evenSeconds()` rounds up.
5. **`contentSha256` and `nShards` are mandatory on every evidence pointer.** `evidenceOf` throws without
   them. The digest binds served bytes to the Arkiv record and is the one check that runs with nothing but
   node's crypto; the shard count is what lets a future blob-ID mismatch be explained rather than read as
   tampering.
6. **`digestFrom` is always set.** `'written'` = we hashed the bytes we sent. `'served'` = we hashed the
   bytes a certified blob gave back. The second is sound — a blob ID commits to content — but it is a
   weaker statement, so it travels with the pointer instead of being flattened into the first.
7. **Copy law applies to text the worker authors, not to text it quotes.** A server's own description from
   the registry is stored verbatim; `assertWorkerCopy` is for our sentences.

## Storage strategy, and its cost

Bulk seed metadata goes into **one Walrus Quilt**; per-record certified blobs are reserved for source
trees, reviews and dispute evidence, where citing one record individually is the whole point.

Measured on the first real seed: 50 record bodies, 49,968 B, 53 epochs → **2 Sui transactions**,
8,157,120 MIST gas, 11,312,154 FROST. The same 50 records as standalone blobs would have been 100
transactions and 565,607,700 FROST — more than the funded balance. On testnet Quilt is not a saving, it is
the difference between finishing and not.

The trade is recorded rather than hidden: a quilted record has no certified Sui object of its own and so no
per-record explorer link. Its pointer carries `addressing: 'quilt-patch'`, its own `patchId`, and the
quilt's digests.

⚠ **The quilt patch mapping must be read back, never inferred.** `flow.listFiles()` returns patch ids with
no identifier and *not* in input order — positional mapping was right for 1 of 50. `writeQuiltOfRecords`
therefore resolves each patch's identifier from the quilt index and re-hashes its bytes before returning,
and throws rather than return a mapping it has not proven. See FRICTION-LOG S9.

## Resume

The seed checkpoints to `state/seed-progress.json` (gitignored) after **every** server, written atomically.
Re-running the same command continues; it does not restart. This is not caution — the testnet faucet once
took 53 blind attempts to answer, and `alreadyCertified` dedup is publisher behaviour, so re-writing a blob
through the SDK **re-charges**. Verified both ways: a `SIGKILL` at server 53 of 60 resumed at exactly the
remaining 7, and a death after the quilt reused the certified quilt and wrote only the pending servers for
0 SUI and 0 WAL.

The candidate set is frozen on the first run. Re-crawling on resume would silently change the population
mid-run.
