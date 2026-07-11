import type { DocId } from "../types/json.js";
import type { ScopeId } from "../extract/scoped-extractor.js";
import { createPostingList, type PostingList } from "./posting.js";

/**
 * One posting identified by both its document and concrete array-element scope.
 */
export interface ScopedPostingEntry {
  /** Complete JSON document identifier. */
  readonly docId: DocId;
  /** Per-document concrete array-element identifier. */
  readonly scopeId: ScopeId;
}

/**
 * Read-only sorted posting list for document and array-scope pairs.
 */
export interface ScopedPostingList {
  /** Number of unique document/scope pairs. */
  readonly size: number;
  /** Tests whether an exact document/scope pair is present. */
  has(docId: DocId, scopeId: ScopeId): boolean;
  /** Returns lexicographically sorted document/scope pairs. */
  toArray(): readonly ScopedPostingEntry[];
  /** Intersects this list with another list on both document and scope identity. */
  intersect(other: ScopedPostingList): ScopedPostingList;
  /** Unions this list with another list on both document and scope identity. */
  union(other: ScopedPostingList): ScopedPostingList;
  /** Removes exact document/scope pairs present in another list. */
  difference(other: ScopedPostingList): ScopedPostingList;
  /** Projects matching scopes into sorted unique document identifiers. */
  matchingDocumentIds(): PostingList;
}

function compareEntries(left: ScopedPostingEntry, right: ScopedPostingEntry): number {
  const documentOrder = Number(left.docId) - Number(right.docId);
  return documentOrder === 0 ? Number(left.scopeId) - Number(right.scopeId) : documentOrder;
}

function sameEntry(left: ScopedPostingEntry, right: ScopedPostingEntry): boolean {
  return left.docId === right.docId && left.scopeId === right.scopeId;
}

function normalizeEntries(entries: Iterable<ScopedPostingEntry>): readonly ScopedPostingEntry[] {
  const sorted = [...entries]
    .map(({ docId, scopeId }) => Object.freeze({ docId, scopeId }))
    .sort(compareEntries);
  const unique: ScopedPostingEntry[] = [];
  for (const entry of sorted) {
    const previous = unique.at(-1);
    if (previous === undefined || !sameEntry(previous, entry)) {
      unique.push(entry);
    }
  }
  return Object.freeze(unique);
}

function mergeIntersection(
  left: readonly ScopedPostingEntry[],
  right: readonly ScopedPostingEntry[]
): readonly ScopedPostingEntry[] {
  const entries: ScopedPostingEntry[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftEntry = left[leftIndex];
    const rightEntry = right[rightIndex];
    if (leftEntry === undefined || rightEntry === undefined) {
      break;
    }
    const order = compareEntries(leftEntry, rightEntry);
    if (order === 0) {
      entries.push(leftEntry);
      leftIndex += 1;
      rightIndex += 1;
    } else if (order < 0) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return entries;
}

function mergeUnion(
  left: readonly ScopedPostingEntry[],
  right: readonly ScopedPostingEntry[]
): readonly ScopedPostingEntry[] {
  const entries: ScopedPostingEntry[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftEntry = left[leftIndex];
    const rightEntry = right[rightIndex];
    if (leftEntry === undefined) {
      if (rightEntry !== undefined) {
        entries.push(rightEntry);
      }
      rightIndex += 1;
      continue;
    }
    if (rightEntry === undefined) {
      entries.push(leftEntry);
      leftIndex += 1;
      continue;
    }
    const order = compareEntries(leftEntry, rightEntry);
    if (order < 0) {
      entries.push(leftEntry);
      leftIndex += 1;
    } else if (order > 0) {
      entries.push(rightEntry);
      rightIndex += 1;
    } else {
      entries.push(leftEntry);
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return entries;
}

function mergeDifference(
  left: readonly ScopedPostingEntry[],
  right: readonly ScopedPostingEntry[]
): readonly ScopedPostingEntry[] {
  const entries: ScopedPostingEntry[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length) {
    const leftEntry = left[leftIndex];
    const rightEntry = right[rightIndex];
    if (leftEntry === undefined) {
      break;
    }
    if (rightEntry === undefined) {
      entries.push(leftEntry);
      leftIndex += 1;
      continue;
    }
    const order = compareEntries(leftEntry, rightEntry);
    if (order < 0) {
      entries.push(leftEntry);
      leftIndex += 1;
    } else if (order > 0) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return entries;
}

/**
 * Sorted-array scoped posting implementation.
 */
export class SortedArrayScopedPostingList implements ScopedPostingList {
  readonly #entries: readonly ScopedPostingEntry[];

  /**
   * Creates a sorted, duplicate-free scoped posting list.
   *
   * @param entries - Candidate document/scope pairs.
   */
  public constructor(entries: Iterable<ScopedPostingEntry>) {
    this.#entries = normalizeEntries(entries);
  }

  /** @inheritdoc */
  public get size(): number {
    return this.#entries.length;
  }

  /** @inheritdoc */
  public has(docId: DocId, scopeId: ScopeId): boolean {
    const target = { docId, scopeId };
    let low = 0;
    let high = this.#entries.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const entry = this.#entries[middle];
      if (entry === undefined) {
        return false;
      }
      const order = compareEntries(entry, target);
      if (order === 0) {
        return true;
      }
      if (order < 0) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return false;
  }

  /** @inheritdoc */
  public toArray(): readonly ScopedPostingEntry[] {
    return this.#entries;
  }

  /** @inheritdoc */
  public intersect(other: ScopedPostingList): ScopedPostingList {
    return createScopedPostingList(mergeIntersection(this.#entries, other.toArray()));
  }

  /** @inheritdoc */
  public union(other: ScopedPostingList): ScopedPostingList {
    return createScopedPostingList(mergeUnion(this.#entries, other.toArray()));
  }

  /** @inheritdoc */
  public difference(other: ScopedPostingList): ScopedPostingList {
    return createScopedPostingList(mergeDifference(this.#entries, other.toArray()));
  }

  /** @inheritdoc */
  public matchingDocumentIds(): PostingList {
    return createPostingList(this.#entries.map(({ docId }) => docId));
  }
}

/**
 * Creates a normalized scoped posting list.
 *
 * @param entries - Candidate document/scope pairs.
 * @returns Sorted, duplicate-free scoped postings.
 */
export function createScopedPostingList(entries: Iterable<ScopedPostingEntry>): ScopedPostingList {
  return new SortedArrayScopedPostingList(entries);
}
