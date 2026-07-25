# Vendored: `@mysten/walrus-wasm@0.3.0`

Copied verbatim, unmodified, from the `nodejs/` build of
[`@mysten/walrus-wasm`](https://www.npmjs.com/package/@mysten/walrus-wasm) version **0.3.0**
(Mysten Labs, Apache-2.0):

```
walrus_wasm.js        17 KB   wasm-bindgen glue (CommonJS)
walrus_wasm_bg.wasm  351 KB   the encoder
```

Only `package.json` (a `type: commonjs` marker) and this file were added.

## Why it is vendored rather than depended on

The SureX plugin is installed with `/plugin marketplace add` straight from a git repo. There is **no
`npm install` step on the user's machine**, so the gate cannot have a runtime dependency — including a
workspace one. Committing 376 KB keeps "nothing to install" true.

## Why it is needed at all

The gate's central claim is that a verdict points at the exact bytes it judged. Checking that means
recomputing a Walrus blob ID from bytes, and **a blob ID is not `sha256(bytes)`** — it is a commitment over
the erasure-coded sliver structure. Measured on a blob our own probe wrote and certified:

```
blob ID           -SzjTmxUSjs01bmC2AZ48iqz-fTCcllwcLu3nc2rb2Y
sha256/base64url  8EV8MBKjUbid8poZDYGJWVB0zy_oQ9ha7_gEfMH_Ktc
```

Without the encoder the gate could only *assert* that a content-addressed store returned what it asked for
— which is trusting the aggregator, and is not a check. With it, the gate recomputes the ID locally and
trusts neither the aggregator that served the bytes nor the API that pointed at them.

`packages/core/test/blobid.test.mjs` pins this against that real blob: recomputation reproduces the
on-chain ID exactly, and a single flipped bit does not.

## Upgrading

```bash
pnpm --dir probes add @mysten/walrus-wasm@<version>
cp probes/node_modules/@mysten/walrus-wasm/nodejs/walrus_wasm.js \
   probes/node_modules/@mysten/walrus-wasm/nodejs/walrus_wasm_bg.wasm \
   packages/plugin/lib/vendor/walrus-wasm/
node --test packages/core/test/blobid.test.mjs   # must still reproduce the real blob ID
```

Update the version in this file and in `package.json`. If the test fails after an upgrade, the encoding or
the network configuration changed — that is a fact to record on every record, not a bug to work around.
