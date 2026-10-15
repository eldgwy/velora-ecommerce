"use client";

import { useEffect, useRef } from "react";

import { recordViewAction } from "@/modules/recently-viewed/presentation/actions/history.actions";
import {
  GUEST_STORAGE_KEY,
  parseGuestHistory,
  prependGuestView,
} from "@/modules/recently-viewed/domain/history-rules";

function readGuestStorage(): unknown {
  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

/**
 * Records the current product view exactly once per mount. Authenticated
 * visitors persist server-side via session identity; guests append to
 * bounded browser-local storage. Failures are swallowed — tracking must
 * never break product rendering. Upsert idempotency makes StrictMode
 * double-mounts harmless.
 */
export function RecordProductView({
  productId,
  signedIn,
}: {
  productId: string;
  signedIn: boolean;
}) {
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    if (signedIn) {
      recordViewAction({ productId }).catch(() => undefined);
    } else {
      try {
        const entries = parseGuestHistory(readGuestStorage());
        const next = prependGuestView(entries, productId, Date.now());
        window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Corrupt or unavailable storage: history simply stays empty.
      }
    }
  }, [productId, signedIn]);

  return null;
}

/** Read validated guest entries (for merge and section rendering). */
export function readGuestEntries(): Array<{ id: string; at: number }> {
  if (typeof window === "undefined") return [];
  try {
    return parseGuestHistory(readGuestStorage());
  } catch {
    return [];
  }
}

/** Drop one guest entry (writes back the bounded list). */
export function removeGuestEntry(productId: string): void {
  try {
    const entries = parseGuestHistory(readGuestStorage()).filter((e) => e.id !== productId);
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage failures.
  }
}

/** Clear guest entries after a successful account merge. */
export function clearGuestEntries(): void {
  try {
    window.localStorage.removeItem(GUEST_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
