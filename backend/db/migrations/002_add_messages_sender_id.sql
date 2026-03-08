-- Conversation memory: identify messages by sender for per-conversation history.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_id VARCHAR(512) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_agent_channel_sender ON messages(agent_id, channel_id, sender_id);

COMMENT ON COLUMN messages.sender_id IS 'Channel-specific sender id (e.g. WhatsApp JID, user id) for conversation history.';
