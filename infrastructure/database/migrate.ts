import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '@/config/env';
import config from '@/drizzle.config';

const pool = new Pool({connectionString: env.DATABASE_URL});
const db = drizzle(pool);

const main = async () => {
  if(config.out) {
    await migrate(db, {migrationsFolder: config.out});
    console.log("Migration completed");
  }
}

main().catch((err) => {
  // Fail closed: an unapplied migration historically exited 0 here, so CI's
  // "Apply migrations" step succeeded while the database stayed empty
  // (integration suites then failed with 42P01 "relation does not exist").
  console.error("Migration failed", err);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});