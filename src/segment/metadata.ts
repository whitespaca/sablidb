import type { SegmentId } from "../types/json.js";

/**
 * Versioned metadata for a persisted SABLI segment.
 */
export interface SegmentManifest {
  /** Storage format marker. */
  readonly format: "sabli-segment";
  /** Segment format version. */
  readonly version: 1;
  /** Unique segment identifier. */
  readonly segmentId: SegmentId;
  /** Number of live documents described by the segment. */
  readonly docCount: number;
  /** ISO timestamp for segment creation. */
  readonly createdAt: string;
}
