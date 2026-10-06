import { defineConfig } from "drizzle-kit";
import { env } from "@/config/env";

export default defineConfig({
  schema: "@/infrastructure/database/schema/index.ts",

  out: "@/infrastructure/database/drizzle",

  dialect: "postgresql",

  dbCredentials: {
    url: env.DATABASE_URL,
  },

  strict: true,

  verbose: true,
});