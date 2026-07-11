import { describe, expect, it } from "vitest";
import { extractScopedEntries } from "../src/extract/scoped-extractor.js";

describe("scope-aware extraction", () => {
  it("allocates deterministic unique scopes and projects nested leaves to ancestors", () => {
    const document = {
      orders: [
        { id: "A1", items: [{ sku: "x" }, { sku: "y" }] },
        { id: "A2" }
      ],
      misc: [null, {}, "value"],
      other: [{ id: "B1" }]
    };

    const extraction = extractScopedEntries(document);
    expect(extraction.scopes).toEqual([
      { scopeId: 1, arrayPath: "$.orders[]" },
      { scopeId: 2, parentScopeId: 1, arrayPath: "$.orders[].items[]" },
      { scopeId: 3, parentScopeId: 1, arrayPath: "$.orders[].items[]" },
      { scopeId: 4, arrayPath: "$.orders[]" },
      { scopeId: 5, arrayPath: "$.misc[]" },
      { scopeId: 6, arrayPath: "$.misc[]" },
      { scopeId: 7, arrayPath: "$.misc[]" },
      { scopeId: 8, arrayPath: "$.other[]" }
    ]);

    expect(extraction.entries.filter(({ path }) => path === "$.orders[].items[].sku")).toEqual([
      {
        path: "$.orders[].items[].sku",
        relativePath: "$.items[].sku",
        value: "x",
        valueType: "string",
        scopeId: 1,
        arrayPath: "$.orders[]"
      },
      {
        path: "$.orders[].items[].sku",
        relativePath: "$.sku",
        value: "x",
        valueType: "string",
        scopeId: 2,
        parentScopeId: 1,
        arrayPath: "$.orders[].items[]"
      },
      {
        path: "$.orders[].items[].sku",
        relativePath: "$.items[].sku",
        value: "y",
        valueType: "string",
        scopeId: 1,
        arrayPath: "$.orders[]"
      },
      {
        path: "$.orders[].items[].sku",
        relativePath: "$.sku",
        value: "y",
        valueType: "string",
        scopeId: 3,
        parentScopeId: 1,
        arrayPath: "$.orders[].items[]"
      }
    ]);

    expect(extraction.entries.filter(({ arrayPath }) => arrayPath === "$.misc[]")).toEqual([
      {
        path: "$.misc[]",
        relativePath: "$",
        value: null,
        valueType: "null",
        scopeId: 5,
        arrayPath: "$.misc[]"
      },
      {
        path: "$.misc[]",
        relativePath: "$",
        value: "value",
        valueType: "string",
        scopeId: 7,
        arrayPath: "$.misc[]"
      }
    ]);
    expect(extractScopedEntries(document)).toEqual(extraction);
  });

  it("keeps duplicate elements and sibling arrays in distinct scopes", () => {
    const extraction = extractScopedEntries({ left: [1, 1], right: [1] });
    expect(extraction.scopes).toEqual([
      { scopeId: 1, arrayPath: "$.left[]" },
      { scopeId: 2, arrayPath: "$.left[]" },
      { scopeId: 3, arrayPath: "$.right[]" }
    ]);
    expect(extraction.entries.map(({ arrayPath, relativePath, scopeId, value }) => ({
      arrayPath,
      relativePath,
      scopeId,
      value
    }))).toEqual([
      { arrayPath: "$.left[]", relativePath: "$", scopeId: 1, value: 1 },
      { arrayPath: "$.left[]", relativePath: "$", scopeId: 2, value: 1 },
      { arrayPath: "$.right[]", relativePath: "$", scopeId: 3, value: 1 }
    ]);
  });
});
