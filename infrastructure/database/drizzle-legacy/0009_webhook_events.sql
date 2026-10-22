-- Webhook event tracking for idempotent payment processing
-- Tracks processed webhook events to prevent duplicate processing

CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Provider identification
    provider TEXT NOT NULL, -- 'stripe', 'paypal', etc.
    
    -- Unique event identifier from the provider
    provider_event_id TEXT NOT NULL,
    
    -- Event type (e.g., 'payment_intent.succeeded', 'payment_intent.payment_failed')
    event_type TEXT NOT NULL,
    
    -- Associated order ID (nullable for events not yet linked to an order)
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    
    -- Associated payment ID (nullable for events not yet linked to a payment)
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    
    -- Processing status
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
    
    -- Error message if processing failed
    error_message TEXT,
    
    -- Number of processing attempts
    attempts INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamp when processing was completed
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Payload for debugging/reprocessing
    payload JSONB NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique constraint to prevent duplicate event processing
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_id_unique
ON webhook_events (provider, provider_event_id);

-- Index for querying by order
CREATE INDEX IF NOT EXISTS webhook_events_order_id_idx
ON webhook_events (order_id);

-- Index for querying by payment
CREATE INDEX IF NOT EXISTS webhook_events_payment_id_idx
ON webhook_events (payment_id);

-- Index for status-based queries
CREATE INDEX IF NOT EXISTS webhook_events_status_idx
ON webhook_events (status);

-- Index for provider-based queries
CREATE INDEX IF NOT EXISTS webhook_events_provider_idx
ON webhook_events (provider);

-- Add webhook_events to the schema
COMMENT ON TABLE webhook_events IS 'Tracks processed webhook events for idempotent payment processing';