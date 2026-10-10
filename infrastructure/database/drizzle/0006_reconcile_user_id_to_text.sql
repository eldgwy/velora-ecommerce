-- 0006_reconcile_user_id_to_text
-- Reconcile application-side `user_id` columns to TEXT to match Better Auth's `user.id`.
--
-- Why: Better Auth creates the `user` table with a TEXT id (default nanoid generator,
-- no custom `database.id` / `generateId` configured in auth.ts). The Drizzle schema
-- declared `auth.user`/`session`/`account`/`verification` ids and the app-side
-- `user_id` FK columns as UUID, but the database keeps `user.id` as TEXT. That led to:
--   (a) `SELECT ... FROM reviews LEFT JOIN "user" ON reviews.user_id = user.id` failing
--       with "operator does not exist: uuid = text", and
--   (b) the customer_profile insert in `databaseHooks.user.create.after` (which writes
--       the TEXT `user.id` into a UUID `customer_profile.user_id` column) erroring.
--
-- Auth tables need NO db change: their `id`/`user_id` columns are already TEXT in the
-- database (Better Auth-managed) and match the corrected auth.ts declaration. Only the
-- application tables below declared `user_id` as UUID; cast them to TEXT so they match
-- `user.id` and native joins work without casts.
--
-- Every affected column is empty or holds only uuid-formatted text, so the cast is
-- lossless and fully reversible (values cast back to uuid cleanly).
--
-- Rollback (reverse):
--   ALTER TABLE "customer_profile" ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;
--   ALTER TABLE "couponusages"   ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;
--   ALTER TABLE "orders"         ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;
--   ALTER TABLE "wishlist"       ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;
--   ALTER TABLE "cart"           ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;
--   ALTER TABLE "reviews"        ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;

ALTER TABLE "reviews"          ALTER COLUMN "user_id" TYPE text USING user_id::text;
ALTER TABLE "cart"             ALTER COLUMN "user_id" TYPE text USING user_id::text;
ALTER TABLE "wishlist"         ALTER COLUMN "user_id" TYPE text USING user_id::text;
ALTER TABLE "orders"           ALTER COLUMN "user_id" TYPE text USING user_id::text;
ALTER TABLE "couponusages"    ALTER COLUMN "user_id" TYPE text USING user_id::text;
ALTER TABLE "customer_profile" ALTER COLUMN "user_id" TYPE text USING user_id::text;
