# VELORA — Complete Next.js Architecture

## 1. Architectural Decision

Velora uses:

> **Modular Monolith + Domain-Oriented Architecture + Next.js App Router**

The architecture follows the SRS stack:

- Next.js 16
- React 19
- PostgreSQL
- Drizzle
- Better Auth
- Stripe
- Cloudinary
- Nodemailer

```text
Browser / Client
      ↓
Next.js App Router
  ├─ Server Components
  ├─ Server Actions
  ├─ Route Handlers
  └─ Middleware
      ↓
Application Layer
  ├─ Use Cases / Commands
  ├─ Authorization
  └─ Validation
      ↓
Domain Layer
  ├─ Orders
  ├─ Inventory
  ├─ Catalog
  ├─ Payments
  ├─ Discounts
  └─ Customers
      ↓
Infrastructure
  ├─ Drizzle
  ├─ PostgreSQL
  ├─ Stripe
  ├─ Cloudinary
  └─ Nodemailer
```

This maps to the SRS tiers:

```text
Presentation
    ↓
Controller / Ingestion
    ↓
Domain Services
    ↓
Data Access
```

**Important:** the project does not use a `src/` folder.

---

# 2. Architectural Principle

Avoid flat feature folders such as:

```text
components/
services/
utils/
hooks/
api/
database/
```

with business logic scattered across them.

Instead:

```text
app/
modules/
infrastructure/
shared/
config/
```

The `modules/` directory is the heart of the application.

---

# 3. Final Project Structure

```text
e-commerce/
│
├── app/
│   ├── (storefront)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── products/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/
│   │   │       └── page.tsx
│   │   ├── categories/
│   │   │   └── [slug]/
│   │   │       └── page.tsx
│   │   ├── collections/
│   │   │   └── [slug]/
│   │   │       └── page.tsx
│   │   ├── search/
│   │   │   └── page.tsx
│   │   ├── cart/
│   │   │   └── page.tsx
│   │   ├── checkout/
│   │   │   └── page.tsx
│   │   └── account/
│   │       ├── page.tsx
│   │       ├── profile/
│   │       ├── addresses/
│   │       ├── orders/
│   │       ├── wishlist/
│   │       └── reviews/
│   │
│   ├── (auth)/
│   │   ├── login/
│   │   ├── register/
│   │   ├── forgot-password/
│   │   └── reset-password/
│   │   └── verify-email/
│   │
│   ├── admin/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── products/
│   │   ├── categories/
│   │   ├── brands/
│   │   ├── inventory/
│   │   ├── orders/
│   │   ├── customers/
│   │   ├── reviews/
│   │   ├── coupons/
│   │   ├── promotions/
│   │   ├── collections/
│   │   ├── banners/
│   │   ├── analytics/
│   │   └── settings/
│   │
│   ├── api/
│   │   ├── auth/
│   │   ├── orders/
│   │   ├── coupons/
│   │   ├── webhooks/
│   │   │   └── stripe/
│   │   │       └── route.ts
│   │   └── ...
│   │
│   ├── layout.tsx
│   ├── not-found.tsx
│   ├── error.tsx
│   └── global-error.tsx
│
├── modules/
│   ├── auth/
│   ├── customer/
│   ├── catalog/
│   ├── inventory/
│   ├── cart/
│   ├── wishlist/
│   ├── checkout/
│   ├── orders/
│   ├── payments/
│   ├── discounts/
│   ├── reviews/
│   ├── marketing/
│   ├── notifications/
│   └── analytics/
│
├── infrastructure/
│   ├── database/
│   │   ├── client.ts
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── transaction.ts
│   ├── auth/
│   │   └── better-auth.ts
│   ├── stripe/
│   │   ├── client.ts
│   │   ├── payments.ts
│   │   ├── refunds.ts
│   │   └── webhook.ts
│   ├── cloudinary/
│   │   ├── client.ts
│   │   ├── upload.ts
│   │   └── delete.ts
│   ├── mail/
│   │   ├── client.ts
│   │   ├── send.ts
│   │   └── templates/
│   └── logging/
│       ├── logger.ts
│       └── correlation.ts
│
├── shared/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   └── feedback/
│   ├── lib/
│   │   ├── utils.ts
│   │   ├── pagination.ts
│   │   ├── money.ts
│   │   ├── dates.ts
│   │   └── errors.ts
│   ├── validation/
│   ├── types/
│   └── constants/
│
├── config/
│   ├── env.ts
│   ├── site.ts
│   ├── routes.ts
│   └── permissions.ts
│
├── drizzle/
│   └── migrations/
│
├── public/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
└── ...
```

