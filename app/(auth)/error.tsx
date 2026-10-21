"use client";

import { useEffect } from "react";

/** (auth) segment error boundary (GP-23 / T-3.1). `{ error, retry }` API. */
export default function AuthError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[auth-error]", error.digest ?? error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold">Sign-in could not be loaded</h1>
      <p className="text-sm text-muted-foreground">
        Something interrupted the account screen. You can retry right here.
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
