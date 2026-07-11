import { parseJsonPath, type PathToken } from "../core/path.js";
import type { JsonObject, JsonPrimitive, JsonValue } from "../types/json.js";
import type {
  ElemMatchExpression,
  Query,
  QueryExpression,
  QueryPredicate
} from "./ast.js";

function isPrimitive(value: JsonValue): value is JsonPrimitive {
  return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return !isPrimitive(value) && !isJsonArray(value);
}

function pathTokens(path: string): readonly PathToken[] {
  return path === "$" ? [{ kind: "root" }] : parseJsonPath(path);
}

function valuesAtPath(root: JsonValue, path: string): readonly JsonValue[] {
  let values: readonly JsonValue[] = [root];
  for (const token of pathTokens(path).slice(1)) {
    const next: JsonValue[] = [];
    if (token.kind === "property") {
      for (const value of values) {
        if (!isJsonObject(value)) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, token.key);
        if (descriptor !== undefined && descriptor.enumerable && "value" in descriptor) {
          const child: unknown = descriptor.value;
          next.push(child as JsonValue);
        }
      }
    } else if (token.kind === "array") {
      for (const value of values) {
        if (isJsonArray(value)) {
          next.push(...value);
        }
      }
    }
    values = next;
    if (values.length === 0) {
      return values;
    }
  }
  return values;
}

function primitiveValuesAt(root: JsonValue, path: string): readonly JsonPrimitive[] {
  return valuesAtPath(root, path).filter(isPrimitive);
}

function compareNumeric(values: readonly JsonPrimitive[], predicate: (value: number) => boolean): boolean {
  return values.some((value) => typeof value === "number" && predicate(value));
}

function verifyPredicate(root: JsonValue, predicate: QueryPredicate): boolean {
  const values = primitiveValuesAt(root, predicate.path);
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

interface ResolvedElemMatchExpression {
  readonly path: string;
  readonly expression: QueryExpression;
}

function resolveElemMatchExpression(expression: ElemMatchExpression): ResolvedElemMatchExpression {
  if ("path" in expression) {
    return { path: expression.path, expression: expression.elemMatch };
  }
  return { path: expression.elemMatch.path, expression: expression.elemMatch.where };
}

function arrayElementsAt(root: JsonValue, path: string): readonly JsonValue[] {
  const tokens = pathTokens(path);
  return tokens.at(-1)?.kind === "array" ? valuesAtPath(root, path) : [];
}

function verifyExpression(root: JsonValue, expression: QueryExpression): boolean {
  if ("and" in expression) {
    return expression.and.every((child) => verifyExpression(root, child));
  }
  if ("or" in expression) {
    return expression.or.some((child) => verifyExpression(root, child));
  }
  if ("not" in expression) {
    return !verifyExpression(root, expression.not);
  }
  if ("elemMatch" in expression) {
    const elemMatch = resolveElemMatchExpression(expression);
    return arrayElementsAt(root, elemMatch.path)
      .some((element) => verifyExpression(element, elemMatch.expression));
  }
  return verifyPredicate(root, expression);
}

/**
 * Verifies a document against a normalized SABLI query using exact full-document semantics.
 *
 * @param document - The JSON document to verify.
 * @param query - The normalized SABLI query.
 * @returns True when the document satisfies the query.
 * @remarks This function is the correctness oracle for optimized search. An
 * `elemMatch` child expression is always evaluated against one concrete array
 * element and never combines values from separate elements.
 */
export function verifyDocument(document: JsonObject, query: Query): boolean {
  return verifyExpression(document, query.where);
}
