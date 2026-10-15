"use server";

import { z } from "zod";

import { getCurrentSession, requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  answerQuestion,
  moderateQuestion,
  submitQuestion,
} from "@/modules/product-questions/application/commands/questions";
import {
  getQuestionModerationQueue,
  listCustomerQuestions,
  type ModerationQueue,
} from "@/modules/product-questions/application/queries/questions";
import {
  QuestionNotFoundError,
  QuestionValidationError,
} from "@/modules/product-questions/domain/question-errors";
import { invalidateProductCache } from "@/shared/lib/cache/tags";

const submitQuestionSchema = z.object({
  productId: z.string().uuid("Invalid product."),
  question: z.string().trim().min(1, "Question is required.").max(2000),
});

const answerSchema = z.object({
  questionId: z.string().uuid("Invalid question."),
  answer: z.string().trim().min(1, "Answer is required.").max(5000),
});

function questionFailure(action: string, error: unknown): ActionResult<never> {
  if (error instanceof QuestionNotFoundError || error instanceof QuestionValidationError) {
    return { ok: false, error: error.message };
  }
  logger.error(`Product Q&A action failed: ${action}`, {
    module: "product-questions",
    action,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That action could not be completed." };
}

/**
 * Submit a customer question. Author id comes from the session; the row
 * starts PENDING and is never public until staff answer it.
 */
export async function submitQuestionAction(
  input: unknown,
): Promise<ActionResult<{ id: string; deduplicated: boolean }>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in to ask a question." };
  const parsed = submitQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  }
  try {
    const result = await submitQuestion({
      userId: session.user.id,
      productId: parsed.data.productId,
      question: parsed.data.question,
    });
    return { ok: true, data: result };
  } catch (error) {
    return questionFailure("submitQuestion", error) as ActionResult<{
      id: string;
      deduplicated: boolean;
    }>;
  }
}

/**
 * Answer a PENDING question (staff only). The answer publishes atomically
 * with the transition; public caches refresh only when visibility changes.
 */
export async function answerQuestionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireAdmin();
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid answer." };
  }
  try {
    const result = await answerQuestion({
      questionId: parsed.data.questionId,
      answer: parsed.data.answer,
      actorId: session.user.id,
    });
    const { getQuestionProduct } = await import(
      "@/modules/product-questions/application/queries/questions"
    );
    const productId = await getQuestionProduct(parsed.data.questionId);
    if (productId) await invalidateProductCache(productId);
    return { ok: true, data: result };
  } catch (error) {
    return questionFailure("answerQuestion", error) as ActionResult<{ id: string }>;
  }
}

/**
 * Withdraw visible content (staff only): ANSWERED → REJECTED, or reject a
 * PENDING row. Terminal REJECTED rows replay idempotently.
 */
export async function rejectQuestionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireAdmin();
  const parsed = z.object({ questionId: z.string().uuid("Invalid question.") }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid question." };
  try {
    const result = await moderateQuestion({
      questionId: parsed.data.questionId,
      to: "REJECTED",
      actorId: session.user.id,
    });
    const { getQuestionProduct } = await import(
      "@/modules/product-questions/application/queries/questions"
    );
    const productId = await getQuestionProduct(parsed.data.questionId);
    if (productId) await invalidateProductCache(productId);
    return { ok: true, data: result };
  } catch (error) {
    return questionFailure("rejectQuestion", error) as ActionResult<{ id: string }>;
  }
}

const queueFilterSchema = z.object({
  status: z.enum(["PENDING", "ANSWERED", "REJECTED"]).optional(),
  productId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** Admin moderation queue (ADMIN/STAFF, server-gated). */
export async function getQuestionQueueAction(
  input: unknown,
): Promise<ActionResult<ModerationQueue>> {
  await requireAdmin();
  const parsed = queueFilterSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const queue = await getQuestionModerationQueue(parsed.data);
  return { ok: true, data: queue };
}

/** The customer's own questions (session-scoped, any status). */
export async function getMyQuestionsAction(input: unknown): Promise<
  ActionResult<{
    items: Array<{
      id: string;
      productId: string;
      productName: string | null;
      question: string;
      answer: string | null;
      status: string;
      createdAt: Date;
    }>;
    totalCount: number;
    totalPages: number;
    currentPage: number;
  }>
> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).max(1000).optional(),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid pagination." };
  const result = await listCustomerQuestions(
    session.user.id,
    parsed.data.page,
    parsed.data.pageSize,
  );
  return { ok: true, data: result };
}
