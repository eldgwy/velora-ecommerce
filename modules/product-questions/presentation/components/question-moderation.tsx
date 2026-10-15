"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  answerQuestionAction,
  rejectQuestionAction,
} from "@/modules/product-questions/presentation/actions/question.actions";

/** Inline staff answer editor for one queue row. */
export function AnswerForm({ questionId }: { questionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState("");

  const submit = () => {
    if (answer.trim().length === 0) {
      toast.error("Please write an answer first.");
      return;
    }
    startTransition(async () => {
      const res = await answerQuestionAction({ questionId, answer });
      if (res.ok) {
        toast.success("Answer published.");
        setAnswer("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`answer-${questionId}`}>Staff answer (publishes immediately)</Label>
      <Textarea
        id={`answer-${questionId}`}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        maxLength={5000}
        rows={3}
        placeholder="Write a helpful, factual answer…"
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={submit} className="self-start">
        {pending ? <Spinner className="size-4" /> : null}
        Publish answer
      </Button>
    </div>
  );
}

/** Queue row actions: reject/withdraw with single-flight protection. */
export function QuestionRowActions({
  questionId,
  status,
}: {
  questionId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status !== "PENDING" && status !== "ANSWERED") {
    return <span className="text-xs text-muted-foreground">Terminal ({status}).</span>;
  }

  const reject = () => {
    startTransition(async () => {
      const res = await rejectQuestionAction({ questionId });
      if (res.ok) {
        toast.success("Question rejected.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Button size="sm" variant="destructive" disabled={pending} onClick={reject}>
      {pending ? <Spinner className="size-4" /> : null}
      {status === "ANSWERED" ? "Withdraw" : "Reject"}
    </Button>
  );
}
