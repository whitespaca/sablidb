# SABLI

[![npm version](https://img.shields.io/npm/v/sablidb.svg)](https://www.npmjs.com/package/sablidb)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![npm](https://img.shields.io/npm/dt/sablidb)

SABLI is an ESModule-only TypeScript library for indexing and searching unordered schema-less JSON documents. SABLI stands for Segmented Adaptive Bloom-LSM Inverted Index.

This initial package provides a correctness-first embedded database with a memory write buffer, append-only WAL, immutable disk segments, advisory Bloom pruning, adaptive posting abstractions, and exact final verification.

## Installation

```bash
npm install sablidb
```

SABLI targets Node.js 22 or later and is published as ESModule only.

## Basic Usage

```ts
import { SabliDatabase } from "sablidb";

const db = await SabliDatabase.open({
  path: "./data/users.sabli",
  createIfMissing: true
});

await db.insert({
  user: { name: "Kim", age: 31 },
  tags: ["backend", "typescript"]
});

const results = await db.search({
  where: {
    and: [
      { path: "user.name", eq: "Kim" },
      { path: "tags[]", contains: "backend" }
    ]
  }
});

console.log(results.documents);

await db.close();
```

## Delete And Update

Delete writes a tombstone to the WAL before the call resolves:

```ts
const inserted = await db.insert({
  user: { name: "Lee", age: 28 },
  tags: ["frontend"]
});

await db.delete(inserted.docId);
```

Update is implemented as a new visible document version plus a tombstone for the old document identifier:

```ts
const first = await db.insert({
  user: { name: "Park", role: "developer" }
});

const next = await db.update(first.docId, {
  user: { name: "Park", role: "architect" }
});

console.log(next.docId);
```

Search never returns deleted documents or superseded old versions. Disk segments use versioned `delete.bitmap` files to filter tombstoned identifiers before raw documents are fetched.

## Query Examples

Field-map syntax:

```ts
await db.search({
  where: {
    "user.name": { eq: "Kim" },
    "tags[]": { contains: "typescript" }
  }
});
```

Explicit Boolean syntax:

```ts
await db.search({
  where: {
    and: [
      { path: "user.age", gte: 30 },
      { path: "tags[]", contains: "backend" }
    ]
  }
});
```

Supported initial operators include `eq`, `neq`, `exists`, `contains`, `gt`, `gte`, `lt`, `lte`, `between`, `and`, `or`, and `not`.

## Validation Behavior

All public inputs are validated at runtime with TypeSea-backed SABLI validation helpers. Validation failures are wrapped in SABLI error classes such as `SabliValidationError` and `SabliCorruptionError`.

Documents must be JSON-compatible plain objects. Values such as `undefined`, `Date`, `Map`, `Set`, functions, symbols, and bigint values must be serialized before insertion.

## Correctness Model

Indexes and Bloom filters only generate candidate documents. SABLI verifies every candidate against the raw JSON document before returning it, so final search results follow exact query semantics.

## Disk Layout

A SABLI database is a directory with a lock file, `CURRENT`, a versioned manifest, one append-only WAL file, and immutable segment directories:

```txt
database.sabli/
  LOCK
  CURRENT
  MANIFEST-000001
  WAL-000001.log
  segments/
    seg-000001/
      segment.meta.json
      docs.bin
      docs.offset
      path.dict
      value.dict
      postings.idx
      bloom.bin
      delete.bitmap
```

Inserts, deletes, and updates are appended to the WAL before they are acknowledged in strict durability mode. `flush()` writes the current memory segment to an immutable disk segment and updates the manifest atomically.

## Durability And Recovery

The default durability mode is `strict`, which asks Node.js to flush WAL appends before acknowledging writes. On startup, SABLI reads `CURRENT`, validates the active manifest, opens immutable segments, loads delete bitmaps, and replays valid WAL records newer than the manifest checkpoint.

Partial trailing WAL records are handled deterministically by stopping at the last valid record. Checksum mismatches are treated as controlled recovery errors.

## Current Limitations

This release is a persistent correctness foundation. Compaction is still future work, so deleted and superseded versions may remain on disk until a later compaction milestone. Optimized posting encodings, richer delete bitmap management, and advanced scope-aware array `elemMatch` semantics are also planned future work.
