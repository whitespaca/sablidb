import { SabliCorruptionError } from "../errors/index.js";
import type { SegmentMetadata } from "../segment/SegmentMetadata.js";
import { toSegmentId } from "../types/json.js";
import { checksum, stableJson } from "../storage/Checksum.js";
import { t } from "typesea";

const SegmentMetadataInputGuard = t.record(t.unknown);

/**
 * Validates immutable segment metadata loaded from disk.
 *
 * @param input - Unknown metadata payload.
 * @returns Validated segment metadata.
 * @throws {SabliCorruptionError} If metadata is invalid.
 */
export function parseSegmentMetadata(input: unknown): SegmentMetadata {
  const result = SegmentMetadataInputGuard.check(input);
  if (!result.ok || typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SabliCorruptionError("Invalid segment metadata: expected an object.");
  }
  const record = input as Readonly<Record<string, unknown>>;
  if (record.format !== "sabli-segment" || record.version !== 1) {
    throw new SabliCorruptionError("Invalid segment metadata: unsupported format or version.");
  }
  for (const key of ["segmentId", "docCount", "minDocId", "maxDocId"] as const) {
    if (typeof record[key] !== "number" || !Number.isInteger(record[key]) || record[key] < 0) {
      throw new SabliCorruptionError(`Invalid segment metadata: ${key} must be a non-negative integer.`);
    }
  }
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    throw new SabliCorruptionError("Invalid segment metadata: createdAt must be an ISO timestamp.");
  }
  if (typeof record.bloom !== "object" || record.bloom === null || Array.isArray(record.bloom)) {
    throw new SabliCorruptionError("Invalid segment metadata: bloom must be an object.");
  }
  if (typeof record.checksum !== "string") {
    throw new SabliCorruptionError("Invalid segment metadata: checksum must be a string.");
  }
  const segmentId = record.segmentId;
  const docCount = record.docCount;
  const minDocId = record.minDocId;
  const maxDocId = record.maxDocId;
  if (typeof segmentId !== "number" || typeof docCount !== "number" || typeof minDocId !== "number" || typeof maxDocId !== "number") {
    throw new SabliCorruptionError("Invalid segment metadata: numeric fields were not narrowed.");
  }
  const payload = { ...record };
  delete (payload as { checksum?: string }).checksum;
  if (checksum(stableJson(payload)) !== record.checksum) {
    throw new SabliCorruptionError("Invalid segment metadata: checksum mismatch.");
  }
  return {
    format: "sabli-segment",
    version: 1,
    segmentId: toSegmentId(segmentId),
    docCount,
    minDocId,
    maxDocId,
    createdAt: record.createdAt,
    bloom: record.bloom as SegmentMetadata["bloom"],
    checksum: record.checksum
  };
}