---

# 4. Module Architecture

Each module can have its own internal architecture.

Example: `orders`

```text
modules/orders/
│
├── domain/
│   ├── entities/
│   │   └── order.ts
│   ├── value-objects/
│   │   ├── order-number.ts
│   │   └── money.ts
│   ├── rules/
│   │   └── order-status-rules.ts
│   └── errors/
│       └── order-errors.ts
│
├── application/
│   ├── commands/
│   │   ├── create-order.ts
│   │   ├── cancel-order.ts
│   │   ├── transition-order.ts
│   │   └── create-refund.ts
│   ├── queries/
│   │   ├── get-order.ts
│   │   ├── list-orders.ts
│   │   └── get-order-history.ts
│   └── dto/
│       ├── create-order.dto.ts
│       └── order.dto.ts
│
├── infrastructure/
│   ├── order.repository.ts
│   └── order.queries.ts
│
├── presentation/
│   ├── actions/
│   │   ├── create-order.action.ts
│   │   └── cancel-order.action.ts
│   ├── components/
│   │   ├── order-card.tsx
│   │   ├── order-status.tsx
│   │   └── order-timeline.tsx
│   └── schemas/
│       └── order.schema.ts
│
└── index.ts
```

Business logic remains inside its module. Route Handlers and Server Actions remain thin controllers.

---

# 5. Dependency Direction

The primary rule is:

```text
Presentation
      ↓
Application
      ↓
Domain
      ↓
Infrastructure
```

Never:

```text
UI → Drizzle             ❌
UI → PostgreSQL          ❌
Server Action → SQL      ❌
Component → Stripe       ❌
Component → Cloudinary   ❌
```

Example:

```text
Checkout Page
      ↓
createOrderAction()
      ↓
CreateOrderUseCase
      ↓
OrderService
      ↓
InventoryService
      ↓
DiscountService
      ↓
PaymentService
      ↓
Drizzle
```

---

# 6. Domain Boundaries

```text
IDENTITY
Auth / User / RBAC

CUSTOMER
Profile / Addresses

CATALOG
Category / Brand / Product / Variant / Media

INVENTORY
Stock / Reservations / Movements

CART
Guest Cart / User Cart / Merge

CHECKOUT
Validation / Pricing / Shipping / Tax

ORDERS
Order / Items / Addresses / Timeline

PAYMENTS
Stripe / COD / Webhooks / Refunds

DISCOUNTS
Coupons / Promotions

REVIEWS
Reviews / Images / Moderation

MARKETING
Collections / Banners

NOTIFICATIONS
Email / Invoice / Events

ANALYTICS
GMV / AOV / Orders / Sales Velocity
```

---

# 7. Catalog Architecture

```text
Category
   │
   └── Product
         │
         ├── ProductImage
         ├── ProductOption
         │      └── OptionValue
         └── ProductVariant
                 │
                 ├── SKU
                 ├── priceOverride
                 └── Inventory
```

The Variant is the actual sellable SKU:

```text
Product ≠ Sellable Unit

Variant = Sellable Unit
```

---

# 8. Inventory Architecture

Inventory is not simple CRUD.

Any change to:

```text
inventory.quantity
```

must create an inventory movement inside the same transaction.

`InventoryService`:

```text
reserve()
release()
commitSale()
restock()
adjust()
damage()
restockReturn()
```

Inventory model:

```text
              Inventory
                  │
        ┌─────────┴─────────┐
        │                   │
     quantity       reservedQuantity
        │                   │
        └─────────┬─────────┘
                  │
           availableStock
                  │
        quantity - reserved
```

Movement ledger:

```text
Inventory
    │
    └── InventoryMovement[]
          │
          ├── RESTOCK
          ├── RESERVATION
          ├── RELEASE
          ├── SALE
          ├── RETURN
          ├── DAMAGE
          └── ADJUSTMENT
```

---

# 9. Checkout Architecture

Checkout is an orchestration use case, not merely a page.

