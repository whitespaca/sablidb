import { describe, expect, it } from "vitest";
import { MutableSegment } from "../src/indexes/mutable-segment.js";
import type { QueryExpression } from "../src/query/ast.js";
import { MemSegment } from "../src/segment/MemSegment.js";
import { toDocId } from "../src/types/json.js";

const bloomOptions = { expectedEntries: 100, falsePositiveRate: 0.01 } as const;

const sameElementQuery: QueryExpression = {
  path: "$.orders[]",
  elemMatch: {
    and: [
      { path: "$.id", eq: "A1" },
      { path: "$.price", gt: 10_000 }
    ]
  }
};

const crossElementDocument = {
  orders: [
    { id: "A1", price: 8_000 },
    { id: "A2", price: 12_000 }
  ]
};

const sameElementDocument = {
  orders: [{ id: "A1", price: 12_000 }]
};

describe("scope-aware memory indexes", () => {
  it("requires a common scope in the persistent database memory segment", () => {
    const segment = new MemSegment(bloomOptions);
    segment.insertWithDocId(toDocId(1), crossElementDocument, 1);
    segment.insertWithDocId(toDocId(2), sameElementDocument, 2);
    expect(segment.candidates(sameElementQuery).toArray()).toEqual([2]);

    segment.delete(toDocId(2), 3);
    expect(segment.candidates(sameElementQuery).toArray()).toEqual([]);
  });

  it("requires a common scope in the standalone mutable segment", () => {
    const segment = new MutableSegment(bloomOptions);
    segment.insert(crossElementDocument);
    segment.insert(sameElementDocument);
    expect(segment.candidates(sameElementQuery).toArray()).toEqual([2]);
  });

  it("keeps the v1.3 direct typed elemMatch wrapper candidate-compatible", () => {
    const segment = new MemSegment(bloomOptions);
    segment.insertWithDocId(toDocId(1), crossElementDocument, 1);
    segment.insertWithDocId(toDocId(2), sameElementDocument, 2);
    const legacyQuery: QueryExpression = {
      elemMatch: {
        path: "$.orders[]",
        where: {
          and: [
            { path: "$.id", eq: "A1" },
            { path: "$.price", gt: 10_000 }
          ]
        }
      }
    };
    expect(segment.candidates(legacyQuery).toArray()).toEqual([2]);
  });

  it("keeps an outer NOT containing elemMatch conservative for final verification", () => {
    const segment = new MemSegment(bloomOptions);
    segment.insertWithDocId(toDocId(1), crossElementDocument, 1);
    segment.insertWithDocId(toDocId(2), sameElementDocument, 2);
    expect(segment.candidates({ not: sameElementQuery }).toArray()).toEqual([1, 2]);
  });

  it("retains empty element scopes for relative exists predicates", () => {
    const segment = new MemSegment(bloomOptions);
    segment.insertWithDocId(toDocId(1), { values: [{}, { code: "present" }] }, 1);
    segment.insertWithDocId(toDocId(2), { values: [{ code: "present" }] }, 2);
    segment.insertWithDocId(toDocId(3), { other: true }, 3);

    expect(segment.candidates({
      path: "$.values[]",
      elemMatch: { path: "$.code", exists: false }
    }).toArray()).toEqual([1]);
    expect(segment.candidates({
      path: "$.values[]",
      elemMatch: { path: "$.code", exists: true }
    }).toArray()).toEqual([1, 2]);
  });
});
