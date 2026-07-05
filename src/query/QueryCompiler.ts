import { parseQuery } from "../validation/queries.js";
import type { Query } from "./ast.js";

/**
 * Validates and compiles public query input into SABLI's normalized query form.
 *
 * @param input - Unknown query input.
 * @returns Normalized query.
 */
export function compileQuery(input: unknown): Query {
  return parseQuery(input);
}
