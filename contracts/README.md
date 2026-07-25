# contracts — the ENS offchain resolver

One contract. `SureXOffchainResolver` is an ERC-3668 (CCIP-Read) resolver that makes every SureX
registry entry readable as an ENS name, with no transaction per entry and no bytes on chain.

```
sxf1-<first 40 hex of the fingerprint>.<parent>.eth
```

Set it once as the resolver on one parent name and every entry resolves — the 51 that exist today,
and every one written after. That is ENSIP-10 wildcard resolution, and it is the whole reason this
is one contract rather than 51 records.

## What the signature proves

That the response came from the holder of the key the resolver pins. Nothing else.

It does **not** prove the registry is right, and it does not make the SureX Gate stronger. The Gate
is the Claude Code `PreToolUse` hook in `packages/plugin`; it reads the HTTP API and does not read
this. **PRD risk #10 — the Gate acting on unsigned responses — is not closed by this work** and is
still listed as Accepted in `docs/surex-prd.md`. Written here because "signed" is a word people
finish the sentence of themselves, and they finish it wrong.

## Layout

```
src/SureXOffchainResolver.sol     the resolver — resolve(), resolveWithProof(), rotation
test/SureXOffchainResolver.t.sol  the Foundry suite, including the cross-language digest vector
script/Deploy.s.sol               deploys, and refuses a gateway URL missing its placeholders
```

No dependencies beyond `forge-std`. The ENS `offchain-resolver` reference pulls OpenZeppelin and the
ens-contracts tree for what is about sixty lines of logic here.

## Running the tests

```bash
forge install foundry-rs/forge-std --no-git   # first time only
forge test -vvv
```

**If you do not have Foundry**, the resolver can still be compiled and executed:

```bash
cd ../probes && pnpm install --ignore-workspace
node ens-resolve.mjs contract
```

That mode compiles `src/SureXOffchainResolver.sol` with solc-js and runs it on an in-process EVM. It
covers the digest, the interface IDs, and the six `resolveWithProof` acceptance and rejection paths.
It exists because Foundry could not be installed in the environment this was written in — see
`FRICTION-LOG.md` E4. `forge test` is the canonical suite and covers more; this is the one that runs
anywhere Node does.

## The digest

```solidity
keccak256(abi.encodePacked(hex"1900", address(this), expires, keccak256(extraData), keccak256(result)))
```

`0x1900` is EIP-191 version `0x00`, "data with intended validator" — the validator being the resolver
address, so a signature made for one resolver cannot be replayed against another. Unchanged from the
ENS reference, so any standard CCIP-Read client verifies a response without knowing anything about
SureX.

**The signature is over the raw digest.** In JavaScript that is
`privateKeyToAccount(key).sign({ hash })` and never `signMessage()`, which would add a second EIP-191
prefix and make `ecrecover` return an address nobody holds. This is the single most likely way to
break the whole thing, which is why the same four inputs and the same expected digest are pinned in
three places — here, in `apps/web/lib/ens.ts`, and asserted across both in
`apps/web/test/ens.test.mjs`.

## Deployed — Ethereum mainnet, 2026-07-25

