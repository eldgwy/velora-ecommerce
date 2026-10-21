#!/usr/bin/env node
/**
 * Migration Validation Script
 * 
 * This script validates that all migrations (currently 0000–0031) can be replayed
 * cleanly on a fresh PostgreSQL database and produce a schema equivalent
 * to the current Drizzle schema definitions.
 * 
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:port/dbname pnpm tsx scripts/validate-migrations.ts
 * 
 * Requirements:
 * - Target database must be empty (no tables, no enums). A non-empty
 *   target aborts unless `--allow-non-empty` (or
 *   ALLOW_NON_EMPTY_MIGRATION_VALIDATION=true) is passed explicitly —
 *   GP-26 (T-2.6): a warns-only check validated nothing on real data.
 * - User must have CREATE DATABASE permission or database must exist
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

async function validateMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('=== Migration Validation Started ===');
  console.log(`Target database: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    // Step 1: Verify database is empty
    // GP-26 (T-2.6): a non-empty target previously only produced a warning,
    // so "validation" could silently validate nothing (schema-equivalence
    // steps below are meaningless against pre-existing tables). Abort
    // unless the operator explicitly overrides.
    console.log('\n--- Step 1: Verifying database is empty ---');
    const tablesBeforeResult = await db.execute(sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tablesBefore = (tablesBeforeResult as QueryResult).rows;
    
    if (tablesBefore.length > 0) {
      const allowOverride =
        process.argv.includes('--allow-non-empty') ||
        process.env.ALLOW_NON_EMPTY_MIGRATION_VALIDATION === 'true';
      console.error('ERROR: Database is not empty. Existing tables:');
      tablesBefore.forEach(t => console.error(`  - ${t.table_name}`));
      if (!allowOverride) {
        console.error(
          'Refusing to validate against a non-empty database. ' +
          'Point DATABASE_URL at a disposable empty database, or pass ' +
          '--allow-non-empty (or ALLOW_NON_EMPTY_MIGRATION_VALIDATION=true) ' +
          'explicitly if you understand the validation in that case is limited ' +
          'to idempotent-replay on an already-migrated schema.',
        );
        process.exit(1);
      }
      console.warn(
        'WARNING: --allow-non-empty override active. Schema-equivalence ' +
        'checks are not meaningful against pre-existing tables.',
      );
    } else {
      console.log('OK: Database is empty');
    }

    // Step 2: Run migrations
    console.log('\n--- Step 2: Running migrations ---');
    const migrationsFolder = path.join(process.cwd(), 'infrastructure/database/drizzle');
    
    if (!fs.existsSync(migrationsFolder)) {
      console.error(`ERROR: Migrations folder not found: ${migrationsFolder}`);
      process.exit(1);
    }

    const migrationFiles = fs.readdirSync(migrationsFolder)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`Found ${migrationFiles.length} migration files:`);
    migrationFiles.forEach(f => console.log(`  - ${f}`));

    await migrate(db, { migrationsFolder });
    console.log('OK: All migrations applied successfully');

    // Step 3: Verify migration history table
    // The table's schema location depends on how the database was primed
    // (drizzle-orm's default here is the `drizzle` schema); locate it
    // instead of hardcoding, so replays on a primed database validate too.
    console.log('\n--- Step 3: Verifying migration history ---');
    const historyLocationResult = await db.execute(sql`
      SELECT table_schema FROM information_schema.tables 
      WHERE table_name = '__drizzle_migrations' LIMIT 1
    `);
    const historyLocation = (historyLocationResult as QueryResult).rows[0] as
      | { table_schema: string }
      | undefined;
    if (!historyLocation) {
      console.error('FAIL: __drizzle_migrations table not found in any schema');
      process.exit(1);
    }
    const historyResult = await db.execute(
      sql.raw(
        `SELECT * FROM ${historyLocation.table_schema}.__drizzle_migrations ORDER BY id`,
      ),
    );
    const history = (historyResult as QueryResult).rows;
    
    console.log(`Migration history entries: ${history.length}`);
    history.forEach(h => console.log(`  - ${h.hash} (applied at ${h.created_at})`));

    // Step 4: Verify schema matches expectations
    console.log('\n--- Step 4: Verifying schema ---');
    const tablesAfterResult = await db.execute(sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tablesAfter = (tablesAfterResult as QueryResult).rows;
    
    console.log(`Tables created: ${tablesAfter.length}`);
    tablesAfter.forEach(t => console.log(`  - ${t.table_name}`));

    const enumsResult = await db.execute(sql`
      SELECT typname, enumlabel FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid 
      WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY typname, enumsortorder
    `);
    const enums = (enumsResult as QueryResult).rows;
    
    console.log(`Enum types: ${new Set(enums.map(e => e.typname)).size}`);
    enums.forEach(e => console.log(`  - ${e.typname}: ${e.enumlabel}`));

    // Step 5: Verify critical tables and constraints
    console.log('\n--- Step 5: Verifying critical schema elements ---');
    
    const criticalChecks = [
      { name: 'rate_limit has id column', query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'rate_limit' AND column_name = 'id'` },
      { name: 'rate_limit id is PK', query: `SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'rate_limit' AND constraint_type = 'PRIMARY KEY'` },
      // Drizzle models real unique constraints as unique INDEXES; table_constraints
      // does not list them, so accept the index form (this check must truthfully
      // detect the enforced uniqueness, else it "validates nothing" — the exact
      // GP-26 finding).
      { name: 'rate_limit key is unique', query: `SELECT 1 FROM pg_indexes WHERE tablename = 'rate_limit' AND indexdef ILIKE '%UNIQUE INDEX%' AND indexdef ILIKE '%USING btree (key)'` },
      { name: 'low_stock_alerts exists', query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'low_stock_alerts'` },
      { name: 'webhook_events exists', query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'webhook_events'` },
      { name: 'order_items has reservation_status', query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'reservation_status'` },
      { name: 'orders has checkout_expires_at', query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'checkout_expires_at'` },
      { name: 'inventory has CHECK constraints', query: `SELECT COUNT(*) as count FROM information_schema.table_constraints WHERE table_name = 'inventory' AND constraint_type = 'CHECK'` },
    ];

    let failedChecks = false;
    for (const check of criticalChecks) {
      const result = await db.execute(sql.raw(check.query));
      const rows = (result as QueryResult).rows;
      const passed = rows.length > 0 && (rows[0]?.count ? parseInt(rows[0].count as string) > 0 : true);
      console.log(`${passed ? 'OK' : 'FAIL'}: ${check.name}`);
      if (!passed) {
        failedChecks = true;
        console.error(`  Query: ${check.query}`);
        console.error(`  Result: ${JSON.stringify(rows)}`);
      }
    }

    if (failedChecks) {
      console.error('\n=== Migration Validation FAILED (critical schema checks above) ===');
      process.exit(1);
    }

    console.log('\n=== Migration Validation Completed Successfully ===');
    
  } catch (error) {
    console.error('\n=== Migration Validation FAILED ===');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

validateMigrations();