```text
Checkout
│
├── Cart Integrity
├── Address
├── Shipping
├── Tax
├── Promotions
├── Coupon
├── Pricing
└── Order Preview
```

Calculation:

```text
Cart
 ↓
Promotion
 ↓
Subtotal
 ↓
Coupon
 ↓
Tax
 ↓
Shipping
 ↓
Final Total
```

Money calculations use arbitrary precision as required by the SRS.

---

# 10. Order Architecture

Order is the core commerce transaction.

```text
CreateOrder
│
├── Validate Cart
├── Lock Inventory
├── Validate Stock
├── Reserve Stock
├── Generate Order Number
├── Create Order
├── Freeze Order Items
├── Snapshot Addresses
├── Create Status History
└── Convert Cart
```

Everything runs inside:

```text
db.transaction()
```

Order materialization must be atomic.

---

# 11. Order State Machine

Do not mutate status directly:

```ts
order.status = "DELIVERED";
```

Use:

```ts
OrderService.transitionStatus(...)
```

Allowed transitions:

```text
PENDING
   │
   ├── PROCESSING
   │       │
   │       ├── SHIPPED
   │       │      │
   │       │      └── DELIVERED
   │       │
   │       └── CANCELLED
   │
   └── CANCELLED
```

Invalid transitions throw:

```text
InvalidOrderTransitionError
```

---

# 12. Payment Architecture

Stripe is not part of the Order domain itself.

```text
Order
  │
  ▼
Payment Application
  │
  ├── Stripe Adapter
  │      └── Stripe API
  │
  └── COD Strategy
```

Webhook flow:

```text
Stripe
   │
   ▼
POST /api/webhooks/stripe
   │
   ▼
Verify Signature
   │
   ▼
Find Payment
   │
   ▼
Idempotency Check
   │
   ▼
Transaction
   │
   ├── Payment → COMPLETED
   ├── Order → PROCESSING
   ├── Inventory → SALE
   └── Order History
   │
   ▼
Commit
   │
   ▼
Async Notification
```

---

# 13. Webhook Idempotency

Use:

```text
payments.providerPaymentId
        ↓
UNIQUE
```

Handler:

```text
Webhook
  ↓
signature valid?
  ↓
payment exists?
  ↓
already completed?
  ├── YES → 200
  └── NO
       ↓
   transaction
       ↓
   process once
```

A duplicate webhook must not repeat mutations.

---

# 14. Discounts

Coupon logic does not belong inside `OrderService`.

```text
modules/discounts/

├── domain/
│   ├── coupon.ts
│   ├── promotion.ts
│   └── discount-rules.ts
├── application/
│   ├── validate-coupon.ts
│   ├── apply-coupon.ts
│   └── apply-promotions.ts
└── infrastructure/
    └── discount.repository.ts
```

Precedence:

```text
Product Price
      ↓
Promotion
      ↓
Discounted Unit Price
      ↓
Subtotal
      ↓
Coupon
      ↓
Tax
      ↓
Shipping
      ↓
Total
```

---

# 15. Authentication & Authorization

Better Auth manages:

```text
User
Session
Account
Verification
```

Application-level authorization:

```text
Better Auth
     ↓
Session
     ↓
Authorization Layer
     ↓
Role
```

Roles:

```text
GUEST
CUSTOMER
STAFF
ADMIN
```

Admin flow:

```text
/admin/*
      ↓
middleware
      ↓
session
      ↓
role
      ↓
ADMIN / STAFF
```

Middleware is not the only authorization layer. Server-side authorization checks are also required because a user can invoke a Server Action directly.

---

# 16. Server Actions vs Route Handlers

## Server Actions

For internal application mutations:

```text
addToCart()
updateProfile()
createAddress()
createProduct()
updateOrderStatus()
moderateReview()
```

## Route Handlers

For external HTTP boundaries:

```text
/api/webhooks/stripe
```

and any public API contract that explicitly requires HTTP.

```text
Browser → Server Action
Stripe  → Route Handler
```

---

# 17. RSC Strategy

Default to:

```text
Server Component
```

Example:

```text
ProductPage
   │
   ├── Server
   │     └── getProduct()
   ├── ProductGallery
   ├── ProductInfo
   └── VariantSelector
          │
          └── Client Component
```

Use Client Components only where interaction is needed:

