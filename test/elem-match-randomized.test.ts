import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SabliDatabase, type DocId, type JsonObject, type JsonValue, type Query } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function objectOrders(document: JsonObject): readonly JsonObject[] {
  const orders = document.orders;
  if (!Array.isArray(orders)) {
    return [];
  }
  return orders.filter((value): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function stringField(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" ? value : undefined;
}

function nestedZone(order: JsonObject): string | undefined {
  const meta = order.meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return undefined;
  }
  return stringField(meta as JsonObject, "zone");
}

interface ReferenceQuery {
  readonly query: Query;
  readonly matches: (order: JsonObject) => boolean;
}

function referenceQueries(): readonly ReferenceQuery[] {
  const cases: ReferenceQuery[] = [];
  const kinds = ["book", "tool", "food"] as const;
  const states = ["paid", "pending", "cancelled"] as const;
  for (let index = 0; index < 12; index += 1) {
    const kind = kinds[index % kinds.length] ?? "book";
    const state = states[(index * 2) % states.length] ?? "paid";
    const minimum = 2_000 + index * 750;
    cases.push({
      query: {
        where: {
          path: "orders[]",
          elemMatch: {
            and: [
              { path: "kind", eq: kind },
              index % 2 === 0
                ? { path: "state", eq: state }
                : { path: "price", gte: minimum }
            ]
          }
        }
      },
      matches: index % 2 === 0
        ? (order) => stringField(order, "kind") === kind && stringField(order, "state") === state
        : (order) => stringField(order, "kind") === kind && (numberField(order, "price") ?? Number.NEGATIVE_INFINITY) >= minimum
    });
  }
  cases.push({
    query: {
      where: {
        path: "orders[]",
        elemMatch: {
          or: [
            { path: "meta.zone", eq: "north" },
            { path: "price", gt: 17_000 }
          ]
        }
      }
    },
    matches: (order) => nestedZone(order) === "north" || (numberField(order, "price") ?? Number.NEGATIVE_INFINITY) > 17_000
  });
  return cases;
}

function generatedDocuments(): readonly JsonObject[] {
  const random = randomGenerator(0x51a_b1_140);
  const documents: JsonObject[] = [];
  const kinds = ["book", "tool", "food"] as const;
  const states = ["paid", "pending", "cancelled"] as const;
  const zones = ["north", "south", "east", "west"] as const;
  for (let documentIndex = 0; documentIndex < 64; documentIndex += 1) {
    if (documentIndex % 17 === 0) {
      documents.push({ batch: documentIndex });
      continue;
    }
    const orderCount = documentIndex % 13 === 0 ? 0 : Math.floor(random() * 6);
    const orders: JsonValue[] = [];
    for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
      if ((documentIndex + orderIndex) % 19 === 0) {
        orders.push(orderIndex % 2 === 0 ? null : `primitive-${String(orderIndex)}`);
        continue;
      }
      const kind = kinds[Math.floor(random() * kinds.length)] ?? "book";
      const state = states[Math.floor(random() * states.length)] ?? "paid";
      const zone = zones[Math.floor(random() * zones.length)] ?? "north";
      orders.push({
        code: `D${String(documentIndex)}-O${String(orderIndex)}`,
        kind,
        state,
        price: Math.floor(random() * 20_000),
        meta: { zone }
      });
    }
    documents.push({ batch: documentIndex, orders });
  }
  return documents;
}

async function assertReferenceEquivalent(
  database: SabliDatabase,
  documents: readonly JsonObject[],
  docIds: readonly DocId[]
): Promise<void> {
  for (const reference of referenceQueries()) {
    const expected = documents.flatMap((document, index) =>
      objectOrders(document).some(reference.matches) ? [Number(docIds[index])] : []
    );
    const actual = (await database.search(reference.query)).documents.map(({ docId }) => Number(docId));
    expect(actual).toEqual(expected);
  }
}

describe("deterministic randomized elemMatch equivalence", () => {
  it("matches an independent raw reference in memory after flush reopen and compaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "sabli-elem-random-"));
    roots.push(root);
    const path = join(root, "database.sabli");
    const documents = generatedDocuments();
    const database = await SabliDatabase.open({
      path,
      createIfMissing: true,
      memSegmentMaxDocuments: 1_000,
      postingCache: { maxEntries: 64 }
    });
    const docIds: DocId[] = [];
    for (const document of documents) {
      docIds.push((await database.insert(document)).docId);
    }

    await assertReferenceEquivalent(database, documents, docIds);
    await database.flush();
    await assertReferenceEquivalent(database, documents, docIds);
    await database.close();

    const reopened = await SabliDatabase.open({ path, createIfMissing: false, postingCache: { maxEntries: 64 } });
    await assertReferenceEquivalent(reopened, documents, docIds);
    await reopened.compact();
    await assertReferenceEquivalent(reopened, documents, docIds);
    await reopened.close();
  });
});
