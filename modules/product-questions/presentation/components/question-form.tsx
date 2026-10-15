"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import { submitQuestionAction } from "@/modules/product-questions/presentation/actions/question.actions";

/**
 * Customer question form. Rating-free; one text field with a live count.
 * Double-submits are absorbed server-side (identical text within 10
 * minutes returns the existing row). New questions enter moderation and
 * appear publicly only after a staff answer.
 */
export function QuestionForm({ productId, signedIn }: { productId: string; signedIn: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");

  if (!signedIn) {
    return (
      <p className="text-sm text-muted-foreground">
        Please sign in to ask a question about this product.
      </p>
    );
  }

  const onSubmit = () => {
    if (text.trim().length < 3) {
      toast.error("Please write a question of at least 3 characters.");
      return;
    }
    startTransition(async () => {
      const res = await submitQuestionAction({ productId, question: text });
      if (res.ok) {
        toast.success(
          res.data?.deduplicated
            ? "You already asked this — find it below once answered."
            : "Thanks! Your question is awaiting a staff answer.",
        );
        setText("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <h3 className="text-base font-semibold">Ask a question</h3>
      <div className="flex flex-col gap-1">
        <Label htmlFor="product-question">Your question</Label>
        <Textarea
          id="product-question"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="e.g. Is this machine-washable?"
          aria-describedby="product-question-count"
        />
        <p id="product-question-count" className="text-xs text-muted-foreground">
          {text.trim().length} / 2000 characters
        </p>
      </div>
      <Button size="sm" disabled={pending} onClick={onSubmit} className="self-start">
        {pending ? <Spinner className="size-4" /> : null}
        Submit question
      </Button>
    </div>
  );
}
