import { BloomFilter } from "../bloom/bloom-filter.js";
import { extractEntries } from "../extract/extractor.js";
import type { BloomOptions, QueryExpression, QueryPredicate } from "../query/ast.js";
import { planQuery } from "../query/planner.js";
import type { DocId, JsonObject, JsonPrimitive } from "../types/json.js";
import { toDocId } from "../types/json.js";
import { SortedArrayPostingList, type PostingList } from "./posting.js";

function primitiveType(value: JsonPrimitive): string {
  return value === null ? "null" : typeof value;
}

function encodeTerm(path: string, value: JsonPrimitive): string {
  return `${path}\u0000${primitiveType(value)}\u0000${JSON.stringify(value)}`;
}

/**
 * In-memory mutable segment implementing the first SABLI indexing backend.
 */
export class MutableSegment<TDocument extends JsonObject = JsonObject> {
  readonly #documents = new Map<DocId, TDocument>();
  readonly #deleted = new Set<DocId>();
  readonly #pathExists = new Map<string, Set<DocId>>();
  readonly #termPostings = new Map<string, Set<DocId>>();
  readonly #numericValues = new Map<string, Array<{ readonly docId: DocId; readonly value: number }>>();
  readonly #bloom: BloomFilter;
  #nextDocId = 1;

  /**
   * Creates a mutable segment.
   *
   * @param bloomOptions - Bloom filter options for advisory pruning.
   */
  public constructor(bloomOptions: BloomOptions) {
    this.#bloom = new BloomFilter(bloomOptions);
  }

  /**
   * Number of documents inserted into the segment, including tombstoned documents.
   */
  public get documentCount(): number {
    return this.#documents.size;
  }

  /**
   * Inserts a validated document into the segment and updates indexes.
   *
   * @param document - Validated JSON document.
   * @returns Inserted document identifier and extracted entry count.
   */
  public insert(document: TDocument): { readonly docId: DocId; readonly entryCount: number } {
    const docId = toDocId(this.#nextDocId);
    this.#nextDocId += 1;
    this.#documents.set(docId, document);
    const entries = extractEntries(document);
    for (const entry of entries) {
      this.addPosting(this.#pathExists, entry.path, docId);
      this.#bloom.add(`path:${entry.path}`);
      const term = encodeTerm(entry.path, entry.value);
      this.addPosting(this.#termPostings, term, docId);
      this.#bloom.add(`term:${term}`);
      if (typeof entry.value === "number") {
        const values = this.#numericValues.get(entry.path) ?? [];
        values.push({ docId, value: entry.value });
        this.#numericValues.set(entry.path, values);
      }
    }
    return { docId, entryCount: entries.length };
  }

  /**
   * Reads a stored document.
   *
   * @param docId - Document identifier.
   * @returns Stored document when present and not deleted.
   */
  public getDocument(docId: DocId): TDocument | undefined {
    if (this.#deleted.has(docId)) {
      return undefined;
    }
    return this.#documents.get(docId);
  }

  /**
   * Returns all live document identifiers in the segment.
   *
   * @returns Posting list of all live documents.
   */
  public allLiveDocuments(): PostingList {
    return new SortedArrayPostingList([...this.#documents.keys()].filter((docId) => !this.#deleted.has(docId)));
  }

  /**
   * Marks a document deleted.
   *
   * @param docId - Document identifier to delete.
   */
  public delete(docId: DocId): void {
    this.#deleted.add(docId);
  }

  /**
   * Clears all segment contents.
   */
  public clear(): void {
    this.#documents.clear();
    this.#deleted.clear();
    this.#pathExists.clear();
    this.#termPostings.clear();
    this.#numericValues.clear();
    this.#nextDocId = 1;
  }

  /**
   * Generates candidate documents for a normalized query expression.
   *
   * @param expression - Normalized query expression.
   * @returns Over-approximate candidate posting list.
   */
  public candidates(expression: QueryExpression): PostingList {
    const plan = planQuery(expression);
    void plan;
    return this.candidatesForExpression(expression);
  }

  private addPosting(index: Map<string, Set<DocId>>, key: string, docId: DocId): void {
    const postings = index.get(key) ?? new Set<DocId>();
    postings.add(docId);
    index.set(key, postings);
  }

  private postingFromSet(values: ReadonlySet<DocId> | undefined): PostingList {
    if (values === undefined) {
      return new SortedArrayPostingList([]);
    }
    return new SortedArrayPostingList([...values].filter((docId) => !this.#deleted.has(docId)));
  }

  private candidatesForPredicate(predicate: QueryPredicate): PostingList {
    let candidates: PostingList | undefined;
    if (predicate.exists === true) {
      candidates = this.#bloom.mightContain(`path:${predicate.path}`)
        ? this.postingFromSet(this.#pathExists.get(predicate.path))
        : new SortedArrayPostingList([]);
    }
    const equalityValue = "eq" in predicate ? predicate.eq : "contains" in predicate ? predicate.contains : undefined;
    if (equalityValue !== undefined) {
      const term = encodeTerm(predicate.path, equalityValue);
      const equality = this.#bloom.mightContain(`term:${term}`)
        ? this.postingFromSet(this.#termPostings.get(term))
        : new SortedArrayPostingList([]);
      candidates = candidates === undefined ? equality : candidates.intersect(equality);
    }
    const numeric = this.numericCandidates(predicate);
    if (numeric !== undefined) {
      candidates = candidates === undefined ? numeric : candidates.intersect(numeric);
    }
    return candidates ?? this.allLiveDocuments();
  }

  private numericCandidates(predicate: QueryPredicate): PostingList | undefined {
    const hasNumeric =
      predicate.gt !== undefined ||
      predicate.gte !== undefined ||
      predicate.lt !== undefined ||
      predicate.lte !== undefined ||
      predicate.between !== undefined;
    if (!hasNumeric) {
      return undefined;
    }
    const values = this.#numericValues.get(predicate.path) ?? [];
    return new SortedArrayPostingList(
      values
        .filter(({ value }) => {
          if (predicate.gt !== undefined && value <= predicate.gt) {
            return false;
          }
          if (predicate.gte !== undefined && value < predicate.gte) {
            return false;
          }
          if (predicate.lt !== undefined && value >= predicate.lt) {
            return false;
          }
          if (predicate.lte !== undefined && value > predicate.lte) {
            return false;
          }
          if (predicate.between !== undefined) {
            const [min, max] = predicate.between;
            return value >= min && value <= max;
          }
          return true;
        })
        .map(({ docId }) => docId)
    );
  }

  private candidatesForExpression(expression: QueryExpression): PostingList {
    if ("and" in expression) {
      const [first, ...rest] = expression.and;
      if (first === undefined) {
        return new SortedArrayPostingList([]);
      }
      let acc = this.candidatesForExpression(first);
      for (const child of rest) {
        acc = acc.intersect(this.candidatesForExpression(child));
      }
      return acc;
    }
    if ("or" in expression) {
      let acc: PostingList = new SortedArrayPostingList([]);
      for (const child of expression.or) {
        acc = acc.union(this.candidatesForExpression(child));
      }
      return acc;
    }
    if ("not" in expression) {
      return this.allLiveDocuments().difference(this.candidatesForExpression(expression.not));
    }
    if ("elemMatch" in expression) {
      // TODO: Add scope-aware candidate planning once scoped array postings are implemented.
      return this.candidatesForExpression(expression.elemMatch.where);
    }
    return this.candidatesForPredicate(expression);
  }
}
