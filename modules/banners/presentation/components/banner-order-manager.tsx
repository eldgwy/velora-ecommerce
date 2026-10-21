"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { reorderBannersAction } from "@/modules/banners/presentation/actions/banner-admin.actions";
import type { BannerListItem } from "@/modules/banners/application/queries/banners";

/**
 * Banner display order manager: move rows up/down, then persist the
 * visible sequence atomically. Positions write densely 0..n-1, so order
 * can never duplicate or gap.
 */
export function BannerOrderManager({ banners }: { banners: BannerListItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState<string[] | null>(null);
  const visible = order ?? banners.map((b) => b.id);
  const byId = new Map(banners.map((b) => [b.id, b]));
  const dirty = order !== null && order.join() !== banners.map((b) => b.id).join();

  const move = (id: string, delta: -1 | 1) => {
    const next = [...visible];
    const index = next.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index]!, next[target]!] = [next[target]!, next[index]!];
    setOrder(next);
  };

  const save = () => {
    if (!order) return;
    startTransition(async () => {
      const res = await reorderBannersAction({ orderedIds: order });
      if (res.ok) {
        toast.success("Display order saved.");
        setOrder(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 className="text-base font-semibold">Display order</h2>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">No banners yet.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {visible.map((id, index) => (
            <li key={id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-xs text-muted-foreground">{index + 1}.</span>
                {byId.get(id)?.title ?? id}
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" disabled={pending || index === 0} onClick={() => move(id, -1)} aria-label="Move up">
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || index === visible.length - 1}
                  onClick={() => move(id, 1)}
                  aria-label="Move down"
                >
                  ↓
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {dirty ? (
        <Button size="sm" disabled={pending} onClick={save} className="self-start">
          {pending ? <Spinner className="size-4" /> : null}
          Save order
        </Button>
      ) : null}
    </div>
  );
}
