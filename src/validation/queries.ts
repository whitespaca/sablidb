import { normalizeJsonPath, parseJsonPath } from "../core/path.js";
import { SabliValidationError } from "../errors/index.js";
import type {
  ElemMatchQueryExpression,
  Query,
  QueryExpression,
  QueryPredicate,
  QueryValue
} from "../query/ast.js";
import { assertValid } from "./assertValid.js";
import { QueryInputGuard } from "./schemas.js";

type ExpressionMode = "document" | "element";

interface QueryParseState {
  readonly active: WeakSet<object>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQueryValue(value: unknown): value is QueryValue {
  return value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function ownStringKeys(value: Readonly<Record<string, unknown>>, context: string): readonly string[] {
  const keys = Reflect.ownKeys(value);
  const strings: string[] = [];
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw new SabliValidationError(`Invalid query: ${context} must not include symbol keys.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new SabliValidationError(`Invalid query: ${context} properties must be enumerable data properties.`);
    }
    strings.push(key);
  }
  return strings;
}

function getOwnValue(value: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnKey(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.getOwnPropertyDescriptor(value, key) !== undefined;
}

function assertOnlyKeys(input: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>, context: string): readonly string[] {
  const keys = ownStringKeys(input, context);
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new SabliValidationError(`Invalid query: unsupported ${context} field '${key}'.`);
    }
  }
  return keys;
}

function withActiveObject<T>(input: object, state: QueryParseState, parse: () => T): T {
  if (state.active.has(input)) {
    throw new SabliValidationError("Invalid query: cyclic query objects are not supported.");
  }
  state.active.add(input);
  try {
    return parse();
  } finally {
    state.active.delete(input);
  }
}

function denseArrayValues(input: readonly unknown[], context: string): readonly unknown[] {
  const indexed = new Map<number, unknown>();
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol") {
      throw new SabliValidationError(`Invalid query: ${context} must not include symbol keys.`);
    }
    if (key === "length") {
      continue;
    }
    if (!/^(?:0|[1-9]\d*)$/.test(key)) {
      throw new SabliValidationError(`Invalid query: ${context} must not include custom array properties.`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= input.length) {
      throw new SabliValidationError(`Invalid query: ${context} contains an invalid array index.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new SabliValidationError(`Invalid query: ${context} entries must be enumerable data properties.`);
    }
    indexed.set(index, descriptor.value);
  }
  if (indexed.size !== input.length) {
    throw new SabliValidationError(`Invalid query: ${context} must not contain sparse array entries.`);
  }
  return [...indexed.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);
}

function normalizeQueryPath(path: string): string {
  try {
    return normalizeJsonPath(path);
  } catch {
    throw new SabliValidationError("Invalid query: path syntax is invalid.");
  }
}

function normalizeElemMatchTargetPath(path: string): string {
  const normalized = normalizeQueryPath(path);
  const tokens = parseJsonPath(normalized);
  if (tokens[1]?.kind !== "property" || tokens.at(-1)?.kind !== "array") {
    throw new SabliValidationError("Invalid query: elemMatch path must identify an array and end with '[]'.");
  }
  return normalized;
}

function normalizeElementPath(path: string): string {
  if (path === "$") {
    return path;
  }
  if (path.startsWith("$")) {
    throw new SabliValidationError("Invalid query: elemMatch child paths must be relative; only '$' may address the element itself.");
  }
  return normalizeQueryPath(path);
}

function parseExpressionArray(
  input: unknown,
  operator: "and" | "or",
  mode: ExpressionMode,
  state: QueryParseState
): readonly QueryExpression[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new SabliValidationError(`Invalid query: ${operator} requires a non-empty array.`);
  }
  return withActiveObject(input, state, () => {
    const expressions: QueryExpression[] = [];
    for (const value of denseArrayValues(input, operator)) {
      expressions.push(parseExpression(value, mode, state));
    }
    return expressions;
  });
}

function parsePredicate(path: string, input: Readonly<Record<string, unknown>>, mode: ExpressionMode): QueryPredicate {
  const normalizedPath = mode === "element" ? normalizeElementPath(path) : normalizeQueryPath(path);
  const predicate: {
    path: string;
    eq?: QueryValue;
    neq?: QueryValue;
    exists?: boolean;
    contains?: QueryValue;
    gt?: number;
    gte?: number;
    lt?: number;
    lte?: number;
    between?: readonly [number, number];
  } = { path: normalizedPath };
  let operatorCount = 0;
  const record = input;
  assertOnlyKeys(record, new Set(["path", "eq", "neq", "exists", "contains", "gt", "gte", "lt", "lte", "between"]), "predicate");

  const assignValue = (key: "eq" | "neq" | "contains"): void => {
    if (hasOwnKey(record, key)) {
      const value = getOwnValue(input, key);
      if (!isQueryValue(value)) {
        throw new SabliValidationError(`Invalid query: ${key} requires a primitive JSON value.`);
      }
      predicate[key] = value;
      operatorCount += 1;
    }
  };
  assignValue("eq");
  assignValue("neq");
  assignValue("contains");

  if (hasOwnKey(record, "exists")) {
    const exists = getOwnValue(input, "exists");
    if (typeof exists !== "boolean") {
      throw new SabliValidationError("Invalid query: exists requires a boolean value.");
    }
    predicate.exists = exists;
    operatorCount += 1;
  }
  for (const key of ["gt", "gte", "lt", "lte"] as const) {
    if (hasOwnKey(record, key)) {
      const value = getOwnValue(input, key);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new SabliValidationError(`Invalid query: ${key} requires a finite number.`);
      }
      predicate[key] = value;
      operatorCount += 1;
    }
  }
  if (hasOwnKey(record, "between")) {
    const value = getOwnValue(input, "between");
    const tuple = Array.isArray(value) ? denseArrayValues(value, "between") : [];
    const leftValue = tuple[0];
    const rightValue = tuple[1];
    if (tuple.length !== 2 || typeof leftValue !== "number" || typeof rightValue !== "number" || !Number.isFinite(leftValue) || !Number.isFinite(rightValue) || leftValue > rightValue) {
      throw new SabliValidationError("Invalid query: between requires an ordered numeric tuple.");
    }
    predicate.between = [leftValue, rightValue];
    operatorCount += 1;
  }
  if (operatorCount === 0) {
    throw new SabliValidationError("Invalid query: predicate must include at least one operator.");
  }
  return predicate;
}

