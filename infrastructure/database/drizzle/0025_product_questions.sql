-- 0025_product_questions
-- Product questions & answers (new domain, no legacy rows):
--
--   product_questions  one row per customer question; the staff answer is
--                      embedded (answer/answered_by/answered_at) because the
--                      lifecycle is strictly one-question-one-answer.
--
-- Lifecycle: PENDING → ANSWERED | REJECTED, plus ANSWERED → REJECTED for
-- withdrawal of visible content. REJECTED rows never display publicly again.
-- Only ANSWERED rows with a recorded answer are public (enforced in
-- queries, mirrored by the answer-consistency CHECK below).
--
-- Multiple questions per customer/product are allowed by design (no
-- uniqueness rule); double-submits are absorbed application-side.
-- Deletion follows product/user retention: product cascade, user set null.
--
-- New table: every constraint validates on creation. No data rewritten.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "product_questions";
--   DROP TYPE IF EXISTS "question_status";

DO $$ BEGIN
  CREATE TYPE "question_status" AS ENUM('PENDING', 'ANSWERED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE set null,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE cascade,
  "question" text NOT NULL,
  "status" "question_status" NOT NULL DEFAULT 'PENDING',
  "answer" text,
  "answered_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "answered_at" timestamp,
  CONSTRAINT "product_questions_question_length"
    CHECK (char_length("question") BETWEEN 3 AND 2000),
  CONSTRAINT "product_questions_answer_length"
    CHECK ("answer" IS NULL OR char_length("answer") BETWEEN 1 AND 5000),
  CONSTRAINT "product_questions_answer_requires_moderated"
    CHECK ("answer" IS NULL OR "status" IN ('ANSWERED', 'REJECTED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_questions_product_id_idx"
  ON "product_questions" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_questions_product_status_idx"
  ON "product_questions" USING btree ("product_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_questions_user_id_idx"
  ON "product_questions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_questions_status_idx"
  ON "product_questions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_questions_created_at_idx"
  ON "product_questions" USING btree ("created_at");
