# Scope-Aware Array `elemMatch` Semantics

This document is the internal semantic contract for the SABLI v1.4 scoped-array index.

## Existing unscoped extraction contract

- Object properties are escaped for `\\`, `.`, `[`, `]`, and `$`, then normalized under a canonical `$` root.
- Every traversed array contributes a literal `[]` token to the canonical path. Numeric array indices are deliberately absent from document posting keys.
- A leaf term consists of its normalized path, JSON primitive value, and primitive type (`null`, `boolean`, `number`, or `string`).
- Repeated leaves are emitted by extraction, while document posting sets remove duplicate document identifiers.
- Nested arrays contribute one `[]` token per array level and are flattened for ordinary document-level predicates.
- This behavior remains the compatibility contract for ordinary queries and `contains`.

## Scope model

A document extraction pass assigns a positive numeric local Scope ID to every concrete array element, including objects, arrays, primitives, and `null`. Assignment follows validated JSON traversal order and array order. Scope IDs are unique within one document version; they do not need to survive update or compaction.

Each leaf is projected into every enclosing array-element scope. For example, a leaf at `orders[].lines[].sku` has an inner `orders[].lines[] / sku` scoped entry and an outer `orders[] / lines[].sku` scoped entry. Inner scopes also retain their parent Scope ID during extraction. Empty elements still appear in the scope universe even though they have no leaf postings.

## Public query contract

The canonical form is:

```ts
{
  path: "orders[]",
  elemMatch: {
    and: [
      { path: "id", eq: "A1" },
      { path: "price", gt: 10_000 }
    ]
  }
}
```

The target path is a canonical document path after normalization and must end in `[]`. Child paths are relative to one target array element. `id` becomes `$.id` internally, nested paths such as `shipping.city` become `$.shipping.city`, and the exact child path `$` means the primitive array element itself. Other `$`-prefixed child paths are rejected as ambiguous absolute paths.

The v1.3 placeholder form `{ elemMatch: { path, where } }` remains accepted as compatibility input and is normalized to the canonical form. Nested `elemMatch` and child `not` expressions are rejected in v1.4.

## Truth conditions

For a normalized target array path `A` and child expression `P`, `elemMatch(A, P)` matches document `d` exactly when at least one concrete element scope `s` selected by `A` makes `P` true.

- `and` evaluates every child against the same `s`.
- `or` requires at least one child to be true for `s`.
- A missing target, a non-array value at the target, or an empty target array has no element scope and does not match.
- Primitive and `null` elements can be tested with the `$` child path. Positive object-relative predicates do not match them; `exists: false` and `neq` retain ordinary missing-path semantics.
- Mixed arrays evaluate each primitive or object element independently.
- Nested object paths are resolved from the selected element.
- Relative paths containing `[]` retain ordinary existential leaf semantics inside the selected outer element. A second same-inner-element constraint requires nested `elemMatch`, which v1.4 rejects explicitly.
- Duplicate or multiple matching elements still yield one matching document identifier.

Ordinary Boolean queries remain document-scoped. Consequently, an ordinary AND may continue to combine leaves contributed by different array elements; only `elemMatch` adds common-scope identity.

## Index and verification contract

Scoped postings are sorted unique `(Document ID, Scope ID)` pairs. Scoped AND intersects both identities, scoped OR unions them, and the result is projected to ordinary Document IDs only after scoped evaluation. Scoped Bloom terms are advisory individual-term checks and never prove a conjunction.

Exact raw-document verification repeats target traversal and evaluates the complete child expression against each element independently. It is the semantic source of truth. Segment metadata version 2 requires a valid `scoped-postings.idx`; metadata version 1 is legacy and may conservatively return all visible segment documents as candidates before exact verification. Compaction rebuilds current scoped postings from visible raw documents.
