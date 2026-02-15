// agente-ia-omnicanal/frontend/widget-chat.js
// Canal WEB: envia agent_id no body. Configure via window.CHAT_AGENT_ID ou data-agent-id no script.

(function() {
    const BACKEND_URL = window.CHAT_BACKEND_URL || 'http://localhost:3000/api/agent/message';
    const USER_ID = 'user_' + Math.random().toString(36).substring(2, 15);

    function getAgentId() {
        if (window.CHAT_AGENT_ID) return window.CHAT_AGENT_ID.trim() || null;
        var script = document.currentScript || document.querySelector('script[data-agent-id]');
        if (script) {
            var id = script.getAttribute('data-agent-id');
            if (id) return id.trim();
            var src = script.src || '';
            var match = src.match(/[?&]agent_id=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        }
        return null;
    }

    var agentId = getAgentId();

    let chatWidgetContainer;
    let chatButton;
    let chatWindow;
    let chatMessages;
    let chatInput;
    let chatSendButton;

    function initChatWidget() {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = 'widget-chat.css';
        document.head.appendChild(link);

        chatWidgetContainer = document.createElement('div');
        chatWidgetContainer.id = 'chat-widget-container';
        document.body.appendChild(chatWidgetContainer);

        chatButton = document.createElement('button');
        chatButton.id = 'chat-button';
        chatButton.innerHTML = '💬';
        chatButton.addEventListener('click', toggleChatWindow);
        chatWidgetContainer.appendChild(chatButton);

        chatWindow = document.createElement('div');
        chatWindow.id = 'chat-window';
        chatWindow.classList.add('hidden');
        chatWidgetContainer.appendChild(chatWindow);

        var chatHeader = document.createElement('div');
        chatHeader.id = 'chat-header';
        chatHeader.innerHTML = '<h3>Agente Omni-Channel</h3><button id="chat-close-button">X</button>';
        chatWindow.appendChild(chatHeader);
        document.getElementById('chat-close-button').addEventListener('click', toggleChatWindow);

        chatMessages = document.createElement('div');
        chatMessages.id = 'chat-messages';
        chatWindow.appendChild(chatMessages);

        var chatInputArea = document.createElement('div');
        chatInputArea.id = 'chat-input-area';
        chatWindow.appendChild(chatInputArea);

        chatInput = document.createElement('input');
        chatInput.type = 'text';
        chatInput.id = 'chat-input';
        chatInput.placeholder = agentId ? 'Digite sua mensagem...' : 'Selecione um agente para enviar mensagens.';
        chatInputArea.appendChild(chatInput);

        chatSendButton = document.createElement('button');
        chatSendButton.id = 'chat-send-button';
        chatSendButton.innerHTML = 'Enviar';
        chatInputArea.appendChild(chatSendButton);

        chatSendButton.addEventListener('click', sendMessage);
        chatInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') sendMessage();
        });

        if (agentId) {
            appendMessage('agent', 'Olá! Sou seu assistente virtual. Como posso ajudar?', 'agent-initial');
        } else {
            appendMessage('agent', 'Selecione um agente antes de enviar mensagens.', 'agent-notice');
        }
    }

    function toggleChatWindow() {
        chatWindow.classList.toggle('hidden');
        if (!chatWindow.classList.contains('hidden')) {
            chatInput.focus();
            scrollToBottom();
        }
    }

    function appendMessage(sender, text, className = '') {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', `message-${sender}`);
        if (className) {
            messageElement.classList.add(className);
        }
        messageElement.textContent = text;
        chatMessages.appendChild(messageElement);
        scrollToBottom();
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendMessage() {
        var messageText = chatInput.value.trim();
        if (messageText === '') return;

        var currentAgentId = getAgentId() || agentId;
        if (!currentAgentId) {
            appendMessage('agent', 'Selecione um agente antes de enviar mensagens.', 'error-message');
            scrollToBottom();
            return;
        }

        appendMessage('user', messageText);
        chatInput.value = '';
        appendMessage('agent', 'digitando...', 'loading-message');
        scrollToBottom();

        try {
            var response = await fetch(BACKEND_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-agent-id': currentAgentId,
                    'x-channel': 'web',
                },
                body: JSON.stringify({
                    text: messageText,
                    agent_id: currentAgentId,
                    channel: 'web',
                }),
            });

            var loadingMessage = chatMessages.querySelector('.loading-message');
            if (loadingMessage) loadingMessage.remove();

            var data = await response.json().catch(function() { return {}; });
            var responseText = data.response ?? data.reply ?? data.error ?? '';

            if (!response.ok) {
                appendMessage('agent', responseText || 'Não foi possível obter resposta. Tente novamente.', 'error-message');
                return;
            }

            appendMessage('agent', responseText || 'Sem resposta.');
        } catch (error) {
            var loadingMsg = chatMessages.querySelector('.loading-message');
            if (loadingMsg) loadingMsg.remove();
            appendMessage('agent', 'Não foi possível conectar ao agente. Verifique a conexão e tente novamente.', 'error-message');
        }
    }

    // Inicializa o widget quando o DOM estiver completamente carregado
    document.addEventListener('DOMContentLoaded', initChatWidget);
})();
