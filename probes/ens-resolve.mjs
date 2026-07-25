#!/usr/bin/env node
// Throwaway probe for the ENS surface. It answers, by observation rather than by
// reading a spec, the questions the ENS work depends on:
//
//   1. is `sxf1_<64 hex>` — the fingerprint we already publish — a legal ENS
//      label? (E1)
//   2. do clients agree on how long a label may be? (E2)
//   3. does the contract compute the same digest the gateway signs, and does it
//      reject a wrong signer, a tampered answer and an expired one? (E3)
//   4. does the gateway's signature satisfy the resolver, end to end? (E4)
//   5. does a real ENS client walk the same path against a deployed one? (E5)
//
// Modes come from argv so one script covers every case:
//   labels | contract | mock | gateway | sepolia
//
// Why (3) is here at all, in a probe, rather than only in `forge test`:
// Foundry cannot be installed in the environment this was built in —
// `foundry.paradigm.xyz` is refused by the egress policy (403 on CONNECT) and the
// `foundry-rs/foundry` GitHub repo is not enabled for the session. So the contract
// is compiled with solc-js and executed on an in-process EVM instead. The Foundry
// suite in `contracts/test/` is the canonical one and covers more; this mode is
// what could actually be RUN, and it pins the two things a cross-language bug
// would hide: the digest, and the recovery.
//
// Usage:
//   node ens-resolve.mjs labels
//   node ens-resolve.mjs contract
//   node ens-resolve.mjs mock                       # stand-in /v1/registry on :4310
//   node ens-resolve.mjs gateway [--gateway http://127.0.0.1:4311]
//   node ens-resolve.mjs live --name <full ens name> [--chain mainnet] [--rpc <url>]
//   node ens-resolve.mjs sepolia --name <full ens name> [--rpc <url>]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const argv = process.argv.slice(2);
const mode = (argv[0] ?? 'labels').replace(/^--/, '');
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const no = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const hr = (t) => console.log(`\n\x1b[1m── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}\x1b[0m`);

/* ─────────────────────────────────────────────────────────────── fixtures ──*/

// A real fingerprint from the registry — the flagged fixture server.
const FP = 'sxf1_b1dad32ff73fe0791aa543000695d093dec235b1af446740e81b53fcef92edb1';
const LABEL = `sxf1-${FP.slice(5, 45)}`;

/* ──────────────────────────────────────────────── 1 + 2 · labels (E1, E2) ──*/

async function labels() {
  const { ens_normalize } = await import('@adraffy/ens-normalize');
  const { packetToBytes } = await import('viem/ens');
  const { dnsEncode } = await import('ethers');

  hr('E1 · is the fingerprint itself a legal ENS label?');
  for (const candidate of [FP, LABEL]) {
    try {
      const out = ens_normalize(`${candidate}.example.eth`);
      console.log(ok(`ens_normalize("${candidate.slice(0, 28)}…") → ${out.slice(0, 34)}…`));
    } catch (err) {
      console.log(no(`ens_normalize("${candidate.slice(0, 28)}…") threw: ${err.message}`));
    }
  }
  console.log(
    '\n  The fingerprint is `sxf1_` + 64 hex (packages/core/src/sxf1.mjs). The underscore\n' +
      '  is what ENSIP-15 rejects, so the published identifier cannot be used as a label\n' +
      '  as written — which is the reason a separate `sxf1-` encoding exists at all.',
  );

  hr('E2 · how long may a label be? viem vs ethers');
  console.log(`  ${'length'.padEnd(8)} ${'viem packetToBytes'.padEnd(26)} ethers dnsEncode`);
  for (const len of [45, 63, 64, 69, 255, 256]) {
    const label = 'a'.repeat(len);
    let v;
    try {
      v = `ok, ${packetToBytes(`${label}.eth`).length} bytes`;
    } catch (err) {
      v = `threw: ${err.message.split('\n')[0].slice(0, 20)}`;
    }
    let e;
    try {
      e = `ok, ${(dnsEncode(`${label}.eth`).length - 2) / 2} bytes`;
    } catch (err) {
      e = `threw: ${String(err.shortMessage ?? err.message).slice(0, 34)}`;
    }
    const agree = v.startsWith('ok') === e.startsWith('ok');
    console.log(`  ${agree ? ' ' : '!'} ${String(len).padEnd(6)} ${v.padEnd(26)} ${e}`);
  }
  console.log(
    `\n  Rows marked ! are where the two clients disagree. Our label is ${LABEL.length} chars,\n` +
      '  which is under every limit observed above.',
  );

  hr('the label we ship');
  console.log(`  fingerprint  ${FP}`);
  console.log(`  label        ${LABEL}  (${LABEL.length} chars)`);
  console.log(`  normalises   ${(() => { try { ens_normalize(`${LABEL}.a.eth`); return 'yes'; } catch { return 'NO'; } })()}`);
}

