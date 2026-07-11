import { describe, expect, it } from "vitest";
import { parseQuery, verifyDocument, type JsonObject, type Query } from "../src/index.js";

describe("elemMatch exact verifier", () => {
  it("never combines predicates from separate array elements", () => {
    const document = {
      orders: [
        { id: "A1", price: 8_000 },
        { id: "A2", price: 12_000 }
      ]
    } satisfies JsonObject;
    const scopedA1 = parseQuery({
      where: {
        path: "orders[]",
        elemMatch: {
          and: [
            { path: "id", eq: "A1" },
            { path: "price", gt: 10_000 }
          ]
        }
      }
    });
    const scopedA2 = parseQuery({
      where: {
        path: "orders[]",
        elemMatch: {
          and: [
            { path: "id", eq: "A2" },
            { path: "price", gt: 10_000 }
          ]
        }
      }
    });
    const ordinary = parseQuery({
      where: {
        and: [
          { path: "orders[].id", eq: "A1" },
          { path: "orders[].price", gt: 10_000 }
        ]
      }
    });
    const directLegacy: Query = {
      where: {
        elemMatch: {
          path: "orders[]",
          where: {
            and: [
              { path: "id", eq: "A1" },
              { path: "price", gt: 10_000 }
            ]
          }
        }
      }
    };

    expect(verifyDocument(document, scopedA1)).toBe(false);
    expect(verifyDocument(document, scopedA2)).toBe(true);
    expect(verifyDocument(document, ordinary)).toBe(true);
    expect(verifyDocument(document, directLegacy)).toBe(false);
  });

  it("resolves escaped and nested child keys relative to one element", () => {
    const document = {
      "order.list": [
        {
          "item.id": "A1",
          "shipping.address": { "city[name]": "Seoul" }
        }
      ]
    } satisfies JsonObject;
    const query = parseQuery({
      where: {
        path: "order\\.list[]",
        elemMatch: {
          and: [
            { path: "item\\.id", eq: "A1" },
            { path: "shipping\\.address.city\\[name\\]", eq: "Seoul" }
          ]
        }
      }
    });

    expect(verifyDocument(document, query)).toBe(true);
  });

  it("supports nested target arrays and ordinary nested-array child traversal", () => {
    const document = {
      groups: [
        {
          orders: [
            { id: "A1", lines: [{ price: 2_000 }] },
            { id: "A2", lines: [{ price: 20_000 }] }
          ]
        },
        {
          orders: [{ id: "A1", lines: [{ price: 30_000 }] }]
        }
      ]
    } satisfies JsonObject;
    const query = parseQuery({
      where: {
        path: "groups[].orders[]",
        elemMatch: {
          and: [
            { path: "id", eq: "A1" },
            { path: "lines[].price", gt: 10_000 }
          ]
        }
      }
    });

    expect(verifyDocument(document, query)).toBe(true);
    expect(verifyDocument({ groups: [document.groups[0]] }, query)).toBe(false);
  });

  it("handles missing, non-array, empty, primitive, null, and mixed targets", () => {
    const objectQuery = parseQuery({
      where: { path: "values[]", elemMatch: { path: "code", eq: "ok" } }
    });
    const primitiveQuery = parseQuery({
      where: { path: "values[]", elemMatch: { path: "$", gte: 5 } }
    });
    const nullQuery = parseQuery({
      where: { path: "values[]", elemMatch: { path: "$", eq: null } }
    });

    expect(verifyDocument({}, objectQuery)).toBe(false);
    expect(verifyDocument({ values: { code: "ok" } }, objectQuery)).toBe(false);
    expect(verifyDocument({ values: [] }, objectQuery)).toBe(false);
    expect(verifyDocument({ values: [null, 2, 8, { code: "ok" }] }, objectQuery)).toBe(true);
    expect(verifyDocument({ values: [null, 2, 8, { code: "ok" }] }, primitiveQuery)).toBe(true);
    expect(verifyDocument({ values: [null, 2, 8, { code: "ok" }] }, nullQuery)).toBe(true);
  });
});
