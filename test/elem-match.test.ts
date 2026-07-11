import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SabliDatabase,
  SabliEngine,
  verifyDocument,
  type JsonObject,
  type Query
} from "../src/index.js";

const roots: string[] = [];

async function temporaryDatabasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sabli-elem-match-"));
  roots.push(root);
  return join(root, "database.sabli");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const a1HighPriceQuery = {
  where: {
    path: "orders[]",
    elemMatch: {
      and: [
        { path: "id", eq: "A1" },
        { path: "price", gt: 10_000 }
      ]
    }
  }
} as const satisfies Query;

const canonicalCrossElementDocument: JsonObject = {
  label: "cross-element",
  orders: [
    { id: "A1", price: 8_000 },
    { id: "A2", price: 12_000 }
  ]
};

async function databaseIds(database: SabliDatabase, query: Query): Promise<readonly number[]> {
  return (await database.search(query)).documents.map(({ docId }) => Number(docId));
}

describe("exact elemMatch verification", () => {
  it("rejects the canonical cross-element false positive and accepts a same-element match", () => {
    const normalizedA1: Query = {
      where: {
        path: "$.orders[]",
        elemMatch: {
          and: [
            { path: "$.id", eq: "A1" },
            { path: "$.price", gt: 10_000 }
          ]
        }
      }
    };
    const normalizedA2: Query = {
      where: {
        path: "$.orders[]",
        elemMatch: {
          and: [
            { path: "$.id", eq: "A2" },
            { path: "$.price", gt: 10_000 }
          ]
        }
      }
    };

    expect(verifyDocument(canonicalCrossElementDocument, normalizedA1)).toBe(false);
    expect(verifyDocument(canonicalCrossElementDocument, normalizedA2)).toBe(true);
  });

  it("evaluates target edge cases and child paths from one concrete element", () => {
    const nested: Query = {
      where: {
        path: "$.orders[]",
        elemMatch: {
          and: [
            { path: "$.shipping.address.city", eq: "Seoul" },
            { path: "$.total", gte: 20_000 }
          ]
        }
      }
    };
    expect(verifyDocument({ orders: [] }, nested)).toBe(false);
    expect(verifyDocument({ customer: "missing" }, nested)).toBe(false);
    expect(verifyDocument({ orders: { shipping: { address: { city: "Seoul" } }, total: 30_000 } }, nested)).toBe(false);
    expect(verifyDocument({
      orders: [
        { shipping: { address: { city: "Seoul" } }, total: 8_000 },
        { shipping: { address: { city: "Busan" } }, total: 30_000 }
      ]
    }, nested)).toBe(false);
    expect(verifyDocument({
      orders: [{ shipping: { address: { city: "Seoul" } }, total: 30_000 }]
    }, nested)).toBe(true);
  });

  it("defines primitive, null, mixed, duplicate, and multiple-element behavior", () => {
    const primitive: Query = {
      where: { path: "$.values[]", elemMatch: { path: "$", gt: 5 } }
    };
    const nullElement: Query = {
      where: { path: "$.values[]", elemMatch: { path: "$", eq: null } }
    };
    const objectElement: Query = {
      where: { path: "$.values[]", elemMatch: { path: "$.code", eq: "ok" } }
    };
    const document: JsonObject = {
      values: [null, 2, 9, { code: "ok" }, { code: "ok" }]
    };

    expect(verifyDocument(document, primitive)).toBe(true);
    expect(verifyDocument(document, nullElement)).toBe(true);
    expect(verifyDocument(document, objectElement)).toBe(true);
  });
});

