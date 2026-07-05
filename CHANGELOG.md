# Changelog

## 1.2.0 - Compaction, Checkpointing, And Release Hardening

- Added manual `compact()` support that rewrites visible immutable-segment documents into a compacted segment.
- Added WAL checkpoint metadata and WAL generation rotation after flush and compaction.
- Added obsolete segment cleanup and safe startup cleanup for known temporary segment directories.
- Added `db.stats()` diagnostics for read-only database state and storage metadata.
- Added deterministic TypeScript benchmark scripts for insert, search, reopen, and compaction measurements.

Current limitations: compaction is manual, posting files are correctness-first JSON structures, range indexing is basic, automatic background compaction is not implemented, and advanced scope-aware `elemMatch` indexing remains future work.

## 1.1.0 - Durable Mutation Support

- Added durable `delete(docId)` support through WAL tombstones and segment delete bitmaps.
- Added `update(docId, document)` as insert-new-version plus tombstone-old-version.
- Added recovery tests for delete and update WAL replay.
- Ensured deleted and superseded documents are excluded from memory and disk searches.

## 1.0.0 - Persistent Database Foundation

- Added the disk-backed `SabliDatabase` API.
- Added append-only WAL persistence, database directory management, manifest loading, immutable disk segments, document blocks, offset tables, Bloom filter files, and exact final verification.
- Added TypeSea validation for public inputs and persisted metadata boundaries.
- Added examples, consumer quickstart documentation, and consumer smoke coverage.
