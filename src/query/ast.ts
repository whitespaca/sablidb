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
 * A Boolean AND expression evaluated relative to one array element.
 */
export interface ElemMatchAndExpression {
  /** Relative child expressions that must all match the same element. */
  readonly and: readonly ElemMatchQueryExpression[];
}

/**
 * A Boolean OR expression evaluated relative to one array element.
 */
export interface ElemMatchOrExpression {
  /** Relative child expressions where at least one must match the element. */
  readonly or: readonly ElemMatchQueryExpression[];
}

/**
 * A query expression supported inside one array-element scope.
 *
 * @remarks Child predicate paths are relative to the selected element. The
 * special path `$` addresses a primitive element itself. Nested `elemMatch`
 * and Boolean NOT are intentionally excluded from this milestone.
 */
export type ElemMatchQueryExpression = QueryPredicate | ElemMatchAndExpression | ElemMatchOrExpression;

/**
 * Canonical query form requiring one concrete array element to satisfy its child expression.
 */
export interface CanonicalElemMatchExpression {
  /** Canonical array path that defines the element scope. */
  readonly path: string;
  /** Expression evaluated relative to one common array element. */
  readonly elemMatch: ElemMatchQueryExpression;
}

/**
 * Compatibility form published as a reserved placeholder before SABLI v1.4.
 *
 * @remarks Public query validation accepts this shape and normalizes it to
 * {@link CanonicalElemMatchExpression}. New code should use the canonical form.
 */
export interface LegacyElemMatchExpression {
  /** Legacy wrapper containing the array path and relative child expression. */
  readonly elemMatch: {
    /** Array path that defines the element scope. */
    readonly path: string;
    /** Expression evaluated relative to one common array element. */
    readonly where: QueryExpression;
  };
}

/**
 * A same-array-element query in canonical or v1.3 compatibility form.
 */
export type ElemMatchExpression = CanonicalElemMatchExpression | LegacyElemMatchExpression;

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
