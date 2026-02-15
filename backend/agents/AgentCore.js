// agente-ia-omnicanal/backend/agents/AgentCore.js

class AgentCore {
    constructor() {
        this.fallbackReply = "Desculpe, não entendi sua pergunta. Poderia reformular?";
    }

    /**
     * Processa a mensagem e gera uma resposta simulada.
     * @param {string} canal - O canal de origem da mensagem.
     * @param {string} userId - O ID do usuário.
     * @param {string} mensagem - A mensagem enviada pelo usuário.
     * @returns {object} Um objeto com a propriedade 'reply'.
     */
    async processMessage(canal, userId, mensagem) {
        const lowerCaseMessage = mensagem.toLowerCase();
        let replyText = this.fallbackReply;

        if (lowerCaseMessage.includes('olá') || lowerCaseMessage.includes('oi')) {
            replyText = "Olá! Como posso ajudar você hoje?";
        } else if (lowerCaseMessage.includes('preço') || lowerCaseMessage.includes('custo')) {
            replyText = "Para saber o preço, por favor, me diga qual produto ou serviço você está interessado.";
        } else if (lowerCaseMessage.includes('horário') || lowerCaseMessage.includes('aberto')) {
            replyText = "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h.";
        } else if (lowerCaseMessage.includes('obrigado') || lowerCaseMessage.includes('valeu')) {
            replyText = "De nada! Fico feliz em ajudar.";
        } else if (lowerCaseMessage.includes('quem é você')) {
            replyText = "Eu sou um agente de IA virtual, pronto para te auxiliar!";
        }

        // Simulação de delay para emular processamento de IA
        await new Promise(resolve => setTimeout(resolve, 500));

        return { reply: replyText };
    }
}

export default new AgentCore();
