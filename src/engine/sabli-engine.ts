import { MutableSegment } from "../indexes/mutable-segment.js";
import type { InsertResult, Query, SabliOptions, SearchResult } from "../query/ast.js";
import { verifyDocument } from "../query/verifier.js";
import type { DocId, JsonObject } from "../types/json.js";
import { parseJsonDocument } from "../validation/documents.js";
import { parseSabliOptions } from "../validation/options.js";
import { parseQuery } from "../validation/queries.js";

/**
 * Main SABLI engine for in-memory JSON document indexing and search.
 */
export class SabliEngine<TDocument extends JsonObject = JsonObject> {
  readonly #options: SabliOptions;
  #segment: MutableSegment<TDocument>;

  /**
   * Creates a SABLI engine with validated options.
   *
   * @param options - Optional engine configuration.
   * @throws {SabliValidationError} If options are invalid.
   */
  public constructor(options?: unknown) {
    this.#options = parseSabliOptions(options);
    this.#segment = new MutableSegment<TDocument>(this.#options.bloom);
  }

  /**
   * Inserts a JSON document into the mutable SABLI segment.
   *
   * @param document - The JSON document to validate, store, and index.
   * @returns Insertion metadata with the assigned document identifier.
   * @throws {SabliValidationError} If the document contains unsupported values.
   * @remarks The expected indexing cost is O(L), where L is the number of primitive JSON leaves.
   */
  public insert(document: unknown): Promise<InsertResult> {
    const parsed = parseJsonDocument(document) as TDocument;
    return Promise.resolve(this.#segment.insert(parsed));
  }

  /**
   * Searches indexed documents with exact final verification.
   *
   * @param query - The query to validate, plan, and execute.
   * @returns Matched documents after full-document verification.
   * @throws {SabliValidationError} If the query shape is invalid.
   */
  public search(query: unknown): Promise<SearchResult<TDocument>> {
    const parsed: Query = parseQuery(query);
    const candidates = this.#segment.candidates(parsed.where);
    const documents = candidates
      .toArray()
      .flatMap((docId) => {
        const document = this.#segment.getDocument(docId);
        if (document === undefined || !verifyDocument(document, parsed)) {
          return [];
        }
        return [{ docId, document }];
      });
    return Promise.resolve({ documents, count: documents.length });
  }

  /**
   * Deletes a document from future search results.
   *
   * @param docId - Document identifier to tombstone.
   */
  public delete(docId: DocId): Promise<void> {
    this.#segment.delete(docId);
    return Promise.resolve();
  }

  /**
   * Clears all in-memory documents and indexes.
   */
  public clear(): Promise<void> {
    this.#segment = new MutableSegment<TDocument>(this.#options.bloom);
    return Promise.resolve();
  }
}
