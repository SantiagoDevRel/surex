# SureX — ENS: the registry as a name, and the verdict as a signed read

> Version 1, 2026-07-25. Companion to [`surex-prd.md`](./surex-prd.md) and [`surex-tech-spec.md`](./surex-tech-spec.md).
>
> Purpose: specify how a SureX verdict is resolvable as an ENS name, what the signature on that read
> does and does not prove, and what has to happen on chain before any of it is true.
>
> `AGENTS.md` §5 said ENS was a deliberate later phase and not to be added without an explicit
> decision. This document *is* that decision, and it moves the sponsor SDK budget from 2 of 3 to
> 3 of 3.

---

## 1. Summary

Every entry in the SureX registry becomes readable at

```
sxf1-<first 40 hex of the fingerprint>.<parent>.eth
```

with no transaction per entry and nothing written to Ethereum. One ERC-3668 (CCIP-Read) resolver,
set once as the resolver on one parent name, answers for all 51 entries that exist today and every
one written after — that is ENSIP-10 wildcard resolution, and it is the reason the cost of this is a
single deployment rather than a per-verdict gas bill.

Reading a verdict becomes one line for anything already holding an Ethereum client:

```ts
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({ chain: mainnet, transport: http() });
await client.getEnsText({ name: 'sxf1-09dcb0601b4d2f1fdebba5d2dfe629f3421274bc.surex.eth', key: 'surex:state' });
// → 'flagged'   (once the gateway is deployed; today this returns null — §6)
```

The client does the ERC-3668 dance itself. Nothing about SureX has to be integrated, and the
response carries a signature the resolver checks on chain.

## 2. Why this is worth building — and what it is not

### It is a read interface nobody has to integrate

The HTTP API is one `fetch` away for anything that speaks HTTP, and it stays the easier path for
most callers. Cursor and Cline do not ship viem, and telling them to resolve an ENS name to learn
about an MCP server would be worse for them, not better.

The population this is for is the one already holding a client: crypto-native agents, onchain
tooling, anything with a wallet in the loop. For those, `getEnsText` is a call they already know how
to make against infrastructure they already trust to be there, and SureX becomes readable without a
single line of SureX-specific code.

### It makes a verdict something a contract can check

This is the part the HTTP API cannot do at all.

Because the response is signed against a key pinned in the resolver, a caller can carry a signed
verdict into a transaction and have a contract check it — `resolveWithProof` is a `view` function
that either returns the answer or reverts. An agent registry could refuse to register an agent whose
MCP server is `flagged`. A multisig module could require a fresh non-`flagged` read before executing.

**None of that is built here.** It is the door this opens, and it is stated as a door.

### Wildcard makes it free

51 entries today, and the count moves every time the crawler runs or a review is superseded. A
design that needed a transaction per entry would be a design nobody would run. One `setResolver`
covers the ones that exist and the ones that do not exist yet.

### What it is NOT: this does not close PRD risk #10

PRD §11 risk #10 says the Gate "runs on every tool call and acts on unsigned remote responses… the
largest knowingly-unmitigated risk in the build."

**This work does not close it, and the claim must not be made.** Three reasons, all of them
checkable:

1. **The Gate does not read this.** The Gate is `packages/plugin/lib/registry.mjs` — a plain `fetch`
   behind an `AbortController` budget, with no signature check anywhere in it. Nothing in this work
   touches that file, by design (§7).
2. **It would buy little if it did.** The transport is already HTTPS, and the signing key lives on
   the same deployment that serves the data. The marginal gain over TLS is cert-pinning-grade, and
   the pin sits in one contract we also control.
3. **A signature is not a fact about a server.** It says the response came from SureX. It says
   nothing about whether the review is right.

Risk #10 stays listed as **Accepted**, in the PRD, in `contracts/README.md`, and in the pull request.

### What it is NOT: nothing renders these today

Wallets and multisig UIs *could* render these records — they already fetch text records, so it is a
few lines. None does today, and none has a moment in its flow where it would resolve a fingerprint
subname. That is roadmap, and `AGENTS.md` §4 forbids describing end-state as current capability.

## 3. The label

### `sxf1_<64 hex>` is not a legal ENS label

`packages/core/src/sxf1.mjs` builds the fingerprint as `` `sxf1_${sha256}` `` and
`packages/core/src/contract.mjs` freezes it as `/^sxf1_[0-9a-f]{64}$/`. ENSIP-15 normalisation
rejects it outright:

```
Invalid label "sxf1_b1dad32ff…edb1": underscore allowed only at start
```

The separator in our own published identifier is what makes it unusable. Measured, not read from a
spec — `node probes/ens-resolve.mjs labels`, written up as FRICTION-LOG **E1**.

