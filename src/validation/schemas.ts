import { t, type Guard } from "typesea";
import type { JsonObject, JsonPrimitive, JsonValue } from "../types/json.js";

/**
 * TypeSea guard for JSON primitive values.
 */
export const JsonPrimitiveGuard: Guard<JsonPrimitive> = t.union(
  t.literal(null),
  t.boolean,
  t.number,
  t.string
);

/**
 * TypeSea guard for recursive JSON values.
 */
export const JsonValueGuard: Guard<JsonValue> = t.lazy((): Guard<JsonValue> =>
  t.union(JsonPrimitiveGuard, t.array(JsonValueGuard), t.record(JsonValueGuard))
);

/**
 * TypeSea guard for SABLI JSON document roots.
 */
export const JsonObjectGuard: Guard<JsonObject> = t.record(JsonValueGuard);

/**
 * TypeSea guard for unknown public query objects before semantic normalization.
 */
export const QueryInputGuard = t.record(t.unknown);

/**
 * TypeSea guard for unknown public options objects before defaults are applied.
 */
export const OptionsInputGuard = t.record(t.unknown).optional();

/**
 * TypeSea guard for unknown persisted metadata objects before semantic checks.
 */
export const ManifestInputGuard = t.record(t.unknown);
