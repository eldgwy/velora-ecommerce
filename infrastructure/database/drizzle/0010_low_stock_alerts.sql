-- 0010_low_stock_alerts
-- Low stock alert system for inventory monitoring

-- Create enum type
CREATE TYPE low_stock_alert_status AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- Create low_stock_alerts table
CREATE TABLE low_stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL,
  available_stock INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  status low_stock_alert_status NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX low_stock_alerts_inventory_id_idx ON low_stock_alerts (inventory_id);
CREATE INDEX low_stock_alerts_variant_id_idx ON low_stock_alerts (variant_id);
CREATE INDEX low_stock_alerts_status_idx ON low_stock_alerts (status);
CREATE INDEX low_stock_alerts_created_at_idx ON low_stock_alerts (created_at);

-- Prevent duplicate pending alerts for the same variant
CREATE UNIQUE INDEX low_stock_alerts_variant_pending_unique
  ON low_stock_alerts (variant_id)
  WHERE status IN ('PENDING', 'PROCESSING');

-- Rollback:
-- DROP INDEX IF EXISTS low_stock_alerts_variant_pending_unique;
-- DROP INDEX IF EXISTS low_stock_alerts_created_at_idx;
-- DROP INDEX IF EXISTS low_stock_alerts_status_idx;
-- DROP INDEX IF EXISTS low_stock_alerts_variant_id_idx;
-- DROP INDEX IF EXISTS low_stock_alerts_inventory_id_idx;
-- DROP TABLE IF EXISTS low_stock_alerts;
-- DROP TYPE IF EXISTS low_stock_alert_status;