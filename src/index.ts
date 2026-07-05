export { BloomFilter } from "./bloom/bloom-filter.js";
export type { SerializedBloomFilter } from "./bloom/bloom-filter.js";
export {
  SabliCorruptionError,
  SabliError,
  SabliQueryError,
  SabliStorageError,
  SabliValidationError
} from "./errors/index.js";
export { SabliEngine } from "./engine/sabli-engine.js";
export { extractEntries } from "./extract/extractor.js";
export type { ExtractedEntry, ExtractedValueType } from "./extract/extractor.js";
export { MutableSegment } from "./indexes/mutable-segment.js";
export { SortedArrayPostingList } from "./indexes/posting.js";
export type { PostingList } from "./indexes/posting.js";
export type {
  AndExpression,
  BloomOptions,
  ElemMatchExpression,
  InsertResult,
  NotExpression,
  OrExpression,
  Query,
  QueryExpression,
  QueryPredicate,
  QueryValue,
  SabliOptions,
  SearchHit,
  SearchResult
} from "./query/ast.js";
export { planQuery } from "./query/planner.js";
export type { QueryPlan } from "./query/planner.js";
export { verifyDocument } from "./query/verifier.js";
export type { SegmentManifest } from "./segment/metadata.js";
export type {
  DocId,
  JsonArray,
  JsonObject,
  JsonPath,
  JsonPrimitive,
  JsonValue,
  PathId,
  SegmentId,
  ValueId
} from "./types/json.js";
export { toDocId, toSegmentId } from "./types/json.js";
export { parseJsonDocument } from "./validation/documents.js";
export { formatValidationError } from "./validation/errors.js";
export { parseSegmentManifest } from "./validation/manifests.js";
export { parseSabliOptions } from "./validation/options.js";
export { parseQuery } from "./validation/queries.js";
