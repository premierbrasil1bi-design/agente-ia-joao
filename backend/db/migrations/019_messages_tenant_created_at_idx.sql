CREATE INDEX IF NOT EXISTS idx_messages_tenant_created_at
  ON messages(tenant_id, created_at);

