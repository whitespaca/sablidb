import { describe, expect, it } from "vitest";
import { SabliValidationError, parseQuery } from "../src/index.js";

function expectInvalidQuery(input: unknown): void {
  expect(() => parseQuery(input)).toThrow(SabliValidationError);
}

describe("elemMatch query validation", () => {
  it("normalizes canonical and v1.3 compatibility inputs to one AST", () => {
    const child = {
      and: [
        { path: "id", eq: "A1" },
        { path: "price", gt: 10_000 }
      ]
    };
    const canonical = parseQuery({ where: { path: "orders[]", elemMatch: child } });
    const compatibility = parseQuery({
      where: { elemMatch: { path: "orders[]", where: child } }
    });

    expect(canonical).toEqual({
      where: {
        path: "$.orders[]",
        elemMatch: {
          and: [
            { path: "$.id", eq: "A1" },
            { path: "$.price", gt: 10_000 }
          ]
        }
      }
    });
    expect(compatibility).toEqual(canonical);
    expect(parseQuery({
      where: { path: "values[]", elemMatch: { path: "$", eq: null } }
    })).toEqual({
      where: { path: "$.values[]", elemMatch: { path: "$", eq: null } }
    });
  });

  it("rejects invalid targets, empty children, and mixed operator shapes", () => {
    expectInvalidQuery({ where: { path: "orders", elemMatch: { path: "id", eq: "A1" } } });
    expectInvalidQuery({ where: { path: "[]", elemMatch: { path: "$", eq: "A1" } } });
    expectInvalidQuery({ where: { path: "orders[].id", elemMatch: { path: "id", eq: "A1" } } });
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: {} } });
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: { and: [] } } });
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: 1 } });
    expectInvalidQuery({
      where: { path: "orders[]", elemMatch: { path: "id", eq: "A1" }, eq: "mixed" }
    });
    expectInvalidQuery({
      where: { path: "orders[]", elemMatch: { path: "id", eq: "A1", unknown: true } }
    });
    expectInvalidQuery({ where: { elemMatch: { path: "orders[]" } } });
    expectInvalidQuery({ where: { elemMatch: { where: { path: "id", eq: "A1" } } } });
  });

  it("requires relative child paths and rejects unsupported scoped operators", () => {
    expectInvalidQuery({
      where: { path: "orders[]", elemMatch: { path: "$.id", eq: "A1" } }
    });
    expectInvalidQuery({
      where: { path: "orders[]", elemMatch: { path: "$[].id", eq: "A1" } }
    });
    expectInvalidQuery({
      where: { path: "orders[]", elemMatch: { not: { path: "id", eq: "A1" } } }
    });
    expectInvalidQuery({
      where: {
        path: "orders[]",
        elemMatch: {
          path: "lines[]",
          elemMatch: { path: "sku", eq: "S1" }
        }
      }
    });
  });

  it("rejects cyclic expressions and hostile Boolean arrays", () => {
    const cyclic: { and?: unknown } = {};
    const cyclicChildren: unknown[] = [cyclic];
    cyclic.and = cyclicChildren;
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: cyclic } });

    const sparse = Array<unknown>(2);
    sparse[1] = { path: "id", eq: "A1" };
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: { and: sparse } } });

    const accessorEntries: unknown[] = [{ path: "id", eq: "A1" }];
    let arrayGetterExecuted = false;
    Object.defineProperty(accessorEntries, "0", {
      enumerable: true,
      get() {
        arrayGetterExecuted = true;
        return { path: "id", eq: "A1" };
      }
    });
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: { and: accessorEntries } } });
    expect(arrayGetterExecuted).toBe(false);

    const symbolEntries: unknown[] = [{ path: "id", eq: "A1" }];
    (symbolEntries as unknown as Record<PropertyKey, unknown>)[Symbol("extra")] = true;
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: { and: symbolEntries } } });
  });

  it("rejects accessor-backed and symbol-keyed scoped objects without executing getters", () => {
    const child: Record<PropertyKey, unknown> = { eq: "A1" };
    let getterExecuted = false;
    Object.defineProperty(child, "path", {
      enumerable: true,
      get() {
        getterExecuted = true;
        return "id";
      }
    });
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: child } });
    expect(getterExecuted).toBe(false);

    const symbolChild: Record<PropertyKey, unknown> = { path: "id", eq: "A1" };
    symbolChild[Symbol("extra")] = true;
    expectInvalidQuery({ where: { path: "orders[]", elemMatch: symbolChild } });
  });
});
