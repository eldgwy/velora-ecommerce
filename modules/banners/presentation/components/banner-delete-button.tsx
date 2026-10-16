"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { deleteBannerAction } from "@/modules/banners/presentation/actions/banner-admin.actions";

/** Delete with explicit two-step confirmation (nothing references banners). */
export function BannerDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Delete…
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Delete “{title}” permanently? This cannot be undone.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await deleteBannerAction(id);
              if (res.ok) {
                toast.success("Banner deleted.");
                router.push("/admin/banners");
                router.refresh();
              } else {
                toast.error(res.error);
              }
            })
          }
        >
          {pending ? <Spinner className="size-4" /> : null}
          Confirm delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}
