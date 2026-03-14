-- SaaS Admin: add description to agents, config to channels, indexes for tenant scoping
-- Run after schema.sql / schema-extensions.sql

-- Agents: description (optional)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS description TEXT;

-- Channels: config (jsonb) for channel-specific settings
ALTER TABLE channels ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_channels_tenant_id ON channels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_admins_tenant_id ON admins(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_id ON usage_logs(tenant_id);
