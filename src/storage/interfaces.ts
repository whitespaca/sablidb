import type { DocId, JsonObject } from "../types/json.js";

/**
 * Minimal document storage contract for future persistent backends.
 */
export interface DocumentStore<TDocument extends JsonObject = JsonObject> {
  /**
   * Reads a document by identifier.
   *
   * @param docId - Document identifier.
   * @returns The document when present.
   */
  get(docId: DocId): TDocument | undefined;
}
