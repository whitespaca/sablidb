import { SabliValidationError } from "../errors/index.js";
import type { JsonObject, JsonValue } from "../types/json.js";
import { formatValidationError } from "./errors.js";
import { JsonObjectGuard } from "./schemas.js";

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSupportedJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SabliValidationError(`Unsupported JSON value at ${path}: numbers must be finite.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSupportedJsonValue(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (isPlainJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertSupportedJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  const label = Object.prototype.toString.call(value).slice(8, -1);
  throw new SabliValidationError(`Unsupported JSON value at ${path}: ${label} values must be serialized before indexing.`);
}

/**
 * Validates and narrows an unknown value into a JSON object accepted by SABLI.
 *
 * @param input - The unknown value supplied by the caller.
 * @returns The validated JSON object.
 * @throws {SabliValidationError} If the value is not a supported JSON object.
 */
export function parseJsonDocument(input: unknown): JsonObject {
  const result = JsonObjectGuard.check(input);
  if (!result.ok) {
    throw new SabliValidationError(formatValidationError("Invalid JSON document.", result.error));
  }
  if (!isPlainJsonObject(input)) {
    throw new SabliValidationError("Invalid JSON document: the root value must be a plain JSON object.");
  }
  assertSupportedJsonValue(input, "$");
  return result.value;
}
