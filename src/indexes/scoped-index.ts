import type { ScopedExtraction } from "../extract/scoped-extractor.js";
import type { ElemMatchExpression, QueryExpression, QueryPredicate } from "../query/ast.js";
import type { DocId, JsonPrimitive } from "../types/json.js";
import { createScopedPostingList, type ScopedPostingEntry, type ScopedPostingList } from "./scoped-posting.js";

/**
 * Runtime view of a normalized same-element query.
 */
export interface ResolvedElemMatchExpression {
  /** Canonical absolute array path that owns the candidate scopes. */
  readonly arrayPath: string;
  /** Expression whose paths are canonical and relative to each element. */
  readonly expression: QueryExpression;
}

interface ScopedNumericEntry extends ScopedPostingEntry {
  readonly value: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function encodePrimitive(value: JsonPrimitive): readonly [string, string] {
  if (value === null) {
    return ["null", "null"];
  }
  if (typeof value === "number") {
    return ["number", Object.is(value, -0) ? "-0" : String(value)];
  }
  if (typeof value === "boolean") {
    return ["boolean", value ? "true" : "false"];
  }
  return ["string", value];
}

/**
 * Encodes a scope-relative path lookup without delimiter collisions.
 *
 * @param arrayPath - Canonical absolute owner array path.
 * @param relativePath - Canonical path relative to an array element.
 * @returns Stable scoped path key.
 */
export function encodeScopedPathKey(arrayPath: string, relativePath: string): string {
  return JSON.stringify([arrayPath, relativePath]);
}

/**
 * Encodes a scoped primitive term lookup without delimiter collisions.
 *
 * @param arrayPath - Canonical absolute owner array path.
 * @param relativePath - Canonical path relative to an array element.
 * @param value - Primitive term value.
 * @returns Stable scoped term key.
 */
export function encodeScopedTermKey(arrayPath: string, relativePath: string, value: JsonPrimitive): string {
  const [type, encoded] = encodePrimitive(value);
  return JSON.stringify([arrayPath, relativePath, type, encoded]);
}

/**
 * Resolves both the canonical elemMatch runtime form and the v1.3 placeholder
 * wrapper used by direct typed callers.
 *
 * @param expression - Normalized query expression to inspect.
 * @returns Array path and child expression, or undefined for a non-elemMatch expression.
 */
export function resolveElemMatchExpression(expression: QueryExpression): ResolvedElemMatchExpression | undefined {
  const record = expression as unknown as Readonly<Record<string, unknown>>;
  if (!hasOwn(record, "elemMatch")) {
    return undefined;
  }
  const elemMatch = record.elemMatch;
  if (typeof record.path === "string" && isRecord(elemMatch)) {
    return { arrayPath: record.path, expression: elemMatch as unknown as QueryExpression };
  }
  if (isRecord(elemMatch) && typeof elemMatch.path === "string" && isRecord(elemMatch.where)) {
    return { arrayPath: elemMatch.path, expression: elemMatch.where as unknown as QueryExpression };
  }
  return undefined;
}

/**
 * Narrows a normalized query node to either supported elemMatch runtime shape.
 *
 * @param expression - Query expression to inspect.
 * @returns True when the node carries an elemMatch child expression.
 */
export function isElemMatchExpression(expression: QueryExpression): expression is ElemMatchExpression {
  return hasOwn(expression, "elemMatch");
}

/**
 * Tests whether an expression subtree contains an elemMatch operation.
 *
 * @param expression - Expression subtree to inspect.
 * @returns True when same-element semantics occur anywhere in the subtree.
 */
export function expressionContainsElemMatch(expression: QueryExpression): boolean {
  if (isElemMatchExpression(expression)) {
    return true;
  }
  if ("and" in expression) {
    return expression.and.some((child) => expressionContainsElemMatch(child));
  }
  if ("or" in expression) {
    return expression.or.some((child) => expressionContainsElemMatch(child));
  }
  if ("not" in expression) {
    return expressionContainsElemMatch(expression.not);
  }
  return false;
}

/**
 * Mutable in-memory scoped index shared by SABLI's two memory segment facades.
 */
export class ScopedIndex {
  readonly #scopeUniverse = new Map<string, ScopedPostingEntry[]>();
  readonly #pathExists = new Map<string, ScopedPostingEntry[]>();
  readonly #termPostings = new Map<string, ScopedPostingEntry[]>();
  readonly #numericValues = new Map<string, ScopedNumericEntry[]>();

