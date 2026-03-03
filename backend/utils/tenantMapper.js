export function toTenantApiRow(dbRow) {
  if (!dbRow) return dbRow;

  const rawStatus = dbRow.status ?? '';
  const statusStr = typeof rawStatus === 'string' ? rawStatus : String(rawStatus || '');
  const isActive = statusStr.toLowerCase() === 'ativo';

  const nomeEmpresa = dbRow.nome_empresa ?? dbRow.name ?? null;

  return {
    ...dbRow,
    nome_empresa: nomeEmpresa,
    status: statusStr || null,
    name: nomeEmpresa,
    active: isActive,
  };
}

export function toTenantDbStatus(activeBool) {
  if (activeBool === undefined || activeBool === null) {
    return 'Ativo';
  }
  return activeBool ? 'Ativo' : 'Inativo';
}

