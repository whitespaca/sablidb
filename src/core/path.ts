import { SabliQueryError } from "../errors/index.js";

/**
 * A token in a parsed SABLI JSON path.
 */
export type PathToken =
  | { readonly kind: "root" }
  | { readonly kind: "property"; readonly key: string }
  | { readonly kind: "array" };

function isSpecialPathChar(value: string): boolean {
  return value === "." || value === "[" || value === "]" || value === "\\" || value === "$";
}

function escapePathKey(key: string): string {
  let output = "";
  for (const char of key) {
    output += isSpecialPathChar(char) ? `\\${char}` : char;
  }
  return output;
}

/**
 * Parses a user-provided JSON path into path tokens.
 *
 * @param input - The path string supplied by the caller.
 * @returns The parsed path token sequence.
 * @throws {SabliQueryError} If the path syntax is invalid.
 */
export function parseJsonPath(input: string): PathToken[] {
  if (input.trim().length === 0) {
    throw new SabliQueryError("Invalid path: expected a non-empty string.");
  }

  const source = input.startsWith("$") ? input : `$.${input}`;
  const tokens: PathToken[] = [{ kind: "root" }];
  let index = source.startsWith("$.") ? 2 : 1;
  let current = "";
  let escaping = false;

  if (source !== "$" && !source.startsWith("$.") && !source.startsWith("$[")) {
    throw new SabliQueryError("Invalid path: expected '$', '$.', or '$[]' prefix.");
  }

  const pushProperty = (): void => {
    if (current.length === 0) {
      throw new SabliQueryError("Invalid path: empty property tokens are not allowed.");
    }
    tokens.push({ kind: "property", key: current });
    current = "";
  };

  while (index < source.length) {
    const char = source[index];
    if (char === undefined) {
      break;
    }
    if (escaping) {
      current += char;
      escaping = false;
      index += 1;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      index += 1;
      continue;
    }
    if (char === ".") {
      pushProperty();
      index += 1;
      continue;
    }
    if (char === "[") {
      if (source[index + 1] !== "]") {
        throw new SabliQueryError("Invalid path: only normalized array token [] is supported.");
      }
      if (current.length > 0) {
        pushProperty();
      }
      tokens.push({ kind: "array" });
      index += 2;
      if (source[index] === ".") {
        index += 1;
      }
      continue;
    }
    if (char === "]") {
      throw new SabliQueryError("Invalid path: unmatched closing bracket.");
    }
    current += char;
    index += 1;
  }

  if (escaping) {
    throw new SabliQueryError("Invalid path: dangling escape character.");
  }
  if (current.length > 0) {
    pushProperty();
  }
  if (tokens.length === 1) {
    throw new SabliQueryError("Invalid path: expected at least one property or array token.");
  }
  return tokens;
}

/**
 * Formats parsed path tokens into SABLI canonical path syntax.
 *
 * @param tokens - Path tokens to format.
 * @returns The canonical path string.
 * @throws {SabliQueryError} If the token sequence is invalid.
 */
export function formatJsonPath(tokens: readonly PathToken[]): string {
  if (tokens.length === 0 || tokens[0]?.kind !== "root") {
    throw new SabliQueryError("Invalid path tokens: expected a root token.");
  }
  let output = "$";
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind === "property") {
      output += `${output.endsWith("[]") || output === "$" ? "." : "."}${escapePathKey(token.key)}`;
    } else if (token?.kind === "array") {
      output += "[]";
    } else {
      throw new SabliQueryError("Invalid path tokens: unknown token kind.");
    }
  }
  return output;
}

/**
 * Normalizes a user-provided JSON path into SABLI canonical syntax.
 *
 * @param input - The path supplied by the caller.
 * @returns The canonical path string.
 * @throws {SabliQueryError} If the path cannot be parsed.
 */
export function normalizeJsonPath(input: string): string {
  return formatJsonPath(parseJsonPath(input));
}
