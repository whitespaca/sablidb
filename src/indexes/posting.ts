import type { DocId } from "../types/json.js";

/**
 * Read-only posting list abstraction for candidate document identifiers.
 */
export interface PostingList {
  /** Number of document identifiers in the posting list. */
  readonly size: number;
  /**
   * Tests whether the posting list contains a document identifier.
   *
   * @param docId - Document identifier to test.
   * @returns True when present.
   */
  has(docId: DocId): boolean;
  /**
   * Returns the sorted document identifiers in this posting list.
   *
   * @returns Sorted document identifiers.
   */
  toArray(): readonly DocId[];
  /**
   * Intersects this posting list with another posting list.
   *
   * @param other - Posting list to intersect.
   * @returns A new posting list containing identifiers present in both lists.
   */
  intersect(other: PostingList): PostingList;
  /**
   * Unions this posting list with another posting list.
   *
   * @param other - Posting list to union.
   * @returns A new posting list containing identifiers present in either list.
   */
  union(other: PostingList): PostingList;
  /**
   * Removes another posting list from this posting list.
   *
   * @param other - Posting list to subtract.
   * @returns A new posting list containing identifiers not present in other.
   */
  difference(other: PostingList): PostingList;
}

/**
 * Sorted array backed posting list used by the initial adaptive posting backend.
 */
export class SortedArrayPostingList implements PostingList {
  readonly #docIds: readonly DocId[];

  /**
   * Creates a sorted unique posting list.
   *
   * @param docIds - Candidate document identifiers.
   */
  public constructor(docIds: Iterable<DocId>) {
    this.#docIds = [...new Set(docIds)].sort((left, right) => left - right);
  }

  /** @inheritdoc */
  public get size(): number {
    return this.#docIds.length;
  }

  /** @inheritdoc */
  public has(docId: DocId): boolean {
    return this.#docIds.includes(docId);
  }

  /** @inheritdoc */
  public toArray(): readonly DocId[] {
    return this.#docIds;
  }

  /** @inheritdoc */
  public intersect(other: PostingList): PostingList {
    return new SortedArrayPostingList(this.#docIds.filter((docId) => other.has(docId)));
  }

  /** @inheritdoc */
  public union(other: PostingList): PostingList {
    return new SortedArrayPostingList([...this.#docIds, ...other.toArray()]);
  }

  /** @inheritdoc */
  public difference(other: PostingList): PostingList {
    return new SortedArrayPostingList(this.#docIds.filter((docId) => !other.has(docId)));
  }
}
