import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SabliStorageError } from "../errors/index.js";

/**
 * Well-known paths inside a SABLI database directory.
 */
export interface DatabasePaths {
  /** Root database directory. */
  readonly root: string;
  /** Lock file path. */
  readonly lock: string;
  /** CURRENT file path. */
  readonly current: string;
  /** Segment parent directory. */
  readonly segments: string;
}

/**
 * Creates and resolves the SABLI database directory layout.
 */
export class DatabaseDirectory {
  readonly #paths: DatabasePaths;

  /**
   * Creates a directory descriptor.
   *
   * @param root - Database root path.
   */
  public constructor(root: string) {
    this.#paths = {
      root,
      lock: join(root, "LOCK"),
      current: join(root, "CURRENT"),
      segments: join(root, "segments")
    };
  }

  /**
   * Resolved database paths.
   */
  public get paths(): DatabasePaths {
    return this.#paths;
  }

  /**
   * Ensures the database directory exists.
   *
   * @throws {SabliStorageError} If directory creation fails.
   */
  public async ensure(): Promise<void> {
    try {
      await mkdir(this.#paths.root, { recursive: true });
      await mkdir(this.#paths.segments, { recursive: true });
    } catch (error) {
      throw new SabliStorageError(`Failed to create database directory ${this.#paths.root}.`, { cause: error });
    }
  }

  /**
   * Reads the CURRENT file when present.
   *
   * @returns Manifest file name, or undefined when CURRENT is missing.
   */
  public async readCurrent(): Promise<string | undefined> {
    try {
      return (await readFile(this.#paths.current, "utf8")).trim();
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw new SabliStorageError("Failed to read CURRENT file.", { cause: error });
    }
  }

  /**
   * Writes the CURRENT file.
   *
   * @param manifestName - Active manifest file name.
   */
  public async writeCurrent(manifestName: string): Promise<void> {
    await writeFile(this.#paths.current, `${manifestName}\n`);
  }

  /**
   * Resolves a WAL file path for a generation number.
   *
   * @param generation - Positive WAL generation.
   * @returns Absolute WAL file path.
   */
  public walPath(generation: number): string {
    return join(this.#paths.root, `WAL-${String(generation).padStart(6, "0")}.log`);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT";
}
