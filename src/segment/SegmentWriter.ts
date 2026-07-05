import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BloomFilter } from "../bloom/bloom-filter.js";
import { extractEntries } from "../extract/extractor.js";
import type { BloomOptions } from "../query/ast.js";
import { checksum, stableJson } from "../storage/Checksum.js";
import { DocumentBlockWriter } from "../storage/DocumentBlockStore.js";
import type { ManifestSegmentEntry } from "../storage/ManifestStore.js";
import type { SegmentId } from "../types/json.js";
import { encodeTermKey, type MemSegmentSnapshot } from "./MemSegment.js";
import type { SegmentMetadata } from "./SegmentMetadata.js";

interface PostingIndexFile {
  readonly format: "sabli-postings";
  readonly version: 1;
  readonly pathExists: readonly (readonly [string, readonly number[]])[];
  readonly termPostings: readonly (readonly [string, readonly number[]])[];
  readonly numericValues: readonly (readonly [string, readonly { readonly docId: number; readonly value: number }[]])[];
}

function addPosting(index: Map<string, Set<number>>, key: string, docId: number): void {
  const postings = index.get(key) ?? new Set<number>();
  postings.add(docId);
  index.set(key, postings);
}

function sortedEntries(index: Map<string, Set<number>>): readonly (readonly [string, readonly number[]])[] {
  return [...index.entries()].map(([key, values]) => [key, [...values].sort((a, b) => a - b)] as const);
}

/**
 * Writes immutable segment files from a memory segment snapshot.
 */
export class SegmentWriter {
  readonly #segmentsRoot: string;
  readonly #bloomOptions: BloomOptions;

  /**
   * Creates a segment writer.
   *
   * @param segmentsRoot - Root segments directory.
   * @param bloomOptions - Bloom filter options.
   */
  public constructor(segmentsRoot: string, bloomOptions: BloomOptions) {
    this.#segmentsRoot = segmentsRoot;
    this.#bloomOptions = bloomOptions;
  }

  /**
   * Flushes a memory snapshot into an immutable segment directory.
   *
   * @param segmentId - Segment identifier.
   * @param snapshot - Memory segment snapshot.
   * @returns Manifest segment entry for the new segment.
   */
  public async write(segmentId: SegmentId, snapshot: MemSegmentSnapshot): Promise<ManifestSegmentEntry> {
    const segmentName = `seg-${String(segmentId).padStart(6, "0")}`;
    const finalPath = join(this.#segmentsRoot, segmentName);
    const tempPath = `${finalPath}.tmp`;
    await rm(tempPath, { recursive: true, force: true });
    await mkdir(tempPath, { recursive: true });

    const pathExists = new Map<string, Set<number>>();
    const termPostings = new Map<string, Set<number>>();
    const numericValues = new Map<string, { readonly docId: number; readonly value: number }[]>();
    const bloom = new BloomFilter(this.#bloomOptions);
    const paths = new Set<string>();
    const values = new Set<string>();

    for (const { docId, document } of snapshot.documents) {
      for (const entry of extractEntries(document)) {
        paths.add(entry.path);
        values.add(JSON.stringify(entry.value));
        addPosting(pathExists, entry.path, docId);
        bloom.add(`path:${entry.path}`);
        const term = encodeTermKey(entry.path, entry.value);
        addPosting(termPostings, term, docId);
        bloom.add(`term:${term}`);
        if (typeof entry.value === "number") {
          const current = numericValues.get(entry.path) ?? [];
          current.push({ docId, value: entry.value });
          numericValues.set(entry.path, current);
        }
      }
    }

    const offsetTable = await new DocumentBlockWriter(join(tempPath, "docs.bin")).writeAll(snapshot.documents);
    await writeFile(join(tempPath, "docs.offset"), JSON.stringify(offsetTable));
    await writeFile(join(tempPath, "path.dict"), JSON.stringify({ format: "sabli-path-dict", version: 1, paths: [...paths].sort() }));
    await writeFile(join(tempPath, "value.dict"), JSON.stringify({ format: "sabli-value-dict", version: 1, values: [...values].sort() }));
    const postings: PostingIndexFile = {
      format: "sabli-postings",
      version: 1,
      pathExists: sortedEntries(pathExists),
      termPostings: sortedEntries(termPostings),
      numericValues: [...numericValues.entries()].map(([path, rows]) => [path, rows] as const)
    };
    await writeFile(join(tempPath, "postings.idx"), JSON.stringify(postings));
    await writeFile(join(tempPath, "bloom.bin"), JSON.stringify(bloom.serialize()));
    await writeFile(join(tempPath, "delete.bitmap"), JSON.stringify({ format: "sabli-delete-bitmap", version: 1, deleted: [] }));
    const docIds = snapshot.documents.map(({ docId }) => Number(docId));
    const metadataPayload = {
      format: "sabli-segment" as const,
      version: 1 as const,
      segmentId,
      docCount: snapshot.documents.length,
      minDocId: docIds.length === 0 ? 0 : Math.min(...docIds),
      maxDocId: docIds.length === 0 ? 0 : Math.max(...docIds),
      createdAt: new Date().toISOString(),
      bloom: bloom.serialize()
    };
    const metadata: SegmentMetadata = { ...metadataPayload, checksum: checksum(stableJson(metadataPayload)) };
    await writeFile(join(tempPath, "segment.meta.json"), JSON.stringify(metadata));
    await rm(finalPath, { recursive: true, force: true });
    await rename(tempPath, finalPath);
    return { segmentId, path: `segments/${segmentName}`, docCount: snapshot.documents.length };
  }
}
