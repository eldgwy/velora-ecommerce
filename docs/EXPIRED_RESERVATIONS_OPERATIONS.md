# Durable Checkout Reservation Expiration — Operational Guide

## Overview

This system automatically releases inventory reservations for checkout sessions that have expired. It uses a database-backed worker pattern that can be deployed as a scheduled cron job, a systemd service, or triggered via a protected internal API endpoint.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Scheduler / Cron                        │
│  (Vercel Cron, systemd timer, pg_cron, external scheduler)  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            Internal API Endpoint (Protected)                │
│  POST /api/internal/jobs/expire-reservations                │
│  Authorization: Bearer <CRON_SECRET>                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Expired Reservation Worker                     │
│  modules/jobs/release-expired-reservations.ts               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Shared Release Operation (Phase 2)             │
│  modules/orders/application/commands/order-lifecycle.ts     │
│  handleCheckoutExpiration()                                 │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `CRON_SECRET` | Secret token for authenticating internal job endpoints | - | Yes (for API mode) |
| `RESERVATION_EXPIRY_MINUTES` | Minutes before a checkout reservation expires | 30 | No |
| `EXPIRED_RESERVATION_BATCH_SIZE` | Max orders to process per job run | 100 | No |
| `EXPIRED_RESERVATION_MAX_RETRIES` | Max retry attempts for failed orders | 3 | No |

### Database Schema

The `orders` table already has:
- `checkout_expires_at` (timestamp with time zone) - Set when order is created
- `status` - Order status (PENDING, PROCESSING, etc.)
- `payment_status` - Payment status

The `order_items` table has:
- `reservation_status` - (PENDING, RESERVED, RELEASED, COMMITTED)

## Deployment Options

### Option 1: Vercel Cron Jobs (Recommended for Vercel Deployments)

Create `vercel.json` in project root:

```json
{
  "crons": [
    {
      "path": "/api/internal/jobs/expire-reservations",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Set `CRON_SECRET` in Vercel environment variables.

### Option 2: Standalone Worker with systemd

1. Create service file `/etc/systemd/system/velora-expired-reservations.service`:

```ini
[Unit]
Description=Velora Expired Reservations Worker
After=network.target

[Service]
Type=oneshot
User=velora
WorkingDirectory=/opt/velora
EnvironmentFile=/opt/velora/.env
ExecStart=/opt/velora/node_modules/.bin/tsx scripts/expired-reservations-worker.ts
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

2. Create timer `/etc/systemd/system/velora-expired-reservations.timer`:

```ini
[Unit]
Description=Run Velora Expired Reservations Worker every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
```

3. Enable and start:
```bash
systemctl daemon-reload
systemctl enable --now velora-expired-reservations.timer
```

### Option 3: pg_cron (PostgreSQL-native)

If using PostgreSQL with pg_cron extension:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the worker every 5 minutes
SELECT cron.schedule(
  'expired-reservations-worker',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-app.vercel.app/api/internal/jobs/expire-reservations',
    headers := '{"Authorization": "Bearer ' || current_setting('app.cron_secret') || '"}',
    body := '{}'
  );
  $$
);
```

### Option 4: External Scheduler (GitHub Actions, cron, etc.)

```bash
# Run every 5 minutes via crontab
*/5 * * * * /opt/velora/node_modules/.bin/tsx /opt/velora/scripts/expired-reservations-worker.ts >> /var/log/velora-expired-reservations.log 2>&1
```

## Scheduling Frequency

**Recommended: Every 5 minutes**

Rationale:
- Balances prompt reservation release with database load
- With 30-minute expiry, 5-minute intervals ensure max ~5 min delay
- Batch size of 100 keeps individual runs fast (< 1 second typical)

## Retry Behavior

- Failed orders are retried up to `EXPIRED_RESERVATION_MAX_RETRIES` times (default: 3)
- Exponential backoff: 5s, 10s, 20s between retries
- Other orders in the batch continue processing even if some fail
- Failed orders are logged with full error details for manual recovery

## Monitoring

### Key Metrics to Track

1. **Job run duration** - Should complete in < 5 seconds
2. **Orders processed per run** - Typically 0-10 during normal operation
3. **Failure rate** - Should be 0%; any failures indicate issues
4. **Expired orders found** - Alert if consistently high (may indicate checkout flow issues)

### Log Entries

The worker emits structured logs:

```json
{
  "timestamp": "2026-10-11T12:00:00.000Z",
  "level": "info",
  "message": "Expired reservation processing job completed",
  "module": "jobs",
  "action": "processExpiredReservations",
  "runId": "expire-run-1234567890-abc123",
  "processed": 2,
  "succeeded": 2,
  "failed": 0,
  "durationMs": 45
}
```

### Health Check Endpoint

Add a health check for the worker:

```typescript
// app/api/internal/jobs/health/route.ts
export async function GET() {
  return Response.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    worker: "expired-reservations"
  });
}
```

## Manual Recovery Procedures

### 1. Re-run for Specific Orders

```bash
# Find stuck orders
psql $DATABASE_URL -c "
  SELECT id, order_number, checkout_expires_at, status, payment_status
  FROM orders
  WHERE checkout_expires_at < NOW()
    AND status IN ('PENDING', 'PROCESSING')
    AND payment_status NOT IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')
    AND EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = orders.id AND oi.reservation_status = 'RESERVED'
    );
