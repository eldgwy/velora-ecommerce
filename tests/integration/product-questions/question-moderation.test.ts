import { vi } from "vitest";

const requireAdminSpy = vi.hoisted(() => vi.fn(async () => ({ user: { id: "qa-admin", role: "ADMIN" } })));
const updateTagSpy = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: updateTagSpy,
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({ requireAdmin: requireAdminSpy }));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
} from "../_db";
import { productQuestions } from "@/infrastructure/database/schema/product-questions";
import { user } from "@/infrastructure/database/schema/auth";
import {
  answerQuestion,
  moderateQuestion,
  submitQuestion,
} from "@/modules/product-questions/application/commands/questions";
import {
  answerQuestionAction,
  getQuestionQueueAction,
  rejectQuestionAction,
} from "@/modules/product-questions/presentation/actions/question.actions";
import {
  listCustomerQuestions,
  listPublicQuestions,
} from "@/modules/product-questions/application/queries/questions";
import { QuestionNotFoundError } from "@/modules/product-questions/domain/question-errors";

const SFX = `qm-${Date.now()}`;
let userA = "";
let userB = "";
let categoryId = "";
let brandId = "";
let productId = "";
let product2Id = "";

beforeAll(async () => {
  for (const [key, id] of [["a", `qm-u-a-${SFX}`], ["b", `qm-u-b-${SFX}`]] as const) {
    const [u] = await testDb
      .insert(user)
      .values({ id, name: `Asker ${key}`, email: `qasker-${key}-${SFX}@ex.com` })
      .returning();
    if (key === "a") userA = u.id;
    else userB = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `qm-cat-${SFX}`, name: "QM Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `qm-brand-${SFX}`, name: "QM Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [p1] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "QM Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  const [p2] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "QM Product 2", status: "ACTIVE", basePrice: "30.00", categoryId, brandId })
    .returning();
  productId = p1.id;
  product2Id = p2.id;
});

afterAll(async () => {
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, productId));
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, product2Id));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(products).where(eq(products.id, product2Id));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userA));
  await testDb.delete(user).where(eq(user.id, userB));
});

beforeEach(async () => {
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, productId));
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, product2Id));
  updateTagSpy.mockClear();
  requireAdminSpy.mockResolvedValue({ user: { id: "qa-admin", role: "ADMIN" } });
});

