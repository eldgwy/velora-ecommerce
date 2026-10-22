CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_request" integer NOT NULL
);
--> statement-breakpoint
DROP INDEX "addresses_customer_default_idx";--> statement-breakpoint
CREATE INDEX "rate_limit_last_request_idx" ON "rate_limit" USING btree ("last_request");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_customer_id_is_default_unique_idx" ON "addresses" USING btree ("customer_id") WHERE is_default = true;