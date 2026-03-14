/**
 * Maps agent DB row to API row format (same style as tenantMapper).
 */
export function toAgentApiRow(dbRow) {
  if (!dbRow) return dbRow;
  const status = (dbRow.status ?? 'ativo').toString().toLowerCase();
  return {
    id: dbRow.id,
    tenant_id: dbRow.tenant_id,
    client_id: dbRow.client_id,
    name: dbRow.name ?? '',
    slug: dbRow.slug ?? '',
    description: dbRow.description ?? null,
    status: status === 'ativo' || status === 'inativo' || status === 'erro' ? status : 'ativo',
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at,
  };
}
