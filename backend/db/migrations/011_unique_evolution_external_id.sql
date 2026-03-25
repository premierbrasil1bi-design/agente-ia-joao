-- Unicidade global: um único canal com provider 'evolution' por external_id (nome da instância na Evolution API).
--
-- PRÉ-VERIFICAÇÃO (rode manualmente se a migration falhar):
--   SELECT external_id, COUNT(*) AS n
--   FROM channels
--   WHERE provider = 'evolution'
--     AND external_id IS NOT NULL
--   GROUP BY external_id
--   HAVING COUNT(*) > 1;
--
-- Se retornar linhas: corrija duplicados (mesclar canais, anular external_id em um deles, ou remover)
-- antes de reaplicar este ficheiro. O bloco abaixo NÃO cria o índice se ainda houver duplicados.

DO $$
DECLARE
  dup_detail text;
BEGIN
  SELECT string_agg(q.external_id || ' (n=' || q.n::text || ')', '; ' ORDER BY q.external_id)
  INTO dup_detail
  FROM (
    SELECT external_id, COUNT(*)::int AS n
    FROM channels
    WHERE provider = 'evolution'
      AND external_id IS NOT NULL
    GROUP BY external_id
    HAVING COUNT(*) > 1
  ) q;

  IF dup_detail IS NOT NULL THEN
    RAISE EXCEPTION
      '011_unique_evolution_external_id: existem external_id duplicados para provider=evolution. '
      'Detalhe: %. '
      'Correção manual obrigatória; não foi criado índice único. '
      'Consulta: SELECT external_id, COUNT(*) FROM channels WHERE provider = ''evolution'' '
      'AND external_id IS NOT NULL GROUP BY external_id HAVING COUNT(*) > 1;',
      dup_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_evolution_external_id
ON channels (external_id)
WHERE provider = 'evolution' AND external_id IS NOT NULL;

COMMENT ON INDEX idx_unique_evolution_external_id IS
  'Garante que o mesmo instanceName (Evolution) não seja ligado a dois canais. external_id = nome da instância na Evolution API.';
