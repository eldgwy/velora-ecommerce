"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { mergeGuestHistoryAction } from "@/modules/recently-viewed/presentation/actions/history.actions";
import {
  clearGuestEntries,
  readGuestEntries,
} from "@/modules/recently-viewed/presentation/components/record-view";

/**
 * One-shot guest→account merge after sign-in. Reads validated browser
 * entries, merges server-side (ids re-validated, capped, idempotent), then
 * clears browser storage so a shared device never re-merges into another
 * account. Failures are silent — history stays available next visit.
 */
export function MergeGuestHistory() {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      const entries = readGuestEntries();
      if (entries.length === 0) return;
      const res = await mergeGuestHistoryAction(entries);
      if (res.ok) {
        clearGuestEntries();
        if (res.data && res.data.merged > 0) router.refresh();
      }
    })().catch(() => undefined);
  }, [router]);

  return null;
}
