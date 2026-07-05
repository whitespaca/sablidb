/**
 * Computes a deterministic 32-bit FNV-1a hash.
 *
 * @param input - Key to hash.
 * @param seed - Additional seed for double hashing.
 * @returns Unsigned 32-bit hash value.
 */
export function hashString(input: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hash ^= code;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
