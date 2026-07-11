import { extractScopedEntries } from "../extract/scoped-extractor.js";
import type { ExtractedValueType } from "../extract/extractor.js";
import type { DocId, JsonObject, JsonPrimitive } from "../types/json.js";
import { encodeScopedPathKey, encodeScopedTermKey } from "../indexes/scoped-index.js";
import type {
  ScopedNumericValueInput,
  ScopedPostingIndexFileInput,
  ScopedPostingPairInput
} from "../validation/schemas.js";

interface MutableScopedPostingRow {
  readonly arrayPath: string;
  readonly relativePath: string;
  readonly postings: Map<string, ScopedPostingPairInput>;
}

interface MutableScopedTermRow extends MutableScopedPostingRow {
  readonly valueType: ExtractedValueType;
  readonly value: JsonPrimitive;
}

interface MutableScopedNumericRow {
  readonly arrayPath: string;
  readonly relativePath: string;
  readonly values: Map<string, ScopedNumericValueInput>;
}

/**
 * Encodes the structured identity of a scoped path posting.
 *
 * @param arrayPath - Canonical absolute array path.
 * @param relativePath - Canonical element-relative leaf path.
 * @returns Collision-safe stable key for internal maps and cache keys.
 */
export function encodeScopedPathIdentity(arrayPath: string, relativePath: string): string {
  return encodeScopedPathKey(arrayPath, relativePath);
}

/**
 * Encodes the structured identity of a scoped equality posting.
 *
 * @param arrayPath - Canonical absolute array path.
 * @param relativePath - Canonical element-relative leaf path.
 * @param valueType - Primitive JSON type label.
 * @param value - Primitive comparison value.
 * @returns Collision-safe stable key for internal maps and cache keys.
 */
export function encodeScopedTermIdentity(
  arrayPath: string,
  relativePath: string,
  valueType: ExtractedValueType,
  value: JsonPrimitive
): string {
  void valueType;
  const persistedValue = typeof value === "number" && Object.is(value, -0) ? 0 : value;
  return encodeScopedTermKey(arrayPath, relativePath, persistedValue);
}

/**
 * Encodes a scoped path-presence Bloom term.
 */
export function encodeScopedPathBloomTerm(arrayPath: string, relativePath: string): string {
  return `scoped-path:${encodeScopedPathIdentity(arrayPath, relativePath)}`;
}

/**
 * Encodes a scoped equality Bloom term.
 */
export function encodeScopedTermBloomTerm(
  arrayPath: string,
  relativePath: string,
  valueType: ExtractedValueType,
  value: JsonPrimitive
): string {
  return `scoped-term:${encodeScopedTermIdentity(arrayPath, relativePath, valueType, value)}`;
}

/**
 * Builds the inspectable version-1 scoped posting file for a version-2 segment.
 *
 * @param documents - Validated raw documents paired with physical identifiers.
 * @returns Deterministically sorted and duplicate-free scoped posting data.
 */
export function buildScopedPostingIndex(
  documents: readonly { readonly docId: DocId; readonly document: JsonObject }[]
): ScopedPostingIndexFileInput {
  const scopes = new Map<string, Map<string, ScopedPostingPairInput>>();
  const pathExists = new Map<string, MutableScopedPostingRow>();
  const termPostings = new Map<string, MutableScopedTermRow>();
  const numericValues = new Map<string, MutableScopedNumericRow>();

  for (const { docId, document } of documents) {
    const numericDocId = Number(docId);
    const extraction = extractScopedEntries(document);
    for (const scope of extraction.scopes) {
      const pair = [numericDocId, Number(scope.scopeId)] as const;
      const postings = scopes.get(scope.arrayPath) ?? new Map<string, ScopedPostingPairInput>();
      postings.set(encodePairIdentity(pair), pair);
      scopes.set(scope.arrayPath, postings);
    }
    for (const entry of extraction.entries) {
      const pair = [numericDocId, Number(entry.scopeId)] as const;
      const pathKey = encodeScopedPathIdentity(entry.arrayPath, entry.relativePath);
      const pathRow = pathExists.get(pathKey) ?? {
        arrayPath: entry.arrayPath,
        relativePath: entry.relativePath,
        postings: new Map<string, ScopedPostingPairInput>()
      };
      pathRow.postings.set(encodePairIdentity(pair), pair);
      pathExists.set(pathKey, pathRow);

      const termKey = encodeScopedTermIdentity(
        entry.arrayPath,
        entry.relativePath,
        entry.valueType,
        entry.value
      );
      const termRow = termPostings.get(termKey) ?? {
        arrayPath: entry.arrayPath,
        relativePath: entry.relativePath,
        valueType: entry.valueType,
        value: entry.value,
        postings: new Map<string, ScopedPostingPairInput>()
      };
      termRow.postings.set(encodePairIdentity(pair), pair);
      termPostings.set(termKey, termRow);

      if (typeof entry.value === "number") {
        const numericKey = encodeScopedPathIdentity(entry.arrayPath, entry.relativePath);
        const numericRow = numericValues.get(numericKey) ?? {
          arrayPath: entry.arrayPath,
          relativePath: entry.relativePath,
          values: new Map<string, ScopedNumericValueInput>()
        };
        const value = { docId: numericDocId, scopeId: Number(entry.scopeId), value: entry.value };
        numericRow.values.set(encodeNumericIdentity(value), value);
        numericValues.set(numericKey, numericRow);
      }
    }
  }

  return {
    format: "sabli-scoped-postings",
    version: 1,
    scopes: [...scopes.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([arrayPath, postings]) => ({
        arrayPath,
        postings: sortedPairs(postings.values())
      })),
    pathExists: [...pathExists.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([, row]) => ({
        arrayPath: row.arrayPath,
        relativePath: row.relativePath,
        postings: sortedPairs(row.postings.values())
      })),
    termPostings: [...termPostings.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([, row]) => ({
        arrayPath: row.arrayPath,
        relativePath: row.relativePath,
        valueType: row.valueType,
        value: row.value,
        postings: sortedPairs(row.postings.values())
      })),
    numericValues: [...numericValues.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([, row]) => ({
        arrayPath: row.arrayPath,
        relativePath: row.relativePath,
        values: [...row.values.values()].sort(compareNumericValues)
      }))
  };
}

function sortedPairs(values: Iterable<ScopedPostingPairInput>): readonly ScopedPostingPairInput[] {
  return [...values].sort(comparePairs);
}

function comparePairs(left: ScopedPostingPairInput, right: ScopedPostingPairInput): number {
  return left[0] === right[0] ? left[1] - right[1] : left[0] - right[0];
}

function compareNumericValues(left: ScopedNumericValueInput, right: ScopedNumericValueInput): number {
  if (left.docId !== right.docId) {
    return left.docId - right.docId;
  }
  if (left.scopeId !== right.scopeId) {
    return left.scopeId - right.scopeId;
  }
  return left.value - right.value;
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function encodePairIdentity(pair: ScopedPostingPairInput): string {
  return `${String(pair[0])}:${String(pair[1])}`;
}

function encodeNumericIdentity(value: ScopedNumericValueInput): string {
  return JSON.stringify([value.docId, value.scopeId, value.value]);
}