  /**
   * Adds all scopes and projected leaves for one document.
   *
   * @param docId - Complete document identifier.
   * @param extraction - Scoped extraction for that document.
   */
  public addDocument(docId: DocId, extraction: ScopedExtraction): void {
    for (const scope of extraction.scopes) {
      this.addPosting(this.#scopeUniverse, scope.arrayPath, { docId, scopeId: scope.scopeId });
    }
    for (const entry of extraction.entries) {
      const posting = { docId, scopeId: entry.scopeId };
      const pathKey = encodeScopedPathKey(entry.arrayPath, entry.relativePath);
      this.addPosting(this.#pathExists, pathKey, posting);
      this.addPosting(
        this.#termPostings,
        encodeScopedTermKey(entry.arrayPath, entry.relativePath, entry.value),
        posting
      );
      if (typeof entry.value === "number") {
        const rows = this.#numericValues.get(pathKey) ?? [];
        rows.push({ ...posting, value: entry.value });
        this.#numericValues.set(pathKey, rows);
      }
    }
  }

  /** Clears all scoped indexes. */
  public clear(): void {
    this.#scopeUniverse.clear();
    this.#pathExists.clear();
    this.#termPostings.clear();
    this.#numericValues.clear();
  }

  /**
   * Generates exact document/scope candidates for supported positive and
   * negative field predicates under one array path.
   *
   * @param arrayPath - Canonical absolute owner array path.
   * @param expression - Element-relative child expression.
   * @returns Matching scope pairs. Unsupported nested elemMatch and NOT shapes
   * conservatively return the complete scope universe for final verification.
   */
  public candidates(arrayPath: string, expression: QueryExpression): ScopedPostingList {
    return this.candidatesForExpression(arrayPath, expression);
  }

  private addPosting(
    index: Map<string, ScopedPostingEntry[]>,
    key: string,
    entry: ScopedPostingEntry
  ): void {
    const postings = index.get(key) ?? [];
    postings.push(entry);
    index.set(key, postings);
  }

  private universe(arrayPath: string): ScopedPostingList {
    return createScopedPostingList(this.#scopeUniverse.get(arrayPath) ?? []);
  }

  private posting(index: ReadonlyMap<string, readonly ScopedPostingEntry[]>, key: string): ScopedPostingList {
    return createScopedPostingList(index.get(key) ?? []);
  }

  private numericPosting(
    arrayPath: string,
    relativePath: string,
    matches: (value: number) => boolean
  ): ScopedPostingList {
    const key = encodeScopedPathKey(arrayPath, relativePath);
    return createScopedPostingList(
      (this.#numericValues.get(key) ?? [])
        .filter(({ value }) => matches(value))
        .map(({ docId, scopeId }) => ({ docId, scopeId }))
    );
  }

  private candidatesForPredicate(arrayPath: string, predicate: QueryPredicate): ScopedPostingList {
    const universe = this.universe(arrayPath);
    let candidates = universe;

    if (predicate.exists !== undefined) {
      const exists = this.posting(this.#pathExists, encodeScopedPathKey(arrayPath, predicate.path));
      candidates = candidates.intersect(predicate.exists ? exists : universe.difference(exists));
    }

    if (hasOwn(predicate, "eq") && predicate.eq !== undefined) {
      candidates = candidates.intersect(
        this.posting(this.#termPostings, encodeScopedTermKey(arrayPath, predicate.path, predicate.eq))
      );
    }
    if (hasOwn(predicate, "neq") && predicate.neq !== undefined) {
      const equal = this.posting(
        this.#termPostings,
        encodeScopedTermKey(arrayPath, predicate.path, predicate.neq)
      );
      candidates = candidates.intersect(universe.difference(equal));
    }
    if (hasOwn(predicate, "contains") && predicate.contains !== undefined) {
      candidates = candidates.intersect(
        this.posting(this.#termPostings, encodeScopedTermKey(arrayPath, predicate.path, predicate.contains))
      );
    }

    if (predicate.gt !== undefined) {
      const bound = predicate.gt;
      candidates = candidates.intersect(this.numericPosting(arrayPath, predicate.path, (value) => value > bound));
    }
    if (predicate.gte !== undefined) {
      const bound = predicate.gte;
      candidates = candidates.intersect(this.numericPosting(arrayPath, predicate.path, (value) => value >= bound));
    }
    if (predicate.lt !== undefined) {
      const bound = predicate.lt;
      candidates = candidates.intersect(this.numericPosting(arrayPath, predicate.path, (value) => value < bound));
    }
    if (predicate.lte !== undefined) {
      const bound = predicate.lte;
      candidates = candidates.intersect(this.numericPosting(arrayPath, predicate.path, (value) => value <= bound));
    }
    if (predicate.between !== undefined) {
      const [minimum, maximum] = predicate.between;
      candidates = candidates.intersect(
        this.numericPosting(arrayPath, predicate.path, (value) => value >= minimum && value <= maximum)
      );
    }
    return candidates;
  }

  private candidatesForExpression(arrayPath: string, expression: QueryExpression): ScopedPostingList {
    if (isElemMatchExpression(expression)) {
      return this.universe(arrayPath);
    }
    if ("and" in expression) {
      const children = expression.and
        .map((child) => this.candidatesForExpression(arrayPath, child))
        .sort((left, right) => left.size - right.size);
      const [first, ...rest] = children;
      if (first === undefined) {
        return this.universe(arrayPath);
      }
      let candidates = first;
      for (const child of rest) {
        candidates = candidates.intersect(child);
        if (candidates.size === 0) {
          break;
        }
      }
      return candidates;
    }
    if ("or" in expression) {
      let candidates = createScopedPostingList([]);
      for (const child of expression.or) {
        candidates = candidates.union(this.candidatesForExpression(arrayPath, child));
      }
      return candidates;
    }
    if ("not" in expression) {
      return this.universe(arrayPath);
    }
    return this.candidatesForPredicate(arrayPath, expression);
  }
}
