import {
  getAgentContext,
  upsertAgentContext
} from '../repositories/agentContext.repository.js';

export async function getContext(req, res) {
  try {
    const tenantId = req.tenantId;
    const agentId = req.query.agent_id;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agent_id é obrigatório na query.'
      });
    }

    const context = await getAgentContext(tenantId, agentId);

    return res.status(200).json({
      success: true,
      context: context || null
    });
  } catch (err) {
    console.error('[agentContext] getContext:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar contexto'
    });
  }
}

export async function saveContext(req, res) {
  try {
    const tenantId = req.tenantId;
    const agentId = req.body?.agent_id;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agent_id é obrigatório no body.'
      });
    }

    const context = await upsertAgentContext(tenantId, agentId, req.body);

    return res.status(200).json({
      success: true,
      context
    });
  } catch (err) {
    console.error('[agentContext] saveContext:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro ao salvar contexto'
    });
  }
}
