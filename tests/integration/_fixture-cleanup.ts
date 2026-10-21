import { sql } from "drizzle-orm";

import { testDb } from "./_db";

/**
 * Cascade-safe purge of a suite's fixed-name category/brand fixtures.
 *
 * The integration suites share one Postgres database. Suites whose fixtures
 * use static slugs must survive a WOUNDED prior run (a worker crash can leave
 * fixtures behind when `afterAll` never reaches its deletes); re-running into
 * a leftover slug otherwise aborts `beforeAll` with a unique-violation and
 * cascades through the whole file.
 *
 * The purge is keyed strictly on the caller's own fixture slugs — never on
 * seed/dev rows — and removes the dependent chain first so the final
 * category/brand delete cannot trip an FK `RESTRICT` from leftover
 * products/variants/order rows.
 */
export async function purgeCategoryFixtures(
  categorySlugs: string[],
  brandSlugs: string[] = [],
): Promise<void> {
  const catArgs = sql.join(
    categorySlugs.map((slug) => sql`${slug}`),
    sql`, `,
  );
  const catIdsSub = sql`(SELECT id FROM categories WHERE slug IN (${catArgs}))`;

  await testDb.execute(sql`
    DELETE FROM order_items WHERE variant_id IN
      (SELECT id FROM product_variant WHERE product_id IN ${catIdsSub})
  `);
  await testDb.execute(sql`
    DELETE FROM inventory_movement WHERE inventory_id IN
      (SELECT id FROM inventory WHERE variant_id IN
        (SELECT id FROM product_variant WHERE product_id IN ${catIdsSub}))
  `);
  await testDb.execute(sql`
    DELETE FROM inventory WHERE variant_id IN
      (SELECT id FROM product_variant WHERE product_id IN ${catIdsSub})
  `);
  for (const table of [
    "reviews",
    "product_questions",
    "wishlist_items",
    "product_view_history",
    "product_option",
    "product_images",
  ]) {
    await testDb.execute(
      sql`DELETE FROM ${sql.raw(table)} WHERE product_id IN ${catIdsSub}`,
    );
  }
  await testDb.execute(sql`
    DELETE FROM product_variant WHERE product_id IN ${catIdsSub}
  `);
  await testDb.execute(sql`DELETE FROM products WHERE category_id IN ${catIdsSub}`);
  await testDb.execute(sql`DELETE FROM categories WHERE slug IN (${catArgs})`);

  if (brandSlugs.length > 0) {
    const brandArgs = sql.join(
      brandSlugs.map((slug) => sql`${slug}`),
      sql`, `,
    );
    await testDb.execute(sql`DELETE FROM "brand" WHERE slug IN (${brandArgs})`);
  }
}
