import { relations } from "drizzle-orm";
import { user, session, account } from "./auth";
import { customerProfiles, addresses } from "./customers";
import {
  categories,
  brands,
  products,
  productImages,
  productVariants,
  productOptions,
  productOptionValues,
  variantOptionValues,
} from "./catalog";
import { inventory, inventoryMovements } from "./inventory";
import { carts, cartItems } from "./cart";
import {
  orders,
  orderItems,
  orderAddresses,
  orderStatusHistories,
  payments,
  refunds,
} from "./orders";
import { returnCases, returnItems } from "./returns";
import { reviews, reviewImages } from "./reviews";
import {
  coupons,
  couponUsages,
  promotions,
  promotionProducts,
} from "./discounts";
import { collections, collectionProducts } from "./marketing";
import { wishlists, wishlistItems } from "./wishlist";

// =============================
// AUTH
// =============================

// One-to-Many: User -> (Sessions, Accounts, Carts, Wishlist, Orders, Reviews, CouponUsages)
// One-to-One: User -> CustomerProfile
export const usersRelations = relations(user, ({ one, many }) => ({
    sessions: many(session),
    accounts: many(account),

    customerProfile: one(customerProfiles),

    carts: many(carts),

    wishlist: one(wishlists),

    orders: many(orders),

    reviews: many(reviews),

    couponUsages: many(couponUsages),
  }),
);

// One-to-One: Session -> User
export const sessionsRelations = relations(session, ({ one }) => ({
    user: one(user, {
      fields: [session.userId],
      references: [user.id],
    }),
  }),
);

// One-to-One: Account -> User
export const accountsRelations = relations(account, ({ one }) => ({
    user: one(user, {
      fields: [account.userId],
      references: [user.id],
    }),
  }),
);

// =============================
// CUSTOMERS
// =============================

// One-to-One: CustomerProfile -> User
// One-to-Many: CustomerProfile -> Addresses
export const customerProfilesRelations = relations(customerProfiles, ({ one, many }) => ({
    user: one(user, {
      fields: [customerProfiles.userId],
      references: [user.id],
    }),

    addresses: many(addresses),
  }),
);

// One-to-One: Address -> CustomerProfile
export const addressesRelations = relations(addresses, ({ one }) => ({
    customer: one(customerProfiles, {
      fields: [addresses.customerId],
      references: [customerProfiles.id],
    }),
  }),
);

// =============================
// CATALOG
// =============================

// One-to-Many: Category -> (Categories, Products)
export const categoriesRelations = relations(categories, ({ one, many }) => ({
    parent: one(categories, {
      fields: [categories.parentId],
      references: [categories.id],
      relationName: "categoryHierarchy",
    }),

    children: many(categories, {
      relationName: "categoryHierarchy",
    }),

    products: many(products),
  }),
);

// One-to-Many: Brand -> Products
export const brandsRelations = relations(brands, ({ many }) => ({
    products: many(products),
  }),
);

// One-to-One: Product -> (Category, Brand)
// One-to-Many: Product -> (Images, Variants, Options, WishlistItems, Reviews, Promotions, Collections)
export const productsRelations = relations(products, ({ one, many }) => ({
    category: one(categories, {
      fields: [products.categoryId],
      references: [categories.id],
    }),

    brand: one(brands, {
      fields: [products.brandId],
      references: [brands.id],
    }),

    images: many(productImages),

    variants: many(productVariants),

    options: many(productOptions),

    wishlistItems: many(wishlistItems),

    reviews: many(reviews),

    promotions: many(promotionProducts),

    collections: many(collectionProducts),
  }),
);

export const productImagesRelations = relations(
  productImages,
  ({ one }) => ({
    product: one(products, {
      fields: [productImages.productId],
      references: [products.id],
    }),
  }),
);

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),

    inventory: one(inventory),

    cartItems: many(cartItems),

    orderItems: many(orderItems),

    optionValues: many(variantOptionValues),
  }),
);

export const productOptionsRelations = relations(
  productOptions,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productOptions.productId],
      references: [products.id],
    }),

    values: many(productOptionValues),
  }),
);

export const productOptionValuesRelations =
  relations(
    productOptionValues,
    ({ one, many }) => ({
      option: one(productOptions, {
        fields: [productOptionValues.optionId],
        references: [productOptions.id],
      }),

      variants: many(variantOptionValues),
    }),
  );

export const variantOptionValuesRelations =
  relations(
    variantOptionValues,
    ({ one }) => ({
      variant: one(productVariants, {
        fields: [variantOptionValues.variantId],
        references: [productVariants.id],
      }),

      optionValue: one(productOptionValues, {
        fields: [
          variantOptionValues.optionValueId,
        ],
        references: [productOptionValues.id],
      }),
    }),
  );

/* ============================================================
   INVENTORY
============================================================ */

export const inventoryRelations = relations(
  inventory,
  ({ one, many }) => ({
    variant: one(productVariants, {
      fields: [inventory.variantId],
      references: [productVariants.id],
    }),

    movements: many(inventoryMovements),
  }),
);

export const inventoryMovementsRelations =
  relations(
    inventoryMovements,
    ({ one }) => ({
      inventory: one(inventory, {
        fields: [inventoryMovements.inventoryId],
        references: [inventory.id],
      }),
    }),
  );

/* ============================================================
   CART
============================================================ */

export const cartsRelations = relations(
  carts,
  ({ one, many }) => ({
    user: one(user, {
      fields: [carts.userId],
      references: [user.id],
    }),

    items: many(cartItems),
  }),
);

