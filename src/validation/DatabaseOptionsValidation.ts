import { t } from "typesea";
import { SabliValidationError } from "../errors/index.js";

const DatabaseOptionsInputGuard = t.record(t.unknown);

/**
 * Options used to open a SABLI database.
 */
export interface SabliDatabaseOptions {
  /** Database directory path. */
  readonly path: string;
  /** Whether to create the database directory and manifest if missing. */
  readonly createIfMissing: boolean;
  /** Number of inserted documents to keep in memory before automatic flush. */
  readonly memSegmentMaxDocuments: number;
  /** Durability mode for acknowledged writes. */
  readonly durability: "strict" | "relaxed";
}

/**
 * Validates public database open options.
 *
 * @param input - Unknown options supplied by the caller.
 * @returns Validated options with defaults.
 * @throws {SabliValidationError} If options are invalid.
 */
export function parseDatabaseOptions(input: unknown): SabliDatabaseOptions {
  const result = DatabaseOptionsInputGuard.check(input);
  if (!result.ok || typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SabliValidationError("Invalid database options: expected an object.");
  }
  const record = input as Readonly<Record<string, unknown>>;
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new SabliValidationError("Invalid database options: path must be a non-empty string.");
  }
  const createIfMissing = record.createIfMissing === undefined ? false : record.createIfMissing;
  if (typeof createIfMissing !== "boolean") {
    throw new SabliValidationError("Invalid database options: createIfMissing must be a boolean.");
  }
  const memSegmentMaxDocuments = record.memSegmentMaxDocuments === undefined ? 1_000 : record.memSegmentMaxDocuments;
  if (typeof memSegmentMaxDocuments !== "number" || !Number.isInteger(memSegmentMaxDocuments) || memSegmentMaxDocuments < 1) {
    throw new SabliValidationError("Invalid database options: memSegmentMaxDocuments must be a positive integer.");
  }
  const durability = record.durability === undefined ? "strict" : record.durability;
  if (durability !== "strict" && durability !== "relaxed") {
    throw new SabliValidationError("Invalid database options: durability must be strict or relaxed.");
  }
  return { path: record.path, createIfMissing, memSegmentMaxDocuments, durability };
}
