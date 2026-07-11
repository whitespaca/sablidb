import { open, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { SabliCorruptionError, SabliStorageError } from "../errors/index.js";
import type { JsonObject } from "../types/json.js";
import { toDocId, type DocId } from "../types/json.js";
import { JsonObjectGuard } from "../validation/schemas.js";
import { assertValid } from "../validation/assertValid.js";
import type { DocumentOffset, OffsetTableFile } from "./OffsetTable.js";

/**
 * Writes raw JSON documents into an append-only block file.
 */
export class DocumentBlockWriter {
  readonly #path: string;
  readonly #offsets: DocumentOffset[] = [];
  #position = 0;

  /**
   * Creates a document block writer.
   *
   * @param path - docs.bin path.
   */
  public constructor(path: string) {
    this.#path = path;
  }

  /**
   * Writes all documents to the block file.
   *
   * @param documents - Documents paired with identifiers.
   * @returns Offset table file contents.
   */
  public async writeAll(documents: readonly { readonly docId: DocId; readonly document: JsonObject }[]): Promise<OffsetTableFile> {
    const chunks: Uint8Array[] = [];
    for (const item of documents) {
      const encoded = new TextEncoder().encode(JSON.stringify(item.document));
      const bytes = Buffer.from(encoded);
      this.#offsets.push({ docId: item.docId, offset: this.#position, length: bytes.length });
      this.#position += bytes.length;
      chunks.push(bytes);
    }
    await writeFile(this.#path, Buffer.concat(chunks));
    return { format: "sabli-doc-offsets", version: 1, offsets: this.#offsets };
  }
}

/**
 * Reads raw JSON documents from a document block file by offset table.
 */
export class DocumentBlockReader {
  readonly #path: string;
  readonly #offsets = new Map<number, DocumentOffset>();

  /**
   * Creates a document block reader.
   *
   * @param path - docs.bin path.
   * @param table - Offset table contents.
   */
  public constructor(path: string, table: OffsetTableFile) {
    this.#path = path;
    for (const offset of table.offsets) {
      this.#offsets.set(offset.docId, offset);
    }
  }

  /**
   * Reads one document by identifier.
   *
   * @param docId - Document identifier.
   * @returns Parsed JSON document, or undefined when missing.
   */
  public async read(docId: DocId): Promise<JsonObject | undefined> {
    const offset = this.#offsets.get(docId);
    if (offset === undefined) {
      return undefined;
    }
    const handle = await this.openHandle();
    try {
      return await this.readOffset(handle, offset);
    } finally {
      await this.closeHandle(handle);
    }
  }

  /**
   * Reads all documents from the block file.
   *
   * @returns All documents paired with identifiers.
   */
  public async readAll(): Promise<readonly { readonly docId: DocId; readonly document: JsonObject }[]> {
    const out: { readonly docId: DocId; readonly document: JsonObject }[] = [];
    const handle = await this.openHandle();
    try {
      for (const offset of this.#offsets.values()) {
        const document = await this.readOffset(handle, offset);
        out.push({ docId: toDocId(offset.docId), document });
      }
    } finally {
      await this.closeHandle(handle);
    }
    return out;
  }

  /**
   * Closes the underlying file handle.
   */
  public async close(): Promise<void> {
    await Promise.resolve();
  }

  private async openHandle(): Promise<FileHandle> {
    try {
      return await open(this.#path, "r");
    } catch (error) {
      throw new SabliStorageError(`Failed to read immutable segment artifact docs.bin at ${this.#path}.`, { cause: error });
    }
  }

  private async closeHandle(handle: FileHandle): Promise<void> {
    try {
      await handle.close();
    } catch (error) {
      throw new SabliStorageError(`Failed to close immutable segment artifact docs.bin at ${this.#path}.`, { cause: error });
    }
  }

  private async readOffset(handle: FileHandle, offset: DocumentOffset): Promise<JsonObject> {
    const buffer = Buffer.alloc(offset.length);
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, offset.length, offset.offset));
    } catch (error) {
      throw new SabliStorageError(`Failed to read immutable segment artifact docs.bin at ${this.#path}.`, { cause: error });
    }
    if (bytesRead !== offset.length) {
      throw new SabliCorruptionError(`Invalid immutable segment artifact docs.bin at ${this.#path}: document payload is truncated.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      throw new SabliCorruptionError(`Invalid immutable segment artifact docs.bin at ${this.#path}: document payload is not valid JSON.`, { cause: error });
    }
    return assertValid(
      JsonObjectGuard,
      parsed,
      "corruption",
      `Invalid immutable segment artifact docs.bin at ${this.#path}: document payload must be a JSON object.`
    );
  }
}
