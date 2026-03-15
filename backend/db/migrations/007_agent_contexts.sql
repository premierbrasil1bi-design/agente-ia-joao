-- Contexto do Agente: dados de negócio por tenant + agent (OMNIA).
CREATE TABLE IF NOT EXISTS agent_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    company_name TEXT,
    business_description TEXT,
    business_type TEXT,
    working_hours TEXT,
    address TEXT,
    services JSONB,
    rules JSONB,
    tone TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, agent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_context_unique
ON agent_contexts (tenant_id, agent_id);

COMMENT ON TABLE agent_contexts IS 'Contexto do agente (empresa, horário, serviços, regras) por tenant e agent.';
