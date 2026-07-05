import { createHash } from "node:crypto";

/**
 * Computes a stable SHA-256 checksum for persisted records.
 *
 * @param input - Bytes or string content to checksum.
 * @returns Hex encoded checksum.
 */
export function checksum(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Encodes a JSON-compatible value with stable object key ordering.
 *
 * @param input - Value to encode.
 * @returns Stable JSON representation.
 */
export function stableJson(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = input as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
