/**
 * Probe: write ONE blob to Walrus testnet, certify it, capture BOTH Sui tx digests,
 * then read the bytes back and prove they round-trip.
 *
 * Throwaway verification script. Not product code.
 *
 *   node probes/walrus-write.mjs
 *
 * Deps live in probes/package.json: @mysten/sui 2.22.1 + @mysten/walrus 1.2.9 (exact peer pairing).
 *
 * Constraints this probe honours (AGENTS.md §7):
 *  - No Walrus package / object / exchange IDs hardcoded. Everything is read at runtime from
 *    the SDK's network config + the on-chain type of the object it points at.
 *  - Blob mode is owned + permanent (deletable: false).
 *  - Epoch count is the on-chain maximum, read from the system object's future-accounting ring
 *    buffer length -- NOT a constant copied out of a doc.
 *  - The private key is read from a file OUTSIDE this repo. Nothing secret is written here.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';

const SECRETS_FILE =
  process.env.SUREX_SECRETS_FILE ??
  'C:/Users/STZTR/Desktop/claude-code-environment/.secrets/surex-wallets.txt';
const FULLNODE = 'https://fullnode.testnet.sui.io:443';
const AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

// Fixed bytes, no timestamp: the blob ID is content-derived, so a stable payload lets the same
// script demonstrate deduplication on a second run.
const PAYLOAD = new TextEncoder().encode(
  'SureX Walrus probe | ETHGlobal Lisbon 2026 | nonce=6f2a91c4d0e75b38 | one blob write = two Sui transactions (register + certify)\n',
);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadKeypair() {
  if (process.env.SUREX_SUI_SECRET) return Ed25519Keypair.fromSecretKey(process.env.SUREX_SUI_SECRET);
  const section = readFileSync(SECRETS_FILE, 'utf8').split('[sui-testnet]')[1];
  if (!section) throw new Error(`no [sui-testnet] section in ${SECRETS_FILE}`);
  const secret = section.match(/private_key=(\S+)/)?.[1];
  if (!secret) throw new Error(`no private_key= under [sui-testnet] in ${SECRETS_FILE}`);
  return Ed25519Keypair.fromSecretKey(secret);
}

/** signer.signAndExecuteTransaction returns a tagged union; unwrap it and surface the digest. */
async function execute(client, transaction, signer, label) {
  transaction.setSenderIfNotSet(signer.toSuiAddress());
  const result = await signer.signAndExecuteTransaction({ transaction, client });
  if (result.FailedTransaction) {
    throw new Error(
      `${label} failed (${result.FailedTransaction.digest}): ${result.FailedTransaction.status.error?.message}`,
    );
  }
  const { digest, effects } = result.Transaction;
  await client.core.waitForTransaction({ digest });
  log(`  ${label} tx: ${digest}`);
  return { digest, effects };
}

const keypair = loadKeypair();
const address = keypair.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: FULLNODE }).$extend(walrus());

log('# 0. wallet');
log('  address:', address);

const { balances } = await client.core.listBalances({ owner: address });
const balOf = (t) => BigInt(balances.find((b) => b.coinType.endsWith(t))?.balance ?? 0n);
const suiBalance = balOf('::sui::SUI');
let walBalance = balOf('::wal::WAL');
log('  SUI:', suiBalance.toString(), 'MIST | WAL:', walBalance.toString(), 'FROST');
if (suiBalance === 0n) throw new Error('wallet has no SUI - fund it at https://faucet.sui.io first');

// 1. WAL. The SDK ships the testnet SUI->WAL exchange object IDs; the exchange package ID is
//    derived from the on-chain TYPE of that object, so nothing here is pinned by hand.
if (walBalance === 0n) {
  log('\n# 1. no WAL -> swapping 0.5 SUI for WAL');
  const exchangeId = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds[0];
  const { object: exchange } = await client.core.getObject({ objectId: exchangeId });
  const exchangePackageId = exchange.type.split('::')[0];
  log('  exchange object:', exchangeId);
  log('  exchange package (from object type, runtime):', exchangePackageId);

  const tx = new Transaction();
  const payment = tx.splitCoins(tx.gas, [500_000_000]);
  const wal = tx.moveCall({
    target: `${exchangePackageId}::wal_exchange::exchange_all_for_wal`,
    arguments: [tx.object(exchangeId), payment],
  });
  tx.transferObjects([wal], address);
  await execute(client, tx, keypair, 'exchange');

  const after = await client.core.listBalances({ owner: address });
  walBalance = BigInt(after.balances.find((b) => b.coinType.endsWith('::wal::WAL'))?.balance ?? 0n);
  log('  WAL now:', walBalance.toString(), 'FROST');
} else {
  log('\n# 1. WAL already held, skipping swap');
}

