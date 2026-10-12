#!/usr/bin/env node
/**
 * Expired Reservations Worker
 * 
 * This script processes expired checkout reservations by:
 * 1. Finding orders with expired checkoutExpiresAt that still have RESERVED inventory
 * 2. Releasing those reservations using the shared handleCheckoutExpiration operation
 * 3. Retrying failed orders with exponential backoff
 * 
 * Usage:
 *   pnpm tsx scripts/expired-reservations-worker.ts
 * 
 * Environment variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   CRON_SECRET - Optional, for API authentication (not used in standalone mode)
 *   RESERVATION_EXPIRY_MINUTES - Default 30
 *   EXPIRED_RESERVATION_BATCH_SIZE - Default 100
 *   EXPIRED_RESERVATION_MAX_RETRIES - Default 3
 */

import { runExpiredReservationsWorker } from "@/modules/jobs/release-expired-reservations";
import { env } from "@/config/env";

async function main(): Promise<void> {
  console.log("Starting expired reservations worker...");
  console.log(`Configuration:`);
  console.log(`  Batch size: ${env.EXPIRED_RESERVATION_BATCH_SIZE}`);
  console.log(`  Max retries: ${env.EXPIRED_RESERVATION_MAX_RETRIES}`);
  console.log(`  Reservation expiry: ${env.RESERVATION_EXPIRY_MINUTES} minutes`);

  try {
    await runExpiredReservationsWorker({
      batchSize: env.EXPIRED_RESERVATION_BATCH_SIZE,
      maxRetries: env.EXPIRED_RESERVATION_MAX_RETRIES,
    });
    console.log("Expired reservations worker completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Expired reservations worker failed:", error);
    process.exit(1);
  }
}

main();