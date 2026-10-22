import Link from "next/link";

import { cn } from "@/shared/lib/utils";

/** Hard ceiling for a manually-entered page number; real clamping happens
 * against `totalPages`, but a stray `?page=99999999999` must never reach
 * the database as an absurd offset. */
const MAX_PAGE_NUMBER = 100_000;

/**
 * Shared admin page-parameter sanitizer: invalid parses to 1; negatives and
 * non-integers decode to 1; absurd values clamp to a bounded ceiling. Pages
 * pass the result straight through — out-of-range pages simply render an
 * empty list plus the real "Page x of y" indicator.
 */
export function parsePageParam(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_PAGE_NUMBER);
}

export type PageItem = number | "start-ellipsis" | "end-ellipsis";

/**
 * Bounded page window: always the first and last page, the active page with
 * both neighbours, and ellipses where gaps form. At most 7 numbers and 2
 * ellipses — a bound that holds equally for 2 pages and 10,000 pages.
 */
export function buildPageItems(currentPage: number, totalPages: number): PageItem[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, currentPage - 1, currentPage, currentPage + 1, totalPages]);
  const visible = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  if (visible.length === 0) return [1];
  const items: PageItem[] = [visible[0] as number];
  for (let i = 1; i < visible.length; i += 1) {
    const prev = visible[i - 1] as number;
    const next = visible[i] as number;
    if (next - prev > 1) {
      items.push(prev === 1 ? "start-ellipsis" : "end-ellipsis");
    }
    items.push(next);
  }
  return items;
}

export interface AdminPaginationProps {
  currentPage: number;
  totalPages: number;
  /** Builds the URL for a page while preserving all existing filter params. */
  buildHref: (page: number) => string;
  /** Unique for the navigation landmark, e.g. "Order pages". */
  ariaLabel: string;
  className?: string;
}

/**
 * Numbered pagination for admin list pages (server-rendered, zero client
 * JS): Previous/Next plus directly selectable page numbers with ellipses on
 * large ranges and a "Page x of y" indicator. The active page is exposed
 * via `aria-current="page"`. Hidden when there is at most one page.
 */
export function AdminPagination({
  currentPage,
  totalPages,
  buildHref,
  ariaLabel,
  className,
}: AdminPaginationProps) {
  const safeCurrent = Math.min(Math.max(1, currentPage), Math.max(1, totalPages));
  if (totalPages <= 1) return null;

  const linkClassName =
    "rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted";

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("flex flex-wrap items-center gap-2 text-sm", className)}
    >
      {safeCurrent > 1 ? (
        <Link href={buildHref(safeCurrent - 1)} rel="prev" className={linkClassName}>
          ← Prev
        </Link>
      ) : (
        <span
          aria-disabled="true"
          aria-hidden="true"
          className="rounded-lg border border-border/50 px-3 py-1.5 text-sm font-medium text-muted-foreground/50"
        >
          ← Prev
        </span>
      )}

      <ul className="flex flex-wrap items-center gap-2">
        {buildPageItems(safeCurrent, totalPages).map((item, index) => {
          if (item === "start-ellipsis" || item === "end-ellipsis") {
            return (
              <li key={`${item}-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
                …
              </li>
            );
          }
          const isActive = item === safeCurrent;
          return (
            <li key={item}>
              {isActive ? (
                <span
                  aria-current="page"
                  aria-label={`Page ${item} of ${totalPages}, current page`}
                  className="rounded-lg border border-velora-emerald bg-velora-emerald px-3 py-1.5 text-sm font-semibold text-white"
                >
                  {item}
                </span>
              ) : (
                <Link
                  href={buildHref(item)}
                  aria-label={`Page ${item} of ${totalPages}`}
                  className={linkClassName}
                >
                  {item}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {safeCurrent < totalPages ? (
        <Link href={buildHref(safeCurrent + 1)} rel="next" className={linkClassName}>
          Next →
        </Link>
      ) : (
        <span
          aria-disabled="true"
          aria-hidden="true"
          className="rounded-lg border border-border/50 px-3 py-1.5 text-sm font-medium text-muted-foreground/50"
        >
          Next →
        </span>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        Page {safeCurrent} of {totalPages}
      </span>
    </nav>
  );
}