describe("answering and moderation", () => {
  it("answers pending questions and publishes them", async () => {
    const { id } = await submitQuestion({ userId: userA, productId, question: "Is it waterproof?" });
    const res = await answerQuestionAction({ questionId: id, answer: "Yes, fully waterproof." });
    expect(res).toEqual({ ok: true, data: { id } });
    const [row] = await testDb.select().from(productQuestions).where(eq(productQuestions.id, id));
    expect(row!.status).toBe("ANSWERED");
    expect(row!.answer).toBe("Yes, fully waterproof.");
    expect(row!.answeredBy).toBe("qa-admin");
    expect(row!.answeredAt).not.toBeNull();
    expect(updateTagSpy).toHaveBeenCalled();
  });

  it("rejects pending rows and withdraws answered rows", async () => {
    const { id } = await submitQuestion({ userId: userA, productId, question: "Reject me please?" });
    const rejected = await rejectQuestionAction({ questionId: id });
    expect(rejected).toEqual({ ok: true, data: { id } });

    const { id: id2 } = await submitQuestion({ userId: userA, productId, question: "Withdraw me please?" });
    await answerQuestion({ questionId: id2, answer: "Temporary answer.", actorId: "qa-admin" });
    const withdrawn = await rejectQuestionAction({ questionId: id2 });
    expect(withdrawn).toEqual({ ok: true, data: { id: id2 } });
    const [row] = await testDb.select().from(productQuestions).where(eq(productQuestions.id, id2));
    expect(row!.status).toBe("REJECTED");
  });

  it("refuses invalid and stale transitions without corruption", async () => {
    const { id } = await submitQuestion({ userId: userA, productId, question: "Stale test question?" });
    await answerQuestion({ questionId: id, answer: "First answer.", actorId: "qa-admin" });

    // ANSWERED cannot be re-answered; the original answer survives.
    const retry = await answerQuestionAction({ questionId: id, answer: "Second answer." });
    expect(retry.ok).toBe(false);
    const [row] = await testDb.select().from(productQuestions).where(eq(productQuestions.id, id));
    expect(row!.answer).toBe("First answer.");

    // REJECTED is terminal.
    await moderateQuestion({ questionId: id, to: "REJECTED", actorId: "qa-admin" });
    const afterReject = await answerQuestionAction({ questionId: id, answer: "Late answer." });
    expect(afterReject.ok).toBe(false);

    await expect(
      answerQuestion({ questionId: "00000000-0000-0000-0000-000000000000", answer: "x", actorId: "a" }),
    ).rejects.toBeInstanceOf(QuestionNotFoundError);
  });

  it("rejects unauthorized queue access without leaking data", async () => {
    requireAdminSpy.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(answerQuestionAction({ questionId: "00000000-0000-0000-0000-000000000000", answer: "x" })).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(rejectQuestionAction({ questionId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(getQuestionQueueAction({})).rejects.toThrow("FORBIDDEN");
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("lists the queue with product context and pagination", async () => {
    await submitQuestion({ userId: userA, productId, question: "Queue question one?" });
    await submitQuestion({ userId: userB, productId: product2Id, question: "Queue question two?" });
    const res = await getQuestionQueueAction({ status: "PENDING", pageSize: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error("expected ok");
    expect(res.data.totalCount).toBe(2);
    expect(res.data.totalPages).toBe(2);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]!.productName).toBeDefined();
  });
});

describe("public visibility and customer history", () => {
  it("shows answered pairs only, hides the rest", async () => {
    const { id: answered } = await submitQuestion({ userId: userA, productId, question: "Public question?" });
    await answerQuestion({ questionId: answered, answer: "Public answer.", actorId: "qa-admin" });
    await submitQuestion({ userId: userA, productId, question: "Still pending question?" });
    const { id: rejected } = await submitQuestion({ userId: userA, productId, question: "Rejected question?" });
    await moderateQuestion({ questionId: rejected, to: "REJECTED", actorId: "qa-admin" });

    const list = await listPublicQuestions(productId, 1, 10);
    expect(list.totalCount).toBe(1);
    expect(list.items[0]!.question).toBe("Public question?");
    expect(list.items[0]!.answer).toBe("Public answer.");
    // No author data leaks publicly.
    expect(Object.keys(list.items[0]!).sort()).toEqual(
      ["answer", "answeredAt", "createdAt", "id", "question"].sort(),
    );
  });

  it("withdrawn answers disappear from public queries", async () => {
    const { id } = await submitQuestion({ userId: userA, productId, question: "Vanishing question?" });
    await answerQuestion({ questionId: id, answer: "Vanishing answer.", actorId: "qa-admin" });
    expect((await listPublicQuestions(productId, 1, 10)).totalCount).toBe(1);
    await moderateQuestion({ questionId: id, to: "REJECTED", actorId: "qa-admin" });
    expect((await listPublicQuestions(productId, 1, 10)).totalCount).toBe(0);
  });

  it("paginates without duplicates or omissions", async () => {
    for (let i = 0; i < 7; i += 1) {
      const { id } = await submitQuestion({ userId: userA, productId, question: `Paged question ${i}?` });
      await answerQuestion({ questionId: id, answer: `Paged answer ${i}.`, actorId: "qa-admin" });
    }
    const p1 = await listPublicQuestions(productId, 1, 5);
    const p2 = await listPublicQuestions(productId, 2, 5);
    expect(p1.items).toHaveLength(5);
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((r) => r.id)).size).toBe(7);
  });

  it("scopes customer history to the session author", async () => {
    await submitQuestion({ userId: userA, productId, question: "My private question?" });
    await submitQuestion({ userId: userB, productId, question: "Their private question?" });
    const mine = await listCustomerQuestions(userA, 1, 20);
    expect(mine.totalCount).toBe(1);
    expect(mine.items[0]!.question).toBe("My private question?");
    const theirs = await listCustomerQuestions(userB, 1, 20);
    expect(theirs.totalCount).toBe(1);
  });
});
