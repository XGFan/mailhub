import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config for generating migrations against the `mailhub` Postgres
 * schema. The full table definitions land in src/db/schema.ts in Phase 2.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config;
