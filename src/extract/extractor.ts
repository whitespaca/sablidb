import { normalizeJsonPath } from "../core/path.js";
import type { JsonObject, JsonPrimitive, JsonValue } from "../types/json.js";

/**
 * A primitive JSON value type label used in term keys.
 */
export type ExtractedValueType = "null" | "boolean" | "number" | "string";

/**
 * A normalized primitive JSON leaf extracted from a document.
 */
export interface ExtractedEntry {
  /** Canonical SABLI path for the leaf. */
  readonly path: string;
  /** Primitive value stored at the path. */
  readonly value: JsonPrimitive;
  /** Primitive type label used for stable term encoding. */
  readonly valueType: ExtractedValueType;
  /** Scope identifier for future same-array-element semantics. */
  readonly scope: string;
}

function valueType(value: JsonPrimitive): ExtractedValueType {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  return "string";
}

function isPrimitive(value: JsonValue): value is JsonPrimitive {
  return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function escapeKey(key: string): string {
  return key.replaceAll("\\", "\\\\").replaceAll(".", "\\.").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("$", "\\$");
}

function walk(value: JsonValue, path: string, scope: string, entries: ExtractedEntry[]): void {
  if (isPrimitive(value)) {
    entries.push({ path: normalizeJsonPath(path), value, valueType: valueType(value), scope });
    return;
  }
  if (isJsonArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[]`, `${scope}/${String(index)}`, entries);
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    walk(child, `${path}.${escapeKey(key)}`, scope, entries);
  }
}

/**
 * Extracts normalized primitive leaf entries from a validated JSON document.
 *
 * @param document - The validated JSON object to extract.
 * @returns Extracted entries in deterministic traversal order.
 * @remarks Extraction cost is O(N), where N is the number of JSON nodes.
 */
export function extractEntries(document: JsonObject): ExtractedEntry[] {
  const entries: ExtractedEntry[] = [];
  for (const [key, value] of Object.entries(document)) {
    walk(value, escapeKey(key), "$", entries);
  }
  return entries;
}