/* ─────────────────────────────────────────────── 3 · the contract (E3) ─────*/

function compileResolver() {
  const solc = require('solc');
  const source = readFileSync(join(REPO, 'contracts/src/SureXOffchainResolver.sol'), 'utf8');
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { 'SureXOffchainResolver.sol': { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
        },
      }),
    ),
  );
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) {
    for (const e of errors) console.log(no(e.formattedMessage ?? e.message));
    throw new Error('solc reported errors');
  }
  for (const w of (out.errors ?? []).filter((e) => e.severity === 'warning')) {
    console.log(`  \x1b[33mwarning\x1b[0m ${(w.formattedMessage ?? w.message).split('\n')[0]}`);
  }
  return out.contracts['SureXOffchainResolver.sol'].SureXOffchainResolver;
}

// solc ships CommonJS only.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function contract() {
  const { VM } = await import('@ethereumjs/vm');
  const { Common, Chain, Hardfork } = await import('@ethereumjs/common');
  const { Address, hexToBytes, bytesToHex } = await import('@ethereumjs/util');
  const viem = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');

  hr('E3 · compile the resolver, then run it');
  const artifact = compileResolver();
  console.log(ok(`solc ${require('solc').version()} compiled SureXOffchainResolver`));

  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun });
  const vm = await VM.create({ common });
  const RESOLVER = '0x1111111111111111111111111111111111111111';
  await vm.stateManager.putContractCode(
    new Address(hexToBytes(RESOLVER)),
    hexToBytes(`0x${artifact.evm.deployedBytecode.object}`),
  );

  // `block.timestamp` is 0 in a bare runCall, which would make every expiry
  // assertion vacuous — `expires < 0` is never true. Give the EVM a block.
  const NOW = 1_700_000_000n;
  const block = {
    header: {
      number: 1n,
      cliqueSigner: () => Address.zero(),
      coinbase: Address.zero(),
      timestamp: NOW,
      difficulty: 0n,
      prevRandao: hexToBytes(`0x${'00'.repeat(32)}`),
      gasLimit: 30_000_000n,
      baseFeePerGas: 0n,
      getBlobGasPrice: () => 0n,
    },
  };

  const abi = artifact.abi;
  const call = async (functionName, args) => {
    const data = viem.encodeFunctionData({ abi, functionName, args });
    const res = await vm.evm.runCall({
      to: new Address(hexToBytes(RESOLVER)),
      data: hexToBytes(data),
      gasLimit: 30_000_000n,
      block,
    });
    if (res.execResult.exceptionError) {
      return { reverted: true, data: bytesToHex(res.execResult.returnValue) };
    }
    return {
      reverted: false,
      value: viem.decodeFunctionResult({ abi, functionName, data: bytesToHex(res.execResult.returnValue) }),
    };
  };

  // The golden vector, byte-identical to contracts/test/SureXOffchainResolver.t.sol
  // and apps/web/test/ens.test.mjs.
  const GOLDEN = {
    resolver: '0x1111111111111111111111111111111111111111',
    expires: 2000000000n,
    callData: '0x00112233445566778899aabbccddeeff',
    result: viem.encodeAbiParameters([{ type: 'string' }], ['flagged']),
    digest: '0xb344ec8556d204183db10bcdac4e9d28cfbb2f81ccc401c04c3809181edff00f',
  };

  const jsDigest = viem.keccak256(
    viem.encodePacked(
      ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
      ['0x1900', GOLDEN.resolver, GOLDEN.expires, viem.keccak256(GOLDEN.callData), viem.keccak256(GOLDEN.result)],
    ),
  );
  const solDigest = (
    await call('makeSignatureHash', [GOLDEN.resolver, GOLDEN.expires, GOLDEN.callData, GOLDEN.result])
  ).value;

  console.log(`  pinned    ${GOLDEN.digest}`);
  console.log(`  javascript${jsDigest === GOLDEN.digest ? ' ' : '!'} ${jsDigest}`);
  console.log(`  solidity  ${solDigest === GOLDEN.digest ? ' ' : '!'} ${solDigest}`);
  const digestOk = jsDigest === GOLDEN.digest && solDigest === GOLDEN.digest;
  console.log(digestOk ? ok('the gateway and the resolver agree on the digest') : no('DIGEST DISAGREEMENT'));

  hr('interface IDs');
  for (const [id, label] of [
    ['0x01ffc9a7', 'ERC-165'],
    ['0x9061b923', 'IExtendedResolver — wildcard resolution needs this'],
    ['0xffffffff', 'the ERC-165 sentinel, must be false'],
  ]) {
    const got = (await call('supportsInterface', [id])).value;
    const want = id !== '0xffffffff';
    console.log(got === want ? ok(`${id}  ${got}  ${label}`) : no(`${id}  ${got}  ${label}`));
  }

  hr('resolveWithProof');
  // The deployed code pins whatever `signer` the constructor set, and we bypassed
  // the constructor by writing deployed bytecode directly — so storage slot 1
  // (`signer`) is set by hand. slot 0 is `owner`.
  const SIGNER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const account = privateKeyToAccount(SIGNER_PK);
  const SIGNER_SLOT = hexToBytes(`0x${'00'.repeat(31)}01`);
  await vm.stateManager.putContractStorage(
    new Address(hexToBytes(RESOLVER)),
    SIGNER_SLOT,
    hexToBytes(account.address.toLowerCase()),
  );
  console.log(`  signer    ${account.address}`);

  const callData = viem.encodeFunctionData({
    abi: [{ name: 'text', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'string' }], outputs: [{ type: 'string' }], stateMutability: 'view' }],
    functionName: 'text',
    args: [`0x${'fe'.repeat(32)}`, 'surex:state'],
  });
  const result = viem.encodeAbiParameters([{ type: 'string' }], ['flagged']);

  const sign = async (expires, cd = callData, res = result) => {
    const digest = viem.keccak256(
      viem.encodePacked(
        ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
        ['0x1900', RESOLVER, expires, viem.keccak256(cd), viem.keccak256(res)],
      ),
    );
    // RAW hash. `signMessage` would add a second EIP-191 prefix and ecrecover
    // would return a stranger.
    return account.sign({ hash: digest });
  };

  const respond = async (expires, opts = {}) =>
    viem.encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      [opts.result ?? result, expires, opts.signature ?? (await sign(expires, opts.signedOver ?? callData, opts.result ?? result))],
    );

  const now = NOW;
  const cases = [
    ['a well-formed answer is accepted', await respond(now + 300n), callData, 'flagged'],
    ['an expired answer is rejected', await respond(0n), callData, null],
    [
      'a tampered result is rejected',
      viem.encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
        [viem.encodeAbiParameters([{ type: 'string' }], ['clean']), now + 300n, await sign(now + 300n)],
      ),
      callData,
      null,
    ],
    ['a signature over another name is rejected', await respond(now + 300n), viem.encodeFunctionData({
      abi: [{ name: 'text', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'string' }], outputs: [{ type: 'string' }], stateMutability: 'view' }],
      functionName: 'text',
      args: [`0x${'ab'.repeat(32)}`, 'surex:state'],
    }), null],
    [
      'a stranger\'s signature is rejected',
      await respond(now + 300n, {
        signature: await privateKeyToAccount(
          '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
        ).sign({
          hash: viem.keccak256(
            viem.encodePacked(
              ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
              ['0x1900', RESOLVER, now + 300n, viem.keccak256(callData), viem.keccak256(result)],
            ),
          ),
        }),
      }),
      callData,
      null,
    ],
    ['a malformed signature is rejected', await respond(now + 300n, { signature: '0x1234' }), callData, null],
  ];

  let pass = 0;
  for (const [label, response, cd, want] of cases) {
    const got = await call('resolveWithProof', [response, cd]);
    if (want === null) {
      const good = got.reverted;
      console.log(good ? ok(label) : no(`${label} — IT WAS ACCEPTED`));
      if (good) pass++;
    } else {
      const good = !got.reverted && viem.decodeAbiParameters([{ type: 'string' }], got.value)[0] === want;
      console.log(good ? ok(`${label} → "${want}"`) : no(`${label} — ${got.reverted ? `reverted ${got.data}` : got.value}`));
      if (good) pass++;
    }
  }

  hr('result');
  const allOk = digestOk && pass === cases.length;
  console.log(`  ${pass}/${cases.length} resolveWithProof cases behaved as specified`);
  console.log(allOk ? ok('the contract does what the gateway assumes') : no('SOMETHING IS WRONG'));
  if (!allOk) process.exitCode = 1;
}

