import type { PostingList } from "../indexes/posting.js";
import type { ScopedPostingList } from "../indexes/scoped-posting.js";

type CachedPosting =
  | { readonly kind: "document"; readonly value: PostingList }
  | { readonly kind: "scoped"; readonly value: ScopedPostingList };

/**
 * Read-only posting cache diagnostics.
 */
export interface PostingCacheStats {
  /** Maximum number of cached posting lists. */
  readonly maxEntries: number;
  /** Current number of cached posting lists. */
  readonly size: number;
  /** Number of successful cache lookups. */
  readonly hits: number;
  /** Number of missed cache lookups. */
  readonly misses: number;
  /** Current number of scoped posting lists in the shared cache budget. */
  readonly scopedSize: number;
  /** Number of successful scoped posting lookups. */
  readonly scopedHits: number;
  /** Number of missed scoped posting lookups. */
  readonly scopedMisses: number;
}

/**
 * Bounded least-recently-used cache for immutable segment posting lookups.
 */
export class PostingCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CachedPosting>();
  #hits = 0;
  #misses = 0;
  #scopedHits = 0;
  #scopedMisses = 0;

  /**
   * Creates a bounded posting cache.
   *
   * @param maxEntries - Maximum cache entries. Zero disables caching.
   */
  public constructor(maxEntries: number) {
    this.#maxEntries = Math.max(0, Math.floor(maxEntries));
  }

  /**
   * Maximum entries allowed in this cache.
   */
  public get maxEntries(): number {
    return this.#maxEntries;
  }

  /**
   * Current cache entry count.
   */
  public get size(): number {
    return this.#entries.size;
  }

  /**
   * Cache hit count.
   */
  public get hits(): number {
    return this.#hits;
  }

  /**
   * Cache miss count.
   */
  public get misses(): number {
    return this.#misses;
  }

  /**
   * Reads a posting list from the cache.
   *
   * @param key - Cache key including segment id and predicate identity.
   * @returns Cached posting list, or undefined.
   */
  public get(key: string): PostingList | undefined {
    const entry = this.read(key, "document");
    return entry?.kind === "document" ? entry.value : undefined;
  }

  /**
   * Stores a posting list in the cache.
   *
   * @param key - Cache key including segment id and predicate identity.
   * @param value - Posting list to cache.
   */
  public set(key: string, value: PostingList): void {
    this.store(key, { kind: "document", value });
  }

  /**
   * Reads a scoped posting list from the shared bounded cache.
   *
   * @param key - Cache key including segment, scope domain, and predicate identity.
   * @returns Cached scoped posting list, or undefined.
   */
  public getScoped(key: string): ScopedPostingList | undefined {
    const entry = this.read(key, "scoped");
    return entry?.kind === "scoped" ? entry.value : undefined;
  }

  /**
   * Stores a scoped posting list in the shared bounded cache.
   *
   * @param key - Cache key including segment, scope domain, and predicate identity.
   * @param value - Scoped posting list to cache.
   */
  public setScoped(key: string, value: ScopedPostingList): void {
    this.store(key, { kind: "scoped", value });
  }

  private read(key: string, expectedKind: CachedPosting["kind"]): CachedPosting | undefined {
    if (this.#maxEntries === 0) {
      this.recordMiss(expectedKind);
      return undefined;
    }
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.kind !== expectedKind) {
      this.recordMiss(expectedKind);
      return undefined;
    }
    this.#hits += 1;
    if (expectedKind === "scoped") {
      this.#scopedHits += 1;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  private store(key: string, entry: CachedPosting): void {
    if (this.#maxEntries === 0) {
      return;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#entries.delete(oldest);
    }
  }

  private recordMiss(kind: CachedPosting["kind"]): void {
    this.#misses += 1;
    if (kind === "scoped") {
      this.#scopedMisses += 1;
    }
  }

  /**
   * Returns immutable cache diagnostics.
   *
   * @returns Cache statistics.
   */
  public stats(): PostingCacheStats {
    return {
      maxEntries: this.#maxEntries,
      size: this.#entries.size,
      hits: this.#hits,
      misses: this.#misses,
      scopedSize: [...this.#entries.values()].filter(({ kind }) => kind === "scoped").length,
      scopedHits: this.#scopedHits,
      scopedMisses: this.#scopedMisses
    };
  }
}
