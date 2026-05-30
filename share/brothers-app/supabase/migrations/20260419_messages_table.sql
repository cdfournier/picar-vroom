-- Migration: Move conversation messages from the `conversations.messages` JSONB blob
-- into a dedicated `conversation_messages` table (one row per message).
--
-- WHY: The previous design required rewriting the entire message array on every
-- turn via UPDATE. As conversations grew, these UPDATEs timed out (Postgres error
-- 57014 "canceling statement due to statement timeout"), silently losing turns.
--
-- The new design appends one small row per message via INSERT. Writes stay
-- constant-time regardless of conversation length.
--
-- Run this against your Supabase project via the SQL editor.
-- SAFE TO RUN: This migration does NOT drop the old `messages` JSONB column.
-- That column is preserved for rollback safety. It can be dropped later once
-- the new system is verified stable.

-- ---------------------------------------------------------------------------
-- 1. New table: one row per message
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,          -- 0-based index within the conversation
  role TEXT NOT NULL,                 -- 'user' or 'assistant'
  content JSONB NOT NULL,             -- string or array of content blocks
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (conversation_id, position)
);

-- Fast lookup: load all messages for a conversation in order
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_position
  ON conversation_messages (conversation_id, position);

-- ---------------------------------------------------------------------------
-- 2. Backfill: copy existing JSONB messages into the new table
-- ---------------------------------------------------------------------------
-- This reads each conversation row, unnests its messages JSONB array, and
-- inserts one row per message with the correct position.
--
-- ON CONFLICT DO NOTHING — safe to re-run; won't duplicate rows.

INSERT INTO conversation_messages (conversation_id, position, role, content)
SELECT
  c.id AS conversation_id,
  (ord - 1)::integer AS position,          -- WITH ORDINALITY is 1-based; convert to 0-based
  msg->>'role' AS role,
  COALESCE(msg->'content', to_jsonb(msg->>'content')) AS content
FROM conversations c,
  jsonb_array_elements(c.messages) WITH ORDINALITY AS t(msg, ord)
WHERE c.messages IS NOT NULL
  AND jsonb_typeof(c.messages) = 'array'
  AND jsonb_array_length(c.messages) > 0
ON CONFLICT (conversation_id, position) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Verification queries (run manually after migration to sanity check)
-- ---------------------------------------------------------------------------
-- SELECT
--   c.id,
--   c.brother_name,
--   jsonb_array_length(c.messages) AS old_count,
--   (SELECT count(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS new_count
-- FROM conversations c
-- ORDER BY c.updated_at DESC;
--
-- Expected: old_count = new_count for every row.

-- ---------------------------------------------------------------------------
-- 4. NOT DONE YET (future migration): drop the old JSONB column
-- ---------------------------------------------------------------------------
-- Once the application has been running on the new table for a while with no
-- issues, run this to reclaim space:
--
--   ALTER TABLE conversations DROP COLUMN messages;
--
-- Until then, the column stays as a rollback safety net.
