import { describe, expect, it } from "vitest";
import { SabliEngine, toDocId, verifyDocument, type JsonObject, type Query } from "../src/index.js";

const documents: readonly JsonObject[] = [
  { user: { name: "Kim", age: 31 }, tags: ["backend", "typescript"] },
  { user: { name: "Lee", age: 25 }, tags: ["frontend"] },
  { user: { name: "Park", age: 40 }, tags: ["backend"] }
];

async function buildEngine(): Promise<SabliEngine> {
  const engine = new SabliEngine();
  for (const document of documents) {
    await engine.insert(document);
  }
  return engine;
}

describe("query behavior", () => {
  it("returns expected documents for equality queries", async () => {
    const engine = await buildEngine();
    const results = await engine.search({ where: { "user.name": { eq: "Kim" } } });
    expect(results.documents.map((hit) => hit.document.user)).toEqual([{ name: "Kim", age: 31 }]);
  });

  it("returns expected documents for exists queries", async () => {
    const engine = await buildEngine();
    const results = await engine.search({ where: { "user.age": { exists: true } } });
    expect(results.count).toBe(3);
  });

  it("returns expected documents for contains queries on normalized arrays", async () => {
    const engine = await buildEngine();
    const results = await engine.search({ where: { "tags[]": { contains: "backend" } } });
    expect(results.documents.map((hit) => hit.docId)).toEqual([1, 3]);
  });

  it("intersects candidates for AND queries", async () => {
    const engine = await buildEngine();
    const results = await engine.search({
      where: {
        and: [
          { path: "tags[]", contains: "backend" },
          { path: "user.age", gte: 35 }
        ]
      }
    });
    expect(results.documents.map((hit) => hit.docId)).toEqual([3]);
  });

  it("matches exact verifier results for representative queries", async () => {
    const engine = await buildEngine();
    const queries: readonly Query[] = [
      { where: { path: "$.user.name", eq: "Kim" } },
      { where: { path: "$.tags[]", contains: "backend" } },
      { where: { and: [{ path: "$.user.age", gte: 30 }, { path: "$.tags[]", contains: "backend" }] } }
    ];
    for (const query of queries) {
      const expected = documents.filter((document) => verifyDocument(document, query));
      const actual = await engine.search(query);
      expect(actual.documents.map((hit) => hit.document)).toEqual(expected);
    }
  });

  it("excludes deleted documents", async () => {
    const engine = await buildEngine();
    await engine.delete(toDocId(1));
    const results = await engine.search({ where: { "tags[]": { contains: "backend" } } });
    expect(results.documents.map((hit) => hit.docId)).toEqual([3]);
  });
});
