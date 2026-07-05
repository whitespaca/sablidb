import { SabliValidationError } from "../errors/index.js";
import type { SabliOptions } from "../query/ast.js";
import { formatValidationError } from "./errors.js";
import { OptionsInputGuard } from "./schemas.js";

/**
 * Default SABLI options used when the caller omits constructor options.
 */
export const DEFAULT_SABLI_OPTIONS: SabliOptions = {
  mutableSegmentMaxDocuments: 100_000,
  bloom: {
    falsePositiveRate: 0.01,
    expectedEntries: 10_000
  }
};

function readPositiveInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SabliValidationError(`Invalid options: ${name} must be a positive integer.`);
  }
  return value;
}

function readProbability(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || value <= 0 || value >= 1) {
    throw new SabliValidationError(`Invalid options: ${name} must be greater than 0 and less than 1.`);
  }
  return value;
}

/**
 * Validates and narrows unknown constructor options.
 *
 * @param input - The unknown options supplied by the caller.
 * @returns Validated SABLI options with defaults applied.
 * @throws {SabliValidationError} If the options are invalid.
 */
export function parseSabliOptions(input: unknown): SabliOptions {
  const result = OptionsInputGuard.check(input);
  if (!result.ok) {
    throw new SabliValidationError(formatValidationError("Invalid options.", result.error));
  }
  const object = (input ?? {}) as Readonly<Record<string, unknown>>;
  const bloom = (typeof object.bloom === "object" && object.bloom !== null && !Array.isArray(object.bloom)
    ? object.bloom
    : {}) as Readonly<Record<string, unknown>>;
  if (object.bloom !== undefined && (typeof object.bloom !== "object" || object.bloom === null || Array.isArray(object.bloom))) {
    throw new SabliValidationError("Invalid options: bloom must be an object when provided.");
  }
  return {
    mutableSegmentMaxDocuments: readPositiveInteger(
      object.mutableSegmentMaxDocuments,
      "mutableSegmentMaxDocuments",
      DEFAULT_SABLI_OPTIONS.mutableSegmentMaxDocuments
    ),
    bloom: {
      falsePositiveRate: readProbability(bloom.falsePositiveRate, "bloom.falsePositiveRate", DEFAULT_SABLI_OPTIONS.bloom.falsePositiveRate),
      expectedEntries: readPositiveInteger(bloom.expectedEntries, "bloom.expectedEntries", DEFAULT_SABLI_OPTIONS.bloom.expectedEntries)
    }
  };
}
