# Inventory model

Authoritative reference for the inventory availability rule, the invariants
enforced by `services/inventory.service.ts`, and the open design decision
around reservation fulfillment.

## Availability invariant

Across the catalog and search surface, stock availability is defined as:

```
available = quantity - reserved_quantity
```

An inventory mutation must **never** make `available` negative. `quantity` is
on-hand stock; `reserved_quantity` is stock already committed to open carts or
pending orders. A unit that is reserved is not independently sellable again
until the reservation is released.

## Per-operation invariants

All mutations run inside a `db.transaction` and acquire a `FOR UPDATE` row lock
on the `inventory` row, so the invariants hold under concurrent writers. Only
the winning transaction commits; the loser re-reads the current state.

| Operation          | Delta sign | Invariants enforced atomically                     | Audit movement |
| ------------------ | ---------- | -------------------------------------------------- | -------------- |
| `adjustStock`      | +/-        | `(quantity + delta) - reserved >= 0`               | caller-chosen type |
| `setStock`         | absolute   | `quantity >= reserved`  (i.e. `available >= 0`)    | `ADJUSTMENT`   |
| `adjustReservation`| +/-        | `reserved + delta >= 0`  and  `reserved + delta <= quantity` | caller-chosen type |

Failure modes raise typed errors consumed by `shared/lib/actions/inventory.ts`:

- `InsufficientStockError` → action returns `{ ok: false, error: "This change would violate stock availability rules." }`
- `InvalidQuantityError` → action returns `{ ok: false, error: "Invalid quantity." }`
- `VariantNotFoundError` / `InventoryNotFoundError` → action returns `{ ok: false, error: "Variant or inventory not found." }`

## Audit trail

Every successful mutation inserts a row into `inventory_movements` with the
signed `quantity` (delta), the `type`, and optional `reason`/`notes`. This is
an append-only ledger; the `inventory` row holds the live balance. `setStock`
records the corrective delta as an `ADJUSTMENT` movement equal to
`target - oldQuantity`.

## Cache invalidation

`adjustInventory` calls `invalidateVariantCache(variantId, productId)` which
revalidates, in order:

1. `variants:product:{productId}`
2. `variant:{variantId}`
3. `product:{productId}`
4. `products:listing`

Review moderation calls `invalidateReviewCache(productId)` which revalidates:

1. `reviews:product:{productId}`
2. `product:{productId}`
3. `products:listing`

Invalidation runs **only** after a successful, committed mutation — failed
operations (validation errors, invariant violations, not-found) do not touch
the cache.

## Concurrency note

The `FOR UPDATE` lock inside each transaction serializes competing mutations of
the same variant. A redundant `adjustReservation` that would violate an
invariant is rejected before the lock is released, so the row always reflects a
valid state.

## Future work: reservation fulfillment

The current data model separates **stock adjustment** from **reservation
adjustment**, and there is no single "fulfill reservation" operation. Fulfilling
an order that decrement both `quantity` (on-hand) and `reserved_quantity`
(commitment) therefore requires two movements:

1. `adjustReservation(variantId, -qty, "RELEASE", ...)` to free the reservation.
2. `adjustStock(variantId, -qty, "SALE", ...)` to decrement on-hand stock.

Recommended future improvement: add a `fulfillReservation(variantId, qty)`
helper that performs both steps inside one transaction and asserts
`available >= qty` up front, so callers cannot partial-apply a fulfillment or
forget to release the reservation. Until then, any checkout path must perform
both steps in a single transaction and handle the `InsufficientStockError`
from either leg transactionally (rollback on either failure).
