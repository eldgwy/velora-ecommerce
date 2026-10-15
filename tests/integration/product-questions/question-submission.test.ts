import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const sessionStore = vi.hoisted(() => ({ userId: null as string | null }));
const requireAdminSpy = vi.hoisted(() => vi.fn(async () => ({ user: { id: "qa-admin", role: "ADMIN" } })));
const updateTagSpy = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: updateTagSpy,
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () =>
    sessionStore.userId ? { user: { id: sessionStore.userId, role: "CUSTOMER" } } : null,
  ),
  requireAdmin: requireAdminSpy,
}));

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
import { submitQuestion } from "@/modules/product-questions/application/commands/questions";
import { submitQuestionAction } from "@/modules/product-questions/presentation/actions/question.actions";
import { QuestionValidationError } from "@/modules/product-questions/domain/question-errors";

const SFX = `pq-${Date.now()}`;
let userA = "";
let userB = "";
let categoryId = "";
let brandId = "";
let productId = "";
let draftProductId = "";

beforeAll(async () => {
  for (const [key, id] of [["a", `pq-u-a-${SFX}`], ["b", `pq-u-b-${SFX}`]] as const) {
    const [u] = await testDb
      .insert(user)
      .values({ id, name: `Asker ${key}`, email: `asker-${key}-${SFX}@ex.com` })
      .returning();
    if (key === "a") userA = u.id;
    else userB = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `pq-cat-${SFX}`, name: "PQ Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `pq-brand-${SFX}`, name: "PQ Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [p1] = await testDb
    .insert(products)
    .values({ name: "PQ Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  const [p2] = await testDb
    .insert(products)
    .values({ name: "PQ Draft", status: "DRAFT", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = p1.id;
  draftProductId = p2.id;
});

afterAll(async () => {
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, productId));
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, draftProductId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(products).where(eq(products.id, draftProductId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userA));
  await testDb.delete(user).where(eq(user.id, userB));
});

beforeEach(async () => {
  await testDb.delete(productQuestions).where(eq(productQuestions.productId, productId));
  sessionStore.userId = null;
  updateTagSpy.mockClear();
});

describe("question submission", () => {
  it("creates PENDING rows attributed to the session author", async () => {
    sessionStore.userId = userA;
    const res = await submitQuestionAction({
      productId,
      question: "Is this machine-washable?",
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error("expected ok");
    expect(res.data.deduplicated).toBe(false);
    const [row] = await testDb.select().from(productQuestions).where(eq(productQuestions.id, res.data.id));
    expect(row!.status).toBe("PENDING");
    expect(row!.userId).toBe(userA);
    expect(row!.answer).toBeNull();
  });

  it("absorbs exact double-submits without a second row", async () => {
    const first = await submitQuestion({ userId: userA, productId, question: "Does it shrink?" });
    expect(first.deduplicated).toBe(false);
    const second = await submitQuestion({ userId: userA, productId, question: "Does it shrink?" });
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
    const rows = await testDb.select().from(productQuestions).where(eq(productQuestions.productId, productId));
    expect(rows).toHaveLength(1);
  });

  it("allows multiple distinct questions per customer and product", async () => {
    await submitQuestion({ userId: userA, productId, question: "First distinct question?" });
    await submitQuestion({ userId: userA, productId, question: "Second distinct question?" });
    const rows = await testDb.select().from(productQuestions).where(eq(productQuestions.productId, productId));
    expect(rows).toHaveLength(2);
  });

  it("validates text, product eligibility, and authorship", async () => {
    await expect(submitQuestion({ userId: userA, productId, question: "  " })).rejects.toBeInstanceOf(
      QuestionValidationError,
    );
    await expect(submitQuestion({ userId: userA, productId, question: "ab" })).rejects.toBeInstanceOf(
      QuestionValidationError,
    );
    await expect(
      submitQuestion({ userId: userA, productId, question: "x".repeat(2001) }),
    ).rejects.toBeInstanceOf(QuestionValidationError);
    await expect(
      submitQuestion({ userId: userA, productId: "00000000-0000-0000-0000-000000000000", question: "Valid question?" }),
    ).rejects.toBeInstanceOf(QuestionValidationError);
    await expect(
      submitQuestion({ userId: userA, productId: draftProductId, question: "Valid question?" }),
    ).rejects.toBeInstanceOf(QuestionValidationError);
  });
});
