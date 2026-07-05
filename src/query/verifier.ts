import { normalizeJsonPath } from "../core/path.js";
import type { JsonObject, JsonPrimitive, JsonValue } from "../types/json.js";
import type { Query, QueryExpression, QueryPredicate } from "./ast.js";

function isPrimitive(value: JsonValue): value is JsonPrimitive {
  return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function escapeKey(key: string): string {
  return key.replaceAll("\\", "\\\\").replaceAll(".", "\\.").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("$", "\\$");
}

function flatten(value: JsonValue, path: string): readonly { readonly path: string; readonly value: JsonPrimitive }[] {
  if (isPrimitive(value)) {
    return [{ path: normalizeJsonPath(path), value }];
  }
  const out: { readonly path: string; readonly value: JsonPrimitive }[] = [];
  if (isJsonArray(value)) {
    for (const child of value) {
      out.push(...flatten(child, `${path}[]`));
    }
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const escaped = escapeKey(key);
    out.push(...flatten(child, path === "$" ? `$.${escaped}` : `${path}.${escaped}`));
  }
  return out;
}

function valuesAt(document: JsonObject, path: string): readonly JsonPrimitive[] {
  const normalized = normalizeJsonPath(path);
  return flatten(document, "$").filter((entry) => entry.path === normalized).map((entry) => entry.value);
}

function compareNumeric(values: readonly JsonPrimitive[], predicate: (value: number) => boolean): boolean {
  return values.some((value) => typeof value === "number" && predicate(value));
}

function verifyPredicate(document: JsonObject, predicate: QueryPredicate): boolean {
  const values = valuesAt(document, predicate.path);
  if (predicate.exists !== undefined && (predicate.exists ? values.length === 0 : values.length > 0)) {
    return false;
  }
  if ("eq" in predicate && !values.some((value) => Object.is(value, predicate.eq))) {
    return false;
  }
  if ("neq" in predicate && values.some((value) => Object.is(value, predicate.neq))) {
    return false;
  }
  if ("contains" in predicate && !values.some((value) => Object.is(value, predicate.contains))) {
    return false;
  }
  if (predicate.gt !== undefined) {
    const bound = predicate.gt;
    if (!compareNumeric(values, (value) => value > bound)) {
      return false;
    }
  }
  if (predicate.gte !== undefined) {
    const bound = predicate.gte;
    if (!compareNumeric(values, (value) => value >= bound)) {
      return false;
    }
  }
  if (predicate.lt !== undefined) {
    const bound = predicate.lt;
    if (!compareNumeric(values, (value) => value < bound)) {
      return false;
    }
  }
  if (predicate.lte !== undefined) {
    const bound = predicate.lte;
    if (!compareNumeric(values, (value) => value <= bound)) {
      return false;
    }
  }
  if (predicate.between !== undefined) {
    const [min, max] = predicate.between;
    if (!compareNumeric(values, (value) => value >= min && value <= max)) {
      return false;
    }
  }
  return true;
}

function verifyExpression(document: JsonObject, expression: QueryExpression): boolean {
  if ("and" in expression) {
    return expression.and.every((child) => verifyExpression(document, child));
  }
  if ("or" in expression) {
    return expression.or.some((child) => verifyExpression(document, child));
  }
  if ("not" in expression) {
    return !verifyExpression(document, expression.not);
  }
  if ("elemMatch" in expression) {
    // TODO: Implement same-array-element scoped verification when scoped indexes are added.
    return verifyExpression(document, expression.elemMatch.where);
  }
  return verifyPredicate(document, expression);
}

/**
 * Verifies a document against a normalized SABLI query using exact full-document semantics.
 *
 * @param document - The JSON document to verify.
 * @param query - The normalized SABLI query.
 * @returns True when the document satisfies the query.
 * @remarks This function is the correctness oracle for optimized search.
 */
export function verifyDocument(document: JsonObject, query: Query): boolean {
  return verifyExpression(document, query.where);
}
