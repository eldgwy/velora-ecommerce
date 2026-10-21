import Link from "next/link";

/**
 * Root not-found (GP-23 / T-3.1). Covers both `notFound()` calls and
 * unmatched routes (single root layout — no global-not-found.js needed).
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-velora-emerald/70">
        VELORA
      </span>
      <h1 className="text-2xl font-semibold">This page has slipped away</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page you asked for does not exist, moved, or was never part of the collection.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-velora-emerald px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-velora-emerald-dark"
        >
          Back to the boutique
        </Link>
        <Link
          href="/products"
          className="rounded-full border border-border bg-white px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
        >
          Browse the collection
        </Link>
      </div>
    </div>
  );
}
