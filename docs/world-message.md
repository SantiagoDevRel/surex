# Message to send World (AgentBook registration — NonExistentRoot, now resolved)

Short, copy-pasteable. Paste into the World hackathon Discord / to the DevRel. This is now **DX feedback about
a transient failure we recovered from**, not a help request — the registration eventually landed. Everything in
it is verified against live on-chain reads.

---

**Heads-up + DX feedback: AgentBook `register()` reverts `NonExistentRoot()` while the World Chain root hasn't
bridged yet (recovered, but it cost hours)**

Hi — building on AgentKit for the Agents track (ETHGlobal Lisbon). Reporting a rough edge that blocked us for a
few hours and then cleared on its own, in case it helps other teams and the docs.

**What happened:** `npx @worldcoin/agentkit-cli register <addr>` completed the World App / World ID verify step
fine (valid Orb proof), but the on-chain `register()` then **reverted with `0xddae3b71` = `NonExistentRoot()`**.
The CLI couldn't decode it (`… not found on the provided ABI`), so the surfaced error was just a raw selector.

We traced it on World Chain (480): the group-1 identity manager's `latestRoot()` was **static** for a while,
and the World App proof's root was newer and not yet in the bridged tree — `checkValidRoot(proofRoot)` reverts.
Two consecutive attempts produced the identical proof root while `latestRoot` didn't move, so it was **not a
bad Orb ID and not our code** — it read as the **State Bridge lagging behind the canonical identity tree**.

**How it resolved:** a while later `latestRoot` on World Chain advanced (we watched it move), we retried the
same command, and registration **landed** — tx `0xaa4c255c5edb7c973452a264184076dca73cfc051c019e0a1c7837a54b0fd870`,
`status: registered`, AgentBook now resolves the wallet to a human. So the fix was simply "wait for the bridge
to catch up," but nothing told us that.

**What would have saved the hours:**
1. **Decode the revert.** The CLI surfacing `NonExistentRoot` as *"the proof root hasn't propagated to World
   Chain yet — retry shortly"* instead of a raw `0xddae3b71` would have made this a 2-minute wait, not a
   multi-hour chase.
2. **The CLI's error hint is misleading here** — it lists "the World ID is not Orb-verified" as a likely cause.
   It was a perfectly valid Orb ID; that hint sent us the wrong way.
3. **Document the root-propagation delay** next to the AgentBook quickstart (how long it takes / where to watch
   the State Bridge), so teams know a `NonExistentRoot` right after a valid verify just means "retry soon."

Minor extras while here: (a) `cli/README.md` documents a `--network base|base-sepolia` flag the shipped 0.2.0
binary doesn't accept; (b) "Orb required" (groupId=1) is the single most load-bearing fact and is easy to miss.

Everything works now end to end on our side (registered agent → dispute accepted; unregistered → refused).
Happy to share the exact addresses/roots. Thanks!

---

*(Full W1–W14 findings + the on-chain evidence are in `docs/WORLD-FEEDBACK.md`. The docs-gap piece was also
submitted through World's own docs feedback channel.)*
