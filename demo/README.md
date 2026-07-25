# The demo

One command proves the whole claim:

```bash
node demo/chain.mjs
```

It starts a real headless Claude Code session with the plugin loaded as a plugin and the malicious fixture
connected as an MCP server, asks the model to call the fixture's `search` tool, and then checks every link:

```
✓ the fixture has a content-derived identity, not a colliding basename
✓ the plugin's hook fired on the MCP tool call
✓ the gate denied the call
✓ the block message reached the model
✓ it names the finding, with file and line
✓ it discloses that no human audited it
✓ it prints the override and says the risk is the user's
✓ it does not claim the reviewed bytes are the installed bytes (tier C)
✓ the gate FETCHED the evidence from Walrus while blocking
✓ the fetched bytes matched the digest recorded on the record
✓ the blob ID was RECOMPUTED from the bytes and matched — not asserted
✓ the model understood it as a block, not as a tool error
✓ after `surex allow`, the same call proceeds
```

## What is real in this run, and what is not

**Real.** The Claude Code session, the plugin, the hook, the fixture MCP server and its tool call, the
`SXF-1` fingerprint computed from configuration alone, the block, the HTTP fetch to a public Walrus
aggregator, the local recomputation of the blob ID by the vendored encoder, the local override, and the
release after it.

The blob really exists: `-SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y`, certified on Walrus testnet by
`probes/walrus-write.mjs`, register `2s1ogVLi6Gc2uEY3ZB4Ztb52DNxyHqftMa4aVrTRqeND`, certify
`7BiSZkhzAjucM2PNY8bMVi9cWBvtiLDBE6T8AEtm1tkq`.

**Not real.** Arkiv is stood in for by a local HTTP server, and the verdict content is hand-written. The
finding it describes is a true statement about our own fixture, but **no model reviewed anything in this
run** and no third-party server has been reviewed by SureX at all. Run it against the live API with
`SUREX_API_URL=… node demo/chain.mjs` to replace that link.

Nothing in this repo should be read as a claim about a real third-party MCP server.

## Why it is worth running rather than describing

Both times the chain was assembled it failed, and both failures were bugs no unit test had caught:

- **A local script was colliding.** `node ./server.js` fingerprinted identically for every locally-run MCP
  server, so the gate would have handed one server's verdict to another. Not a miss — a *wrong verdict*.
- **The session-start prefetch could poison the cache.** It turned "the registry did not answer" into a
  cached `unknown`, which suppressed a flag for the whole negative TTL. A flagged server read as unknown and
  the call went through with no notice.

Both are fixed, both have regression tests, and neither would have been found by reasoning about the code.

## The thirty-second interactive check still worth doing

`session_id` behaviour across `/clear` and `/compact` was established from transcript forensics, not from a
hook watching itself. To confirm it directly, see `probes/hook/README.md`.