### 45 characters, because clients disagree above 63

ethers `dnsEncode` defaults to a 63-byte-per-label limit and throws above it. viem's `packetToBytes`
has no such default and encodes anything up to 255 bytes verbatim. So any label between 64 and 255
characters resolves in one client and fails in the other, silently, depending on what the caller
happens to use. FRICTION-LOG **E2**.

Hence:

| | |
|---|---|
| Prefix | `sxf1-` — a hyphen, which normalises |
| Payload | the first 40 hex characters of the fingerprint |
| Total | **45 characters** — under 63, under 255, normalises cleanly |

40 hex characters is 160 bits. Across 51 entries that is not a collision risk, and the gateway
refuses to answer at all if two entries ever did share a prefix (§5). The truncation is a naming
convenience and never the identity: `surex:fingerprint` carries all 64 characters, so a caller who
needs certainty compares the whole thing rather than trusting the name. The prefix is also visibly
the prefix of the fingerprint rendered on `/r/<fp>`, so a human can match the two by eye.

## 4. The records

| Key | Value | Source |
|---|---|---|
| `surex:state` | `clean` · `flagged` · `disputed` · `unreviewable` · `stale` · `unknown` | `head.state` |
| `surex:severity` | `0`–`4` | `head.severity` |
| `surex:tier` | `A` · `B` · `C` · `MISMATCH` | `head.tier` |
| `surex:reason` | `licence` · `source-unavailable` · `remote-endpoint`, or empty | `head.reason` |
| `surex:reviewed` | ISO 8601 | `head.reviewedAt ?? head.updatedAt` |
| `surex:fingerprint` | the full `sxf1_<64 hex>` | `head.fingerprint` |
| `url` | `https://arkiv-surex.vercel.app/r/<fingerprint>` | derived |

`url` is the standard ENS key rather than a `surex:` one, so a client that already knows how to
render a name's website lands on the evidence page without being taught anything.

`addr(bytes32)` answers the zero address. A registry entry is not an account, and reverting would
look like a resolution failure rather than an honest "no address here". Any other record type
answers empty bytes.

### What is deliberately absent

**No `topFinding`, no `disputeSummary`, no `name`.** Two reasons, and the second is the real one:

1. Those are model-generated free text. `AGENTS.md` §4 binds every surface, and a value that cannot
   be copy-checked ahead of time cannot be allowed into something signed. `recordsFor()` runs
   `copyViolations()` over every value at runtime and throws rather than returning a violating set;
   `apps/web/test/ens.test.mjs` walks the entire enum space the contract allows —
   state × tier × severity × reason — and asserts zero violations across all of it.
2. A finding is an accusation about a named project. It belongs on a page that carries the evidence,
   the date, the model, the prompt version, and the one-command override. A text record is read
   completely out of context, with none of that around it, which is exactly where an automated
   accusation does the most damage. PRD risk #5.

**There is no boolean `disputed` record.** `disputed` is a value of `surex:state`, matching
`VERDICT_HEAD_FIELDS`. Adding a second spelling of the same fact is how two sources of truth start.

## 5. Architecture

```
viem client                    SureXOffchainResolver            apps/web gateway         apps/api
     │                            (mainnet)                                                (read only)
     │  eth_call resolve()            │                                │                        │
     ├───────────────────────────────►│                                │                        │
     │  revert OffchainLookup(urls)   │                                │                        │
     │◄───────────────────────────────┤                                │                        │
     │  GET /api/ens/{sender}/{data}.json                              │                        │
     ├────────────────────────────────────────────────────────────────►│                        │
     │                                │        GET /v1/registry?limit=500                       │
     │                                │                                ├───────────────────────►│
     │                                │                                │◄───────────────────────┤
     │  { data: (result, expires, signature) }                         │                        │
     │◄────────────────────────────────────────────────────────────────┤                        │
     │  eth_call resolveWithProof()   │                                │                        │
     ├───────────────────────────────►│                                │                        │
     │  result, or revert             │  ecrecover == pinned signer    │                        │
     │◄───────────────────────────────┤                                │                        │
```

### The gateway lives in `apps/web`, not `apps/api`

`apps/api/src/app.mjs` opens by stating that the read API has no wallet and no key, and that the
separation is the reason a compromise of the read path cannot rewrite the registry — a property to
preserve, not an implementation detail. `apps/web` already holds one signing key with an established
shape (`app/api/world/rp-signature/route.ts`), so the gateway follows that file rather than putting a
key where one has never been.

### The three refusals

The failure mode of a signing route is not an error. It is a believable lie. So:

