import type { QueryExpression, QueryPredicate } from "./ast.js";

/**
 * A simple executable query plan for the first in-memory engine.
 */
export interface QueryPlan {
  /** Query expression after validation and normalization. */
  readonly expression: QueryExpression;
  /** Indexable predicates discovered in the expression. */
  readonly predicates: readonly QueryPredicate[];
}

function collectPredicates(expression: QueryExpression, out: QueryPredicate[]): void {
  if ("and" in expression) {
    for (const child of expression.and) {
      collectPredicates(child, out);
    }
    return;
  }
  if ("or" in expression || "not" in expression || "elemMatch" in expression) {
    return;
  }
  out.push(expression);
}

/**
 * Builds a basic query plan from a normalized query expression.
 *
 * @param expression - The normalized query expression.
 * @returns A simple plan with indexable predicates separated from the expression.
 */
export function planQuery(expression: QueryExpression): QueryPlan {
  const predicates: QueryPredicate[] = [];
  collectPredicates(expression, predicates);
  return { expression, predicates };
}
