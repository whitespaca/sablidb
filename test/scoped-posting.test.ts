import { describe, expect, it } from "vitest";
import type { ScopeId } from "../src/extract/scoped-extractor.js";
import {
  createScopedPostingList,
  type ScopedPostingEntry,
  type ScopedPostingList
} from "../src/indexes/scoped-posting.js";
import { toDocId } from "../src/types/json.js";

function scope(value: number): ScopeId {
  return value as ScopeId;
}

function entry(docId: number, scopeId: number): ScopedPostingEntry {
  return { docId: toDocId(docId), scopeId: scope(scopeId) };
}

function pairs(posting: ScopedPostingList): readonly (readonly [number, number])[] {
  return posting.toArray().map(({ docId, scopeId }) => [Number(docId), Number(scopeId)] as const);
}

describe("scoped posting lists", () => {
  it("sorts and removes duplicate document/scope pairs", () => {
    const posting = createScopedPostingList([
      entry(2, 1),
      entry(1, 2),
      entry(1, 1),
      entry(1, 2)
    ]);
    expect(pairs(posting)).toEqual([[1, 1], [1, 2], [2, 1]]);
    expect(posting.has(toDocId(1), scope(2))).toBe(true);
    expect(posting.has(toDocId(1), scope(3))).toBe(false);
  });

  it("performs set operations on both document and scope identity", () => {
    const left = createScopedPostingList([entry(1, 1), entry(1, 2), entry(2, 1)]);
    const right = createScopedPostingList([entry(1, 2), entry(2, 2), entry(3, 1)]);
    expect(pairs(left.intersect(right))).toEqual([[1, 2]]);
    expect(pairs(left.union(right))).toEqual([[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]]);
    expect(pairs(left.difference(right))).toEqual([[1, 1], [2, 1]]);
  });

  it("projects multiple matching scopes into unique document identifiers", () => {
    const posting = createScopedPostingList([
      entry(3, 2),
      entry(1, 1),
      entry(3, 1),
      entry(1, 2)
    ]);
    expect(posting.matchingDocumentIds().toArray()).toEqual([1, 3]);
  });
});
