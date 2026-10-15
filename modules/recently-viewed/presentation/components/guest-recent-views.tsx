"use client";

import { useEffect, useState } from "react";

import { resolveGuestHistoryAction } from "@/modules/recently-viewed/presentation/actions/history.actions";
import type { RecentViewItem } from "@/modules/recently-viewed/application/queries/history";
import { HistoryRowList } from "@/modules/recently-viewed/presentation/components/history-rows";
import { readGuestEntries, removeGuestEntry } from "@/modules/recently-viewed/presentation/components/record-view";

/**
 * Guest history section: resolves browser-local ids to live product cards
 * server-side, excluding the product on display. Malformed storage or a
 * failed resolve renders nothing — never an error state for tracking.
 */
export function GuestRecentViews({ currentProductId }: { currentProductId: string }) {
  const [items, setItems] = useState<RecentViewItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = readGuestEntries()
        .map((e) => e.id)
        .filter((id) => id !== currentProductId)
        .slice(0, 8);
      if (ids.length === 0) {
        if (!cancelled) setItems([]);
        return;
      }
      const res = await resolveGuestHistoryAction(ids);
      if (!cancelled) {
        setItems(res.ok && res.data ? res.data.items : []);
      }
    })().catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [currentProductId]);

  if (!items || items.length === 0) return null;

  const onRemoved = (productId: string) => {
    removeGuestEntry(productId);
    setItems((prev) => (prev ?? []).filter((i) => i.productId !== productId));
  };

  return <HistoryRowList items={items} heading="Recently viewed" onRemoved={onRemoved} />;
}
