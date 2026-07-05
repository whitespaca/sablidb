import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  SabliCorruptionError,
  SabliDatabase,
  SabliDatabaseClosedError,
  SabliValidationError
} from "../src/index.js";
import { checksum, stableJson } from "../src/storage/Checksum.js";
import { toDocId } from "../src/types/json.js";
import type { WalRecord } from "../src/storage/WalStore.js";
import { parseDatabaseManifest } from "../src/storage/ManifestStore.js";

const roots: string[] = [];

async function tempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sabli-test-"));
  roots.push(root);
  return join(root, "database.sabli");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function encodeWal(record: WalRecord): string {
  return `${JSON.stringify({ record, checksum: checksum(stableJson(record)) })}\n`;
}

async function activeWalPath(path: string): Promise<string> {
  const manifest = parseDatabaseManifest(JSON.parse(await readFile(join(path, "MANIFEST-000001"), "utf8")));
  return join(path, `WAL-${String(manifest.activeWalGeneration).padStart(6, "0")}.log`);
}

async function segmentNames(path: string): Promise<readonly string[]> {
  return (await readdir(join(path, "segments"))).filter((name) => name.startsWith("seg-")).sort();
}

describe("SabliDatabase persistence", () => {
  it("opens a new database", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    expect(db.path).toBe(path);
    await db.close();
  });

  it("reopens an existing database", async () => {
    const path = await tempDbPath();
    await (await SabliDatabase.open({ path, createIfMissing: true })).close();
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    await reopened.close();
  });

  it("persists inserts across reopen", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "kim", age: 31 }, tags: ["backend"] });
    await db.close();
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    const matches = await reopened.search({ where: { "user.name": { eq: "kim" } } });
    expect(matches.count).toBe(1);
    await reopened.close();
  });

  it("replays WAL records after a process-like reopen", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "flushed" } });
    await db.close();
    await writeFile(
      await activeWalPath(path),
      encodeWal({
        format: "sabli-wal-record",
        version: 1,
        sequence: 2,
        type: "insert",
        docId: toDocId(2),
        document: { user: { name: "wal" }, tags: ["replay"] }
      })
    );
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    const matches = await reopened.search({ where: { "tags[]": { contains: "replay" } } });
    expect(matches.count).toBe(1);
    await reopened.close();
  });

  it("rejects an invalid manifest", async () => {
    const path = await tempDbPath();
    await (await SabliDatabase.open({ path, createIfMissing: true })).close();
    await writeFile(join(path, "MANIFEST-000001"), JSON.stringify({ format: "bad" }));
    await expect(SabliDatabase.open({ path, createIfMissing: false })).rejects.toThrow(SabliCorruptionError);
  });

  it("stops WAL replay at a corrupted trailing record", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "flushed" } });
    await db.close();
    const wal = encodeWal({
      format: "sabli-wal-record",
      version: 1,
      sequence: 2,
      type: "insert",
      docId: toDocId(2),
      document: { user: { name: "valid" } }
    });
    await writeFile(await activeWalPath(path), `${wal}{not-json`);
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    const matches = await reopened.search({ where: { "user.name": { eq: "valid" } } });
    expect(matches.count).toBe(1);
    await reopened.close();
  });

  it("flush creates an immutable segment", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "flushed" } });
    await db.flush();
    const matches = await db.search({ where: { "user.name": { eq: "flushed" } } });
    expect(matches.count).toBe(1);
    await expect(readFile(join(path, "segments", "seg-000001", "segment.meta.json"), "utf8")).resolves.toContain("sabli-segment");
    await db.close();
  });

  it("searches both memory and disk segments", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ tags: ["backend"], user: { name: "disk" } });
    await db.flush();
    await db.insert({ tags: ["backend"], user: { name: "mem" } });
    const matches = await db.search({ where: { "tags[]": { contains: "backend" } } });
    expect(matches.documents.map((hit) => hit.document.user)).toEqual([{ name: "disk" }, { name: "mem" }]);
    await db.close();
  });

  it("does not return deleted memory documents", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const inserted = await db.insert({ user: { name: "temporary" } });
    await db.delete(inserted.docId);
    const matches = await db.search({ where: { "user.name": { eq: "temporary" } } });
    expect(matches.count).toBe(0);
    await db.close();
  });

  it("does not return deleted disk segment documents", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const inserted = await db.insert({ user: { name: "disk-delete" } });
    await db.flush();
    await db.delete(inserted.docId);
    const matches = await db.search({ where: { "user.name": { eq: "disk-delete" } } });
    expect(matches.count).toBe(0);
    await expect(readFile(join(path, "segments", "seg-000001", "delete.bitmap"), "utf8")).resolves.toContain(String(inserted.docId));
    await db.close();
  });

  it("persists delete across reopen", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const inserted = await db.insert({ user: { name: "delete-persist" } });
    await db.flush();
    await db.delete(inserted.docId);
    await db.close();
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    const matches = await reopened.search({ where: { "user.name": { eq: "delete-persist" } } });
    expect(matches.count).toBe(0);
    await reopened.close();
  });

  it("updates a document as a new visible version", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const inserted = await db.insert({ user: { name: "old" } });
    const updated = await db.update(inserted.docId, { user: { name: "new" } });
    expect(updated.docId).not.toBe(inserted.docId);
    expect((await db.search({ where: { "user.name": { eq: "old" } } })).count).toBe(0);
    expect((await db.search({ where: { "user.name": { eq: "new" } } })).count).toBe(1);
    await db.close();
  });

  it("persists update across reopen without returning old versions", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const inserted = await db.insert({ user: { name: "old-disk" } });
    await db.flush();
    await db.update(inserted.docId, { user: { name: "new-disk" } });
    await db.close();
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    expect((await reopened.search({ where: { "user.name": { eq: "old-disk" } } })).count).toBe(0);
    expect((await reopened.search({ where: { "user.name": { eq: "new-disk" } } })).count).toBe(1);
    await reopened.close();
  });

  it("replays WAL delete state", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "wal-delete" } });
    await db.close();
    await writeFile(
      await activeWalPath(path),
      encodeWal({
        format: "sabli-wal-record",
        version: 1,
        sequence: 2,
        type: "delete",
        docId: toDocId(1)
      })
    );
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    expect((await reopened.search({ where: { "user.name": { eq: "wal-delete" } } })).count).toBe(0);
    await reopened.close();
  });

  it("replays WAL update state represented as delete plus insert", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "wal-old" } });
    await db.close();
    await writeFile(
      await activeWalPath(path),
      `${encodeWal({
        format: "sabli-wal-record",
        version: 1,
        sequence: 2,
        type: "delete",
        docId: toDocId(1)
      })}${encodeWal({
        format: "sabli-wal-record",
        version: 1,
        sequence: 3,
        type: "insert",
        docId: toDocId(2),
        document: { user: { name: "wal-new" } }
      })}`
    );
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    expect((await reopened.search({ where: { "user.name": { eq: "wal-old" } } })).count).toBe(0);
    expect((await reopened.search({ where: { "user.name": { eq: "wal-new" } } })).count).toBe(1);
    await reopened.close();
  });

  it("prevents writes after close", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.close();
    await expect(db.insert({ closed: true })).rejects.toThrow(SabliDatabaseClosedError);
  });

  it("rejects invalid database options", async () => {
    await expect(SabliDatabase.open({ path: "", createIfMissing: true })).rejects.toThrow(SabliValidationError);
  });

  it("rejects invalid queries", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await expect(db.search({ where: { and: [] } })).rejects.toThrow(SabliValidationError);
    await db.close();
  });

  it("compaction preserves visible documents and replaces old segments", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true, memSegmentMaxDocuments: 1 });
    await db.insert({ user: { name: "one" }, tags: ["live"] });
    await db.insert({ user: { name: "two" }, tags: ["live"] });
    expect(await segmentNames(path)).toHaveLength(2);
    const before = await db.search({ where: { "tags[]": { contains: "live" } } });
    await db.compact();
    const after = await db.search({ where: { "tags[]": { contains: "live" } } });
    expect(after.documents).toEqual(before.documents);
    expect(await segmentNames(path)).toHaveLength(1);
    await db.close();
  });

  it("compaction removes deleted documents from the compacted segment", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const deleted = await db.insert({ user: { name: "deleted" } });
    await db.insert({ user: { name: "kept" } });
    await db.flush();
    await db.delete(deleted.docId);
    await db.compact();
    await db.close();
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    expect((await reopened.search({ where: { "user.name": { eq: "deleted" } } })).count).toBe(0);
    expect((await reopened.search({ where: { "user.name": { eq: "kept" } } })).count).toBe(1);
    await reopened.close();
  });

  it("compaction removes superseded versions after update", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const old = await db.insert({ user: { name: "old-compact" } });
    await db.flush();
    await db.update(old.docId, { user: { name: "new-compact" } });
    await db.compact();
    await db.close();
    const reopened = await SabliDatabase.open({ path, createIfMissing: false });
    expect((await reopened.search({ where: { "user.name": { eq: "old-compact" } } })).count).toBe(0);
    expect((await reopened.search({ where: { "user.name": { eq: "new-compact" } } })).count).toBe(1);
    await reopened.close();
  });

  it("update then delete followed by compaction returns no document", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    const old = await db.insert({ user: { name: "gone-old" } });
    await db.flush();
    const replacement = await db.update(old.docId, { user: { name: "gone-new" } });
    await db.delete(replacement.docId);
    await db.compact();
    expect((await db.search({ where: { "user.name": { eq: "gone-old" } } })).count).toBe(0);
    expect((await db.search({ where: { "user.name": { eq: "gone-new" } } })).count).toBe(0);
    await db.close();
  });

  it("checkpoint advances and rotates WAL after compaction", async () => {
    const path = await tempDbPath();
    const db = await SabliDatabase.open({ path, createIfMissing: true });
    await db.insert({ user: { name: "checkpoint" } });
    await db.flush();
    const before = parseDatabaseManifest(JSON.parse(await readFile(join(path, "MANIFEST-000001"), "utf8")));
    await db.compact();
    const after = parseDatabaseManifest(JSON.parse(await readFile(join(path, "MANIFEST-000001"), "utf8")));
    expect(after.flushedWalSequence).toBeGreaterThanOrEqual(before.flushedWalSequence);
    expect(after.activeWalGeneration).toBeGreaterThan(before.activeWalGeneration);
    await db.insert({ user: { name: "after-checkpoint" } });
    await expect(readFile(await activeWalPath(path), "utf8")).resolves.toContain("after-checkpoint");
    await db.close();
  });
});
