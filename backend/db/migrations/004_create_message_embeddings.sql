-- Vector memory: embeddings of user messages for semantic search (pgvector).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS message_embeddings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sender_id  VARCHAR(512) NOT NULL,
  content    TEXT NOT NULL,
  embedding  vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_embeddings_agent_sender ON message_embeddings(agent_id, sender_id);

-- ivfflat index for cosine similarity search (lists = 100, increase lists if table grows large).
-- If this fails on empty table (some hosts), run after inserting at least a few rows.
CREATE INDEX IF NOT EXISTS idx_message_embeddings_embedding_cosine
  ON message_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON TABLE message_embeddings IS 'Vector embeddings of user messages for semantic retrieval (OpenAI text-embedding-3-small, 1536 dims).';
