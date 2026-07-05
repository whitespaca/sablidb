import { SabliCorruptionError } from "../errors/index.js";
import type { SegmentManifest } from "../segment/metadata.js";
import { toSegmentId } from "../types/json.js";
import { formatValidationError } from "./errors.js";
import { ManifestInputGuard } from "./schemas.js";

/**
 * Validates persisted segment metadata before it is trusted by the storage layer.
 *
 * @param input - Unknown metadata read from disk.
 * @returns The validated segment manifest.
 * @throws {SabliCorruptionError} If the manifest is malformed or unsupported.
 */
export function parseSegmentManifest(input: unknown): SegmentManifest {
  const result = ManifestInputGuard.check(input);
  if (!result.ok) {
    throw new SabliCorruptionError(formatValidationError("Invalid segment manifest.", result.error));
  }
  const object = input as Readonly<Record<string, unknown>>;
  if (object.format !== "sabli-segment" || object.version !== 1) {
    throw new SabliCorruptionError("Invalid segment manifest: unsupported format or version.");
  }
  if (typeof object.segmentId !== "number" || !Number.isInteger(object.segmentId) || object.segmentId < 0) {
    throw new SabliCorruptionError("Invalid segment manifest: segmentId must be a non-negative integer.");
  }
  if (typeof object.docCount !== "number" || !Number.isInteger(object.docCount) || object.docCount < 0) {
    throw new SabliCorruptionError("Invalid segment manifest: docCount must be a non-negative integer.");
  }
  if (typeof object.createdAt !== "string" || Number.isNaN(Date.parse(object.createdAt))) {
    throw new SabliCorruptionError("Invalid segment manifest: createdAt must be an ISO date string.");
  }
  return {
    format: "sabli-segment",
    version: 1,
    segmentId: toSegmentId(object.segmentId),
    docCount: object.docCount,
    createdAt: object.createdAt
  };
}
