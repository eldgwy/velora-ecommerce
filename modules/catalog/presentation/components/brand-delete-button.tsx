"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { deleteBrand } from "@/shared/lib/actions/brands";

/**
 * Row-level destructive action: confirm-then-delete on the existing brand
 * action. Disabling while pending prevents double submissions.
 */
export function BrandDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={(e) => {
        // The row is inside a link-less cell; prevent accidental form/row nav.
        e.preventDefault();
        const confirmed = window.confirm(
          `Delete brand "${name}"? Products referencing it cannot exist with it removed.`,
        );
        if (!confirmed) return;
        startTransition(async () => {
          const res = await deleteBrand(id);
          if ("error" in res && res.error) {
            toast.error(res.error);
            return;
          }
          toast.success("Brand deleted.");
          router.refresh();
        });
      }}
    >
      Delete
    </Button>
  );
}