/* ─────────────────────────────── 4a · the gateway, against the resolver ────*/

/**
 * The whole CCIP-Read loop, minus the client library: build the `resolve()`
 * calldata a resolver would revert with, GET the gateway, and hand what comes
 * back to a real `resolveWithProof` running on an in-process EVM.
 *
 * This is the mode that proves the two halves of the build interoperate. The
 * `sepolia` mode below proves a real client walks the same path, but it cannot
 * run until something is deployed, and this can run now.
 *
 * Needs `next dev` on :4311 with SUREX_ENS_* set, and something answering
 * `/v1/registry`. `--serve-mock` starts that something.
 */
async function gateway() {
  const { VM } = await import('@ethereumjs/vm');
  const { Common, Chain, Hardfork } = await import('@ethereumjs/common');
  const { Address, hexToBytes, bytesToHex } = await import('@ethereumjs/util');
  const viem = await import('viem');
  const { packetToBytes } = await import('viem/ens');

  const base = flag('gateway', 'http://127.0.0.1:4311');
  const RESOLVER = flag('resolver', '0x1111111111111111111111111111111111111111');
  const SIGNER = flag('signer', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const name = flag('name', `${LABEL}.surex.eth`);

  hr('E4 · the gateway, checked by the resolver');
  console.log(`  gateway   ${base}`);
  console.log(`  resolver  ${RESOLVER}`);
  console.log(`  name      ${name}`);

  const RESOLVE_ABI = viem.parseAbi(['function resolve(bytes name, bytes data) view returns (bytes)']);
  const TEXT_ABI = viem.parseAbi(['function text(bytes32 node, string key) view returns (string)']);

  const callDataFor = (ensName, key) =>
    viem.encodeFunctionData({
      abi: RESOLVE_ABI,
      functionName: 'resolve',
      args: [
        bytesToHex(packetToBytes(ensName)),
        viem.encodeFunctionData({ abi: TEXT_ABI, functionName: 'text', args: [viem.namehash(ensName), key] }),
      ],
    });

  const ask = async (sender, callData) => {
    const res = await fetch(`${base}/api/ens/${sender}/${callData}.json`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  // The EVM half: the deployed resolver, with `signer` pointed at the gateway's key.
  const artifact = compileResolver();
  const common = new Common({chain: Chain.Mainnet, hardfork: Hardfork.Cancun});
  const vm = await VM.create({common});
  const addr = new Address(hexToBytes(RESOLVER));
  await vm.stateManager.putContractCode(addr, hexToBytes(`0x${artifact.evm.deployedBytecode.object}`));
  await vm.stateManager.putContractStorage(addr, hexToBytes(`0x${'00'.repeat(31)}01`), hexToBytes(SIGNER.toLowerCase()));
  const block = {
    header: {
      number: 1n,
      coinbase: Address.zero(),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      difficulty: 0n,
      prevRandao: hexToBytes(`0x${'00'.repeat(32)}`),
      gasLimit: 30_000_000n,
      baseFeePerGas: 0n,
      getBlobGasPrice: () => 0n,
    },
  };

  const verify = async (response, callData) => {
    const data = viem.encodeFunctionData({
      abi: artifact.abi,
      functionName: 'resolveWithProof',
      args: [response, callData],
    });
    const res = await vm.evm.runCall({to: addr, data: hexToBytes(data), gasLimit: 30_000_000n, block});
    if (res.execResult.exceptionError) return {reverted: true};
    const out = viem.decodeFunctionResult({
      abi: artifact.abi,
      functionName: 'resolveWithProof',
      data: bytesToHex(res.execResult.returnValue),
    });
    return {reverted: false, value: viem.decodeAbiParameters([{type: 'string'}], out)[0]};
  };

  hr('records, signed by the gateway and accepted by the resolver');
  let failures = 0;
  for (const key of ['surex:state', 'surex:severity', 'surex:tier', 'surex:fingerprint', 'url']) {
    const callData = callDataFor(name, key);
    const {status, body} = await ask(RESOLVER, callData);
    if (status !== 200 || !body?.data) {
      failures++;
      console.log(no(`${key.padEnd(20)} gateway ${status}: ${body?.error ?? ''} ${body?.detail ?? ''}`));
      continue;
    }
    const checked = await verify(body.data, callData);
    if (checked.reverted) {
      failures++;
      console.log(no(`${key.padEnd(20)} the resolver REJECTED the gateway's signature`));
    } else {
      console.log(ok(`${key.padEnd(20)} ${checked.value === '' ? '(empty)' : checked.value}`));
    }
  }

  hr('the refusals');
  const callData = callDataFor(name, 'surex:state');
  const checks = [
    ['a sender that is not our resolver is refused', await ask('0x' + 'de'.repeat(20), callData), 400],
    ['calldata that is not resolve(bytes,bytes) is refused', await ask(RESOLVER, '0xdeadbeef'), 400],
    [
      'an illustrative entry is never signed',
      await ask(RESOLVER, callDataFor(flag('illustrative-name', `sxf1-${'c'.repeat(40)}.surex.eth`), 'surex:state')),
      500,
    ],
  ];
  for (const [label, got, want] of checks) {
    const good = got.status === want;
    if (!good) failures++;
    console.log(good ? ok(`${label} → ${got.status}`) : no(`${label} → ${got.status}, expected ${want}`));
  }

  hr('a name with no entry');
  const missing = callDataFor(`sxf1-${'0'.repeat(40)}.surex.eth`, 'surex:state');
  const got = await ask(RESOLVER, missing);
  if (got.status === 200) {
    const checked = await verify(got.body.data, missing);
    const good = !checked.reverted && checked.value === 'unknown';
    if (!good) failures++;
    console.log(good ? ok(`no entry → signed "unknown", never "clean"`) : no(`no entry → ${JSON.stringify(checked)}`));
  } else {
    failures++;
    console.log(no(`no entry → ${got.status} ${got.body?.error ?? ''}`));
  }

  hr('result');
  console.log(failures === 0 ? ok('the gateway and the resolver interoperate') : no(`${failures} failed`));
  if (failures) process.exitCode = 1;
}

/**
 * A stand-in for `/v1/registry`, so the loop above can run without the real API.
 * Serves the shape `apps/api/src/app.mjs` documents: `{heads, total, byState}`.
 */
async function serveMock(port) {
  const { createServer } = await import('node:http');
  const heads = [
    {
      fingerprint: FP,
      state: 'flagged',
      severity: 4,
      tier: 'B',
      name: '@surex/fixture-mcp@0.1.0',
      reviewedAt: '2026-07-25T10:00:00.000Z',
      updatedAt: '2026-07-25T10:00:00.000Z',
    },
    {
      // Deliberately marked demo data. The gateway must refuse to sign it.
      fingerprint: `sxf1_${'c'.repeat(64)}`,
      state: 'clean',
      severity: 0,
      tier: 'A',
      illustrative: true,
    },
  ];
  const server = createServer((req, res) => {
    const json = (body) => {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/v1/registry')) {
      json({heads, total: heads.length, byState: {flagged: 1, clean: 1}});
      return;
    }
    // Enough of `/v1/entry/:fp` for the evidence page to render, so the ENS row
    // can be looked at rather than only asserted.
    if (req.url.startsWith('/v1/entry/')) {
      const fp = decodeURIComponent(req.url.slice('/v1/entry/'.length).split('?')[0]);
      const head = heads.find((h) => h.fingerprint === fp);
      if (!head) {
        res.writeHead(404, {'content-type': 'application/json'});
        res.end('{"error":"not_found"}');
        return;
      }
      json({head, summary: 'A stand-in entry served by probes/ens-resolve.mjs.', findings: []});
      return;
    }
    res.writeHead(404, {'content-type': 'application/json'});
    res.end('{}');
  });
  await new Promise((r) => server.listen(port, r));
  console.log(ok(`mock /v1/registry on :${port} — ${heads.length} heads, one of them illustrative`));
  return server;
}

/* ───────────────────────────────────────────── 5 · end to end (E5) ─────────*/

async function endToEnd({ rpcUrl, chain, name }) {
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  hr(`E5 · getEnsText against ${name}`);
  console.log(`  rpc   ${rpcUrl}`);
  const keys = ['surex:state', 'surex:severity', 'surex:tier', 'surex:fingerprint', 'url'];
  let failed = 0;
  for (const key of keys) {
    try {
      const value = await client.getEnsText({ name, key });
      console.log(ok(`${key.padEnd(20)} ${value === null ? '(no record)' : value}`));
    } catch (err) {
      failed++;
      console.log(no(`${key.padEnd(20)} ${String(err.shortMessage ?? err.message).split('\n')[0]}`));
    }
  }
  console.log(
    '\n  Every line above walked the full ERC-3668 path: eth_call → OffchainLookup\n' +
      '  revert → gateway fetch → resolveWithProof → ecrecover. A value printed here\n' +
      '  is a value the resolver accepted a signature for.',
  );
  if (failed) process.exitCode = 1;
}

/**
 * E6 · the DEPLOYED contract, hop by hop.
 *
 * `getEnsText` is a black box: when the path breaks it returns `null`, which is
 * indistinguishable from an empty record, and you learn nothing about which hop
 * failed. That is not hypothetical — it is exactly how the first mainnet
 * deployment hid a real bug. `resolve()` forwarded only `data` (the inner
 * `text(bytes32,string)` call) and dropped `name`, so the gateway received a
 * namehash it could not reverse and 400'd every request. 17 Foundry tests and
 * six in-process EVM cases all passed, because each half was checked against its
 * own idea of the request rather than against the other half. `gateway` mode
 * BUILDS the request the way the gateway parses it; nothing took what the
 * contract actually emits and fed it to the gateway.
 *
 * So this mode never constructs a request. It reads the real revert off chain,
 * asserts the invariant that was violated, then walks the rest of the path and
 * names the hop that breaks.
 */
async function live() {
  const viem = await import('viem');
  const { packetToBytes } = await import('viem/ens');
  const chains = await import('viem/chains');

  const name = flag('name', `${LABEL}.surex.eth`);
  const key = flag('key', 'surex:state');
  const chainName = flag('chain', 'mainnet');
  const chain = chains[chainName] ?? chains.mainnet;
  const rpcUrl = flag('rpc', chainName === 'mainnet' ? 'https://ethereum-rpc.publicnode.com' : undefined);
  const client = viem.createPublicClient({ chain, transport: viem.http(rpcUrl) });

  const RESOLVE_ABI = viem.parseAbi(['function resolve(bytes name, bytes data) view returns (bytes)']);
  const TEXT_ABI = viem.parseAbi(['function text(bytes32 node, string key) view returns (string)']);
  const PROOF_ABI = viem.parseAbi(['function resolveWithProof(bytes response, bytes extraData) view returns (bytes)']);
  const LOOKUP_ABI = viem.parseAbi([
    'error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)',
  ]);

  hr(`E6 · the deployed resolver, hop by hop — ${name}`);
  console.log(`  chain ${chain.name} (${chain.id})`);
  console.log(`  key   ${key}\n`);

  let failures = 0;
  const step = (good, label, detail = '') => {
    if (!good) failures++;
    console.log((good ? ok(label) : no(label)) + (detail ? `\n      ${detail}` : ''));
    return good;
  };

  // 1 — which resolver is the name actually pointed at?
  let resolver;
  try {
    resolver = await client.getEnsResolver({ name });
    step(Boolean(resolver), `resolver for the name        ${resolver}`);
  } catch (err) {
    step(false, 'resolver for the name', String(err.shortMessage ?? err.message).split('\n')[0]);
    console.log(no('\n  no resolver — setResolver has not been called on the parent'));
    process.exitCode = 1;
    return;
  }

  // 2 — the real revert, with CCIP-Read switched OFF so viem does not follow it.
  const inner = viem.encodeFunctionData({ abi: TEXT_ABI, functionName: 'text', args: [viem.namehash(name), key] });
  const outer = viem.encodeFunctionData({
    abi: RESOLVE_ABI,
    functionName: 'resolve',
    args: [viem.bytesToHex(packetToBytes(name)), inner],
  });

  let raw;
  try {
    const { data } = await client.call({ to: resolver, data: outer, ccipRead: false });
    // Not a failure. `ccipRead: false` is best-effort — when the whole path is
    // healthy viem can still follow the lookup and hand back the answer, and a
    // returned value means every hop below already worked. Reporting that as
    // "it did not revert" was this probe's own false negative: it called a
    // fully working deployment broken.
    const value = viem.decodeFunctionResult({
      abi: TEXT_ABI,
      functionName: 'text',
      data: viem.decodeFunctionResult({ abi: RESOLVE_ABI, functionName: 'resolve', data }),
    });
    console.log(ok(`the full path resolved in one call        ${key} = ${value}`));
    hr('result');
    console.log(ok('the deployed contract, the gateway and the signature all agree'));
    return;
  } catch (err) {
    raw = JSON.stringify(err).match(/0x556f1830[0-9a-fA-F]+/)?.[0];
    step(Boolean(raw), 'resolve() reverts with OffchainLookup');
  }
  if (!raw) {
    console.log(no('\n  cannot continue without the revert payload'));
    process.exitCode = 1;
    return;
  }

  const { args } = viem.decodeErrorResult({ abi: LOOKUP_ABI, data: raw });
  const [sender, urls, callData, , extraData] = args;

  // 3 — THE INVARIANT THAT WAS VIOLATED. The gateway needs the name, and a
  //     namehash cannot be reversed, so callData must be the whole resolve()
  //     call. Asserting the selector alone is not enough: the failure mode is a
  //     dropped name, so decode it and check the name survives.
  const selector = callData.slice(0, 10).toLowerCase();
  const expected = viem.toFunctionSelector('resolve(bytes,bytes)').toLowerCase();
  if (
    step(
      selector === expected,
      `callData is a resolve(bytes,bytes) call  ${selector}`,
      selector === expected
        ? ''
        : `expected ${expected}. The contract is forwarding the INNER call and dropping the name;\n` +
          '      the gateway gets a namehash it cannot reverse and will 400 every request.',
    )
  ) {
    try {
      const [gotName] = viem.decodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }],
        `0x${callData.slice(10)}`,
      );
      const label = leftmostLabelOf(gotName);
      step(
        label === name.split('.')[0],
        `the NAME reaches the gateway             ${label ?? '(none)'}`,
        label === name.split('.')[0] ? '' : 'the label is the only route to the fingerprint',
      );
    } catch {
      step(false, 'the NAME reaches the gateway', 'callData did not decode as (bytes,bytes)');
    }
  }

  step(extraData.toLowerCase() === callData.toLowerCase(), 'extraData === callData (digest is rebuilt over it)');
  step(sender.toLowerCase() === resolver.toLowerCase(), `sender is the resolver itself            ${sender}`);

  // 4 — the gateway, using the contract's own bytes. Never ours.
  const url = urls[0].replaceAll('{sender}', sender).replaceAll('{data}', callData);
  console.log(`\n  gateway ${urls[0]}`);
  let body;
  try {
    const res = await fetch(url);
    body = await res.json().catch(() => null);
    step(res.ok, `gateway answered                         HTTP ${res.status}`,
      res.ok ? '' : JSON.stringify(body).slice(0, 220));
  } catch (err) {
    step(false, 'gateway answered', String(err.message).slice(0, 200));
  }
  if (!body?.data) {
    console.log(no('\n  no signed payload to verify'));
    process.exitCode = 1;
    return;
  }

  // 5 — hand it back to the chain. This is the signature check, for real.
  try {
    const { data } = await client.call({
      to: resolver,
      data: viem.encodeFunctionData({ abi: PROOF_ABI, functionName: 'resolveWithProof', args: [body.data, extraData] }),
    });
    const returned = viem.decodeFunctionResult({ abi: PROOF_ABI, functionName: 'resolveWithProof', data });
    const value = viem.decodeFunctionResult({ abi: TEXT_ABI, functionName: 'text', data: returned });
    step(true, `resolveWithProof accepted it             ${key} = ${value}`);
  } catch (err) {
    step(false, 'resolveWithProof accepted it', String(err.shortMessage ?? err.message).split('\n')[0]);
  }

  hr('result');
  if (failures) {
    console.log(no(`${failures} failed — the hop named above is the one to fix`));
    process.exitCode = 1;
  } else {
    console.log(ok('the deployed contract, the gateway and the signature all agree'));
  }
}

