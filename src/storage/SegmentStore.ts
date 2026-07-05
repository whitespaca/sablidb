import { join } from "node:path";
import { ImmutableSegment } from "../segment/ImmutableSegment.js";
import { SegmentWriter } from "../segment/SegmentWriter.js";
import type { BloomOptions } from "../query/ast.js";
import type { ManifestSegmentEntry } from "./ManifestStore.js";

/**
 * Opens and writes immutable segment directories.
 */
export class SegmentStore {
  readonly #root: string;
  readonly #writer: SegmentWriter;

  /**
   * Creates a segment store.
   *
   * @param databaseRoot - Database root directory.
   * @param bloomOptions - Bloom filter options.
   */
  public constructor(databaseRoot: string, bloomOptions: BloomOptions) {
    this.#root = databaseRoot;
    this.#writer = new SegmentWriter(join(databaseRoot, "segments"), bloomOptions);
  }

  /**
   * Segment writer.
   */
  public get writer(): SegmentWriter {
    return this.#writer;
  }

  /**
   * Opens one segment from a manifest entry.
   *
   * @param entry - Manifest segment entry.
   * @returns Immutable segment reader.
   */
  public async open(entry: ManifestSegmentEntry): Promise<ImmutableSegment> {
    return ImmutableSegment.open(join(this.#root, entry.path));
  }
}
