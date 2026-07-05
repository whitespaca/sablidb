import { open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { SabliLockError } from "../errors/index.js";

/**
 * Exclusive database file lock implemented with atomic file creation.
 */
export class FileLock {
  readonly #path: string;
  #handle: FileHandle | undefined;

  /**
   * Creates a file lock descriptor.
   *
   * @param path - Lock file path.
   */
  public constructor(path: string) {
    this.#path = path;
  }

  /**
   * Acquires the lock.
   *
   * @throws {SabliLockError} If the lock already exists or cannot be created.
   */
  public async acquire(): Promise<void> {
    try {
      this.#handle = await open(this.#path, "wx");
      await this.#handle.writeFile(`${String(process.pid)}\n`);
    } catch (error) {
      throw new SabliLockError(`Failed to acquire SABLI database lock at ${this.#path}.`, { cause: error });
    }
  }

  /**
   * Releases the lock.
   */
  public async release(): Promise<void> {
    if (this.#handle !== undefined) {
      await this.#handle.close();
      this.#handle = undefined;
    }
    await unlink(this.#path).catch(() => undefined);
  }
}