/** DNS wire name → leftmost label. Mirrors `apps/web/lib/ens.ts`. */
function leftmostLabelOf(dnsEncoded) {
  const hex = dnsEncoded.startsWith('0x') ? dnsEncoded.slice(2) : dnsEncoded;
  if (hex.length < 2) return null;
  const length = Number.parseInt(hex.slice(0, 2), 16);
  if (!Number.isFinite(length) || length === 0 || length > 63) return null;
  const body = hex.slice(2, 2 + length * 2);
  if (body.length !== length * 2) return null;
  return Buffer.from(body, 'hex').toString('utf8');
}

/* ─────────────────────────────────────────────────────────────────── main ──*/

switch (mode) {
  case 'labels':
    await labels();
    break;
  case 'contract':
    await contract();
    break;
  case 'mock': {
    await serveMock(Number(flag('port', '4310')));
    // Deliberately does not exit — it is a server.
    break;
  }
  case 'gateway':
    await gateway();
    break;
  case 'live':
    await live();
    break;
  case 'sepolia': {
    const { sepolia } = await import('viem/chains');
    const name = flag('name');
    if (!name) {
      console.log(no('sepolia mode needs --name <the full ENS name>'));
      process.exit(1);
    }
    await endToEnd({
      rpcUrl: flag('rpc', process.env.SEPOLIA_RPC ?? 'https://rpc.sepolia.org'),
      chain: sepolia,
      name,
    });
    break;
  }
  default:
    console.log(`unknown mode "${mode}". one of: labels | contract | mock | gateway | live | sepolia`);
    process.exit(1);
}
