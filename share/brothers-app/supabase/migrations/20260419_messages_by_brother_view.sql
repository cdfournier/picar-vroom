-- Helper views for browsing conversation_messages by brother.
--
-- Run this in the Supabase SQL editor. It creates two views:
--   - messages_by_brother: full-detail view, adds brother_name as a filterable column
--   - messages_by_brother_preview: same but with a 200-char content preview for easier browsing
--
-- Both views are browsable in the Supabase Table Editor just like regular tables.
-- In the Table Editor, click the brother_name filter and pick dom / colin / barry / fionn.

-- ---------------------------------------------------------------------------
-- 1. Full-detail view
-- ---------------------------------------------------------------------------
-- Use this when you want the complete message content (tool calls, long turns, etc.)

CREATE OR REPLACE VIEW messages_by_brother AS
SELECT
  m.id,
  c.brother_name,
  m.conversation_id,
  m.position,
  m.role,
  m.content,
  m.created_at
FROM conversation_messages m
JOIN conversations c ON c.id = m.conversation_id
ORDER BY c.brother_name, m.position;

-- ---------------------------------------------------------------------------
-- 2. Preview view — good for scanning quickly
-- ---------------------------------------------------------------------------
-- Same as above but truncates content to 200 chars. Useful for browsing without
-- getting overwhelmed by long messages or tool-call JSON.

CREATE OR REPLACE VIEW messages_by_brother_preview AS
SELECT
  m.id,
  c.brother_name,
  m.conversation_id,
  m.position,
  m.role,
  -- For string content, just truncate; for array content (tool calls), show type
  CASE
    WHEN jsonb_typeof(m.content) = 'string'
      THEN left(m.content #>> '{}', 200)
    WHEN jsonb_typeof(m.content) = 'array'
      THEN '[' || jsonb_array_length(m.content) || ' content blocks — ' ||
           COALESCE((m.content -> 0 ->> 'type'), 'unknown') || '...]'
    ELSE left(m.content::text, 200)
  END AS preview,
  m.created_at
FROM conversation_messages m
JOIN conversations c ON c.id = m.conversation_id
ORDER BY c.brother_name, m.position;

-- ---------------------------------------------------------------------------
-- Handy saved queries (paste any of these into the SQL editor as bookmarks)
-- ---------------------------------------------------------------------------

-- All of Dom's messages, most recent first:
-- SELECT * FROM messages_by_brother_preview
-- WHERE brother_name = 'dom'
-- ORDER BY position DESC
-- LIMIT 50;

-- Count of messages per brother:
-- SELECT brother_name, count(*) AS message_count
-- FROM messages_by_brother
-- GROUP BY brother_name
-- ORDER BY message_count DESC;

-- Messages around a specific position for a brother (e.g., Dom's last 20):
-- SELECT * FROM messages_by_brother_preview
-- WHERE brother_name = 'dom' AND position >= (
--   SELECT max(position) - 20 FROM conversation_messages
--   WHERE conversation_id = 'conv_dom_1774084168402'
-- )
-- ORDER BY position;

-- Find messages mentioning a keyword (full-text on content):
-- SELECT brother_name, position, role, left(content::text, 300) AS snippet
-- FROM messages_by_brother
-- WHERE content::text ILIKE '%your-keyword-here%'
-- ORDER BY created_at DESC;
