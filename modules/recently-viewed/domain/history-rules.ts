/**
 * Browsing-history rules (domain layer — pure, no framework or DB imports).
 *
 * Two persistence strategies, one limit:
 * - Authenticated customers: server rows (`product_view_history`), one per
 *   (customer, product), refreshed in place, pruned to HISTORY_LIMIT.
 * - Guests: bounded browser-local id list (`GUEST_STORAGE_KEY`); product
 *   details always resolve server-side, never from stored metadata.
 */

export const HISTORY_LIMIT = 20;
export const GUEST_STORAGE_KEY = "velora_recently_viewed";

export interface GuestViewEntry {
  id: string;
  at: number;
}

function isUuidLike(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F-]{8,64}$/.test(value)
  );
}

/**
 * Parse untrusted browser storage into valid entries: drops malformed
 * rows, dedupes by id (keeping the newest timestamp), sorts most-recent
 * first, and caps at HISTORY_LIMIT. Never throws.
 */
export function parseGuestHistory(raw: unknown): GuestViewEntry[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, number>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, at } = entry as { id?: unknown; at?: unknown };
    if (!isUuidLike(id)) continue;
    const atMs = typeof at === "number" && Number.isFinite(at) ? at : 0;
    const prev = byId.get(id);
    if (prev === undefined || atMs > prev) byId.set(id, atMs);
  }
  return [...byId.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_LIMIT);
}

/**
 * Prepend a view to parsed entries (refresh recency, bound the list).
 * Pure helper for the client recorder; storage I/O stays in the component.
 */
export function prependGuestView(entries: GuestViewEntry[], id: string, at: number): GuestViewEntry[] {
  if (!isUuidLike(id)) return entries;
  return [{ id, at }, ...entries.filter((e) => e.id !== id)].slice(0, HISTORY_LIMIT);
}
