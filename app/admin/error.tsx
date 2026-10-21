"use client";

import { useEffect } from "react";

/** Admin segment error boundary (GP-23 / T-3.1). `{ error, retry }` API. */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[admin-error]", error.digest ?? error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-velora-emerald/70">
        VELORA · ADMIN
      </span>
      <h1 className="text-xl font-semibold">The console hit an error</h1>
      <p className="text-sm text-muted-foreground">
        This console page failed to load. Staff data was never affected — retry to continue.
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
