// Local entry. Port 4310 (the web app takes 4311).

import { serve } from '@hono/node-server';
import { createApp } from './app.mjs';

export const PORT = Number(process.env.PORT ?? 4310);

const app = createApp();
const { mode, admin, verifiers, store } = app.surex;

serve({ fetch: app.fetch, port: PORT }, (info) => {
  const lines = [
    `surex-api listening on http://localhost:${info.port}  ·  mode=${mode}  ·  read path only, no wallet`,
  ];
  if (mode === 'mock') {
    lines.push(
      '  MOCK MODE: every response is fixture data carrying illustrative:true. No Arkiv connection at all.',
      `  the deliberate miss fingerprint is ${store.missFingerprint}`,
    );
  } else {
    lines.push(
      `  arkiv: ${store.rpcUrl}  chainId=${store.chainId}`,
      `  project=${store.project}  every read filtered by .createdBy(${store.writerAddress})`,
    );
  }
  lines.push(
    admin.mounted
      ? `  admin: POST ${admin.path}  (demo control, not a security boundary)`
      : '  admin: NOT MOUNTED (SUREX_ADMIN_SLUG unset)',
  );
  if (verifiers.isStub) {
    lines.push('  disputes: STUB VERIFIER — every dispute is refused until the World lane is wired in.');
  }
  console.log(lines.join('\n'));
});

export default app;