```text
Variant selection
Cart drawer
Quantity controls
Filters
Animations
Stripe Elements
```

---

# 18. State Management

Not everything should use Zustand.

### Server State

PostgreSQL + Server Components.

### URL State

```text
/search?category=shoes&sort=price_asc
```

### Client UI State

Zustand or local state:

```text
cart drawer open
mobile menu
product gallery
filters UI
```

### Checkout State

Prefer server-derived state whenever possible.

Prices, stock, and discounts are authoritative on the server.

---

# 19. Database Architecture

Split Drizzle schemas by domain:

```text
infrastructure/database/schema/

├── auth.ts
├── customers.ts
├── catalog.ts
├── inventory.ts
├── cart.ts
├── wishlist.ts
├── orders.ts
├── payments.ts
├── discounts.ts
├── reviews.ts
├── marketing.ts
└── index.ts
```

Avoid a single 1000-line `schema.ts`.

---

# 20. Database Relationship Map

```text
User
├── CustomerProfile
│    └── Address[]
├── Cart[]
│    └── CartItem[]
│         └── ProductVariant
├── Wishlist
│    └── WishlistItem[]
│         └── Product
├── Order[]
│    ├── OrderItem[]
│    │     └── ProductVariant
│    ├── OrderAddress[]
│    ├── OrderStatusHistory[]
│    └── Payment[]
│          └── Refund[]
├── Review[]
└── CouponUsage[]
```

Then:

```text
Product
├── Category
├── Brand
├── ProductImage[]
├── ProductOption[]
│    └── ProductOptionValue[]
└── ProductVariant[]
     ├── Inventory
     │    └── InventoryMovement[]
     └── VariantOptionValue[]
```

Marketing:

```text
Collection
    ↕
CollectionProduct
    ↕
Product

Promotion
    ↕
PromotionProduct
    ↕
Product
```

---

# 21. Repository Pattern

Use Repository abstractions selectively.

Critical domains:

```text
orders
inventory
payments
```

Use:

```text
Application
   ↓
Repository abstraction
   ↓
Drizzle implementation
```

Read-heavy catalog queries can use:

```text
CatalogQueryService
```

directly over Drizzle infrastructure.

Avoid unnecessary layers such as:

```text
Repository
RepositoryImpl
RepositoryFactory
RepositoryInterface
RepositoryManager
```

for every query.

---

# 22. Transaction Boundary

A core rule:

> Transactions start in the Application Service.

Not in Components and not in small repositories.

Example:

```text
createOrder()
```

owns:

```text
transaction
 ├── lock inventory
 ├── reserve inventory
 ├── create order
 ├── create order items
 ├── snapshot addresses
 ├── create history
 └── convert cart
```

---

# 23. Notifications

Nodemailer is an Infrastructure Adapter.

Avoid:

```text
OrderService → nodemailer.send()
```

Use:

```text
OrderService
    ↓
NotificationService
    ↓
Notification Port
    ↓
SMTP Adapter
```

Structure:

```text
notifications/

├── domain/

├── application/
│   └── send-order-confirmation.ts

└── infrastructure/
    └── smtp-notifier.ts
```

Notifications should be asynchronous and email failure must not break the purchase flow.

---

# 24. Cloudinary

```text
Product Image Upload
       ↓
Catalog Application
       ↓
Media Service
       ↓
Cloudinary Adapter
```

The database stores:

```text
url
publicId
altText
sortOrder
isPrimary
```

not binary image data.

---

# 25. Analytics

Analytics does not belong inside `OrderService`.

```text
modules/analytics/

├── application/
│   ├── get-dashboard-kpis.ts
│   ├── get-sales-velocity.ts
│   └── get-order-metrics.ts
└── infrastructure/
    └── analytics.queries.ts
```

Dashboard metrics:

```text
GMV
Revenue
Orders
AOV
Inventory Alerts
Sales Velocity
```

---

# 26. Security Architecture

Security boundary:

```text
Request
 ↓
Correlation ID
 ↓
Rate Limit
 ↓
Authentication
 ↓
Authorization
 ↓
Validation
 ↓
Application Service
 ↓
Database
```

Use:

```text
Zod
Better Auth
HttpOnly Cookies
TLS
HSTS
Rate Limiting
CSRF considerations
Parameterized Drizzle queries
```

