/**
 * Maps channel DB row to API row format.
 */
export function toChannelApiRow(dbRow) {
  if (!dbRow) return dbRow;
  return {
    id: dbRow.id,
    tenant_id: dbRow.tenant_id,
    agent_id: dbRow.agent_id,
    type: (dbRow.type ?? 'api').toString().toLowerCase(),
    name: dbRow.name ?? '',
    config: dbRow.config ?? {},
    status: (dbRow.status ?? 'offline').toString().toLowerCase(),
    is_active: dbRow.is_active !== false,
    message_count: Number(dbRow.message_count ?? 0),
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at,
  };
}