// 2. Epochs. Read the real maximum off chain instead of trusting a doc.
const systemState = await client.walrus.systemState();
const maxEpochs = systemState.future_accounting.length;
const currentEpoch = systemState.committee.epoch;
log('\n# 2. storage term');
log('  walrus epoch:', currentEpoch, '| max epochs ahead (on chain):', maxEpochs);

const { storageCost, writeCost, totalCost } = await client.walrus.storageCost(PAYLOAD.length, maxEpochs);
log(`  quote for ${PAYLOAD.length} B x ${maxEpochs} epochs: storage=${storageCost} write=${writeCost} total=${totalCost} FROST`);

// 3. The write, one step at a time, so both transactions are ours to capture.
//    flow.executeRegister/executeCertify exist but executeCertify DISCARDS the digest, so the
//    register()/certify() transaction builders are used and executed by hand instead.
log('\n# 3. write');
const flow = client.walrus.writeBlobFlow({ blob: PAYLOAD });

const encoded = await flow.encode();
log('  encoded. blobId:', encoded.blobId);
log('  rootHash (base64):', encoded.rootHash);

const registerTx = flow.register({ epochs: maxEpochs, owner: address, deletable: false });
const register = await execute(client, registerTx, keypair, 'register');
const registerTxDigest = register.digest;

const uploaded = await flow.upload({ digest: registerTxDigest });
const suiObjectId = uploaded.blobObjectId;
log('  slivers uploaded to storage nodes. Blob object:', suiObjectId);

const certifyTx = flow.certify();
const certify = await execute(client, certifyTx, keypair, 'certify');
const certifyTxDigest = certify.digest;

const blob = await flow.getBlob();
log('  certified epoch:', blob.blobObject.certified_epoch);
log('  deletable:', blob.blobObject.deletable, '| storage epochs:', blob.blobObject.storage.start_epoch, '->', blob.blobObject.storage.end_epoch);

// 4. Is the blob ID just a hash of the bytes? (A later feature depends on the answer.)
log('\n# 4. blob id vs sha256');
const sha256Hex = createHash('sha256').update(PAYLOAD).digest('hex');
const sha256B64Url = createHash('sha256').update(PAYLOAD).digest('base64url');
log('  blobId          :', encoded.blobId);
log('  sha256 (hex)    :', sha256Hex);
log('  sha256 (b64url) :', sha256B64Url);
log('  blobId === sha256(bytes)?', encoded.blobId === sha256B64Url ? 'YES' : 'NO');

// 5. Read back and compare bytes. Aggregator can 404 right after certification.
log('\n# 5. read back');
const viaSdk = await client.walrus.readBlob({ blobId: encoded.blobId });
const sdkMatches = Buffer.from(viaSdk).equals(Buffer.from(PAYLOAD));
log('  via SDK readBlob   :', viaSdk.length, 'B, bytes identical:', sdkMatches);

let aggregatorMatches = null;
for (let i = 1; i <= 8; i++) {
  const res = await fetch(`${AGGREGATOR}/v1/blobs/${encoded.blobId}`);
  if (res.ok) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    aggregatorMatches = Buffer.from(bytes).equals(Buffer.from(PAYLOAD));
    log(`  via HTTP aggregator: ${bytes.length} B, bytes identical: ${aggregatorMatches} (attempt ${i})`);
    break;
  }
  log(`  aggregator attempt ${i}: HTTP ${res.status}, retrying`);
  await sleep(2000 * i);
}

// 6. Identical bytes should dedupe rather than pay again.
log('\n# 6. rewrite the same bytes (dedup check)');
const flow2 = client.walrus.writeBlobFlow({ blob: PAYLOAD });
const encoded2 = await flow2.encode();
log('  same blobId on re-encode:', encoded2.blobId === encoded.blobId);
const status = await client.walrus.getVerifiedBlobStatus({ blobId: encoded.blobId });
log('  on-chain blob status:', JSON.stringify(status));

log('\n================ CAPTURED ================');
log('blobId           :', encoded.blobId);
log('suiObjectId      :', suiObjectId);
log('registerTxDigest :', registerTxDigest);
log('certifyTxDigest  :', certifyTxDigest);
log('explorer         : https://suiscan.xyz/testnet/tx/' + registerTxDigest);
log('                   https://suiscan.xyz/testnet/tx/' + certifyTxDigest);
log('                   https://suiscan.xyz/testnet/object/' + suiObjectId);
log('aggregator       : ' + AGGREGATOR + '/v1/blobs/' + encoded.blobId);
log('bytes round-trip : SDK=' + sdkMatches + ' aggregator=' + aggregatorMatches);
log('==========================================');