PCI boundary:

```text
Browser
   ↓
Stripe Elements
   ↓
Stripe
```

Never:

```text
Browser
   ↓
Velora Server
   ↓
Card Number ❌
```

---

# 27. Error Architecture

Avoid:

```ts
throw new Error("something went wrong")
```

Use:

```text
AppError
├── ValidationError
├── UnauthorizedError
├── ForbiddenError
├── NotFoundError
├── ConflictError
├── InsufficientStockError
├── InvalidOrderTransitionError
├── CouponInvalidError
├── PaymentError
└── ExternalServiceError
```

Flow:

```text
Domain Error
      ↓
Application boundary
      ↓
HTTP / Server Action result
```

---

# 28. Observability

The SRS requires correlation IDs and structured JSON logging.

```text
Request
 ↓
x-request-id
 ↓
logger.withContext()
 ↓
service
 ↓
database / Stripe / SMTP
```

Example:

```json
{
  "timestamp": "...",
  "level": "info",
  "requestId": "req_123",
  "module": "orders",
  "action": "createOrder",
  "userId": "..."
}
```

---

# 29. Environment Architecture

Validate environment variables at startup.

```text
config/env.ts
```

Variables:

```text
DATABASE_URL

BETTER_AUTH_SECRET
BETTER_AUTH_URL

STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET

SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

Server secrets must never enter the client bundle.

---

# 30. Caching Strategy

## Highly Cacheable

```text
Homepage
Categories
Brands
Collections
Product pages
Public banners
Approved reviews
```

## Dynamic

```text
Cart
Checkout
Account
Orders
Inventory
Admin
Payment status
```

## Never trust cache for

```text
stock
payment
order total
coupon usage
authorization
```

The database is the authority.

---

# 31. Search Architecture

V1 can use:

```text
ILIKE
```

or:

```text
PostgreSQL tsvector
```

Architecture:

```text
CatalogSearchService
        ↓
SearchQuery
        ↓
PostgreSQL
```

Keep an abstraction that can later support:

```text
PostgreSQL Search
       ↓
Meilisearch / Elasticsearch
```

without changing UI/application contracts.

---

# 32. Scheduled / Async Jobs

Do not rely on:

```ts
setTimeout()
```

or process memory.

Use a Job / Worker Boundary:

```text
modules/jobs/

├── release-expired-reservations.ts
├── send-notification-retries.ts
└── process-low-stock-alerts.ts
```

The deployment environment runs these through a cron/job runner.

The web tier remains stateless.

---

# 33. Testing Architecture

```text
tests/
│
├── unit/
│   ├── pricing/
│   ├── discounts/
│   ├── order-state/
│   └── inventory/
│
├── integration/
│   ├── orders/
│   ├── inventory/
│   ├── payments/
│   └── auth/
│
└── e2e/
    ├── auth/
    ├── shopping/
    ├── checkout/
    ├── payments/
    └── admin/
```

Critical scenarios:

```text
Two users buy last item simultaneously
        ↓
Only one reservation succeeds
```

```text
Stripe webhook × 2
        ↓
Inventory committed once
```

```text
Refund > captured amount
        ↓
Rejected
```

```text
Customer A requests Customer B order
        ↓
403
```

---

# 34. Business-Critical Modules

```text
1. Catalog
2. Inventory
3. Cart
4. Orders
5. Payments
```

Dependency flow:

```text
Catalog
   ↓
Inventory
   ↓
Cart
   ↓
Checkout
   ↓
Orders
   ↓
Payments
```

Discounts interact with:

```text
Cart
Checkout
Orders
```

Notifications interact with:

```text
Auth
Orders
Payments
```

---

# 35. Architecture Overview

```text
                              VELORA

                                │

                ┌───────────────┴────────────────┐
                │                                │
           STOREFRONT                         ADMIN
                │                                │
                └───────────────┬────────────────┘
                                │
                         NEXT.JS APP ROUTER
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
          RSC Pages        Server Actions     Route Handlers
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                         AUTHORIZATION
                                │
                           VALIDATION
                                │
                       APPLICATION LAYER
                                │
       ┌────────┬────────┬──────┼──────┬────────┐
       │        │        │      │      │        │
     Auth    Catalog  Cart   Checkout Orders Payments
       │        │        │      │      │        │
       └────────┴────────┴──────┼──────┴────────┘
                                │
                         DOMAIN SERVICES
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
      Inventory             Discounts            Customers
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                │
                       INFRASTRUCTURE
                                │
          ┌──────────┬──────────┼─────────┬──────────┐
          │          │          │         │          │
       Drizzle    BetterAuth  Stripe  Cloudinary  SMTP
          │
      PostgreSQL
