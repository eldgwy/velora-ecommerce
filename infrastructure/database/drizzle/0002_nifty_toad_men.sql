ALTER TABLE "coupons" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."coupon_type";--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "type" SET DATA TYPE "public"."coupon_type" USING "type"::"public"."coupon_type";--> statement-breakpoint
ALTER TABLE "order_addresses" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."order_address_type";--> statement-breakpoint
CREATE TYPE "public"."order_address_type" AS ENUM('SHIPPING', 'BILLING');--> statement-breakpoint
ALTER TABLE "order_addresses" ALTER COLUMN "type" SET DATA TYPE "public"."order_address_type" USING "type"::"public"."order_address_type";--> statement-breakpoint
ALTER TABLE "order_status_histories" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "order_status_histories" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."payment_status" USING "status"::"public"."payment_status";--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."promotion_type";--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "type" SET DATA TYPE "public"."promotion_type" USING "type"::"public"."promotion_type";--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" SET DEFAULT 'PENDING'::text;--> statement-breakpoint
DROP TYPE "public"."refund_status";--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."refund_status";--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" SET DATA TYPE "public"."refund_status" USING "status"::"public"."refund_status";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."review_status";--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "status" SET DATA TYPE "public"."review_status" USING "status"::"public"."review_status";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'CUSTOMER' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" "user_status" DEFAULT 'ACTIVE' NOT NULL;