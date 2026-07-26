// Explorer URLs for a record. The one place recorded identifiers (blobId,
// suiObjectId, both tx digests) become links, so no route hand-rolls a path.
//
// Bases are read from env at CALL time, not at import time — a test that sets an
// env var after importing must still see it.

import { DEFAULT_AGGREGATORS } from '@surex/core';

/**
 * The path is `/entity/<entityKey>` (checked live 2026-07-25). `/entities/<key>`
 * and `/storage/entity/<key>` both 404 — do not guess the path.
 */
export const DEFAULT_ARKIV_EXPLORER = 'https://explorer.braga.hoodi.arkiv.network';

/** Suiscan testnet. Object and tx paths differ, so both are built here. */
export const DEFAULT_SUI_EXPLORER = 'https://suiscan.xyz/testnet';

const trim = (s) => String(s).replace(/\/+$/, '');

export function bases(env = process.env) {
  return {
    arkiv: trim(env.SUREX_ARKIV_EXPLORER_BASE || DEFAULT_ARKIV_EXPLORER),
    sui: trim(env.SUREX_SUI_EXPLORER_BASE || DEFAULT_SUI_EXPLORER),
    walrus: trim(env.SUREX_WALRUS_AGGREGATOR || DEFAULT_AGGREGATORS[0]),
  };
}

export function arkivEntityUrl(entityKey, env = process.env) {
  if (!entityKey) return null;
  return `${bases(env).arkiv}/entity/${encodeURIComponent(entityKey)}`;
}

/**
 * Links for one Walrus record. Anything the record does not carry is omitted
 * rather than guessed — a dead link that looks alive is worse than no link.
 * Accepts either the `evidence` shape ({blobId, …}) or the `blob` shape ({id, …}).
 */
export function recordLinks(pointer, env = process.env) {
  if (!pointer || typeof pointer !== 'object') return null;
  const b = bases(env);
  const blobId = pointer.blobId ?? pointer.id ?? null;
  const suiObjectId = pointer.suiObjectId ?? null;
  const registerTx = pointer.registerTx ?? pointer.registerTxDigest ?? null;
  const certifyTx = pointer.certifyTx ?? pointer.certifyTxDigest ?? null;

  const out = {};
  if (blobId) out.blob = `${b.walrus}/v1/blobs/${encodeURIComponent(blobId)}`;
  if (suiObjectId) out.suiObject = `${b.sui}/object/${encodeURIComponent(suiObjectId)}`;
  if (registerTx) out.registerTx = `${b.sui}/tx/${encodeURIComponent(registerTx)}`;
  if (certifyTx) out.certifyTx = `${b.sui}/tx/${encodeURIComponent(certifyTx)}`;
  return Object.keys(out).length ? out : null;
}

/** Normalise a record for the wire: keep the pointer, add the links beside it. */
export function withLinks(record, env = process.env) {
  if (!record || typeof record !== 'object') return record;
  const pointer = record.evidence ?? record.blob ?? null;
  const links = recordLinks(pointer, env);
  const arkiv = arkivEntityUrl(record.key ?? record.arkivEntityKey, env);
  if (!links && !arkiv) return record;
  return { ...record, links: { ...(links ?? {}), ...(arkiv ? { arkivEntity: arkiv } : {}) } };
}
