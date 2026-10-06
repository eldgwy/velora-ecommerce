// ============================================
// Date formatting helpers
// ============================================

/**
 * Format a stored `timestamp` (date-only semantics, e.g. `birthday`) as the
 * `YYYY-MM-DD` value an `<input type="date">` expects.
 *
 * Drizzle reads `timestamp` columns back as a `Date` parsed in the server's
 * local timezone (postgres-js parses the bare `YYYY-MM-DD HH:MM:SS` string),
 * so the local calendar components — not `toISOString()` — carry the intended
 * day. Pair with `new Date(\`${value}T00:00:00.000Z\`)` when writing to keep
 * the round-trip stable (see `updateCustomerProfile`).
 */
export function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** Human-readable date, e.g. `2 Oct 2026`. */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";

  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "";

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
