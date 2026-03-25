-- Registros de erros/alertas críticos (invariantes, falhas de integridade).
-- Consumo: dashboards, jobs de notificação ou consulta manual no Neon.

CREATE TABLE IF NOT EXISTS system_errors (
  id BIGSERIAL PRIMARY KEY,
  error_type VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_errors_type_created
  ON system_errors (error_type, created_at DESC);

COMMENT ON TABLE system_errors IS 'Alertas persistidos (ex.: EVOLUTION_INVARIANT_BROKEN). Não substitui logs; complementa monitoração.';
COMMENT ON COLUMN system_errors.error_type IS 'Identificador estável (ex. EVOLUTION_INVARIANT_BROKEN).';
COMMENT ON COLUMN system_errors.payload IS 'JSON do evento (type, external_id, channels, etc.).';
