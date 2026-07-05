/**
 * Base class for all SABLI domain errors.
 */
export class SabliError extends Error {
  /**
   * Creates a SABLI domain error.
   *
   * @param message - English diagnostic message.
   * @param options - Optional error cause.
   */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Error thrown when public input fails runtime validation.
 */
export class SabliValidationError extends SabliError {}

/**
 * Error thrown when a query is semantically invalid.
 */
export class SabliQueryError extends SabliError {}

/**
 * Error thrown when storage operations fail.
 */
export class SabliStorageError extends SabliError {}

/**
 * Error thrown when persisted SABLI metadata or data is malformed.
 */
export class SabliCorruptionError extends SabliError {}
