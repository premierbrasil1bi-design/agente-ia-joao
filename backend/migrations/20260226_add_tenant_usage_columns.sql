ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS agents_used_current_period INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS messages_used_current_period INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS billing_cycle_start TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_tenants_billing_cycle
ON tenants (billing_cycle_start);