```

---

# 36. Avoid Global Service Dump

Do not create:

```text
services/

├── order-service.ts
├── inventory-service.ts
├── payment-service.ts
├── catalog-service.ts
└── ...
```

This creates a Service Dump over time.

Instead:

```text
modules/

├── orders/
│   └── application/
├── inventory/
│   └── application/
└── payments/
    └── application/
```

Each business capability lives inside its domain module.

---

# 37. Dependency Rules

At the project level:

```text
app
 ↓
modules
 ↓
infrastructure
```

Inside each module:

```text
presentation
      ↓
application
      ↓
domain
      ↓
infrastructure
```

The Domain must not know about:

```text
Next.js
React
Drizzle
Stripe
Cloudinary
Nodemailer
```

Correct:

```ts
// domain
export function canTransitionOrder(...) {
  // business rule
}
```

Incorrect:

```ts
// domain
import { db } from "@/infrastructure/database/client"; // ❌
```

---

# 38. Database ≠ Business Logic

Database constraints handle things such as:

```text
quantity >= 0
unique SKU
foreign keys
indexes
```

But:

```text
Can this order transition from PROCESSING → SHIPPED?
```

is a business rule.

Its home is:

```text
modules/orders/domain/
```

not a component.

---

# 39. Architecture Roadmap

## PHASE 0 — Foundation

```text
Next.js
TypeScript strict
Drizzle
PostgreSQL
env
logging
errors
```

## PHASE 1 — Identity

```text
Better Auth
RBAC
Customer profile
```

## PHASE 2 — Catalog

```text
Categories
Brands
Products
Variants
Options
Images
```

## PHASE 3 — Inventory

```text
Stock
Movement ledger
Reservation
Release
```

## PHASE 4 — Storefront

```text
Discovery
Search
Filtering
PDP
```

## PHASE 5 — Cart

```text
Guest cart
User cart
Merge
```

## PHASE 6 — Pricing

```text
Promotions
Coupons
Tax
Shipping
```

## PHASE 7 — Orders

```text
Checkout
Order creation
State machine
History
```

## PHASE 8 — Payments

```text
Stripe
COD
Webhooks
Refunds
```

## PHASE 9 — Customer Experience

```text
Wishlist
Reviews
Account
```

## PHASE 10 — Marketing

```text
Collections
Banners
```

## PHASE 11 — Admin

```text
Operations
Inventory
Orders
Reviews
Analytics
```

## PHASE 12 — Notifications

```text
Email
Invoice
Retry system
```

## PHASE 13 — Hardening

```text
Security
Performance
Observability
Load testing
E2E
```

---

# Final Architecture Decision

The VELORA SRS does not require Microservices.

The chosen architecture is:

> **Next.js Modular Monolith + Domain-Oriented Clean Architecture + PostgreSQL + Drizzle + Better Auth + External Adapters**

Critical business flow:

```text
Catalog
   ↓
Inventory
   ↓
Cart
   ↓
Checkout
   ↓
Order
   ↓
Payment
   ↓
Webhook
   ↓
Inventory Commit
   ↓
Notification
```

## Core Architectural Principles

1. No `src/` folder.
2. `app/` is responsible for Next.js routing and composition.
3. `modules/` owns business capabilities.
4. `infrastructure/` owns external implementations.
5. `shared/` contains only genuinely shared primitives.
6. `config/` owns application configuration.
7. Domain logic must not depend on frameworks or infrastructure.
8. Server Actions and Route Handlers remain thin.
9. Critical multi-entity mutations run inside PostgreSQL transactions.
10. Inventory changes always produce movement records atomically.
11. Payment webhooks are verified and idempotent.
12. Authorization is enforced server-side.
13. Notifications are asynchronous.
14. The web tier remains stateless.
15. The database is the authority for stock, payment state, totals, coupon usage, and authorization-sensitive data.
