// @surex/worker — the write path.
//
// This package WRITES. It never serves reads: apps/api holds no wallet and the
// gate holds no wallet, so a compromise of either cannot rewrite the registry.
// Only this wallet's writes are trusted, and every consumer read filters on it
// with `.createdBy` (never `ownedBy` — ownership is transferable).

export * from './src/config.mjs';
export * from './src/walrus.mjs';
export * from './src/arkiv.mjs';
export * from './src/entities.mjs';
export * from './src/licence.mjs';
export * from './src/registry.mjs';
export * from './src/progress.mjs';