| | |
|---|---|
| name | [`surex.eth`](https://app.ens.domains/surex.eth), expires 2027-07-25, not wrapped |
| resolver | [`0x2BEaeC431bB22Fd1160319d0ebDAE886Ef593a8B`](https://etherscan.io/address/0x2BEaeC431bB22Fd1160319d0ebDAE886Ef593a8B) |
| pinned signer | `0x9D80524581a242a8F67c5333418B6b8b3a8a6D01` |
| name owner (`setResolver`) | `0xFE388539e3fffeA23ba4C5aa4c750cb90f369b2E` |
| resolver owner (`setSigner`, `setUrls`) | `0xC19a460767CcD13c63e0a2470Ee10c75804c3dB4` |
| deploy cost | 0.000072 ETH — 1,067,648 gas at 0.067 gwei |

**Verified live, end to end.** A stock viem client reads a verdict off a subname that was never
registered:

```bash
cd ../probes && node ens-resolve.mjs live --name sxf1-<40 hex>.surex.eth
# ✓ the full path resolved in one call        surex:state = flagged
```

That walks wildcard resolution → `OffchainLookup` → gateway fetch → `resolveWithProof` → `ecrecover`,
driving the DEPLOYED contract rather than a constructed request. Use this mode, not `getEnsText`, to
check a deployment: `getEnsText` returns `null` on a failed CCIP fetch rather than throwing, so a
broken seam is indistinguishable from an empty record.

⚠️ **`0xCb140fF30c449c3782D96Bfa356cDDE8E33b2559` was the first deployment and is superseded.** It forwarded
`data` instead of `msg.data`, dropping the name the gateway needs — see `FRICTION-LOG.md` E8. Nothing
should point at it.

**Why mainnet and not a testnet:** `.eth` registration on Sepolia has been broken network-wide since
early June 2026 — see `FRICTION-LOG.md` E5 and E6. It was not a preference.

## Deploying it yourself

Nothing below is in this repo and nothing below should be. Secrets live in the deployment
environment (`AGENTS.md` §4).

### 1. Register the parent name

At [app.ens.domains](https://app.ens.domains). Do not reach for Sepolia — registration there is
broken (E5). A 5+ character name is ~0.0027 ETH/year and gas is the smaller half.

### 2. Deploy the resolver

```bash
cd contracts
SUREX_ENS_SIGNER=0x…                   # address whose key the gateway signs with — NOT its key
SUREX_ENS_GATEWAY_URL='https://arkiv-surex.vercel.app/api/ens/{sender}/{data}.json' \
forge script script/Deploy.s.sol \
  --rpc-url https://ethereum-rpc.publicnode.com \
  --sender <deployer address> --interactive --broadcast
```

`--sender` is required even with `--interactive`; without it forge falls back to its default sender
and refuses to broadcast. `--interactive` needs a real TTY — it fails with `Device not configured`
inside a non-interactive shell, so run it in a terminal.

The `{sender}` and `{data}` placeholders are literal and required; the script refuses to deploy
without them, because a URL missing one deploys fine and then fails every lookup with an opaque
gateway error.

### 3. Point the parent at it

This is the step that turns wildcard resolution on. Until it runs, nothing resolves.

```bash
cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setResolver(bytes32,address)" \
  $(cast namehash <parent>.eth) <deployed resolver address> \
  --rpc-url https://ethereum-rpc.publicnode.com --from <name owner> --interactive
```

`0x0000…2e1e` is the ENS registry, the same address on Sepolia as on mainnet. If the parent is
wrapped in the Name Wrapper, call `setResolver` on the wrapper instead. The ENS app's **More →
Resolver → Edit → Custom resolver** does the same thing and is easier; expect a warning that the
address is not a recognised resolver, which is correct — ours implements `IExtendedResolver`, not
the usual profile interface.

⚠️ After this, the parent stops resolving to an address. Ours answers `text()` for subnames, not
`addr()` for the parent. That is intended for a registry-as-a-name and surprising otherwise.

### 4. Configure the gateway

On the web deployment (Vercel project `apps/web`):

| Variable | What |
|---|---|
| `SUREX_ENS_SIGNING_KEY` | `0x`-prefixed 32-byte private key whose address is `SUREX_ENS_SIGNER` |
| `SUREX_ENS_RESOLVER_ADDRESS` | the address from step 2 — the gateway signs for this resolver and refuses every other |
| `NEXT_PUBLIC_SUREX_ENS_PARENT` | `surex.eth`. Until it is set, the evidence page shows no ENS row at all |
| `SUREX_ENS_TTL_SECONDS` | optional, default 300 |
| `SUREX_ENS_CHAIN` | optional — only picks the explorer host for the UI link. Set `mainnet` for this deployment |

For the live deployment those are `SUREX_ENS_RESOLVER_ADDRESS=0x2BEaeC431bB22Fd1160319d0ebDAE886Ef593a8B`,
`NEXT_PUBLIC_SUREX_ENS_PARENT=surex.eth`, `SUREX_ENS_CHAIN=mainnet`, and `SUREX_ENS_SIGNING_KEY` is the
key for `0x9D80524581a242a8F67c5333418B6b8b3a8a6D01` — kept in `~/.secrets/surex-ens.env` and never
in this repo.

With `SUREX_ENS_SIGNING_KEY` or `SUREX_ENS_RESOLVER_ADDRESS` unset the gateway answers `503` and
names what is missing. It never manufactures a signature.

### 5. Prove it

```bash
cd ../probes
node ens-resolve.mjs sepolia --name sxf1-<40 hex>.surex.eth --rpc https://ethereum-rpc.publicnode.com
```

That walks the whole path with a real client: `eth_call` → `OffchainLookup` revert → gateway fetch →
`resolveWithProof` → `ecrecover`. (The mode is still called `sepolia`; pass `--rpc` for any chain.)

Until the gateway is deployed this stops at the fetch, which is the current state — resolution
reaches the contract, and there is nothing on the other end to answer. A status table does not get a
✅ on an assertion, so `AGENTS.md` §2 says *gateway pending* until this prints green.

## Rotating the signer

```bash
cast send 0x2BEaeC431bB22Fd1160319d0ebDAE886Ef593a8B "setSigner(address)" <new signer> \
  --rpc-url https://ethereum-rpc.publicnode.com \
  --from 0xC19a460767CcD13c63e0a2470Ee10c75804c3dB4 --interactive
```

Then update `SUREX_ENS_SIGNING_KEY`. Rotation invalidates every signature already in flight, which is
the intended behaviour. A key that cannot be rotated is a liability the first time it is exposed, and
that is the only reason `owner` exists on this contract.
