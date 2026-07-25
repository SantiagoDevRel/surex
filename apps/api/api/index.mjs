// Vercel function entry. NODE RUNTIME, deliberately not edge.
//
// Not edge because: node:crypto (the timing-safe admin compare and the dispute id),
// the Arkiv SDK's viem transport, and JSON import attributes all want a real Node
// runtime. There is no `export const config = { runtime: 'edge' }` here and there
// should never be one.
//
// vercel.json rewrites every path to this function, so `/v1/verdict` reaches the
// same Hono app the tests exercise and `node src/server.mjs` serves.

import { handle } from '@hono/node-server/vercel';
import { createApp } from '../src/app.mjs';

const app = createApp();

export default handle(app);
