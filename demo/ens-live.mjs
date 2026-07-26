// Reads a verdict off Ethereum mainnet with nothing but viem — no SureX code,
// no plugin, no SDK. The subname was never registered; one wildcard resolver
// answers for every entry in the registry.
//
//   cd surex && node demo/ens-live.mjs
//
// The RPC is pinned deliberately, but not for a CCIP-Read reason: on 2026-07-25
// llamarpc, cloudflare-eth and ankr failed `eth_blockNumber` too, so they were
// simply unreachable or gated from here. publicnode and eth.drpc.org both answer
// and both return `flagged`. Pinned so a demo does not depend on a default.

import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
})

// @surex/mal-tool-shadow — our own fixture, and the only flagged entry.
const name = 'sxf1-ceacc357115421177295dd5b183871b3192c17b1.surex.eth'

console.log(name)

for (const key of ['surex:state', 'surex:severity', 'surex:tier', 'url']) {
  // null is not "no record" — a dead gateway reads the same way client-side.
  console.log(' ', key.padEnd(15), await client.getEnsText({ name, key }))
}
