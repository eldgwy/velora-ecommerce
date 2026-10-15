"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { clearHistoryAction } from "@/modules/recently-viewed/presentation/actions/history.actions";

/** Clear-history button with single-flight protection and feedback. */
export function ClearHistoryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const clear = () => {
    if (pending) return;
    startTransition(async () => {
      const res = await clearHistoryAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Browsing history cleared.");
      router.refresh();
    });
  };

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={clear}>
      {pending ? <Spinner className="size-4" /> : null}
      Clear history
    </Button>
  );
}
