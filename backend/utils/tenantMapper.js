export function toTenantApiRow(dbRow) {
  if (!dbRow) return dbRow;

  const rawStatus = dbRow.status ?? '';
  const statusStr = typeof rawStatus === 'string' ? rawStatus : String(rawStatus || '');
  const isActive = dbRow.active !== undefined && dbRow.active !== null
    ? Boolean(dbRow.active)
    : statusStr.toLowerCase() === 'ativo';

  const nomeEmpresa = dbRow.name ?? null;

  return {
    ...dbRow,
    nome_empresa: nomeEmpresa,
    status: statusStr || (isActive ? 'ativo' : 'inativo'),
    name: nomeEmpresa,
    active: isActive,
    allowed_providers: Array.isArray(dbRow.allowed_providers) ? dbRow.allowed_providers : [],
  };
}

export function toTenantDbStatus(activeBool) {
  if (activeBool === undefined || activeBool === null) {
    return 'Ativo';
  }
  return activeBool ? 'Ativo' : 'Inativo';
}

