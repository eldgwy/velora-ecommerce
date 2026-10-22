CREATE TYPE "public"."banner_status" AS ENUM('ACTIVE', 'EXPIRED', 'SCHEDULED', 'DRAFT');--> statement-breakpoint
CREATE TYPE "public"."cart_status" AS ENUM('ACTIVE', 'ABANDONED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('RESTOCK', 'RELEASE', 'RESERVATION', 'DAMAGE', 'ADJUSTMENT', 'RETURN', 'SALE');--> statement-breakpoint
CREATE TYPE "public"."low_stock_alert_status" AS ENUM('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."order_address_type" AS ENUM('SHIPPING', 'BILLING');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('PAID', 'AUTHORIZED', 'PENDING', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REQUIRES_ACTION', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."order_reservation_status" AS ENUM('PENDING', 'RESERVED', 'RELEASED', 'COMMITTED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH_ON_DELIVERY', 'CARD', 'PAYPAL', 'DIGITAL_WALLET', 'GOOGLE_PAY', 'APPLE_PAY');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'AUTHORIZED', 'COMPLETED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVE');--> statement-breakpoint
CREATE TYPE "public"."product_variant_status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVE');--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('PENDING', 'ANSWERED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'STAFF', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'NOTACTIVE');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "cart_recovery_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"stage" integer NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"label" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"address_line3" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"phone" text,
	"birthday" timestamp,
	"preferred_language" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_admin_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_value" text,
	"new_value" text NOT NULL,
	"actor_type" text,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo" text,
	"website" text,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo" text,
	"parent_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"is_active" "product_variant_status" DEFAULT 'ACTIVE' NOT NULL,
	"sku" text,
	"barcode" text,
	"price_override" numeric,
	"weight_grams" integer,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_price_override_positive" CHECK ("product_variant"."price_override" IS NULL OR "product_variant"."price_override" > 0),
	CONSTRAINT "product_variant_weight_non_negative" CHECK ("product_variant"."weight_grams" IS NULL OR "product_variant"."weight_grams" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "product_status" DEFAULT 'ACTIVE' NOT NULL,
	"base_price" numeric NOT NULL,
	"compare_price" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "products_base_price_positive" CHECK ("products"."base_price" > 0),
	CONSTRAINT "products_compare_price_valid" CHECK ("products"."compare_price" IS NULL OR "products"."compare_price" >= "products"."base_price")
);
--> statement-breakpoint
CREATE TABLE "variant_option_value" (
	"variant_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "variant_option_value_variant_id_option_value_id_pk" PRIMARY KEY("variant_id","option_value_id")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer,
	"location" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_quantity_non_negative" CHECK ("quantity" >= 0),
	CONSTRAINT "inventory_reserved_non_negative" CHECK ("reserved_quantity" >= 0),
	CONSTRAINT "inventory_reserved_le_quantity" CHECK ("reserved_quantity" <= "quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"type" "inventory_movement_type" NOT NULL,
	"reason" text,
	"notes" text,
	"actor_type" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "low_stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"available_stock" integer NOT NULL,
	"threshold" integer NOT NULL,
	"status" "low_stock_alert_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"delivered_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "low_stock_alert_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price_at_addition" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_quantity_positive" CHECK ("cart_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"guest_id" text,
	"status" "cart_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cart_owner_check" CHECK ("cart"."user_id" IS NOT NULL OR "cart"."guest_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" "order_address_type" NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"country" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"address_line1" text,
	"address_line2" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" text,
	"variant_name" text,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric,
	"discount_amount" numeric,
	"total_amount" numeric,
	"regular_unit_price" numeric,
	"promotion_name" text,
	"promotion_id" uuid,
	"reservation_status" "order_reservation_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "order_status_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"note" text,
	"previous_status" "order_status",
	"event_type" text,
	"actor_type" text,
	"actor_id" text,
	"correlation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "order_status" NOT NULL,
	"subtotal" numeric NOT NULL,
	"discount_amount" numeric NOT NULL,
	"shipping_amount" numeric NOT NULL,
	"tax_amount" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"currency" text NOT NULL,
	"payment_status" "order_payment_status",
	"idempotency_key" text NOT NULL,
	"checkout_hash" text,
	"checkout_expires_at" timestamp,
	"notes" text,
	"shipping_method" text,
	"tax_jurisdiction" text,
	"tax_rate_bps" integer,
	"taxable_base" numeric,
	"pricing_policy_version" text DEFAULT '1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"amount" numeric,
	"currency" text,
	"status" "payment_status",
	"payment_method" "payment_method",
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider_refund_id" text,
	"amount" numeric,
	"reason" text,
	"status" "refund_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"refund_id" uuid,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "return_cases_status_allowed" CHECK ("status" IN ('OPEN', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"condition" text,
	"restocked_movement_id" uuid,
	"processed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "return_items_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "return_items_status_allowed" CHECK ("status" IN ('PENDING', 'RECEIVED', 'APPROVED', 'REJECTED', 'RESTOCKED', 'CANCELLED')),
	CONSTRAINT "return_items_condition_allowed" CHECK ("condition" IS NULL OR "condition" IN ('RESTOCKABLE', 'DAMAGED')),
	CONSTRAINT "return_items_movement_requires_restocked" CHECK ("restocked_movement_id" IS NULL OR "status" = 'RESTOCKED')
);
--> statement-breakpoint
CREATE TABLE "product_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"product_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" "question_status" DEFAULT 'PENDING' NOT NULL,
	"answer" text,
	"answered_by" text,
	"answered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_questions_question_length" CHECK (char_length("question") BETWEEN 3 AND 2000),
	CONSTRAINT "product_questions_answer_length" CHECK ("answer" IS NULL OR char_length("answer") BETWEEN 1 AND 5000),
	CONSTRAINT "product_questions_answer_requires_moderated" CHECK ("answer" IS NULL OR "status" IN ('ANSWERED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "product_view_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"url" text,
	"public_id" text,
	"sort_order" integer,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"product_id" uuid NOT NULL,
	"rating" integer,
	"title" text,
	"content" text,
	"status" "review_status" DEFAULT 'pending',
	"is_verified_buyer" boolean DEFAULT false NOT NULL,
	"moderated_by" text,
	"moderated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5)),
	CONSTRAINT "reviews_title_length" CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 120),
	CONSTRAINT "reviews_content_length" CHECK ("content" IS NULL OR char_length("content") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "couponusages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid,
	"user_id" text,
	"order_id" uuid,
	"discount_amount" numeric,
	"code" text,
	"type" "coupon_type",
	"value" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "coupon_type" NOT NULL,
	"value" numeric NOT NULL,
	"minimum_order_amount" numeric,
	"maximum_discount_amount" numeric,
	"usage_limit" integer,
	"per_user_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_value_positive" CHECK ("value" > 0),
	CONSTRAINT "coupons_percentage_bounded" CHECK ("type" <> 'PERCENTAGE' OR "value" <= 100),
	CONSTRAINT "coupons_minimum_non_negative" CHECK ("minimum_order_amount" IS NULL OR "minimum_order_amount" >= 0),
	CONSTRAINT "coupons_max_discount_non_negative" CHECK ("maximum_discount_amount" IS NULL OR "maximum_discount_amount" >= 0),
	CONSTRAINT "coupons_window_ordered" CHECK ("starts_at" IS NULL OR "expires_at" IS NULL OR "expires_at" > "starts_at"),
	CONSTRAINT "coupons_usage_limit_non_negative" CHECK ("usage_limit" IS NULL OR "usage_limit" >= 0),
	CONSTRAINT "coupons_per_user_limit_non_negative" CHECK ("per_user_limit" IS NULL OR "per_user_limit" >= 0),
	CONSTRAINT "coupons_usage_count_non_negative" CHECK ("usage_count" >= 0),
	CONSTRAINT "coupons_code_length" CHECK (char_length("code") BETWEEN 3 AND 32)
);
--> statement-breakpoint
CREATE TABLE "promotion_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "promotion_type" NOT NULL,
	"value" numeric NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"image" text NOT NULL,
	"mobile_image" text,
	"link" text,
	"sort_order" integer,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"is_active" "banner_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "banners_title_length" CHECK (char_length("title") BETWEEN 1 AND 120),
	CONSTRAINT "banners_subtitle_length" CHECK ("subtitle" IS NULL OR char_length("subtitle") <= 300),
	CONSTRAINT "banners_sort_order_non_negative" CHECK ("sort_order" IS NULL OR "sort_order" >= 0),
	CONSTRAINT "banners_window_ordered" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "collection_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sort_order" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"sort_order" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collections_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
	CONSTRAINT "collections_slug_format" CHECK (char_length("slug") BETWEEN 3 AND 64 AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "collections_description_length" CHECK ("description" IS NULL OR char_length("description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_emails" ADD CONSTRAINT "auth_emails_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_recovery_emails" ADD CONSTRAINT "cart_recovery_emails_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_recovery_emails" ADD CONSTRAINT "cart_recovery_emails_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customer_profile_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profile" ADD CONSTRAINT "customer_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_option_id_product_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_option_value_id_product_option_value_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_value"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "low_stock_alert_recipients" ADD CONSTRAINT "low_stock_alert_recipients_alert_id_low_stock_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."low_stock_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart" ADD CONSTRAINT "cart_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlist_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_histories" ADD CONSTRAINT "order_status_histories_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_case_id_return_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."return_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_view_history" ADD CONSTRAINT "product_view_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_view_history" ADD CONSTRAINT "product_view_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couponusages" ADD CONSTRAINT "couponusages_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couponusages" ADD CONSTRAINT "couponusages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couponusages" ADD CONSTRAINT "couponusages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_emails_user_idx" ON "auth_emails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_emails_status_idx" ON "auth_emails" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_recovery_emails_cart_stage_unique" ON "cart_recovery_emails" USING btree ("cart_id","stage");--> statement-breakpoint
CREATE INDEX "cart_recovery_emails_user_idx" ON "cart_recovery_emails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cart_recovery_emails_status_idx" ON "cart_recovery_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "addresses_customer_id_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_customer_id_is_default_unique_idx" ON "addresses" USING btree ("customer_id") WHERE is_default = true;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profile_user_id_unique" ON "customer_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customer_profile_phone_idx" ON "customer_profile" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "rate_limit_last_request_idx" ON "rate_limit" USING btree ("last_request");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_unique" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE INDEX "user_admin_events_user_idx" ON "user_admin_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_admin_events_created_idx" ON "user_admin_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_slug_unique" ON "brand" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "brand_name_idx" ON "brand" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "categories_parent_active_idx" ON "categories" USING btree ("parent_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_public_id_unique" ON "product_images" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_url_unique" ON "product_images" USING btree ("url");--> statement-breakpoint
CREATE INDEX "product_images_product_id_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_images_product_sort_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_product_primary_unique" ON "product_images" USING btree ("product_id") WHERE is_primary = true;--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_value_option_value_unique" ON "product_option_value" USING btree ("option_id","value");--> statement-breakpoint
CREATE INDEX "product_option_value_option_id_idx" ON "product_option_value" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_product_name_unique" ON "product_option" USING btree ("product_id","name");--> statement-breakpoint
CREATE INDEX "product_option_product_id_idx" ON "product_option" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variant_product_id_idx" ON "product_variant" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variant_status_idx" ON "product_variant" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "product_variant_product_status_idx" ON "product_variant" USING btree ("product_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_sku_unique" ON "product_variant" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_barcode_unique" ON "product_variant" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_brand_id_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_unique_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "products_category_status_idx" ON "products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "products_brand_status_idx" ON "products" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "variant_option_value_option_value_idx" ON "variant_option_value" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_variant_id_unique" ON "inventory" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "inventory_quantity_idx" ON "inventory" USING btree ("quantity");--> statement-breakpoint
CREATE INDEX "inventory_quantity_threshold_idx" ON "inventory" USING btree ("quantity","low_stock_threshold");--> statement-breakpoint
CREATE INDEX "inventory_movement_inventory_id_idx" ON "inventory_movement" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_inventory_created_idx" ON "inventory_movement" USING btree ("inventory_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movement_type_idx" ON "inventory_movement" USING btree ("type");--> statement-breakpoint
CREATE INDEX "inventory_movement_created_at_idx" ON "inventory_movement" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inventory_movement_actor_id_idx" ON "inventory_movement" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "low_stock_alerts_inventory_id_idx" ON "low_stock_alerts" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "low_stock_alerts_variant_id_idx" ON "low_stock_alerts" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "low_stock_alerts_status_idx" ON "low_stock_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "low_stock_alerts_created_at_idx" ON "low_stock_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "low_stock_alerts_variant_pending_unique" ON "low_stock_alerts" USING btree ("variant_id") WHERE status IN ('PENDING', 'PROCESSING');--> statement-breakpoint
CREATE UNIQUE INDEX "low_stock_alert_recipients_alert_email_unique" ON "low_stock_alert_recipients" USING btree ("alert_id","recipient_email");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_variant_unique" ON "cart_items" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "cart_user_id_idx" ON "cart" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cart_guest_id_idx" ON "cart" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "cart_status_idx" ON "cart" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cart_user_status_idx" ON "cart" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "cart_user_created_idx" ON "cart" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_user_active_unique" ON "cart" USING btree ("user_id") WHERE "cart"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "cart_guest_active_unique" ON "cart" USING btree ("guest_id") WHERE "cart"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_wishlist_product_unique" ON "wishlist_items" USING btree ("wishlist_id","product_id");--> statement-breakpoint
CREATE INDEX "wishlist_items_wishlist_id_idx" ON "wishlist_items" USING btree ("wishlist_id");--> statement-breakpoint
CREATE INDEX "wishlist_items_product_id_idx" ON "wishlist_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_user_id_unique" ON "wishlist" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_addresses_order_type_unique" ON "order_addresses" USING btree ("order_id","type");--> statement-breakpoint
CREATE INDEX "order_addresses_order_id_idx" ON "order_addresses" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_variant_unique" ON "order_items" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_id_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "order_items_reservation_status_idx" ON "order_items" USING btree ("reservation_status");--> statement-breakpoint
CREATE UNIQUE INDEX "order_notifications_order_type_unique" ON "order_notifications" USING btree ("order_id","type");--> statement-breakpoint
CREATE INDEX "order_notifications_order_id_idx" ON "order_notifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_notifications_status_idx" ON "order_notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "order_status_histories" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_created_idx" ON "order_status_histories" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_history_status_idx" ON "order_status_histories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_unique" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_unique" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_idempotency_key_idx" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_id_unique" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_order_status_idx" ON "payments" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_provider_idx" ON "payments" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_id_unique" ON "refunds" USING btree ("provider_refund_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_status_idx" ON "refunds" USING btree ("payment_id","status");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refunds_created_at_idx" ON "refunds" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_id_unique" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_order_id_idx" ON "webhook_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "webhook_events_payment_id_idx" ON "webhook_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_events_provider_idx" ON "webhook_events" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "return_cases_order_id_idx" ON "return_cases" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "return_cases_status_idx" ON "return_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "return_items_case_id_idx" ON "return_items" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "return_items_order_item_id_idx" ON "return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "return_items_status_idx" ON "return_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "return_items_movement_unique" ON "return_items" USING btree ("restocked_movement_id");--> statement-breakpoint
CREATE INDEX "product_questions_product_id_idx" ON "product_questions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_questions_product_status_idx" ON "product_questions" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "product_questions_user_id_idx" ON "product_questions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "product_questions_status_idx" ON "product_questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_questions_created_at_idx" ON "product_questions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_view_history_user_product_unique" ON "product_view_history" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "product_view_history_user_viewed_idx" ON "product_view_history" USING btree ("user_id","viewed_at");--> statement-breakpoint
CREATE INDEX "product_view_history_product_id_idx" ON "product_view_history" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "review_images_review_id_idx" ON "review_images" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_images_review_sort_idx" ON "review_images" USING btree ("review_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_user_product_unique" ON "reviews" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "reviews_product_id_idx" ON "reviews" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reviews_product_status_idx" ON "reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "reviews_user_id_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "couponusages_coupon_order_unique" ON "couponusages" USING btree ("coupon_id","order_id");--> statement-breakpoint
CREATE INDEX "couponusages_coupon_id_idx" ON "couponusages" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "couponusages_user_id_idx" ON "couponusages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "couponusages_order_id_idx" ON "couponusages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "couponusages_coupon_user_idx" ON "couponusages" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_unique" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_is_active_idx" ON "coupons" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "coupons_starts_expires_idx" ON "coupons" USING btree ("starts_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_products_promotion_product_unique" ON "promotion_products" USING btree ("promotion_id","product_id");--> statement-breakpoint
CREATE INDEX "promotion_products_promotion_id_idx" ON "promotion_products" USING btree ("promotion_id");--> statement-breakpoint
CREATE INDEX "promotion_products_product_id_idx" ON "promotion_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "promotions_is_active_idx" ON "promotions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "promotions_starts_ends_idx" ON "promotions" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "promotions_active_starts_idx" ON "promotions" USING btree ("is_active","starts_at");--> statement-breakpoint
CREATE INDEX "banners_status_idx" ON "banners" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "banners_sort_order_idx" ON "banners" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "banners_starts_ends_idx" ON "banners" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "banners_status_sort_idx" ON "banners" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_products_collection_product_unique" ON "collection_products" USING btree ("collection_id","product_id");--> statement-breakpoint
CREATE INDEX "collection_products_collection_id_idx" ON "collection_products" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_products_product_id_idx" ON "collection_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "collection_products_collection_sort_idx" ON "collection_products" USING btree ("collection_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_unique" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collections_is_active_idx" ON "collections" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "collections_sort_order_idx" ON "collections" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "collections_active_sort_idx" ON "collections" USING btree ("is_active","sort_order");