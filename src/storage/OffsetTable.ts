/**
 * One document byte range in a document block file.
 */
export interface DocumentOffset {
  /** Document identifier. */
  readonly docId: number;
  /** Byte offset in docs.bin. */
  readonly offset: number;
  /** Byte length in docs.bin. */
  readonly length: number;
}

/**
 * Versioned offset table stored beside a document block.
 */
export interface OffsetTableFile {
  /** Offset table format marker. */
  readonly format: "sabli-doc-offsets";
  /** Offset table format version. */
  readonly version: 1;
  /** Document offsets. */
  readonly offsets: readonly DocumentOffset[];
}
