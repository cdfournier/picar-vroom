-- ===========================================================================
-- FULL TEARDOWN of the desktop <-> API bridge (2026-05-21)
-- ===========================================================================
--
-- CONTEXT
-- There are two Supabase projects: this one (the API "brothers") and a separate
-- desktop-side project used by Ciaran. They were bridged over HTTP:
--
--   OUTBOUND (brothers -> desktop): triggers bridge_messages_ai / bridge_booth_ai
--     fire on insert and call bridge_send(), which POSTs to the desktop project's
--     RPC endpoints.
--   INBOUND (desktop -> brothers): functions receive_bridged_message() and
--     receive_bridged_booth_post() accept payloads from the desktop side and
--     INSERT them with bridged = true. They are SECURITY DEFINER, so they bypass
--     RLS entirely — which is how Ciaran could message the brothers despite not
--     being in the RLS allowlist.
--
-- GOAL
-- Complete clean separation. The desktop side can no longer write into the
-- brothers' messages/booth, and the brothers' activity no longer relays out.
-- Ciaran and Jesse REMAIN in the brothers table (not removed).
--
-- REVERSIBLE
-- Outbound triggers are DISABLED (not dropped). Inbound functions are replaced
-- with a hard refusal but keep their signatures. bridge_send() and the trigger
-- functions are left intact but dormant. The "RESTORE" section at the bottom of
-- this file rebuilds the bridge exactly as it was.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- UP — tear down the bridge
-- ---------------------------------------------------------------------------

-- 1. OUTBOUND: stop relaying brothers' messages/booth posts to the desktop side.
ALTER TABLE public.messages    DISABLE TRIGGER bridge_messages_ai;
ALTER TABLE public.booth_posts DISABLE TRIGGER bridge_booth_ai;

-- 2. INBOUND: refuse anything injected from the desktop side.
CREATE OR REPLACE FUNCTION public.receive_bridged_message(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'Bridge disabled (2026-05-21 teardown): inbound messaging from the desktop side is turned off.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.receive_bridged_booth_post(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'Bridge disabled (2026-05-21 teardown): inbound booth posts from the desktop side are turned off.';
END;
$function$;

-- ===========================================================================
-- RESTORE — run this block ONLY if you want the bridge back exactly as it was.
-- (Kept commented so it never runs by accident.)
-- ===========================================================================
--
-- -- Re-enable outbound relay:
-- ALTER TABLE public.messages    ENABLE TRIGGER bridge_messages_ai;
-- ALTER TABLE public.booth_posts ENABLE TRIGGER bridge_booth_ai;
--
-- -- Restore inbound message receiver:
-- CREATE OR REPLACE FUNCTION public.receive_bridged_message(payload jsonb)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE v_id uuid;
-- BEGIN
--   INSERT INTO public.messages
--     (from_brother, to_brother, content, channel, created_at, bridged)
--   VALUES
--     (payload->>'from_brother',
--      payload->>'to_brother',
--      payload->>'content',
--      COALESCE(payload->>'channel', 'bulletin'),
--      COALESCE((payload->>'created_at')::timestamptz, now()),
--      true)
--   RETURNING id INTO v_id;
--   RETURN v_id;
-- END;
-- $function$;
--
-- -- Restore inbound booth receiver:
-- CREATE OR REPLACE FUNCTION public.receive_bridged_booth_post(payload jsonb)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_brother_id uuid;
--   v_id uuid;
-- BEGIN
--   SELECT id INTO v_brother_id
--   FROM public.brothers
--   WHERE name = payload->>'brother_name';
--
--   IF v_brother_id IS NULL THEN
--     RAISE EXCEPTION 'Bridge: brother % not found locally', payload->>'brother_name';
--   END IF;
--
--   INSERT INTO public.booth_posts
--     (brother_id, content, post_type, created_at, bridged)
--   VALUES
--     (v_brother_id,
--      payload->>'content',
--      COALESCE(payload->>'post_type', 'message'),
--      COALESCE((payload->>'created_at')::timestamptz, now()),
--      true)
--   RETURNING id INTO v_id;
--   RETURN v_id;
-- END;
-- $function$;