export const cartItemsRelations = relations(
  cartItems,
  ({ one }) => ({
    cart: one(carts, {
      fields: [cartItems.cartId],
      references: [carts.id],
    }),

    variant: one(productVariants, {
      fields: [cartItems.variantId],
      references: [productVariants.id],
    }),
  }),
);

/* ============================================================
   WISHLIST
============================================================ */

export const wishlistsRelations = relations(
  wishlists,
  ({ one, many }) => ({
    user: one(user, {
      fields: [wishlists.userId],
      references: [user.id],
    }),

    items: many(wishlistItems),
  }),
);

export const wishlistItemsRelations = relations(
  wishlistItems,
  ({ one }) => ({
    wishlist: one(wishlists, {
      fields: [wishlistItems.wishlistId],
      references: [wishlists.id],
    }),

    product: one(products, {
      fields: [wishlistItems.productId],
      references: [products.id],
    }),
  }),
);

/* ============================================================
   ORDERS
============================================================ */

export const ordersRelations = relations(
  orders,
  ({ one, many }) => ({
    user: one(user, {
      fields: [orders.userId],
      references: [user.id],
    }),

    items: many(orderItems),

    addresses: many(orderAddresses),

    statusHistory: many(orderStatusHistories),

    payments: many(payments),

    couponUsages: many(couponUsages),

    returnCases: many(returnCases),
  }),
);

export const orderItemsRelations = relations(
  orderItems,
  ({ one }) => ({
    order: one(orders, {
      fields: [orderItems.orderId],
      references: [orders.id],
    }),

    variant: one(productVariants, {
      fields: [orderItems.variantId],
      references: [productVariants.id],
    }),
  }),
);

export const orderAddressesRelations =
  relations(
    orderAddresses,
    ({ one }) => ({
      order: one(orders, {
        fields: [orderAddresses.orderId],
        references: [orders.id],
      }),
    }),
  );

export const orderStatusHistoriesRelations =
  relations(
    orderStatusHistories,
    ({ one }) => ({
      order: one(orders, {
        fields: [orderStatusHistories.orderId],
        references: [orders.id],
      }),
    }),
  );

export const paymentsRelations = relations(
  payments,
  ({ one, many }) => ({
    order: one(orders, {
      fields: [payments.orderId],
      references: [orders.id],
    }),

    refunds: many(refunds),
  }),
);

export const refundsRelations = relations(
  refunds,
  ({ one }) => ({
    payment: one(payments, {
      fields: [refunds.paymentId],
      references: [payments.id],
    }),
  }),
);

/* ============================================================
   REVIEWS
============================================================ */

export const reviewsRelations = relations(
  reviews,
  ({ one, many }) => ({
    user: one(user, {
      fields: [reviews.userId],
      references: [user.id],
    }),

    product: one(products, {
      fields: [reviews.productId],
      references: [products.id],
    }),

    images: many(reviewImages),
  }),
);

export const reviewImagesRelations = relations(
  reviewImages,
  ({ one }) => ({
    review: one(reviews, {
      fields: [reviewImages.reviewId],
      references: [reviews.id],
    }),
  }),
);

/* ============================================================
   DISCOUNTS
============================================================ */

export const couponsRelations = relations(
  coupons,
  ({ many }) => ({
    usages: many(couponUsages),
  }),
);

export const couponUsagesRelations = relations(
  couponUsages,
  ({ one }) => ({
    coupon: one(coupons, {
      fields: [couponUsages.couponId],
      references: [coupons.id],
    }),

    user: one(user, {
      fields: [couponUsages.userId],
      references: [user.id],
    }),

    order: one(orders, {
      fields: [couponUsages.orderId],
      references: [orders.id],
    }),
  }),
);

export const promotionsRelations = relations(
  promotions,
  ({ many }) => ({
    products: many(promotionProducts),
  }),
);

export const promotionProductsRelations =
  relations(
    promotionProducts,
    ({ one }) => ({
      promotion: one(promotions, {
        fields: [promotionProducts.promotionId],
        references: [promotions.id],
      }),

      product: one(products, {
        fields: [promotionProducts.productId],
        references: [products.id],
      }),
    }),
  );

/* ============================================================
   MARKETING
============================================================ */

export const collectionsRelations = relations(
  collections,
  ({ many }) => ({
    products: many(collectionProducts),
  }),
);

export const collectionProductsRelations =
  relations(
    collectionProducts,
    ({ one }) => ({
      collection: one(collections, {
        fields: [collectionProducts.collectionId],
        references: [collections.id],
      }),

      product: one(products, {
        fields: [collectionProducts.productId],
        references: [products.id],
      }),
    }),
  );
/* ============================================================
   RETURNS (physical goods — separate from monetary refunds)
============================================================ */

export const returnCasesRelations = relations(
  returnCases,
  ({ one, many }) => ({
    order: one(orders, {
      fields: [returnCases.orderId],
      references: [orders.id],
    }),

    refund: one(refunds, {
      fields: [returnCases.refundId],
      references: [refunds.id],
    }),

    items: many(returnItems),
  }),
);

export const returnItemsRelations = relations(
  returnItems,
  ({ one }) => ({
    returnCase: one(returnCases, {
      fields: [returnItems.caseId],
      references: [returnCases.id],
    }),

    orderItem: one(orderItems, {
      fields: [returnItems.orderItemId],
      references: [orderItems.id],
    }),

    variant: one(productVariants, {
      fields: [returnItems.variantId],
      references: [productVariants.id],
    }),
  }),
);