function parseExpression(input: unknown, mode: ExpressionMode, state: QueryParseState): QueryExpression {
  if (!isRecord(input)) {
    throw new SabliValidationError("Invalid query: where must be an object.");
  }
  return withActiveObject(input, state, () => {
    const record = input;
    if (hasOwnKey(record, "and")) {
      assertOnlyKeys(record, new Set(["and"]), "expression");
      const and = getOwnValue(record, "and");
      return { and: parseExpressionArray(and, "and", mode, state) };
    }
    if (hasOwnKey(record, "or")) {
      assertOnlyKeys(record, new Set(["or"]), "expression");
      const or = getOwnValue(record, "or");
      return { or: parseExpressionArray(or, "or", mode, state) };
    }
    if (hasOwnKey(record, "not")) {
      if (mode === "element") {
        throw new SabliValidationError("Invalid query: not is not supported inside elemMatch.");
      }
      assertOnlyKeys(record, new Set(["not"]), "expression");
      return { not: parseExpression(getOwnValue(record, "not"), mode, state) };
    }
    if (hasOwnKey(record, "elemMatch")) {
      if (mode === "element") {
        throw new SabliValidationError("Invalid query: nested elemMatch expressions are not supported.");
      }
      if (hasOwnKey(record, "path")) {
        assertOnlyKeys(record, new Set(["path", "elemMatch"]), "elemMatch expression");
        const targetPath = getOwnValue(record, "path");
        if (typeof targetPath !== "string") {
          throw new SabliValidationError("Invalid query: elemMatch requires a string array path.");
        }
        return {
          path: normalizeElemMatchTargetPath(targetPath),
          elemMatch: parseExpression(getOwnValue(record, "elemMatch"), "element", state) as ElemMatchQueryExpression
        };
      }

      assertOnlyKeys(record, new Set(["elemMatch"]), "expression");
      const compatibilityInput = getOwnValue(record, "elemMatch");
      if (!isRecord(compatibilityInput)) {
        throw new SabliValidationError("Invalid query: elemMatch requires an array path and a non-empty child expression.");
      }
      return withActiveObject(compatibilityInput, state, () => {
        assertOnlyKeys(compatibilityInput, new Set(["path", "where"]), "elemMatch");
        const targetPath = getOwnValue(compatibilityInput, "path");
        if (typeof targetPath !== "string" || !hasOwnKey(compatibilityInput, "where")) {
          throw new SabliValidationError("Invalid query: elemMatch requires an array path and a non-empty child expression.");
        }
        return {
          path: normalizeElemMatchTargetPath(targetPath),
          elemMatch: parseExpression(getOwnValue(compatibilityInput, "where"), "element", state) as ElemMatchQueryExpression
        };
      });
    }
    if (hasOwnKey(record, "path")) {
      const path = getOwnValue(record, "path");
      if (typeof path !== "string") {
        throw new SabliValidationError("Invalid query: predicate path must be a string.");
      }
      return parsePredicate(path, record, mode);
    }

    const expressions = ownStringKeys(input, mode === "element" ? "elemMatch expression" : "where").map((path) => {
      const condition = getOwnValue(input, path);
      if (!isRecord(condition)) {
        throw new SabliValidationError("Invalid query: field conditions must be objects.");
      }
      return parsePredicate(path, condition, mode);
    });
    if (expressions.length === 0) {
      throw new SabliValidationError(mode === "element"
        ? "Invalid query: elemMatch expression must not be empty."
        : "Invalid query: where must not be empty.");
    }
    return expressions.length === 1 ? expressions[0] as QueryExpression : { and: expressions };
  });
}

/**
 * Validates and narrows an unknown value into a SABLI query.
 *
 * @param input - The unknown query supplied by the caller.
 * @returns The validated query.
 * @throws {SabliValidationError} If the query shape is invalid.
 */
export function parseQuery(input: unknown): Query {
  const object = assertValid(QueryInputGuard, input, "public", "Invalid query.");
  const state: QueryParseState = { active: new WeakSet() };
  if (!hasOwnKey(object, "where")) {
    return { where: parseExpression(object, "document", state) };
  }
  assertOnlyKeys(object, new Set(["where"]), "query");
  return { where: parseExpression(getOwnValue(object, "where"), "document", state) };
}
