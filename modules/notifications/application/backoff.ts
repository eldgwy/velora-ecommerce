/** Bounded exponential backoff for notification retries (pure). */
const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600];

/** Delay before the next attempt after `attempt` failures (1-based). */
export function computeBackoffMs(failedAttempts: number): number {
  const idx = Math.max(0, Math.min(failedAttempts - 1, BACKOFF_SECONDS.length - 1));
  return BACKOFF_SECONDS[idx]! * 1000;
}

export const NOTIFICATION_LEASE_MS_DEFAULT = 10 * 60 * 1000;

export function retryConfigFromEnv(): {
  batchSize: number;
  maxAttempts: number;
  leaseMs: number;
} {
  const num = (raw: string | undefined, fallback: number): number => {
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
  };
  return {
    batchSize: num(process.env.NOTIFICATION_BATCH_SIZE, 50),
    maxAttempts: num(process.env.NOTIFICATION_MAX_ATTEMPTS, 5),
    leaseMs: num(process.env.NOTIFICATION_LEASE_MINUTES, 10) * 60_000,
  };
}

/** Provider errors may carry account details — keep a safe, short prefix. */
export function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown provider error";
  return message.slice(0, 500);
}
