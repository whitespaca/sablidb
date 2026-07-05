import type { JsonPrimitive } from "../types/json.js";

/**
 * A primitive comparison value accepted by query predicates.
 */
export type QueryValue = JsonPrimitive;

/**
 * A field-level SABLI predicate.
 */
export interface QueryPredicate {
  /** Path targeted by the predicate. */
  readonly path: string;
  /** Equality comparison value. */
  readonly eq?: QueryValue;
  /** Inequality comparison value. */
  readonly neq?: QueryValue;
  /** Existence comparison. */
  readonly exists?: boolean;
  /** Array membership comparison for paths containing []. */
  readonly contains?: QueryValue;
  /** Greater-than numeric comparison. */
  readonly gt?: number;
  /** Greater-than-or-equal numeric comparison. */
  readonly gte?: number;
  /** Less-than numeric comparison. */
  readonly lt?: number;
  /** Less-than-or-equal numeric comparison. */
  readonly lte?: number;
  /** Inclusive numeric range comparison. */
  readonly between?: readonly [number, number];
}

/**
 * A Boolean AND query expression.
 */
export interface AndExpression {
  /** Child expressions that must all match. */
  readonly and: readonly QueryExpression[];
}

/**
 * A Boolean OR query expression.
 */
export interface OrExpression {
  /** Child expressions where at least one must match. */
  readonly or: readonly QueryExpression[];
}

/**
 * A Boolean NOT query expression.
 */
export interface NotExpression {
  /** Child expression to negate. */
  readonly not: QueryExpression;
}

/**
 * Same-array-element query semantics reserved for scoped arrays.
 */
export interface ElemMatchExpression {
  /** Array path that defines the element scope. */
  readonly elemMatch: {
    readonly path: string;
    readonly where: QueryExpression;
  };
}

/**
 * A normalized SABLI query expression.
 */
export type QueryExpression = QueryPredicate | AndExpression | OrExpression | NotExpression | ElemMatchExpression;

/**
 * A public SABLI query object.
 */
export interface Query {
  /** The expression used to filter documents. */
  readonly where: QueryExpression;
}

/**
 * Constructor options for the SABLI engine.
 */
export interface SabliOptions {
  /** Mutable segment flush threshold by document count. */
  readonly mutableSegmentMaxDocuments: number;
  /** Bloom filter configuration. */
  readonly bloom: BloomOptions;
}

/**
 * Bloom filter construction options.
 */
export interface BloomOptions {
  /** Target false positive probability, exclusive between zero and one. */
  readonly falsePositiveRate: number;
  /** Expected number of inserted keys. */
  readonly expectedEntries: number;
}

/**
 * Result returned by document insertion.
 */
export interface InsertResult {
  /** Assigned document identifier. */
  readonly docId: import("../types/json.js").DocId;
  /** Number of primitive entries extracted and indexed. */
  readonly entryCount: number;
}

/**
 * Result returned by a SABLI search.
 */
export interface SearchResult<TDocument = import("../types/json.js").JsonObject> {
  /** Matched document records after exact verification. */
  readonly documents: readonly SearchHit<TDocument>[];
  /** Number of documents that matched the query. */
  readonly count: number;
}

/**
 * A matched document and its identifier.
 */
export interface SearchHit<TDocument = import("../types/json.js").JsonObject> {
  /** Identifier assigned during insertion. */
  readonly docId: import("../types/json.js").DocId;
  /** The stored JSON document. */
  readonly document: TDocument;
}
