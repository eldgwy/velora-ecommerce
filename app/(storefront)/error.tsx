"use client";

import { useEffect } from "react";

/**
 * Storefront segment error boundary (GP-23 / T-3.1). A segment error never
 * takes the site down — the shell above this boundary stays interactive.
 * This version's API is `{ error, retry }`.
 */
export default function StorefrontError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[storefront-error]", error.digest ?? error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-velora-emerald/70">
        VELORA
      </span>
      <h1 className="text-xl font-semibold">We could not finish loading this page</h1>
      <p className="text-sm text-muted-foreground">
        The collection page hit an unexpected snag. Trying again often helps.
      </p>
      <button
        type="button"
        onClick={retry}
        className="rounded-full bg-velora-emerald px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-velora-emerald-dark"
      >
        Try again
      </button>
    </div>
  );
}