describe("in-memory elemMatch indexing", () => {
  it("uses common element scopes while ordinary document AND remains unchanged", async () => {
    const engine = new SabliEngine();
    await engine.insert(canonicalCrossElementDocument);
    await engine.insert({
      label: "same-element",
      orders: [
        { id: "A1", price: 15_000 },
        { id: "B1", price: 2_000 }
      ]
    });

    expect((await engine.search(a1HighPriceQuery)).documents.map(({ docId }) => Number(docId))).toEqual([2]);
    expect((await engine.search({
      where: {
        and: [
          { path: "orders[].id", eq: "A1" },
          { path: "orders[].price", gt: 10_000 }
        ]
      }
    })).documents.map(({ docId }) => Number(docId))).toEqual([1, 2]);
  });

  it("supports OR, nested child object paths, primitive arrays, and mixed arrays", async () => {
    const engine = new SabliEngine();
    await engine.insert({
      values: [null, "ready", { code: "object" }],
      orders: [
        { id: "low", total: 4_000, shipping: { address: { city: "Seoul" } } },
        { id: "high", total: 30_000, shipping: { address: { city: "Busan" } } }
      ]
    });

    await expect(engine.search({ where: { path: "values[]", elemMatch: { path: "$", eq: "ready" } } }))
      .resolves.toMatchObject({ count: 1 });
    await expect(engine.search({ where: { path: "values[]", elemMatch: { path: "code", eq: "object" } } }))
      .resolves.toMatchObject({ count: 1 });
    await expect(engine.search({
      where: {
        path: "orders[]",
        elemMatch: {
          or: [
            { path: "shipping.address.city", eq: "Seoul" },
            { path: "total", gt: 20_000 }
          ]
        }
      }
    })).resolves.toMatchObject({ count: 1 });
    await expect(engine.search({
      where: {
        path: "orders[]",
        elemMatch: {
          and: [
            { path: "shipping.address.city", eq: "Seoul" },
            { path: "total", gt: 20_000 }
          ]
        }
      }
    })).resolves.toMatchObject({ count: 0 });
  });

  it("keeps ordinary primitive-array contains behavior", async () => {
    const engine = new SabliEngine();
    await engine.insert({ tags: ["typescript", "storage"] });
    await expect(engine.search({ where: { path: "tags[]", contains: "storage" } }))
      .resolves.toMatchObject({ count: 1 });
  });

  it("distinguishes concrete elements of nested arrays", async () => {
    const engine = new SabliEngine();
    await engine.insert({
      orders: [{
        id: "outer",
        lines: [
          { sku: "X", quantity: 1 },
          { sku: "Y", quantity: 10 }
        ]
      }]
    });

    await expect(engine.search({
      where: {
        path: "orders[].lines[]",
        elemMatch: {
          and: [
            { path: "sku", eq: "X" },
            { path: "quantity", gt: 5 }
          ]
        }
      }
    })).resolves.toMatchObject({ count: 0 });
    await expect(engine.search({
      where: {
        path: "orders[].lines[]",
        elemMatch: {
          and: [
            { path: "sku", eq: "Y" },
            { path: "quantity", gt: 5 }
          ]
        }
      }
    })).resolves.toMatchObject({ count: 1 });
  });
});

describe("persistent elemMatch lifecycle", () => {
  it.each([
    { label: "enabled", postingCache: { maxEntries: 16 } as const },
    { label: "disabled", postingCache: { enabled: false } as const }
  ])("preserves exact results through flush reopen update delete and compaction with cache $label", async ({ postingCache }) => {
    const path = await temporaryDatabasePath();
    const database = await SabliDatabase.open({
      path,
      createIfMissing: true,
      memSegmentMaxDocuments: 100,
      postingCache
    });
    const cross = await database.insert(canonicalCrossElementDocument);
    const changed = await database.insert({
      label: "changed-later",
      orders: [{ id: "A1", price: 18_000 }]
    });
    const stable = await database.insert({
      label: "stable",
      orders: [
        { id: "A1", price: 21_000 },
        { id: "A1", price: 22_000 }
      ]
    });

    expect(await databaseIds(database, a1HighPriceQuery)).toEqual([Number(changed.docId), Number(stable.docId)]);
    await database.flush();
    expect(await databaseIds(database, a1HighPriceQuery)).toEqual([Number(changed.docId), Number(stable.docId)]);
    expect(await databaseIds(database, a1HighPriceQuery)).toEqual([Number(changed.docId), Number(stable.docId)]);
    const cacheStats = await database.stats();
    if ("enabled" in postingCache) {
      expect(cacheStats).toMatchObject({ postingCacheMaxEntries: 0, postingCacheSize: 0, postingCacheHits: 0 });
    } else {
      expect(cacheStats.postingCacheHits).toBeGreaterThan(0);
    }
    await database.close();

    const reopened = await SabliDatabase.open({ path, createIfMissing: false, postingCache });
    expect(await databaseIds(reopened, a1HighPriceQuery)).toEqual([Number(changed.docId), Number(stable.docId)]);
    await reopened.update(changed.docId, { label: "no-longer-matches", orders: [{ id: "A1", price: 1_000 }] });
    expect(await databaseIds(reopened, a1HighPriceQuery)).toEqual([Number(stable.docId)]);
    await reopened.update(cross.docId, { label: "now-matches", orders: [{ id: "A1", price: 31_000 }] });
    expect((await reopened.search(a1HighPriceQuery)).count).toBe(2);
    const nowMatching = (await reopened.search({ where: { path: "label", eq: "now-matches" } })).documents[0];
    if (nowMatching === undefined) {
      throw new Error("Expected updated matching document.");
    }
    await reopened.delete(nowMatching.docId);
    expect(await databaseIds(reopened, a1HighPriceQuery)).toEqual([Number(stable.docId)]);
    await reopened.compact();
    expect(await databaseIds(reopened, a1HighPriceQuery)).toEqual([Number(stable.docId)]);
    await reopened.close();

    const compacted = await SabliDatabase.open({ path, createIfMissing: false, postingCache });
    expect(await databaseIds(compacted, a1HighPriceQuery)).toEqual([Number(stable.docId)]);
    await compacted.close();
  });
});
