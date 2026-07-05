import { describe, expect, it } from "vitest";
import {
  parseJsonDocument,
  parseQuery,
  parseSabliOptions,
  parseSegmentManifest,
  SabliCorruptionError,
  SabliValidationError
} from "../src/index.js";

describe("TypeSea validation boundaries", () => {
  it("accepts valid JSON documents", () => {
    expect(parseJsonDocument({ user: { name: "Kim" }, tags: ["backend"] })).toEqual({
      user: { name: "Kim" },
      tags: ["backend"]
    });
  });

  it("rejects unsupported document values", () => {
    expect(() => parseJsonDocument({ createdAt: new Date() })).toThrow(SabliValidationError);
    expect(() => parseJsonDocument({ value: undefined })).toThrow(SabliValidationError);
  });

  it("rejects invalid queries with SABLI-specific errors", () => {
    expect(() => parseQuery({ where: { and: [] } })).toThrow(SabliValidationError);
    expect(() => parseQuery({ where: { "user.name": { eq: { nested: true } } } })).toThrow(SabliValidationError);
  });

  it("applies option defaults and rejects malformed options", () => {
    expect(parseSabliOptions(undefined).bloom.falsePositiveRate).toBe(0.01);
    expect(() => parseSabliOptions({ bloom: { falsePositiveRate: 2 } })).toThrow(SabliValidationError);
  });

  it("wraps malformed persisted metadata as corruption errors", () => {
    expect(() => parseSegmentManifest({ format: "bad", version: 1 })).toThrow(SabliCorruptionError);
    expect(parseSegmentManifest({
      format: "sabli-segment",
      version: 1,
      segmentId: 1,
      docCount: 2,
      createdAt: "2026-07-05T00:00:00.000Z"
    }).docCount).toBe(2);
  });
});
