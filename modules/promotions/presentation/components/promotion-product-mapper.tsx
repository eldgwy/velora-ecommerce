"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  mapProductAction,
  searchProductsForMappingAction,
  unmapProductAction,
} from "@/modules/promotions/presentation/actions/promotion-admin.actions";
import type { ProductSearchRow } from "@/modules/promotions/application/queries/promotions";
import type { MappedProductRow } from "@/modules/promotions/application/queries/promotions";

/**
 * Product mapping manager: search catalog products, map them onto the
 * promotion, and remove mappings. Mapping changes refresh storefront
 * prices via cache invalidation; order history is never touched.
 */
export function PromotionProductMapper({
  promotionId,
  mapped,
}: {
  promotionId: string;
  mapped: MappedProductRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchRow[]>([]);
  const [searched, setSearched] = useState(false);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        router.refresh();
      } else {
        toast.error(res.error ?? "That action could not be completed.");
      }
    });
  };

  const search = () => {
    if (query.trim().length < 2) {
      toast.error("Type at least 2 characters to search.");
      return;
    }
    startTransition(async () => {
      const res = await searchProductsForMappingAction({ promotionId, query: query.trim() });
      if (res.ok && res.data) {
        setResults(res.data);
        setSearched(true);
      } else {
        toast.error(res.ok ? "Search failed." : res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Mapped products ({mapped.length})</h3>
        {mapped.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No products mapped. The promotion applies to nothing until mapped.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {mapped.map((m) => (
              <li key={m.productId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{m.productName}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run("Mapping removed.", () =>
                      unmapProductAction({ promotionId, productId: m.productId }),
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium">Map a product</p>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            placeholder="Search by product name…"
            aria-label="Search products by name"
          />
          <Button size="sm" variant="outline" disabled={pending} onClick={search}>
            {pending ? <Spinner className="size-4" /> : null}
            Search
          </Button>
        </div>
        {searched ? (
          results.length === 0 ? (
            <p className="text-xs text-muted-foreground">No products found.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {r.name} · ${r.basePrice}
                  </span>
                  {r.mapped ? (
                    <span className="text-muted-foreground">Mapped</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run("Product mapped.", () =>
                          mapProductAction({ promotionId, productId: r.id }),
                        )
                      }
                    >
                      Map
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
