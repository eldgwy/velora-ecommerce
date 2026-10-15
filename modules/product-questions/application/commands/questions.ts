import { and, eq, gte } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import { productQuestions } from "@/infrastructure/database/schema/product-questions";
import {
  assertAnswerText,
  assertQuestionText,
  canTransitionQuestion,
  type QuestionStatus,
} from "@/modules/product-questions/domain/question-rules";
import {
  QuestionNotFoundError,
  QuestionValidationError,
} from "@/modules/product-questions/domain/question-errors";
import { logger } from "@/shared/lib/logging/logger";

/**
 * Double-submit window: an identical question (same author, product, exact
 * text) inside this window returns the existing row instead of inserting.
 * This absorbs double-clicks and retry replays without inventing a
 * uniqueness rule — distinct questions are always allowed.
 */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code === "23505") return true;
      if (typeof record.message === "string" && record.message.includes("duplicate key value")) {
        return true;
      }
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Submit a customer question. Creates a PENDING row — never public, never
 * answered, never attributed to anyone but the session author. An exact
 * recent duplicate returns the existing row (idempotent resubmission).
 */
export async function submitQuestion(input: {
  userId: string;
  productId: string;
  question: string;
}): Promise<{ id: string; deduplicated: boolean }> {
  const text = assertQuestionText(input.question);

  const [product] = await db
    .select({ id: products.id, status: products.status })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) {
    throw new QuestionValidationError("That product could not be found.");
  }
  if (product.status !== "ACTIVE") {
    throw new QuestionValidationError("This product is not accepting questions right now.");
  }

  const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const [recent] = await db
    .select({ id: productQuestions.id })
    .from(productQuestions)
    .where(
      and(
        eq(productQuestions.userId, input.userId),
        eq(productQuestions.productId, input.productId),
        eq(productQuestions.question, text),
        gte(productQuestions.createdAt, windowStart),
      ),
    );
  if (recent) return { id: recent.id, deduplicated: true };

  try {
    const [created] = await db
      .insert(productQuestions)
      .values({
        userId: input.userId,
        productId: input.productId,
        question: text,
        status: "PENDING",
      })
      .returning({ id: productQuestions.id });
    if (!created) throw new Error("Question insert failed");
    return { id: created.id, deduplicated: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new QuestionValidationError("Your question could not be saved. Please try again.");
    }
    throw error;
  }
}

export interface AnswerInput {
  questionId: string;
  answer: string;
  actorId: string;
}

/**
 * Answer a PENDING question (staff only at the action layer). Sets the
 * answer atomically with the PENDING → ANSWERED transition, conditional on
 * the source state so concurrent moderations converge instead of clobbering.
 */
export async function answerQuestion(input: AnswerInput): Promise<{ id: string }> {
  const text = assertAnswerText(input.answer);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: productQuestions.id, status: productQuestions.status })
      .from(productQuestions)
      .where(eq(productQuestions.id, input.questionId))
      .for("update");
    if (!current) throw new QuestionNotFoundError(input.questionId);
    if (!canTransitionQuestion(current.status as QuestionStatus, "ANSWERED")) {
      throw new QuestionValidationError(
        `This question cannot be answered from ${current.status} state.`,
      );
    }
    // No answer edits in this scope: an ANSWERED row keeps its original
    // answer (the matrix-level same-state replay does not apply when new
    // content is supplied — use withdrawal for bad content).
    if (current.status === "ANSWERED") {
      throw new QuestionValidationError("This question has already been answered.");
    }

    const [updated] = await tx
      .update(productQuestions)
      .set({
        answer: text,
        answeredBy: input.actorId,
        answeredAt: new Date(),
        status: "ANSWERED",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productQuestions.id, input.questionId),
          eq(productQuestions.status, "PENDING"),
        ),
      )
      .returning({ id: productQuestions.id, productId: productQuestions.productId });
    if (!updated) {
      throw new QuestionValidationError("This question changed while you were answering it.");
    }

    logger.catalog.questionModerated(
      updated.id,
      updated.productId,
      "PENDING",
      "ANSWERED",
      input.actorId,
    );
    return { id: updated.id };
  });
}

export interface ModerateQuestionInput {
  questionId: string;
  to: Extract<QuestionStatus, "REJECTED">;
  actorId: string;
}

/**
 * Moderate a question: PENDING → REJECTED, or withdraw visible content via
 * ANSWERED → REJECTED. Conditional on the source state; REJECTED rows are
 * terminal and repeated calls replay idempotently.
 */
export async function moderateQuestion(input: ModerateQuestionInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: productQuestions.id,
        productId: productQuestions.productId,
        status: productQuestions.status,
      })
      .from(productQuestions)
      .where(eq(productQuestions.id, input.questionId))
      .for("update");
    if (!current) throw new QuestionNotFoundError(input.questionId);
    if (!canTransitionQuestion(current.status as QuestionStatus, input.to)) {
      throw new QuestionValidationError(
        `This question cannot move from ${current.status} to ${input.to}.`,
      );
    }
    if (current.status === input.to) return { id: current.id };

    const [updated] = await tx
      .update(productQuestions)
      .set({ status: input.to, updatedAt: new Date() })
      .where(
        and(
          eq(productQuestions.id, input.questionId),
          eq(productQuestions.status, current.status),
        ),
      )
      .returning({ id: productQuestions.id });
    if (!updated) {
      throw new QuestionValidationError("This question changed while you were moderating it.");
    }

    logger.catalog.questionModerated(
      updated.id,
      current.productId,
      current.status,
      input.to,
      input.actorId,
    );
    return { id: updated.id };
  });
}
