"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  addProductToCollectionAction,
  removeProductFromCollectionAction,
  reorderCollectionProductsAction,
  searchProductsForCollectionAction,
} from "@/modules/collections/presentation/actions/collection-admin.actions";
import type { ProductSearchRow } from "@/modules/collections/application/queries/collections";
import type { CollectionProductRow } from "@/modules/collections/application/queries/collections";

/**
 * Collection product manager: search the catalog, append products (each
 * lands at the end of the order), move rows up/down, and remove mappings.
 * Order persists via one explicit save of the visible sequence — positions
 * stay dense and can never duplicate.
 */
export function CollectionProductManager({
  collectionId,
  mapped,
}: {
  collectionId: string;
  mapped: CollectionProductRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchRow[]>([]);
  const [searched, setSearched] = useState(false);
  // Local order mirrors the server sequence; Save persists it atomically.
  const [order, setOrder] = useState<string[] | null>(null);
  const visible = order ?? mapped.map((m) => m.productId);
  const byId = new Map(mapped.map((m) => [m.productId, m]));
  const dirty = order !== null && order.join() !== mapped.map((m) => m.productId).join();

  const refresh = () => {
    setOrder(null);
    router.refresh();
  };

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        refresh();
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
      const res = await searchProductsForCollectionAction({
        collectionId,
        query: query.trim(),
      });
      if (res.ok && res.data) {
        setResults(res.data);
        setSearched(true);
      } else {
        toast.error(res.ok ? "Search failed." : res.error);
      }
    });
  };

  const move = (productId: string, delta: -1 | 1) => {
    const next = [...visible];
    const index = next.indexOf(productId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index]!, next[target]!] = [next[target]!, next[index]!];
    setOrder(next);
  };

  const saveOrder = () => {
    if (!order) return;
    run("Product order saved.", () =>
      reorderCollectionProductsAction({ collectionId, orderedProductIds: order }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Products in order ({visible.length})</h3>
        {visible.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No products mapped. The collection page stays hidden until it has visible products.
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1">
            {visible.map((pid, index) => (
              <li key={pid} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-xs text-muted-foreground">{index + 1}.</span>
                  {byId.get(pid)?.productName ?? pid}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" disabled={pending || index === 0} onClick={() => move(pid, -1)} aria-label="Move up">
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || index === visible.length - 1}
                    onClick={() => move(pid, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run("Mapping removed.", () =>
                        removeProductFromCollectionAction({ collectionId, productId: pid }),
                      )
                    }
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {dirty ? (
          <Button size="sm" disabled={pending} onClick={saveOrder} className="mt-2">
            {pending ? <Spinner className="size-4" /> : null}
            Save order
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium">Add a product (appends at the end)</p>
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
                        run("Product added.", () =>
                          addProductToCollectionAction({ collectionId, productId: r.id }),
                        )
                      }
                    >
                      Add
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
