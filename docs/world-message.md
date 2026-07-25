# Message to send World (AgentBook registration — NonExistentRoot)

Short, copy-pasteable. Paste into the World hackathon Discord / to the DevRel. Everything in it is verified
against live on-chain reads and the docs.

---

**AgentBook `register()` reverts `NonExistentRoot()` — World App proof root not on World Chain**

Hi — building on AgentKit for the Agents track (ETHGlobal Lisbon). Our agent-side integration works: we recover
the signer, call `createAgentBookVerifier().lookupHuman()` against the canonical AgentBook on World Chain (480),
and gate correctly. The blocker is **registration**.

`npx @worldcoin/agentkit-cli register <addr>`:
- The World App / World ID verify step **succeeds** — real Orb scan, valid nullifier, full ZK proof.
- The on-chain `register()` then **reverts with `0xddae3b71`**, which the CLI can't decode (`… not found on the
  provided ABI`). It's `NonExistentRoot()` — decoded via `keccak256("NonExistentRoot()")[:4]`.

We chased it down on-chain (World Chain 480):
- `AgentBook(0xA23aB2712eA7BBa896930544C7d6636a96b944dA).worldIdRouter()` → `0x17B354dD…A278` (matches your docs).
- `router.routeFor(1)` → group-1 identity manager `0xdFCa0A882…009E`.
- its `latestRoot()` = `12796…349` (sealed 2026-07-25 13:20 UTC, **static**).
- the **proof's root** = `13007…511`, and `checkValidRoot(proofRoot)` **reverts** — the root the World App proof
  is built against is not in World Chain's bridged tree.
- **Not transient:** a retry produced the identical proof root and `latestRoot` on World Chain didn't move.

So it reads like the **State Bridge hasn't propagated the current identity root to World Chain's bridged World
ID**, while World App keeps anchoring proofs against the newer (unbridged) root. Registration can't land until
the bridge catches up.

**Questions for you:**
1. Is there a known root-propagation delay / a status page for the World Chain State Bridge we should watch?
2. Is there a way to obtain a proof against a root already bridged to World Chain (or a testnet AgentBook path)
   so we can complete registration for the demo?
3. Is this expected right now, or is our flow doing something wrong? (Our `lookupHuman` + gating all work; it's
   only `register` that reverts.)

Two small DX things while we're here: (a) the CLI's failure hint lists "the World ID is not Orb-verified" as a
likely cause — it was a valid Orb ID, so that hint sent us the wrong way; (b) `agentkit-cli` reverts with a raw
`0xddae3b71` — decoding `NonExistentRoot` and saying "proof root not yet on World Chain" would have saved hours.

Happy to share the exact addresses/roots and repro. Thanks!

---

*(Backing detail + the full W1–W14 findings are in `docs/WORLD-FEEDBACK.md`. Submitted the docs-gap piece
through World's docs feedback channel too.)*
