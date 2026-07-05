import type { DocId, JsonObject } from "../types/json.js";

/**
 * In-memory document storage used by the mutable segment.
 */
export class InMemoryDocumentStore<TDocument extends JsonObject = JsonObject> {
  readonly #documents = new Map<DocId, TDocument>();

  /**
   * Stores a document under an assigned identifier.
   *
   * @param docId - The identifier assigned to the document.
   * @param document - The validated JSON document.
   */
  public set(docId: DocId, document: TDocument): void {
    this.#documents.set(docId, document);
  }

  /**
   * Reads a document by identifier.
   *
   * @param docId - The document identifier.
   * @returns The stored document, or undefined when absent.
   */
  public get(docId: DocId): TDocument | undefined {
    return this.#documents.get(docId);
  }

  /**
   * Deletes a document from storage.
   *
   * @param docId - The document identifier.
   */
  public delete(docId: DocId): void {
    this.#documents.delete(docId);
  }

  /**
   * Removes all documents from the store.
   */
  public clear(): void {
    this.#documents.clear();
  }
}
