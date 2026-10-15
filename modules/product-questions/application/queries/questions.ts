import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import { productQuestions } from "@/infrastructure/database/schema/product-questions";
import { user } from "@/infrastructure/database/schema/auth";

export interface PublicQuestionView {
  id: string;
  question: string;
  answer: string;
  answeredAt: Date | null;
  createdAt: Date;
}

export interface PublicQuestionList {
  items: PublicQuestionView[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Paginated publicly-visible Q&A for a product: ANSWERED rows carrying an
 * answer. PENDING/REJECTED rows and answer-less rows are excluded in the
 * data-access layer — never merely hidden in the UI. No author data leaves
 * with public rows.
 */
export async function listPublicQuestions(
  productId: string,
  page = 1,
  pageSize = 10,
): Promise<PublicQuestionList> {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const where = and(
    eq(productQuestions.productId, productId),
    eq(productQuestions.status, "ANSWERED"),
    isNotNull(productQuestions.answer),
  );

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(productQuestions)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      id: productQuestions.id,
      question: productQuestions.question,
      answer: productQuestions.answer,
      answeredAt: productQuestions.answeredAt,
      createdAt: productQuestions.createdAt,
    })
    .from(productQuestions)
    .where(where)
    .orderBy(desc(productQuestions.createdAt), desc(productQuestions.id))
    .limit(safeSize)
    .offset((safePage - 1) * safeSize);

  return {
    items: rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer ?? "",
      answeredAt: r.answeredAt,
      createdAt: r.createdAt,
    })),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeSize)),
    currentPage: safePage,
  };
}

export interface CustomerQuestionView {
  id: string;
  productId: string;
  productName: string | null;
  question: string;
  answer: string | null;
  status: string;
  createdAt: Date;
}

/**
 * The authenticated customer's own questions across products, any status.
 * Strictly scoped to the session author — cross-customer reads are
 * structurally impossible (no other user id ever enters the predicate).
 */
export async function listCustomerQuestions(
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: CustomerQuestionView[]; totalCount: number; totalPages: number; currentPage: number }> {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const where = eq(productQuestions.userId, userId);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(productQuestions)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      id: productQuestions.id,
      productId: productQuestions.productId,
      productName: products.name,
      question: productQuestions.question,
      answer: productQuestions.answer,
      status: productQuestions.status,
      createdAt: productQuestions.createdAt,
    })
    .from(productQuestions)
    .leftJoin(products, eq(products.id, productQuestions.productId))
    .where(where)
    .orderBy(desc(productQuestions.createdAt), desc(productQuestions.id))
    .limit(safeSize)
    .offset((safePage - 1) * safeSize);

  return {
    items: rows,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeSize)),
    currentPage: safePage,
  };
}

export interface ModerationQueueItem {
  id: string;
  productId: string;
  productName: string | null;
  userName: string | null;
  question: string;
  answer: string | null;
  status: string;
  createdAt: Date;
}

export interface ModerationQueue {
  items: ModerationQueueItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Admin moderation queue (server-gated by the action layer). Names only —
 * no emails or addresses. Defaults to unanswered (PENDING) rows.
 */
export async function getQuestionModerationQueue(opts: {
  status?: "PENDING" | "ANSWERED" | "REJECTED";
  productId?: string;
  page?: number;
  pageSize?: number;
}): Promise<ModerationQueue> {
  const safePage = Math.max(1, opts.page ?? 1);
  const safeSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const conditions = [eq(productQuestions.status, opts.status ?? "PENDING")];
  if (opts.productId) conditions.push(eq(productQuestions.productId, opts.productId));
  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(productQuestions)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      id: productQuestions.id,
      productId: productQuestions.productId,
      productName: products.name,
      userName: user.name,
      question: productQuestions.question,
      answer: productQuestions.answer,
      status: productQuestions.status,
      createdAt: productQuestions.createdAt,
    })
    .from(productQuestions)
    .leftJoin(products, eq(products.id, productQuestions.productId))
    .leftJoin(user, eq(user.id, productQuestions.userId))
    .where(where)
    .orderBy(desc(productQuestions.createdAt), desc(productQuestions.id))
    .limit(safeSize)
    .offset((safePage - 1) * safeSize);

  return {
    items: rows,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeSize)),
    currentPage: safePage,
  };
}

/** Product id for a question (cache invalidation after visibility changes). */
export async function getQuestionProduct(questionId: string): Promise<string | null> {
  const [row] = await db
    .select({ productId: productQuestions.productId })
    .from(productQuestions)
    .where(eq(productQuestions.id, questionId));
  return row?.productId ?? null;
}
