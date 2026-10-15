import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { questionStatusEnum } from "./enums";
import { user } from "./auth";
import { products } from "./catalog";

/**
 * Product questions & answers (one row per question; the staff answer is
 * embedded because the lifecycle is strictly one-question-one-answer).
 *
 * Lifecycle: PENDING → ANSWERED | REJECTED, plus ANSWERED → REJECTED
 * (withdrawal of visible content). REJECTED rows never display publicly
 * again. Only ANSWERED rows with a recorded answer are public.
 */
export const productQuestions = pgTable(
  "product_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
      }),

    question: text("question").notNull(),

    status: questionStatusEnum("status").notNull().default("PENDING"),

    answer: text("answer"),

    answeredBy: text("answered_by"),

    answeredAt: timestamp("answered_at", {
      mode: "date",
    }),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("product_questions_product_id_idx").on(table.productId),

    index("product_questions_product_status_idx").on(
      table.productId,
      table.status,
    ),

    index("product_questions_user_id_idx").on(table.userId),

    index("product_questions_status_idx").on(table.status),

    index("product_questions_created_at_idx").on(table.createdAt),

    check(
      "product_questions_question_length",
      sql`char_length("question") BETWEEN 3 AND 2000`,
    ),

    check(
      "product_questions_answer_length",
      sql`"answer" IS NULL OR char_length("answer") BETWEEN 1 AND 5000`,
    ),

    // Answers exist only on moderated rows: PENDING rows never carry one,
    // while withdrawn (REJECTED) rows keep theirs for the audit trail —
    // public queries filter by status, never by answer presence alone.
    check(
      "product_questions_answer_requires_moderated",
      sql`"answer" IS NULL OR "status" IN ('ANSWERED', 'REJECTED')`,
    ),
  ],
);

export type ProductQuestionStatus = (typeof questionStatusEnum.enumValues)[number];
