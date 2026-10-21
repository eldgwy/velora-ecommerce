"use client";

import { useEffect } from "react";

/**
 * Global error boundary — the only boundary rendered when the root layout
 * itself fails, so it must render its own html/body. Style-light by
 * necessity (global CSS is not mounted here). API of this Next version:
 * `{ error, retry }`.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error.digest ?? error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8f7f3",
          fontFamily: "system-ui, sans-serif",
          color: "#1c211f",
          textAlign: "center",
        }}
      >
        <div>
          <p style={{ letterSpacing: "0.3em", fontSize: 12, color: "#365f54", fontWeight: 600 }}>
            VELORA
          </p>
          <h1 style={{ fontSize: 24, margin: "12px 0 8px" }}>The store is briefly unavailable</h1>
          <p style={{ color: "#4a524e", margin: "0 0 20px", fontSize: 14 }}>
            A fatal error interrupted the page. Please try again in a moment.
          </p>
          {error.digest ? (
            <p style={{ color: "#8b938e", fontSize: 12, margin: "0 0 20px" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            style={{
              padding: "10px 24px",
              borderRadius: 999,
              border: "none",
              background: "#365f54",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