"

# Manually trigger expiration for a specific order
psql $DATABASE_URL -c "
  SELECT * FROM handle_checkout_expiration('ORDER_UUID_HERE');
"
```

### 2. Force Release Reservations

If the worker is down and reservations need immediate release:

```bash
# Direct database update (use with caution)
psql $DATABASE_URL -c "
  UPDATE order_items
  SET reservation_status = 'RELEASED', updated_at = NOW()
  WHERE reservation_status = 'RESERVED'
    AND order_id IN (
      SELECT id FROM orders
      WHERE checkout_expires_at < NOW()
        AND status IN ('PENDING', 'PROCESSING')
    );
"
```

### 3. Clear Stuck Processing State

If orders are stuck in "PROCESSING" due to a crashed worker:

```bash
psql $DATABASE_URL -c "
  UPDATE orders
  SET status = 'CANCELLED', payment_status = 'EXPIRED', updated_at = NOW()
  WHERE status = 'PROCESSING'
    AND payment_status = 'PENDING'
    AND checkout_expires_at < NOW() - INTERVAL '1 hour';
"
```

## Testing

### Unit Tests

Run the job worker tests:

```bash
pnpm test -- --testNamePattern="expired reservation"
```

### Integration Tests

The test suite covers:
- Expiration at the configured deadline
- Worker restart and delayed execution
- Duplicate worker execution
- Concurrent payment and expiration
- Transient failures and retries
- Large batches and bounded processing
- Already released or fulfilled reservations

### Manual Testing

```bash
# Create an order with expired checkout
psql $DATABASE_URL -c "
  INSERT INTO orders (id, order_number, user_id, status, ..., checkout_expires_at)
  VALUES ('test-uuid', 'ORD-TEST', 'user-1', 'PENDING', ..., NOW() - INTERVAL '1 hour');
"

# Run worker manually
pnpm tsx scripts/expired-reservations-worker.ts

# Verify reservations released
psql $DATABASE_URL -c "
  SELECT o.order_number, oi.reservation_status
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.id = 'test-uuid';
"
```

## Troubleshooting

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Worker runs but processes 0 orders | No expired orders, or all already processed | Normal; check `checkout_expires_at` values |
| High failure rate | Database locks, constraint violations | Check logs; verify inventory constraints |
| Orders not expiring | `checkout_expires_at` not set | Verify order creation sets expiry |
| Duplicate processing | Multiple schedulers running | Ensure only one scheduler active |
| API returns 401 | Invalid/missing CRON_SECRET | Verify secret matches in env and scheduler |

## Security Considerations

1. **Internal endpoint protection**: The `/api/internal/jobs/expire-reservations` endpoint requires `Authorization: Bearer <CRON_SECRET>` header
2. **No public exposure**: The endpoint is not linked from any public page
3. **Idempotent operations**: Safe to call multiple times; won't double-release reservations
4. **Least privilege**: Worker only accesses orders and inventory tables it needs

## Related Files

- `modules/jobs/release-expired-reservations.ts` - Core worker logic
- `app/api/internal/jobs/expire-reservations/route.ts` - Protected API endpoint
- `scripts/expired-reservations-worker.ts` - Standalone CLI entry point
- `modules/orders/application/commands/order-lifecycle.ts` - `handleCheckoutExpiration` (Phase 2)
- `config/env.ts` - Configuration schema
- `.env.example` - Example environment variables