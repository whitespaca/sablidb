import { normalizeJsonPath } from "../core/path.js";
import type { JsonObject, JsonPrimitive, JsonValue } from "../types/json.js";
import type { ExtractedValueType } from "./extractor.js";

/**
 * A positive identifier for one concrete array element during one document
 * extraction pass.
 *
 * @remarks Scope identifiers are local to a document. A scoped posting is
 * uniquely identified by the pair of its document and scope identifiers.
 */
export type ScopeId = number & { readonly __brand: "ScopeId" };

/**
 * One concrete array-element scope discovered during document extraction.
 */
export interface ScopedArrayScope {
  /** Per-document array-element identifier. */
  readonly scopeId: ScopeId;
  /** Nearest enclosing array-element scope, when one exists. */
  readonly parentScopeId?: ScopeId;
  /** Canonical absolute path of the array that owns this element. */
  readonly arrayPath: string;
}

/**
 * A primitive leaf projected into one concrete array-element scope.
 */
export interface ScopedExtractedEntry {
  /** Canonical absolute path of the primitive leaf. */
  readonly path: string;
  /** Canonical path relative to the scoped array element. */
  readonly relativePath: string;
  /** Primitive JSON value stored at the leaf. */
  readonly value: JsonPrimitive;
  /** Primitive type label used for stable term encoding. */
  readonly valueType: ExtractedValueType;
  /** Per-document array-element identifier. */
  readonly scopeId: ScopeId;
  /** Nearest enclosing array-element scope, when one exists. */
  readonly parentScopeId?: ScopeId;
  /** Canonical absolute path of the array that owns this scope. */
  readonly arrayPath: string;
}

/**
 * Scope universe and projected primitive leaves for one document.
 */
export interface ScopedExtraction {
  /** Every concrete array element, including empty and primitive elements. */
  readonly scopes: readonly ScopedArrayScope[];
  /** Primitive leaves projected into each enclosing array-element scope. */
  readonly entries: readonly ScopedExtractedEntry[];
}

interface ActiveScope extends ScopedArrayScope {
  readonly relativePath: string;
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

function appendRelativeProperty(path: string, key: string): string {
  return `${path}.${escapeKey(key)}`;
}

function withParentScope(
  scopeId: ScopeId,
  arrayPath: string,
  parentScopeId: ScopeId | undefined
): ScopedArrayScope {
  return parentScopeId === undefined
    ? { scopeId, arrayPath }
    : { scopeId, parentScopeId, arrayPath };
}

/**
 * Extracts deterministic array scopes and scope-relative primitive leaves from
 * a validated JSON document.
 *
 * @param document - Validated JSON document to inspect.
 * @returns Per-document scopes and projected primitive leaf records.
 * @remarks
 * Scope identifiers start at one for each call and are allocated in the same
 * deterministic depth-first traversal order used by ordinary extraction.
 * Nested leaves are projected into every enclosing array scope so an outer
 * element can match a relative path that traverses a nested array.
 */
export function extractScopedEntries(document: JsonObject): ScopedExtraction {
  const scopes: ScopedArrayScope[] = [];
  const entries: ScopedExtractedEntry[] = [];
  let nextScopeId = 1;

  const walk = (value: JsonValue, path: string, activeScopes: readonly ActiveScope[]): void => {
    if (isPrimitive(value)) {
      const normalizedPath = normalizeJsonPath(path);
      const type = valueType(value);
      for (const active of activeScopes) {
        const base = {
          path: normalizedPath,
          relativePath: active.relativePath,
          value,
          valueType: type,
          scopeId: active.scopeId,
          arrayPath: active.arrayPath
        };
        entries.push(active.parentScopeId === undefined
          ? base
          : { ...base, parentScopeId: active.parentScopeId });
      }
      return;
    }

    if (isJsonArray(value)) {
      const arrayPath = normalizeJsonPath(`${path}[]`);
      value.forEach((item) => {
        const scopeId = nextScopeId as ScopeId;
        nextScopeId += 1;
        const parentScopeId = activeScopes.at(-1)?.scopeId;
        const scope = withParentScope(scopeId, arrayPath, parentScopeId);
        scopes.push(scope);

        const ancestors = activeScopes.map((active) => ({
          ...active,
          relativePath: `${active.relativePath}[]`
        }));
        const ownScope: ActiveScope = parentScopeId === undefined
          ? { scopeId, arrayPath, relativePath: "$" }
          : { scopeId, parentScopeId, arrayPath, relativePath: "$" };
        walk(item, `${path}[]`, [...ancestors, ownScope]);
      });
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const escapedKey = escapeKey(key);
      const descendants = activeScopes.map((active) => ({
        ...active,
        relativePath: appendRelativeProperty(active.relativePath, key)
      }));
      walk(child, `${path}.${escapedKey}`, descendants);
    }
  };

  for (const [key, value] of Object.entries(document)) {
    walk(value, escapeKey(key), []);
  }

  return { scopes, entries };
}
