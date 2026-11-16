// Turns driver values into something JSON.stringify can print faithfully.

/** Values JSON cannot hold, converted recursively. */
export function toJsonSafe(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "bigint":
      return value.toString();
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "string":
    case "boolean":
      return value;
    case "object":
      break;
    default:
      return String(value);
  }

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => toJsonSafe(v, seen));
    if (value instanceof Map) {
      return Object.fromEntries([...value].map(([k, v]) => [String(k), toJsonSafe(v, seen)]));
    }
    if (value instanceof Set) return [...value].map((v) => toJsonSafe(v, seen));
    // Decimal-like and other value classes print themselves.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      if (typeof value.toJSON === "function") return toJsonSafe(value.toJSON(), seen);
      if (value.toString !== Object.prototype.toString) return value.toString();
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v, seen)]));
  } finally {
    seen.delete(value);
  }
}

/** The text a `query` returns, cut to `maxRows` when given. */
export function formatRows(rows, maxRows) {
  const total = rows.length;
  const shown = maxRows != null && total > maxRows ? rows.slice(0, maxRows) : rows;
  return {
    text: JSON.stringify(toJsonSafe(shown), null, 2),
    truncated: shown.length < total,
    shown: shown.length,
    total,
  };
}
