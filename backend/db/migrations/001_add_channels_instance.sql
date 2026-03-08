-- Agent Router: map channel instance (e.g. Evolution API instance) to agent.
-- Run once: adds instance column to channels for instance → agent resolution.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS instance VARCHAR(255) DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_type_instance
  ON channels (type, instance)
  WHERE instance IS NOT NULL;

COMMENT ON COLUMN channels.instance IS 'Channel instance identifier (e.g. Evolution API instance name). Used by agentRouter to resolve agent per instance.';
