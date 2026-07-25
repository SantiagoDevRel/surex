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

## Deploying

Nothing below is in this repo and nothing below should be. Secrets live in the deployment
environment (`AGENTS.md` §4).

### 1. Register the parent name

At [sepolia.app.ens.domains](https://sepolia.app.ens.domains). Sepolia costs no real ETH and the
ERC-3668 flow is identical to mainnet. Note that `surex.eth` on mainnet is already registered to
`0x8FA4C314F61a2b630A805af4e87e33b7fD66fA75` and is not ours — pick the parent accordingly.

### 2. Deploy the resolver

```bash
export SUREX_ENS_SIGNER=0x…            # the address whose key the gateway will sign with
export SUREX_ENS_GATEWAY_URL='https://arkiv-surex.vercel.app/api/ens/{sender}/{data}.json'
export SEPOLIA_RPC=https://…

forge script script/Deploy.s.sol \
  --rpc-url "$SEPOLIA_RPC" \
  --private-key "$DEPLOYER_KEY" \
  --broadcast
```

The `{sender}` and `{data}` placeholders are required and the script refuses to deploy without them —
a URL missing one deploys fine and then fails every lookup with an opaque gateway error.

### 3. Point the parent at it

This is the step that turns wildcard resolution on. Until it runs, nothing resolves.

```bash
cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setResolver(bytes32,address)" \
  $(cast namehash <parent>.eth) <deployed resolver address> \
  --rpc-url "$SEPOLIA_RPC" --private-key "$OWNER_KEY"
```

`0x0000…2e1e` is the ENS registry, the same address on Sepolia as on mainnet. If the parent is
wrapped in the Name Wrapper, call `setResolver` on the wrapper instead.

### 4. Configure the gateway

On the web deployment (Vercel project `apps/web`):

| Variable | What |
|---|---|
| `SUREX_ENS_SIGNING_KEY` | `0x`-prefixed 32-byte private key whose address is `SUREX_ENS_SIGNER` |
| `SUREX_ENS_RESOLVER_ADDRESS` | the address from step 2 — the gateway signs for this resolver and refuses every other |
| `NEXT_PUBLIC_SUREX_ENS_PARENT` | e.g. `surex-registry.eth`. Until it is set, the evidence page shows no ENS row at all |
| `SUREX_ENS_TTL_SECONDS` | optional, default 300 |
| `SUREX_ENS_CHAIN` | optional, default `sepolia` — only picks the explorer host for the UI link |

With `SUREX_ENS_SIGNING_KEY` or `SUREX_ENS_RESOLVER_ADDRESS` unset the gateway answers `503` and
names what is missing. It never manufactures a signature.

### 5. Prove it

```bash
cd ../probes
node ens-resolve.mjs sepolia --name sxf1-<40 hex>.<parent>.eth --rpc "$SEPOLIA_RPC"
```

That walks the whole path with a real client: `eth_call` → `OffchainLookup` revert → gateway fetch →
`resolveWithProof` → `ecrecover`. Until it prints green, the status table in `AGENTS.md` §2 says
*built, not proven on Sepolia*, and the README **Live** table gets no row. A status table does not
get a ✅ on an assertion.

## Rotating the signer

```bash
cast send <resolver> "setSigner(address)" <new signer> --rpc-url "$SEPOLIA_RPC" --private-key "$OWNER_KEY"
```

Then update `SUREX_ENS_SIGNING_KEY`. Rotation invalidates every signature already in flight, which is
the intended behaviour. A key that cannot be rotated is a liability the first time it is exposed, and
that is the only reason `owner` exists on this contract.