| Situation | Answer |
|---|---|
| `sender` is not our resolver | **400, no signature.** Without this the route is an oracle that signs responses for anyone else's resolver, with our key, against their gateway URL. 4xx because ERC-3668 clients must not retry another URL on a 4xx, and there is nothing to retry. |
| The registry is unreachable, or the listing was truncated | **500, no signature.** `lib/api.ts` falls back to fixtures when the API is down — right for a page carrying an illustrative banner, catastrophic for a signature. A manufactured `unknown` is a fabricated fact. |
| The head is marked `illustrative`, or the prefix is ambiguous | **500, no signature.** |
| Nothing is configured | **503**, naming the missing variables. |

A label with no match is different from all four, and is the one case that *is* answered: it is
`unknown`, signed, because "nobody has submitted this install configuration" is a real fact about the
registry. Same rule the Gate and `lib/api.ts` already follow — degrade to `unknown`, never to
`clean`.

### The digest

```
keccak256(abi.encodePacked(hex"1900", resolver, expires, keccak256(callData), keccak256(result)))
```

`0x1900` is EIP-191 version `0x00`, "data with intended validator" — the validator being the resolver
address, so a signature made for one resolver cannot be replayed against another. Unchanged from the
ENS reference so that any standard CCIP-Read client verifies a response without knowing anything
about SureX.

The signature is over the **raw digest**: `privateKeyToAccount(key).sign({ hash })`, never
`signMessage()`, which would add a second EIP-191 prefix and make `ecrecover` return an address
nobody holds.

The formula exists twice — in `apps/web/lib/ens.ts` and in `SureXOffchainResolver.makeSignatureHash`
— because the signer and the verifier are in different languages in different packages. If they ever
disagree, every lookup fails `resolveWithProof` with an error naming neither side, and both suites
stay green while the product is entirely broken. So the same four inputs and the same expected
digest are pinned in both, and `apps/web/test/ens.test.mjs` reads the Solidity as text to prove the
two literals are the same one.

## 6. What is deployed, and what is not

| | |
|---|---|
| Network | **Ethereum mainnet.** Not a preference — `.eth` registration on Sepolia has been broken network-wide since early June 2026 (`FRICTION-LOG.md` E5, E6). |
| Parent name | **`surex.eth`**, ours, expires 2027-07-25. It was available because a prior registration lapsed on 2024-07-21; the earlier claim that it belonged to `0x8FA4C314…` read a stale record on an expired name. |
| Resolver | **`0xCb140fF30c449c3782D96Bfa356cDDE8E33b2559`**, signer `0x9D80524581a242a8F67c5333418B6b8b3a8a6D01`. |
| Wildcard | **Verified live.** `getEnsResolver` on a subname that was never registered returns our resolver through the standard Universal Resolver, and `resolve()` reverts with a real `OffchainLookup`. |
| Gateway | **Not deployed.** `arkiv-surex.vercel.app/api/ens/` 404s until this branch ships, so `getEnsText` returns `null`. No further transactions are needed. |
| ⚠️ Reading a `null` | A dead gateway is indistinguishable from an empty record client-side — viem swallows the failed fetch. Never read `null` as "no verdict". |

The runbook is `contracts/README.md`. The order matters: deploying the resolver changes nothing until
`setResolver` is called on the parent, and that one transaction is what turns wildcard resolution on
for every entry at once.

## 7. Out of scope

- **The Gate does not cross-check ENS.** The hot path stays untouched. `AGENTS.md` §7 records that a
  `PreToolUse` hook exceeding its timeout is killed and the tool call proceeds — a slow gate does not
  fail closed, it fails *silently*. Adding an RPC round trip in front of every tool call would buy
  nothing the local cache does not already give and would risk disabling enforcement outright.
- **Writing anything to Ethereum per entry.** The registry lives on Arkiv. This is a read surface.
- **Reverse resolution.** No `addr` record means no meaningful primary name.
- **Mainnet, and the Name Wrapper.** Both are deployment decisions.

## 8. How this was checked

| What | How |
|---|---|
| Label encoding, E1, E2 | `node probes/ens-resolve.mjs labels` |
| The contract compiles and behaves | `cd contracts && forge test -vvv`, or `node probes/ens-resolve.mjs contract` where Foundry cannot be installed |
| Digest agreement across languages | `pnpm --filter @surex/web test` — the golden vector, asserted against the Solidity source as text |
| Copy law over every record | same suite — the whole state × tier × severity × reason space |
| Gateway ↔ resolver, end to end | `node probes/ens-resolve.mjs mock` then `node ens-resolve.mjs gateway`, with `next dev` between them |
| A real client, against mainnet | `node probes/ens-resolve.mjs sepolia --name sxf1-<40 hex>.surex.eth --rpc https://ethereum-rpc.publicnode.com` — resolution reaches the contract; the fetch fails until the gateway ships |
