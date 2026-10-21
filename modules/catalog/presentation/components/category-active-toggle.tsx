"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { toggleCategoryActive } from "@/shared/lib/actions/catalog";

/**
 * Storefront-visibility toggle for a category; the server action owns the
 * state transition and cache invalidation.
 */
export function CategoryActiveToggle({
  id,
  name,
  isActive,
}: {
  id: string;
  name: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await toggleCategoryActive(id, !isActive);
          if ("error" in res && res.error) {
            toast.error(res.error);
            return;
          }
          toast.success(isActive ? `Hidden "${name}".` : `"${name}" is visible again.`);
          router.refresh();
        });
      }}
    >
      {isActive ? "Hide" : "Show"}
    </Button>
  );
}
