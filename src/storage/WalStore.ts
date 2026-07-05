import { appendFile, readFile, writeFile } from "node:fs/promises";
import { SabliRecoveryError, SabliStorageError } from "../errors/index.js";
import type { JsonObject } from "../types/json.js";
import { toDocId, type DocId } from "../types/json.js";
import { checksum, stableJson } from "./Checksum.js";
import { t } from "typesea";
import { JsonObjectGuard } from "../validation/schemas.js";

const WalRecordInputGuard = t.record(t.unknown);

/**
 * Insert WAL payload.
 */
export interface WalInsertRecord {
  /** WAL record format marker. */
  readonly format: "sabli-wal-record";
  /** WAL record version. */
  readonly version: 1;
  /** Monotonic WAL sequence number. */
  readonly sequence: number;
  /** Record operation type. */
  readonly type: "insert";
  /** Assigned document identifier. */
  readonly docId: DocId;
  /** JSON document payload. */
  readonly document: JsonObject;
}

/**
 * Future delete WAL payload.
 */
export interface WalDeleteRecord {
  /** WAL record format marker. */
  readonly format: "sabli-wal-record";
  /** WAL record version. */
  readonly version: 1;
  /** Monotonic WAL sequence number. */
  readonly sequence: number;
  /** Record operation type. */
  readonly type: "delete";
  /** Deleted document identifier. */
  readonly docId: DocId;
}

/**
 * Future update WAL payload.
 */
export interface WalUpdateRecord {
  /** WAL record format marker. */
  readonly format: "sabli-wal-record";
  /** WAL record version. */
  readonly version: 1;
  /** Monotonic WAL sequence number. */
  readonly sequence: number;
  /** Record operation type. */
  readonly type: "update";
  /** Updated document identifier. */
  readonly docId: DocId;
  /** Replacement JSON document. */
  readonly document: JsonObject;
}

/**
 * Supported WAL record payloads.
 */
export type WalRecord = WalInsertRecord | WalDeleteRecord | WalUpdateRecord;

interface WalEnvelope {
  readonly record: WalRecord;
  readonly checksum: string;
}

/**
 * Result of WAL replay.
 */
export interface WalReplayResult {
  /** Valid replay records newer than the manifest flush sequence. */
  readonly records: readonly WalRecord[];
  /** Last valid sequence observed in the WAL. */
  readonly lastSequence: number;
  /** Whether replay stopped at a partial or malformed trailing record. */
  readonly stoppedAtInvalidRecord: boolean;
}

/**
 * Append-only write-ahead log store.
 */
export class WalStore {
  readonly #path: string;

  /**
   * Creates a WAL store.
   *
   * @param path - WAL file path.
   */
  public constructor(path: string) {
    this.#path = path;
  }

  /**
   * Ensures the WAL file exists.
   */
  public async ensure(): Promise<void> {
    await appendFile(this.#path, "");
  }

  /**
   * Appends a record before it is acknowledged.
   *
   * @param record - WAL record to append.
   * @param durable - Whether to force the record to stable storage immediately.
   * @throws {SabliStorageError} If append fails.
   */
  public async append(record: WalRecord, durable: boolean): Promise<void> {
    const envelope: WalEnvelope = { record, checksum: checksum(stableJson(record)) };
    try {
      await appendFile(this.#path, `${JSON.stringify(envelope)}\n`, durable ? { flush: true } : undefined);
    } catch (error) {
      throw new SabliStorageError("Failed to append WAL record.", { cause: error });
    }
  }

  /**
   * Replays valid WAL records newer than a flushed sequence.
   *
   * @param flushedSequence - Last sequence already reflected in immutable segments.
   * @returns Replay records and recovery metadata.
   */
  public async replay(flushedSequence: number): Promise<WalReplayResult> {
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch {
      return { records: [], lastSequence: flushedSequence, stoppedAtInvalidRecord: false };
    }
    const records: WalRecord[] = [];
    let lastSequence = flushedSequence;
    for (const line of text.split("\n")) {
      if (line.length === 0) {
        continue;
      }
      const parsed = this.parseEnvelope(line);
      if (parsed === undefined) {
        return { records, lastSequence, stoppedAtInvalidRecord: true };
      }
      lastSequence = Math.max(lastSequence, parsed.sequence);
      if (parsed.sequence > flushedSequence) {
        records.push(parsed);
      }
    }
    return { records, lastSequence, stoppedAtInvalidRecord: false };
  }

  /**
   * Truncates the WAL after all records have been flushed.
   */
  public async reset(): Promise<void> {
    await writeFile(this.#path, "");
  }

  private parseEnvelope(line: string): WalRecord | undefined {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const envelope = value as Readonly<Record<string, unknown>>;
    if (typeof envelope.checksum !== "string" || typeof envelope.record !== "object" || envelope.record === null || Array.isArray(envelope.record)) {
      return undefined;
    }
    if (checksum(stableJson(envelope.record)) !== envelope.checksum) {
      throw new SabliRecoveryError("Invalid WAL record: checksum mismatch.");
    }
    return parseWalRecord(envelope.record);
  }
}

/**
 * Validates a WAL record loaded from disk.
 *
 * @param input - Unknown WAL record payload.
 * @returns Validated WAL record.
 * @throws {SabliRecoveryError} If the record is structurally invalid.
 */
export function parseWalRecord(input: unknown): WalRecord {
  const result = WalRecordInputGuard.check(input);
  if (!result.ok || typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SabliRecoveryError("Invalid WAL record: expected an object.");
  }
  const record = input as Readonly<Record<string, unknown>>;
  if (record.format !== "sabli-wal-record" || record.version !== 1) {
    throw new SabliRecoveryError("Invalid WAL record: unsupported format or version.");
  }
  if (typeof record.sequence !== "number" || !Number.isInteger(record.sequence) || record.sequence < 1) {
    throw new SabliRecoveryError("Invalid WAL record: sequence must be a positive integer.");
  }
  if (typeof record.docId !== "number" || !Number.isInteger(record.docId) || record.docId < 1) {
    throw new SabliRecoveryError("Invalid WAL record: docId must be a positive integer.");
  }
  if (record.type === "delete") {
    return { format: "sabli-wal-record", version: 1, sequence: record.sequence, type: "delete", docId: toDocId(record.docId) };
  }
  if (record.type === "insert" || record.type === "update") {
    const documentResult = JsonObjectGuard.check(record.document);
    if (!documentResult.ok) {
      throw new SabliRecoveryError("Invalid WAL record: document must be an object.");
    }
    return {
      format: "sabli-wal-record",
      version: 1,
      sequence: record.sequence,
      type: record.type,
      docId: toDocId(record.docId),
      document: documentResult.value
    };
  }
  throw new SabliRecoveryError("Invalid WAL record: unsupported operation type.");
}
