-- Conversation persistence for the BrotherClaudes API app
-- Run this against your Supabase project via the SQL editor

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                          -- conv_dom_xxx style IDs
  brother_name TEXT NOT NULL,                   -- e.g. "dom", "colin"
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,  -- full Anthropic message history
  system_prompt TEXT,                           -- the system prompt used
  token_count INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  compaction_summaries JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by brother name + recency
CREATE INDEX IF NOT EXISTS idx_conversations_brother_updated
  ON conversations (brother_name, updated_at DESC);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();
