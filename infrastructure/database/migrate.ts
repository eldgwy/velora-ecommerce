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
  console.error("Migration failed", err);
}).finally(async () => {
  await pool.end();
});