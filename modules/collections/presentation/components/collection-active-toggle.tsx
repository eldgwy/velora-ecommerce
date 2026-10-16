"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { setCollectionActiveAction } from "@/modules/collections/presentation/actions/collection-admin.actions";

/**
 * Publish/unpublish toggle with explicit confirmation for unpublishing.
 * Unpublishing removes the collection from public queries immediately.
 */
export function CollectionActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const flip = (next: boolean) => {
    startTransition(async () => {
      const res = await setCollectionActiveAction({ id, isActive: next });
      if (res.ok) {
        toast.success(next ? "Collection published." : "Collection unpublished.");
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  if (!isActive) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => flip(true)}>
        {pending ? <Spinner className="size-4" /> : null}
        Publish
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Unpublish…
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Unpublishing hides this collection from the storefront at once.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => flip(false)}>
          {pending ? <Spinner className="size-4" /> : null}
          Confirm unpublish
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}
