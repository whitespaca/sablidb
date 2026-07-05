import { describe, expect, it } from "vitest";
import { extractEntries } from "../src/extract/extractor.js";
import { normalizeJsonPath } from "../src/core/path.js";

describe("path normalization and extraction", () => {
  it("normalizes plain and array paths consistently", () => {
    expect(normalizeJsonPath("user.name")).toBe("$.user.name");
    expect(normalizeJsonPath("tags[]")).toBe("$.tags[]");
    expect(normalizeJsonPath("$.orders[].price")).toBe("$.orders[].price");
  });

  it("extracts primitive leaves from nested documents", () => {
    const entries = extractEntries({
      user: { name: "Kim", age: 31 },
      active: true
    });
    expect(entries.map((entry) => [entry.path, entry.value])).toEqual([
      ["$.user.name", "Kim"],
      ["$.user.age", 31],
      ["$.active", true]
    ]);
  });

  it("indexes array values under normalized [] paths", () => {
    const entries = extractEntries({ tags: ["backend", "typescript"] });
    expect(entries.map((entry) => entry.path)).toEqual(["$.tags[]", "$.tags[]"]);
  });
});
