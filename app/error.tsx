"use client";

import { useEffect } from "react";
import { logger } from "@/shared/lib/logging/logger";

/**
 * Root error boundary (GP-23 / T-3.1). API: this Next version passes
 * `{ error, retry }` — `retry()` re-fetches the failed segment. Digest is
 * safe to surface; the underlying error never is.
 */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    logger.error("Unhandled render error", {
      module: "boundary",
      action: "rootError",
      digest: error.digest,
      errorName: error.name,
      errorMessage: error.message.slice(0, 200),
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-velora-emerald/70">
        VELORA
      </span>
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error interrupted this page. Retrying usually resolves a temporary
        fault; your data was never at risk.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground/70">Reference: {error.digest}</p>
      ) : null}
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
