# VELORA — Shopping Cart Lifecycle (FR-06)

## Guest-cart storage strategy

**Server-side guest `cart` rows, opaque-token cookie.** The signed
`velora_guest_cart` cookie carries only an opaque `guestId` (a random UUID)
plus metadata — never prices, quantities, or items. All business data lives
in Postgres, so guest and authenticated carts share one transactional code
path (unique constraints, inventory checks, merge logic).

Trade-offs vs. client-side item storage (considered, rejected):

| Concern | Server-side rows (chosen) | Client-side items |
|---|---|---|
| Trust boundary | Cookie holds an opaque id; every fact re-read from DB | Every item field must be revalidated; payload is attacker-controlled |
| Payload limits | None (rows in DB) | Cookie size caps (~4 KB) force item-count limits |
| Merge | Row move inside one transaction | Re-insert + validate each client item |
| Cost | Guest rows need `CONVERTED` marking on merge; no orphan job needed because rows are created only on first mutation, never on bare reads | Stateless, but larger attack surface |

Reads (`getCartDetail`) never create rows: window-shoppers leave no trace.

## Cookie integrity and security

- Format: `base64url(JSON) . base64url(HMAC-SHA256)` (`modules/cart/domain/guest-cookie.ts`).
- Verified with `timingSafeEqual`; malformed, oversized (>512 B), version-mismatched, or tampered values yield `null` — never throw.
- Attributes: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, 30-day expiry.
- A guest token never authorizes user-cart access: guest rows (`userId IS NULL`)
  and user rows resolve through separate queries; item mutations additionally
  scope by the resolved cart id (BR-008).
- Secret: `GUEST_CART_SECRET` (see `config/env.ts`). Required in production;
  dev/test fall back to a non-secret placeholder. No cookie, session, or
  payment values are ever logged.

## Authenticated-cart ownership

- Owner comes only from the verified Better Auth session (`getCurrentSession`);
  client-supplied user/cart ids are ignored.
- One `ACTIVE` cart per user, enforced by the partial unique index
  `cart_user_active_unique` (and `cart_guest_active_unique` for guests).
  Concurrent initialization races on the insert; the loser re-reads the winner
  (`findOrCreateUserCart` / `findOrCreateGuestCart`).
- Drizzle error wrapping: unique violations are detected through the
  `cause` chain (`isUniqueViolation`), because Drizzle wraps driver errors.

## Guest-to-user merge behavior

Login is client-side (Better Auth `authClient.signIn.email`), so there is no
server login hook. Instead, **opportunistic merge**: every authenticated cart
interaction resolves the verified guest cookie first and merges before acting.
`mergeGuestCartAction` is also available explicitly (post-login landing) and is
safe to call repeatedly.

Procedure per guest item, inside one transaction:

1. Validate against live DB state (existence, variant + product `ACTIVE`).
2. `merged = authQty + guestQty`; cap at `min(available, 99)`.
3. Full fit → move, delete guest row, record `mergedItems`.
4. Overflow → **cap-and-retain**: valid portion moves, remainder stays in the
   guest cart, `adjustedItems` + `itemsRequiringAction` (reason `exceeds_stock`).
5. Inactive/deleted/zero-stock → reported (`unavailableItems` / `invalidVariants`),
   retained in the guest cart — never silently discarded.
6. Guest cart with no rows left → `CONVERTED`; only then is the cookie cleared.
   Leftovers keep the cart `ACTIVE` and the cookie, so retries converge.

Idempotency: moved rows are gone from the guest cart, so retries process only
leftovers. Concurrent merges serialize on the guest cart row (`FOR UPDATE`);
the loser re-reads post-commit state and returns empty success. No inventory
is reserved during merge.

## Conflict handling and quantity limits

- Per-item quantity: integer in `[1, 99]` (`MAX_QUANTITY_PER_ITEM`); zero deletes
  the row (DB `CHECK (quantity >= 1)`).
- Distinct variants per cart: ≤ 50 (`MAX_DISTINCT_ITEMS`).
- Writers of one cart serialize via a cart-items lock; the
  `(cartId, variantId)` unique index is the final backstop with one retry.
- All limits are server-enforced; Zod schemas reject invalid input at the boundary.

## Price snapshot semantics

- `priceAtAddition` = **latest observed authoritative list price** (variant
  `priceOverride`, else product `basePrice`), refreshed on every add/update.
  It is a change-detection aid, not a price guarantee.
- Checkout/validation price (`currentPrice`) is always resolved live.
- The payable amount comes from live catalog + promotion math, never from the
  snapshot or any client total (actions accept no price/total fields; unknown
  fields are stripped by Zod).

## Promotion validation

No promotion service existed, so cart reuses the `promotions` /
`promotion_products` schema directly (no duplicated engine): an active
promotion is `isActive`, started, and unended (`endsAt = NULL` is open-ended);
the best one per product (largest absolute saving) adjusts the unit price
(BR-009 precedence — coupons remain a checkout concern). Validation surfaces
`promotion_expired` when mappings exist but none is currently active.

## Inventory availability checks

Availability reuses `getInventoryByVariant` (`available = quantity −
reservedQuantity`). Adds/updates/merges require `resultingQty ≤ available`,
but **a cart is not a reservation**: stock may change between the check and
the write, and cart writes deliberately do not lock inventory rows (avoids
contention/deadlocks with the order-reservation path). Final order creation
must revalidate and reserve through the atomic `reserveOrderInventory`
lifecycle. This TOCTOU behavior is covered by integration tests.

## Cart validation vs. final checkout

`validateCartForCheckout` is **validation-only**: no order, no payment, no
reservation. It returns per-item status (prices, shortages, inactive items,
expired promotions) plus server-computed `subtotal` / `discountTotal` /
`payableTotal` (pre-shipping/pre-tax; shipping + tax belong to checkout per
BR-002). Prices, promotions, and stock may change after validation.

## Required database migrations

- `0013_cart_guest_and_constraints` — nullable `user_id`, new `guest_id`,
  partial unique `cart_user_active_unique` / `cart_guest_active_unique`,
  `cart_owner_check`, `cart_items_quantity_positive`. Additive only.
- `0014_cart_missing_indexes` — reconciles environments missing the indexes
  declared in migration 0000 (notably `cart_items_cart_variant_unique`).

## Environment variables

- `GUEST_CART_SECRET` (optional in dev/test, **required in production**).
  No other new variables.

## Known limitations and follow-up work

- No rate limiting on cart actions (existing rate-limit infra covers only
  Better Auth endpoints); consider IP/user throttles on mutations.
- Abandoned-cart expiry job does not exist yet (`ABANDONED` status unused).
- Cart lines show the primary product image; option-level display names and
  variant imagery are future work.
- Coupons apply at checkout, not in cart validation (by design, BR-009).
- Integration tests share one database across parallel workers; keep fixture
  cleanup scoped to created rows (see `tests/integration/cart/*`).
