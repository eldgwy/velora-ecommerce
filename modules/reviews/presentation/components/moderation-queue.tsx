"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { moderateReviewAction } from "@/shared/lib/actions/reviews";
import { StarRatingDisplay } from "@/modules/reviews/presentation/components/star-rating";
import { VerifiedBuyerBadge } from "@/modules/reviews/presentation/components/verified-badge";
import type { ModerationQueueItem } from "@/modules/reviews/application/queries/reviews";

/**
 * Moderation queue row actions (T-5.4): pending rows decide approve/reject;
 * moderated rows offer re-moderation (back to pending) and direct flips.
 * The server re-validates every transition, so stale or repeated clicks
 * resolve safely.
 */
/** Moderation targets mirror the action's zod enum (content never edited). */
type ModerationTarget = "pending" | "approved" | "rejected";

export function ModerationActions({ item }: { item: ModerationQueueItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (status: ModerationTarget) => {
    startTransition(async () => {
      const res = await moderateReviewAction({ reviewId: item.id, status });
      if ("error" in res) {
        toast.error(res.error);
      } else {
        toast.success(
          status === "approved"
            ? "Review approved."
            : status === "rejected"
              ? "Review rejected."
              : "Review re-opened for moderation.",
        );
        router.refresh();
      }
    });
  };

  if (item.status !== "pending") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("rejected")}>
          {pending ? <Spinner className="size-4" /> : null}
          Reject
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("approved")}>
          {pending ? <Spinner className="size-4" /> : null}
          Approve
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("pending")}>
          {pending ? <Spinner className="size-4" /> : null}
          Re-moderate
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("approved")}>
        {pending ? <Spinner className="size-4" /> : null}
        Approve
      </Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run("rejected")}>
        {pending ? <Spinner className="size-4" /> : null}
        Reject
      </Button>
    </div>
  );
}

/** Queue row: product, author, rating, text, eligibility, images. */
export function ModerationRow({ item }: { item: ModerationQueueItem }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{item.productName ?? "Removed product"}</span>
        <StarRatingDisplay rating={item.rating} />
        {item.isVerifiedBuyer ? <VerifiedBuyerBadge /> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {item.userName ?? "Unknown customer"} · {item.imageCount} photo{item.imageCount === 1 ? "" : "s"}
        </span>
      </div>
      {item.title ? <p className="text-sm font-medium">{item.title}</p> : null}
      {item.content ? <p className="text-sm text-muted-foreground">{item.content}</p> : null}
      <ModerationActions item={item} />
    </li>
  );
}
