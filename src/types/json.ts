/**
 * A JSON primitive value accepted by SABLI documents and query predicates.
 */
export type JsonPrimitive = null | boolean | number | string;

/**
 * A JSON array accepted by SABLI.
 */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object accepted as the root SABLI document type.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * A JSON-compatible value accepted by SABLI.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * A canonical JSON path string.
 */
export type JsonPath = string;

/**
 * A SABLI document identifier assigned by a segment.
 */
export type DocId = number & { readonly __brand: "DocId" };

/**
 * A SABLI internal path identifier reserved for future dictionaries.
 */
export type PathId = number & { readonly __brand: "PathId" };

/**
 * A SABLI internal value identifier reserved for future dictionaries.
 */
export type ValueId = number & { readonly __brand: "ValueId" };

/**
 * A SABLI segment identifier.
 */
export type SegmentId = number & { readonly __brand: "SegmentId" };

/**
 * Casts a non-negative integer into a document identifier.
 *
 * @param value - The numeric identifier to brand.
 * @returns The branded document identifier.
 */
export function toDocId(value: number): DocId {
  return value as DocId;
}

/**
 * Casts a non-negative integer into a segment identifier.
 *
 * @param value - The numeric identifier to brand.
 * @returns The branded segment identifier.
 */
export function toSegmentId(value: number): SegmentId {
  return value as SegmentId;
}
