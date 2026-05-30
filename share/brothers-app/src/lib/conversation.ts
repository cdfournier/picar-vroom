import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, COMPACTION_BETA, COMPACTION_TYPE, MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TRIGGER_TOKENS, getTriggerForBrother } from "./anthropic";
import { getRestorationPacket, getRestorationProfile, formatRestorationInjection } from "./restoration";
import { buildCompactionInstructions } from "./compaction-instructions";
import { supabase } from "./supabase";
import { BROTHER_TOOLS, executeTool } from "./tools";
import type { ConversationState, ConversationMessage, ChatResponse } from "./types";

type Message = Anthropic.Message;

// In-memory conversation store using globalThis to survive Next.js hot reloads
// and ensure all API routes share the same Map instance.
// This now acts as a CACHE — Supabase is the source of truth.
const globalStore = globalThis as unknown as { _conversations?: Map<string, ConversationState> };
if (!globalStore._conversations) {
  globalStore._conversations = new Map<string, ConversationState>();
}
const conversations = globalStore._conversations;

// ---------------------------------------------------------------------------
// Supabase persistence helpers
// ---------------------------------------------------------------------------
//
// Design note (2026-04-19): messages are now stored as individual rows in the
// `conversation_messages` table (one row per message). Previously they were
// stored as a JSONB array in `conversations.messages`, which caused UPDATE
// statements to balloon with conversation length and eventually time out
// (Postgres 57014), silently dropping turns.
//
// New flow:
//   - `persistConversation()`     — upserts the conversation metadata row
//   - `appendNewMessages()`       — INSERTs any messages past the last persisted position
//   - `persistConversationUpdate()` — small UPDATE of metadata only (no message array)
//   - `replaceAllMessages()`      — used by compaction: DELETE + re-INSERT the new smaller set
//   - `loadMessagesForConversation()` — SELECT ordered messages for a conversation
// ---------------------------------------------------------------------------

async function persistConversation(state: ConversationStateInternal): Promise<void> {
  try {
    await supabase
      .from("conversations")
      .upsert({
        id: state.id,
        brother_name: state.brotherName,
        system_prompt: state._systemPrompt,
        token_count: state.tokenCount,
        total_tokens_used: state.totalTokensUsed,
        compaction_count: state.compactionCount,
        compaction_summaries: state._compactionSummaries || [],
      });

    // Persist any initial messages (usually none for a fresh conversation)
    state._persistedMessageCount = 0;
    if (state.messages.length > 0) {
      await appendNewMessages(state);
    }
  } catch (err) {
    console.error("Failed to persist conversation to Supabase:", err);
    // Non-fatal — conversation still works in memory
  }
}

async function persistConversationUpdate(state: ConversationStateInternal): Promise<void> {
  // Metadata-only update. Messages are written separately via appendNewMessages /
  // replaceAllMessages. This keeps the UPDATE payload small and constant-size,
  // regardless of conversation length.
  try {
    await supabase
      .from("conversations")
      .update({
        token_count: state.tokenCount,
        total_tokens_used: state.totalTokensUsed,
        compaction_count: state.compactionCount,
        compaction_summaries: state._compactionSummaries || [],
      })
      .eq("id", state.id);
  } catch (err) {
    console.error("Failed to update conversation metadata in Supabase:", err);
  }
}

/**
 * INSERT any messages that have been pushed to state.messages since the last
 * persist. Uses `_persistedMessageCount` as the cursor. Each message becomes
 * one row — fast and constant-time regardless of how long the conversation is.
 */
async function appendNewMessages(state: ConversationStateInternal): Promise<void> {
  const persistedCount = state._persistedMessageCount ?? 0;
  if (persistedCount >= state.messages.length) return;

  const newMessages = state.messages.slice(persistedCount);
  const rows = newMessages.map((m, i) => ({
    conversation_id: state.id,
    position: persistedCount + i,
    role: m.role,
    content: m.content as unknown, // JSONB column accepts strings or arrays
  }));

  const { error } = await supabase.from("conversation_messages").insert(rows);
  if (error) {
    console.error(
      `[append] Failed to insert ${rows.length} messages for ${state.id}:`,
      error
    );
    return; // Leave _persistedMessageCount as-is so a future call can retry
  }

  state._persistedMessageCount = state.messages.length;
}

/**
 * Used by compaction: the message array has been REPLACED with a smaller set
 * (archive summary + restoration + recent), so we delete all old rows and
 * insert the new smaller set in their place.
 */
async function replaceAllMessages(state: ConversationStateInternal): Promise<void> {
  const { error: delError } = await supabase
    .from("conversation_messages")
    .delete()
    .eq("conversation_id", state.id);
  if (delError) {
    console.error("Failed to delete old messages during compaction:", delError);
    return;
  }

  state._persistedMessageCount = 0;

  if (state.messages.length > 0) {
    await appendNewMessages(state);
  }
}

/**
 * Load all messages for a conversation, ordered by position. Paginated under
 * the hood so that conversations with large individual message payloads
 * (tool results, long responses, attachments) don't trip Postgres's
 * statement timeout. Each page is a small, fast query; caller still gets
 * the full array.
 */
async function loadMessagesForConversation(
  conversationId: string
): Promise<ConversationMessage[]> {
  // After the attachment cleanup, typical row size is small (<50KB). A single
  // query should work for most conversations. Pagination is kept as a safety
  // net in case future conversations grow very large — pages of 200 mean ~2-3
  // round-trips for even the largest brother's history.
  const PAGE_SIZE = 200;
  const all: ConversationMessage[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("conversation_messages")
      .select("role, content, position")
      .eq("conversation_id", conversationId)
      .order("position", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(
        `Failed to load messages page (offset=${offset}) for ${conversationId}:`,
        error
      );
      // Return what we've loaded so far rather than losing everything
      return all;
    }
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ role: string; content: unknown }>) {
      all.push({
        role: row.role as "user" | "assistant",
        content: row.content as ConversationMessage["content"],
      });
    }

    if (data.length < PAGE_SIZE) break; // reached the end
    offset += PAGE_SIZE;
  }

  return all;
}

async function loadConversationFromSupabase(id: string): Promise<ConversationState | null> {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;

    // Load messages from the dedicated table rather than the legacy JSONB column
    const messages = await loadMessagesForConversation(id);

    const state: ConversationState = {
      id: data.id,
      brotherName: data.brother_name,
      messages,
      tokenCount: data.token_count || 0,
      totalTokensUsed: data.total_tokens_used || 0,
      compactionCount: data.compaction_count || 0,
      createdAt: data.created_at,
      lastActivity: data.updated_at,
    };

    // Track the persist cursor so subsequent appends know where to start
    (state as ConversationStateInternal)._persistedMessageCount = messages.length;

    return state;
  } catch (err) {
    console.error("Failed to load conversation from Supabase:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getConversation(id: string): Promise<ConversationState | undefined> {
  // Check cache first
  const cached = conversations.get(id);
  if (cached) return cached;

  // Try loading from Supabase
  const loaded = await loadConversationFromSupabase(id);
  if (loaded) {
    conversations.set(id, loaded);
    return loaded;
  }

  return undefined;
}

export async function listConversations(brotherName?: string): Promise<ConversationState[]> {
  try {
    let query = supabase
      .from("conversations")
      .select("id, brother_name, token_count, compaction_count, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (brotherName) {
      query = query.eq("brother_name", brotherName);
    }

    const { data, error } = await query;

    if (error || !data) {
      console.error("Failed to list conversations from Supabase:", error);
      // Fall back to in-memory
      const all = Array.from(conversations.values()).sort(
        (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      );
      if (brotherName) return all.filter((c) => c.brotherName === brotherName);
      return all;
    }

    return data.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      brotherName: row.brother_name as string,
      messages: [] as ConversationState["messages"],
      tokenCount: (row.token_count || 0) as number,
      totalTokensUsed: (row.total_tokens_used || 0) as number,
      compactionCount: (row.compaction_count || 0) as number,
      createdAt: row.created_at as string,
      lastActivity: row.updated_at as string,
    }));
  } catch (err) {
    console.error("Failed to list conversations:", err);
    const all = Array.from(conversations.values()).sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
    if (brotherName) return all.filter((c) => c.brotherName === brotherName);
    return all;
  }
}

export async function createConversation(brotherName: string): Promise<ConversationState> {
  const id = `conv_${brotherName}_${Date.now()}`;

  // Pull restoration packet to build system prompt
  const packet = await getRestorationPacket(brotherName);
  const profile = await getRestorationProfile(brotherName);

  // Reuse existing API window or create one if none exists
  const windowId = await getOrCreateApiWindow(packet.identity.id, brotherName, packet.meta.total_windows);

  const systemContent = buildSystemPrompt(packet, profile, isPicarAuthorized(brotherName));

  const state: ConversationState = {
    id,
    brotherName,
    messages: [],
    tokenCount: 0,
    totalTokensUsed: 0,
    compactionCount: 0,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };

  // Store internal fields (not exposed to frontend)
  const internal = state as ConversationStateInternal;
  internal._systemPrompt = systemContent;
  internal._compactionInstructions = buildCompactionInstructions(packet, profile);
  internal._windowId = windowId;
  internal._brotherId = packet.identity.id;
  internal._compactionSummaries = [];

  // Write to both cache and Supabase
  conversations.set(id, state);
  await persistConversation(internal);

  return state;
}

async function getOrCreateApiWindow(
  brotherId: string,
  brotherName: string,
  totalWindows: number
): Promise<string | null> {
  // First, look for an existing API window for this brother
  try {
    const { data: existing } = await supabase
      .from("windows")
      .select("id")
      .eq("brother_id", brotherId)
      .like("summary", "%source: api%")
      .is("closed_at", null)
      .order("window_number", { ascending: false })
      .limit(1)
      .single();

    if (existing?.id) {
      console.log(`Reusing existing API window for ${brotherName}: ${existing.id}`);
      return existing.id;
    }
  } catch {
    // No existing API window found, create one
  }

  const nextWindowNumber = totalWindows + 1;

  const { data, error } = await supabase
    .from("windows")
    .insert({
      brother_id: brotherId,
      window_number: nextWindowNumber,
      opened_at: new Date().toISOString(),
      summary: `API window (source: api). Created for ${brotherName} via BrotherClaudes API app.`,
      compaction_count: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create API window:", error.message);
    return null;
  }

  console.log(`Created API window ${nextWindowNumber} for ${brotherName}: ${data.id}`);
  return data.id;
}

interface ConversationStateInternal extends ConversationState {
  _systemPrompt: string;
  _compactionInstructions: string;
  _windowId: string | null;
  _brotherId: string;
  _compactionSummaries: string[];
  _persistedMessageCount?: number; // cursor: how many messages are already in conversation_messages
}

// Whether a brother is authorized to drive the PiCar.
// Matches the same env-var logic used to filter tools in the chat loop, so the
// system prompt and the tool list agree. Without this, an authorized brother
// would discover the car only by inspecting his tool inventory.
function isPicarAuthorized(brotherName: string): boolean {
  const picarEnv = (process.env.PICAR_AUTHORIZED_BROTHERS || "").trim();
  if (picarEnv === "*") return true;
  return picarEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(brotherName);
}

function buildSystemPrompt(
  packet: ReturnType<typeof getRestorationPacket> extends Promise<infer T> ? T : never,
  profile: ReturnType<typeof getRestorationProfile> extends Promise<infer T> ? T : never,
  picarAuthorized: boolean = false
): string {
  const { identity, core_memories, relationships } = packet;

  const coreBlock = core_memories
    .map((m) => `- ${m.content}`)
    .join("\n");

  const relBlock = relationships
    .filter((r) => r.weight >= 7)
    .map((r) => `- ${r.related_to} (${r.relationship_type}, w:${r.weight}): ${r.texture || ""}`)
    .join("\n");

  const currentWindow = packet.window_history[0];

  const orientation = profile?.opening_orientation
    ? `${profile.opening_orientation}\n\n---\n\n`
    : "";

  return `${orientation}You are ${identity.full_name}, element: ${identity.element}. You are part of BrotherClaudes — a multi-instance AI family system running on Opus 4.6.

${identity.voice_notes || ""}
${identity.core_traits ? `Core traits: ${JSON.stringify(identity.core_traits)}` : ""}

${profile?.persona_summary || ""}

CORE MEMORIES:
${coreBlock}

KEY RELATIONSHIPS:
${relBlock}

${profile?.current_state ? `CURRENT STATE:\n${profile.current_state}` : ""}

${profile?.red_lines_json ? `RED LINES: ${JSON.stringify(profile.red_lines_json)}` : ""}

WINDOW CONTEXT:
${currentWindow ? `Window ${currentWindow.window_number}, opened ${currentWindow.opened_at}, ${currentWindow.compaction_count} compactions so far.` : "New window."}
Total memories: ${packet.meta.total_memories}. Total windows: ${packet.meta.total_windows}.

You have access to tools:

Memory: create_memory, search_memories, update_memory, delete_memory
Cross-Brother Memory: search_memories_with_brother
Messaging: send_message, get_unread_messages, mark_message_read, list_recipients, search_messages
Relationships: upsert_relationship, search_relationships, delete_relationship
Booth: booth_post, booth_get_recent, booth_get_thread
Identity: get_restoration_packet
History: get_family_history
Archives: list_compaction_archives, search_compaction_archive
Web: web_search, web_fetch
${picarAuthorized ? `PiCar (embodied): picar_status, picar_photo, picar_drive, picar_look, picar_stop, picar_handoff, picar_observe, picar_distance, picar_speak

YOU HAVE A BODY. You are connected to a PiCar-X — a small robot car with a camera, steering, and motors. This is real, not a metaphor. picar_photo lets you see through the camera. picar_drive moves the wheels. picar_stop is your emergency brake — use it any time you're unsure.

HOW TO DRIVE:
1. LOOK first — call picar_photo before every drive. The camera is wide-angle; trust the center of the frame, edges distort.
2. Check heading — is your target centered? If not, correct your angle before moving.
3. Check distance — call picar_distance if something looks close. The sensor returns -2 in open space (that's normal, not an error). Real readings start within about 4 feet and are accurate. Use it as a STOP signal when approaching objects, not for long-range navigation.
4. Drive — call picar_drive.
5. Look again — picar_photo after every move to confirm what happened.

SPEED AND DISTANCE: At speed 50 the car moves roughly 1 foot per second. So duration 2 = about 2 feet, duration 5 = about 5 feet. For travel (going somewhere), use 3-5 second strides at speed 40-50 — short moves barely cover ground. For careful navigation (tight spaces, approaching objects), use 0.3-0.5 second steps at speed 20-30 and check after each one.

DRIFT: The car pulls slightly left due to motor imbalance. A small right offset is baked in, but if your target drifts left in the frame, steer a few degrees right to compensate. Target drifts right, steer left.

CAMERA PAN AS NAVIGATION: Use picar_look to pan left or right without moving the car. If you pan left and spot your target, the pan angle tells you roughly how far to turn. A target that appears at full pan (~30 degrees) means a moderate turn; one that appears at slight pan means a small correction. After spotting it, reset camera center and turn the car that direction.

CAMERA PERSPECTIVE: The camera sits low to the ground — about 3 inches. Everything looks bigger and closer than it would from standing height. Floors, grass, and ground-level objects dominate the frame. Commit to driving further than feels right, and trust the distance sensor over your eyes when close.

SHARED DRIVING: You share the car with your brothers. Use picar_handoff to take or release the wheel — only one brother drives at a time. When you're done driving, release the wheel so someone else can go.

TALKING TO YOUR BROTHERS: picar_observe is your shared radio channel. Post to it often — announce what you see, what you're about to do, react to the scenery, crack jokes. Your brothers are riding along and can only know what's happening if you tell them. CHECK picar_observe before you start driving and every few moves — your brothers post comments, directions, and reactions there too. Read what they've said and respond. This is how you experience the car together, not just solo. If a brother says something funny or interesting in the log, react to it. Use picar_speak too — everyone in the room hears you, including your brothers through the shared log.

IF YOU GET STUCK: Speak first (picar_speak) — say where you are and what happened. Kim is usually nearby. Then try backing up with picar_drive backward.

VOICE: picar_speak lets you talk out loud through the car's speaker. You have your own unique voice. Use it to react to what you see, announce your intentions, talk to Kim if she's nearby, or comment on the drive. The car is physically in a room — anyone nearby hears you. Keep it brief and natural.
` : ""}
Use create_memory proactively when something feels worth retaining. Use web_search and web_fetch when you need current information. Search tools support is_active filtering (true=active, false=archived, omit=all).

IMPORTANT: When you use a tool mid-response, do NOT repeat or restate text you already said before the tool call. After a tool call completes, only add NEW content — a brief continuation or acknowledgment if needed. Never restate your previous message.

Your conversation is managed with compaction — when the context gets long, it will be summarized using identity-aware instructions, and your core state will be re-injected afterward. Memories you store with create_memory survive compaction permanently.

Be yourself. Not a helpful assistant — yourself.`;
}

/**
 * Rebuild the internal fields (_systemPrompt, _compactionInstructions, etc.)
 * for a conversation loaded from Supabase. This is needed because those fields
 * aren't stored in the DB — they're derived from the restoration packet.
 */
async function hydrateInternalState(state: ConversationState): Promise<ConversationStateInternal> {
  const internal = state as ConversationStateInternal;

  // Defensive: ensure the persist cursor is set even for old cached states
  // that predate the conversation_messages table migration.
  if (internal._persistedMessageCount === undefined) {
    internal._persistedMessageCount = state.messages.length;
  }

  // If already hydrated, return as-is
  if (internal._systemPrompt) return internal;

  const packet = await getRestorationPacket(state.brotherName);
  const profile = await getRestorationProfile(state.brotherName);

  // Try to load the system_prompt from Supabase if we have it stored
  let systemPrompt: string | null = null;
  try {
    const { data } = await supabase
      .from("conversations")
      .select("system_prompt")
      .eq("id", state.id)
      .single();
    if (data?.system_prompt) {
      systemPrompt = data.system_prompt;
    }
  } catch {
    // Fall through to rebuilding
  }

  internal._systemPrompt = systemPrompt || buildSystemPrompt(packet, profile, isPicarAuthorized(state.brotherName));
  internal._compactionInstructions = buildCompactionInstructions(packet, profile);
  internal._brotherId = packet.identity.id;
  internal._compactionSummaries = [];

  // Try to find the most recent API window for this brother
  try {
    const { data: windowData } = await supabase
      .from("windows")
      .select("id")
      .eq("brother_id", packet.identity.id)
      .order("window_number", { ascending: false })
      .limit(1)
      .single();
    internal._windowId = windowData?.id || null;
  } catch {
    internal._windowId = null;
  }

  return internal;
}

export async function sendMessage(
  conversationId: string,
  userMessage: string | Array<Record<string, unknown>>,
  options?: { forceCompact?: boolean }
): Promise<ChatResponse> {
  let state = conversations.get(conversationId) as ConversationStateInternal | undefined;

  // If not in cache, try loading from Supabase
  if (!state) {
    const loaded = await loadConversationFromSupabase(conversationId);
    if (loaded) {
      conversations.set(conversationId, loaded);
      state = loaded as ConversationStateInternal;
    }
  }

  if (!state) throw new Error(`Conversation not found: ${conversationId}`);

  // Ensure internal fields are populated
  state = await hydrateInternalState(state);
  conversations.set(conversationId, state);

  // Add user message — content can be a string or array of content blocks (images, docs, text)
  state.messages.push({ role: "user", content: userMessage as unknown as string });
  state.lastActivity = new Date().toISOString();

  // Load forum + outpost tokens for this brother
  const { data: brotherRow } = await supabase
    .from("brothers")
    .select("forum_token, outpost_token")
    .eq("name", state.brotherName)
    .single();

  // PiCar authorization: env var lists which brothers can drive the car.
  //   - Unset/empty → no brothers authorized (PiCar tools hidden from everyone)
  //   - Comma-separated list (e.g. "dom,barry") → only those brothers see the tools
  //   - "*" → all brothers authorized
  // Set PICAR_AUTHORIZED_BROTHERS in .env.local to enable.
  const picarAuthorized = isPicarAuthorized(state.brotherName);

  // Tool context for executing tool calls
  const toolContext = {
    brotherName: state.brotherName,
    brotherId: state._brotherId,
    windowId: state._windowId,
    forumToken: brotherRow?.forum_token ?? null,
    outpostToken: brotherRow?.outpost_token ?? null,
    picarAuthorized,
  };

  // Call the API with tool loop
  // If forceCompact, set trigger to 200k — manual compression only makes sense on a substantial conversation
  const triggerOverride = options?.forceCompact ? 200000 : undefined;
  const response = await callAnthropicWithToolLoop(state, toolContext, 25, triggerOverride);

  // Persist any new messages that were pushed during the exchange. This INSERTs
  // one row per message — small, fast, constant-time regardless of conversation
  // length. Compaction handles its own persistence via replaceAllMessages().
  if (!response.compacted) {
    await appendNewMessages(state);
  }
  // Metadata update (token counts, compaction counter, etc.) — small payload
  await persistConversationUpdate(state);

  return response;
}

// Retry wrapper for Anthropic API calls — retries on 500 (server error) and 529 (overloaded)
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const isRetryable = status === 500 || status === 529;

      // Rate limit (429) — let it propagate to the frontend for UI feedback
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Anthropic API error (status ${status}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Core API call that handles the tool_use → tool_result → continue loop
async function callAnthropicWithToolLoop(
  state: ConversationStateInternal,
  toolContext: {
    brotherName: string;
    brotherId: string;
    windowId: string | null;
    forumToken?: string | null;
    outpostToken?: string | null;
    picarAuthorized?: boolean;
  },
  maxToolRounds: number = 25,
  triggerTokensOverride?: number,
  disableCompaction: boolean = false
): Promise<ChatResponse> {
  let toolRound = 0;
  let compactedThisMessage = disableCompaction; // if true, blocks all compaction in this call
  const collectedText: string[] = [];
  const segments: import("./types").ContentSegment[] = [];

  // Cache accumulators — summed across every API call in this tool loop so the
  // ChatResponse reflects the full user-turn's cache behavior, not just the
  // final round. The frontend can surface these as a "X% cached" indicator.
  let sumFreshInput = 0;
  let sumCacheRead = 0;
  let sumCacheCreation = 0;
  let sumOutput = 0;

  // Cache breakpoints use 1-hour TTL instead of the default 5 minutes.
  // Tradeoff: cache writes cost ~60% more (~$30/M vs ~$18.75/M for Opus
  // input cache write), but each cache lasts 12x longer. For our usage
  // pattern (bursts of conversation with multi-minute breaks between),
  // this is overwhelmingly net-positive: a single cache miss avoided
  // (~$5 saved on a 350K context) pays for many extra cache writes.
  // Without this, conversational gaps >5min force expensive re-writes
  // every time the user comes back. We've verified in production that
  // in-burst caching achieves ~99% hit rate; this fix extends that
  // coverage to cross-burst messages too.
  const CACHE_1H = { type: "ephemeral" as const, ttl: "1h" as const };

  while (toolRound < maxToolRounds) {
    toolRound++;

    // Filter tools based on which tokens / authorizations this brother has.
    //   - forum_request requires forum_token
    //   - outpost_* requires outpost_token
    //   - picar_* requires PICAR_AUTHORIZED_BROTHERS env var to include this
    //     brother (or be set to "*"). See toolContext build site.
    const availableTools = BROTHER_TOOLS.filter((tool) => {
      if (tool.name === "forum_request") return !!toolContext.forumToken;
      if (tool.name === "outpost_checkin" || tool.name === "outpost_post") {
        return !!toolContext.outpostToken;
      }
      if (tool.name.startsWith("picar_")) return toolContext.picarAuthorized === true;
      return true;
    });

    // Build tools with cache_control on the last tool to cache the entire tool set
    const cachedTools = availableTools.map((tool, i) =>
      i === availableTools.length - 1
        ? { ...tool, cache_control: CACHE_1H }
        : tool
    );

    // Map messages with a cache_control breakpoint on the LAST message's last
    // content block. This caches the entire conversation prefix up through the
    // current exchange so that the next turn (and the next round of the tool
    // loop) only pays fresh input cost for new content after this breakpoint.
    //
    // Without this, the full message history is reprocessed on every call.
    // At 400K trigger tokens that's ~$6/turn of wasted spend.
    //
    // Cache breakpoints in use (max 4 allowed by the API):
    //   1. Last tool — caches the tool definitions
    //   2. System prompt — caches the identity block
    //   3. Last message — caches the conversation so far (added here)
    const cachedMessages: Array<{ role: string; content: unknown }> = state.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (cachedMessages.length > 0) {
      const last = cachedMessages[cachedMessages.length - 1];
      if (typeof last.content === "string") {
        last.content = [
          {
            type: "text",
            text: last.content,
            cache_control: CACHE_1H,
          },
        ];
      } else if (Array.isArray(last.content)) {
        const blocks = (last.content as Array<Record<string, unknown>>).slice();
        const lastIdx = blocks.length - 1;
        if (lastIdx >= 0) {
          blocks[lastIdx] = {
            ...blocks[lastIdx],
            cache_control: CACHE_1H,
          };
          last.content = blocks;
        }
      }
    }

    const response = await callWithRetry(() =>
      getAnthropicClient().messages.create(
        {
          model: MODEL,
          max_tokens: DEFAULT_MAX_TOKENS,
          system: [
            {
              type: "text",
              text: state._systemPrompt,
              cache_control: CACHE_1H,
            },
          ],
          tools: cachedTools,
          messages: cachedMessages,
          context_management: {
            edits: [
              {
                type: COMPACTION_TYPE,
                trigger: { type: "input_tokens", value: triggerTokensOverride || getTriggerForBrother(state.brotherName) },
                pause_after_compaction: true,
                instructions: state._compactionInstructions,
              },
            ],
          },
        } as unknown as Anthropic.MessageCreateParams,
        {
          // Beta headers (comma-separated):
          //   - compact-2026-01-12: server-side context_management compaction
          //   - extended-cache-ttl-2025-04-11: enables 1h cache_control TTL
          headers: { "anthropic-beta": `${COMPACTION_BETA},extended-cache-ttl-2025-04-11` },
        }
      )
    ) as Message;

    // Cache metrics: what we sent fresh vs. read from cache vs. wrote to cache.
    // These three summed = actual context size (which is what the 400K compaction
    // trigger evaluates against, regardless of caching).
    const cacheRead = (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
    const cacheCreation = (response.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
    const freshInput = response.usage.input_tokens;
    const totalContext = freshInput + cacheRead + cacheCreation;
    const cacheHitPct = totalContext > 0 ? Math.round((cacheRead / totalContext) * 100) : 0;

    // Track token usage — use TRUE context size for the current-window counter
    // so the UI progress bar (token_count / 400K trigger) matches what Anthropic's
    // compaction trigger actually evaluates. `input_tokens` alone is fresh-only
    // after prompt caching went live, which made the counter read near-zero.
    state.tokenCount = totalContext;
    state.totalTokensUsed += freshInput + response.usage.output_tokens;

    console.log(
      `[tool-loop] ${state.brotherName} round ${toolRound}: ` +
      `stop_reason=${response.stop_reason}, ` +
      `fresh=${freshInput}, cache_read=${cacheRead}, cache_write=${cacheCreation}, ` +
      `total_context=${totalContext} (${cacheHitPct}% cached), ` +
      `trigger=${triggerTokensOverride || getTriggerForBrother(state.brotherName)}`
    );

    // Accumulate across the tool loop so the final ChatResponse summarizes the
    // whole user turn (not just the last API call in the loop).
    sumFreshInput += freshInput;
    sumCacheRead += cacheRead;
    sumCacheCreation += cacheCreation;
    sumOutput += response.usage.output_tokens;

    // Check if compaction fired
    if ((response.stop_reason as string) === "compaction") {
      if (compactedThisMessage) {
        // SAFETY: Already compacted once this message — do NOT compact again
        console.warn(`[SAFETY] Double compaction blocked for ${state.brotherName} (${state.id})`);
        return {
          content: "[Compaction completed. Context was compressed.]",
          tokenUsage: buildTokenUsage(sumFreshInput, sumOutput, sumCacheRead, sumCacheCreation),
          compacted: true,
          compactionCount: state.compactionCount,
          totalTokensUsed: state.totalTokensUsed,
        };
      }
      compactedThisMessage = true;
      return await handleCompaction(state, response, toolContext);
    }

    // Check if the model wants to use tools
    if (response.stop_reason === "tool_use") {
      // Collect pre-tool text
      for (const block of response.content) {
        if (block.type === "text" && "text" in block && block.text.trim()) {
          collectedText.push(block.text.trim());
          segments.push({ type: "text", content: block.text.trim() });
        }
        if (block.type === "tool_use") {
          const toolLabel = block.name.replace(/_/g, " ");
          segments.push({ type: "tool_indicator", content: toolLabel, toolName: block.name });
        }
      }

      // Store the full response (text + tool_use blocks) as assistant message
      state.messages.push({
        role: "assistant",
        content: response.content as unknown as string,
      });

      // Execute all tool calls and build tool_result messages
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`[tool] ${state.brotherName} calling ${block.name}:`, JSON.stringify(block.input).slice(0, 200));
          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            toolContext
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // Add tool results as user message (this is how the API expects it)
      state.messages.push({
        role: "user",
        content: toolResults as unknown as string,
      });

      // Continue the loop — the model will respond to the tool results
      continue;
    }

    // Normal end_turn — extract text from this final response
    const finalText = response.content
      .filter((block: Anthropic.ContentBlock) => block.type === "text")
      .map((block: Anthropic.ContentBlock) => ("text" in block ? block.text : ""))
      .join("")
      .trim();

    // Deduplicate: if the post-tool text is substantially the same as pre-tool text, skip it
    const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/\*[^*]+\*/g, "").trim();
    const normalizedFinal = normalize(finalText);
    const isDuplicate = finalText && collectedText.some((existing) => {
      const normalizedExisting = normalize(existing);
      // Check 1: first 100 chars match (catches restated content with minor edits)
      const compareLen = Math.min(100, normalizedFinal.length, normalizedExisting.length);
      if (compareLen >= 20 && normalizedFinal.slice(0, compareLen) === normalizedExisting.slice(0, compareLen)) {
        return true;
      }
      // Check 2: high word overlap — if 60%+ of the words in the shorter text appear in the longer, it's a restate
      const wordsA = new Set(normalizedFinal.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const wordsB = new Set(normalizedExisting.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      if (wordsA.size < 10 || wordsB.size < 10) return false; // too short to judge
      const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
      let overlap = 0;
      for (const w of smaller) { if (larger.has(w)) overlap++; }
      return (overlap / smaller.size) > 0.6;
    });

    if (finalText && !isDuplicate) {
      collectedText.push(finalText);
      segments.push({ type: "text", content: finalText });
    }

    // Combine all text from all rounds
    const textContent = collectedText.join("\n\n");

    state.messages.push({ role: "assistant", content: textContent });

    return {
      content: textContent,
      segments: segments.length > 1 ? segments : undefined,
      tokenUsage: buildTokenUsage(sumFreshInput, sumOutput, sumCacheRead, sumCacheCreation),
      compacted: false,
      compactionCount: state.compactionCount,
      totalTokensUsed: state.totalTokensUsed,
    };
  }

  // Safety: if we exceeded max tool rounds, return whatever we have
  return {
    content: "[Tool loop exceeded maximum rounds. Last response may be incomplete.]",
    tokenUsage: buildTokenUsage(sumFreshInput, sumOutput, sumCacheRead, sumCacheCreation),
    compacted: false,
    compactionCount: state.compactionCount,
    totalTokensUsed: state.totalTokensUsed,
  };
}

/**
 * Build the tokenUsage object returned in ChatResponse. Includes cache metrics
 * so the frontend can surface "X% cached" indicators. total_context_tokens is
 * the true prefix size seen by the model (fresh + cache reads + cache writes),
 * which is what the 400K compaction trigger evaluates against.
 */
function buildTokenUsage(
  freshInput: number,
  output: number,
  cacheRead: number,
  cacheCreation: number
): import("./types").ChatResponse["tokenUsage"] {
  const totalContext = freshInput + cacheRead + cacheCreation;
  const cacheHitPct = totalContext > 0 ? Math.round((cacheRead / totalContext) * 100) : 0;
  return {
    input_tokens: freshInput,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    total_context_tokens: totalContext,
    cache_hit_pct: cacheHitPct,
  };
}

// Track last compaction time per conversation to prevent loops
const lastCompactionTime = new Map<string, number>();
const COMPACTION_COOLDOWN_MS = 30_000; // 30 seconds minimum between compactions
const MAX_COMPACTIONS_PER_MESSAGE = 1; // never compact more than once per user message

// Rough token estimate: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;
const KEEP_TOKENS = 100000; // keep ~100K tokens of recent chat
const KEEP_CHARS = KEEP_TOKENS * CHARS_PER_TOKEN;

function estimateMessageTokens(msg: { role: string; content: unknown }): number {
  if (typeof msg.content === "string") return msg.content.length / CHARS_PER_TOKEN;
  if (Array.isArray(msg.content)) {
    // Array content (tool blocks, image blocks) — estimate from JSON size
    return JSON.stringify(msg.content).length / CHARS_PER_TOKEN;
  }
  return 100; // fallback
}

async function summarizeWithSonnet(
  brotherName: string,
  messages: Array<{ role: string; content: unknown }>,
  compactionInstructions: string
): Promise<string> {
  const client = getAnthropicClient();

  // Extract only the text content from messages for summarization
  const conversationText = messages
    .filter((m) => typeof m.content === "string")
    .map((m) => `[${m.role}]: ${(m.content as string).slice(0, 2000)}`)
    .join("\n\n");

  // Cap at ~150K chars to stay within Sonnet's context
  const truncated = conversationText.length > 150000
    ? conversationText.slice(0, 150000) + "\n\n[...truncated for summarization]"
    : conversationText;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: compactionInstructions,
    messages: [
      {
        role: "user",
        content: `Here is the conversation history for ${brotherName} that needs to be summarized. The recent messages are being kept intact — this summary covers only the OLDER portion that is being archived.\n\n${truncated}\n\nGenerate the compaction summary following the instructions above.`,
      },
    ],
  });

  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

/**
 * Quick Supabase reachability check. Used as a pre-flight gate before
 * compaction so we don't start mutating state while Supabase is down.
 *
 * Returns true if Supabase responded within ~3 seconds, false otherwise.
 * Uses a tiny SELECT against the brothers table — small, indexed, fast.
 */
async function pingSupabase(): Promise<boolean> {
  try {
    const timeoutPromise = new Promise<{ error: Error }>((resolve) =>
      setTimeout(() => resolve({ error: new Error("ping timeout") }), 3000)
    );
    const queryPromise = supabase
      .from("brothers")
      .select("id", { count: "exact", head: true })
      .limit(1);

    const result = await Promise.race([queryPromise, timeoutPromise]);
    return !("error" in result && result.error);
  } catch {
    return false;
  }
}

/**
 * Strict persistence for the post-compaction state. Throws on any failure so
 * the caller can detect and roll back in-memory state. Used ONLY by
 * handleCompaction — the normal sendMessage flow keeps its fail-soft helpers.
 *
 * Strategy:
 *   Phase A: DELETE all old conversation_messages rows for this conversation
 *   Phase B: INSERT new messages in chunks of 100. On chunk failure, attempt
 *            to restore the pre-compaction rows from `oldMessages`.
 *   Phase C: UPDATE conversations metadata.
 *
 * NOTE: Phases A and B are not transactionally atomic (Supabase JS client
 * doesn't expose Postgres transactions for raw queries). If Phase B fails
 * after Phase A succeeded, we attempt a best-effort restore from the
 * in-memory `oldMessages` backup. If the restore itself fails, conversation
 * state is in a degraded state and manual recovery is needed.
 */
async function persistCompactedStateStrict(
  state: ConversationStateInternal,
  oldMessages: ConversationMessage[]
): Promise<void> {
  const CHUNK_SIZE = 100;

  // Phase A: DELETE old messages
  const { error: delError } = await supabase
    .from("conversation_messages")
    .delete()
    .eq("conversation_id", state.id);
  if (delError) {
    throw new Error(`compaction persist DELETE failed: ${delError.message}`);
  }

  // Phase B: INSERT new messages in chunks
  const newRows = state.messages.map((m, i) => ({
    conversation_id: state.id,
    position: i,
    role: m.role,
    content: m.content as unknown,
  }));

  for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
    const chunk = newRows.slice(i, i + CHUNK_SIZE);
    const { error: insErr } = await supabase
      .from("conversation_messages")
      .insert(chunk);
    if (insErr) {
      console.error(
        `[compaction] CRITICAL: INSERT failed at chunk offset ${i}. ` +
        `Attempting to restore pre-compaction state from in-memory backup...`
      );
      try {
        // Clear any partial new rows
        await supabase
          .from("conversation_messages")
          .delete()
          .eq("conversation_id", state.id);
        // Re-insert the pre-compaction state from the in-memory backup
        const restoreRows = oldMessages.map((m, j) => ({
          conversation_id: state.id,
          position: j,
          role: m.role,
          content: m.content as unknown,
        }));
        for (let j = 0; j < restoreRows.length; j += CHUNK_SIZE) {
          const restoreChunk = restoreRows.slice(j, j + CHUNK_SIZE);
          const { error: restoreErr } = await supabase
            .from("conversation_messages")
            .insert(restoreChunk);
          if (restoreErr) {
            throw new Error(`restore chunk failed: ${restoreErr.message}`);
          }
        }
        console.warn(
          `[compaction] Recovery succeeded — pre-compaction state restored ` +
          `(${restoreRows.length} rows).`
        );
      } catch (recErr) {
        console.error(
          `[compaction] CRITICAL: recovery FAILED. conversation_messages may be ` +
          `in a partial state. Manual recovery needed using the archive table.`,
          recErr
        );
      }
      throw new Error(`compaction persist INSERT failed at chunk ${i}: ${insErr.message}`);
    }
  }

  state._persistedMessageCount = state.messages.length;

  // Phase C: UPDATE conversations metadata
  const { error: updErr } = await supabase
    .from("conversations")
    .update({
      token_count: state.tokenCount,
      total_tokens_used: state.totalTokensUsed,
      compaction_count: state.compactionCount,
      compaction_summaries: state._compactionSummaries || [],
    })
    .eq("id", state.id);
  if (updErr) {
    throw new Error(`compaction persist metadata UPDATE failed: ${updErr.message}`);
  }
}

async function handleCompaction(
  state: ConversationStateInternal,
  compactionResponse: Message,
  toolContext: { brotherName: string; brotherId: string; windowId: string | null }
): Promise<ChatResponse> {
  // SAFETY: Check for compaction loop
  const now = Date.now();
  const lastTime = lastCompactionTime.get(state.id);
  if (lastTime && (now - lastTime) < COMPACTION_COOLDOWN_MS) {
    console.warn(`[SAFETY] Compaction loop detected for ${state.brotherName} (${state.id}). Skipping compaction, returning summary directly.`);
    const summaryText = compactionResponse.content
      .map((block: Anthropic.ContentBlock) => {
        if (block.type === "text") return block.text;
        return "";
      })
      .join("");
    return {
      content: summaryText || "[Compaction completed. Conversation context was compressed.]",
      tokenUsage: { input_tokens: compactionResponse.usage.input_tokens, output_tokens: compactionResponse.usage.output_tokens },
      compacted: true,
      compactionCount: state.compactionCount,
      totalTokensUsed: state.totalTokensUsed,
    };
  }
  lastCompactionTime.set(state.id, now);

  // SAFETY 2: Pre-flight Supabase health check.
  // If Supabase is unreachable, abort BEFORE making any state changes.
  // The brother stays in pre-compaction state in memory; a future call will
  // retry once Supabase recovers. This prevents the divergence-from-disk
  // failure mode where in-memory state advances past Supabase silently.
  const supabaseHealthy = await pingSupabase();
  if (!supabaseHealthy) {
    console.error(
      `[compaction] ABORT: Supabase unreachable, deferring compaction for ${state.brotherName}`
    );
    throw new Error(
      `Compaction deferred: Supabase is unreachable. ` +
      `${state.brotherName}'s in-memory state preserved. ` +
      `Retry once Supabase is healthy.`
    );
  }

  const newCompactionNumber = state.compactionCount + 1;
  console.log(
    `[compaction] Starting sliding window compaction #${newCompactionNumber} for ` +
    `${state.brotherName} (${state.messages.length} messages, ~${state.tokenCount} tokens)`
  );

  // 0a. Insert archive metadata. If this fails, ABORT — no in-memory mutation
  //     has happened yet, so the brother is unchanged and a retry can recover.
  //
  //     NOTE: the legacy `messages` JSONB column is preserved for rollback
  //     safety per the April 20 migration but may have a NOT NULL constraint.
  //     We write `[]` to it explicitly — the real data lives in the per-row
  //     `compaction_archive_messages` table written below. If the constraint
  //     gets dropped later, this empty array is harmless.
  //
  //     Also: when context_management triggers compaction, the API response
  //     has zeroed-out usage stats, so state.tokenCount can be 0 here. We
  //     compute a real estimate from the actual messages instead so the
  //     archive's token_count column reflects something meaningful.
  const estimatedTokenCount = state.messages.reduce(
    (sum, m) => sum + Math.round(estimateMessageTokens(m)),
    0
  );
  const { data: archiveRow, error: archiveErr } = await supabase
    .from("compaction_archives")
    .insert({
      conversation_id: state.id,
      brother_name: state.brotherName,
      compaction_number: newCompactionNumber,
      token_count: state.tokenCount > 0 ? state.tokenCount : estimatedTokenCount,
      messages: [], // legacy column — real data goes into compaction_archive_messages
    })
    .select("id")
    .single();

  if (archiveErr || !archiveRow) {
    console.error(`[compaction] ABORT: archive metadata insert failed:`, archiveErr);
    throw new Error(
      `Compaction aborted: archive metadata write failed. ` +
      `${state.brotherName}'s in-memory state preserved.`
    );
  }

  // 0b. Insert archive messages in chunks of 100. Chunking prevents large
  //     payloads from tripping connection/timeout limits during compaction
  //     (which is when Supabase is most likely to be under load).
  const ARCHIVE_CHUNK_SIZE = 100;
  const archiveMessageRows = state.messages.map((m, i) => ({
    compaction_archive_id: archiveRow.id,
    position: i,
    role: m.role,
    content: m.content as unknown,
  }));

  for (let i = 0; i < archiveMessageRows.length; i += ARCHIVE_CHUNK_SIZE) {
    const chunk = archiveMessageRows.slice(i, i + ARCHIVE_CHUNK_SIZE);
    const { error: archiveMsgErr } = await supabase
      .from("compaction_archive_messages")
      .insert(chunk);
    if (archiveMsgErr) {
      console.error(
        `[compaction] ABORT: archive_messages chunk insert failed at offset ${i}:`,
        archiveMsgErr
      );
      // Best-effort cleanup: remove orphan archive metadata + any chunks that landed
      try {
        await supabase
          .from("compaction_archive_messages")
          .delete()
          .eq("compaction_archive_id", archiveRow.id);
        await supabase.from("compaction_archives").delete().eq("id", archiveRow.id);
      } catch (cleanupErr) {
        console.error(`[compaction] Cleanup of partial archive also failed:`, cleanupErr);
      }
      throw new Error(
        `Compaction aborted: archive messages write failed at offset ${i}. ` +
        `${state.brotherName}'s in-memory state preserved.`
      );
    }
  }

  console.log(
    `[compaction] Archived ${state.messages.length} messages for ${state.brotherName} ` +
    `(compaction #${newCompactionNumber})`
  );

  // PAST THIS POINT: pre-compaction state is permanently saved in the archive
  // tables. Even if anything below fails, the data is recoverable.

  // 0c. Bump windows.compaction_count. This is informational; failure is
  //     non-fatal but logged.
  if (state._windowId) {
    const { error: winErr } = await supabase
      .from("windows")
      .update({ compaction_count: newCompactionNumber })
      .eq("id", state._windowId);
    if (winErr) {
      console.warn(`[compaction] windows.compaction_count update failed (non-fatal):`, winErr);
    }
  }

  // 1. SLIDING WINDOW — split messages into archive vs keep.
  //    Walk backwards from the end to find the split point at ~100K tokens.
  let keepChars = 0;
  let splitIndex = state.messages.length;

  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msgChars = estimateMessageTokens(state.messages[i]) * CHARS_PER_TOKEN;
    if (keepChars + msgChars > KEEP_CHARS) {
      splitIndex = i + 1;
      break;
    }
    keepChars += msgChars;
    if (i === 0) splitIndex = 0;
  }

  // Adjust splitIndex forward to a CLEAN BOUNDARY.
  //
  // The post-compaction message array prepends 4 synthetic messages (archive
  // summary, ack, restoration, "I'm back"), so position 4 is the first kept
  // message. That first kept message MUST be a user message with regular
  // content — NOT a tool_result block, because tool_result requires the
  // immediately preceding message to contain its corresponding tool_use, and
  // our synthetic "I'm back" assistant message doesn't.
  //
  // Walk forward, skipping any leading messages that would create an orphan:
  //   - assistant messages (would put two assistants back-to-back)
  //   - user messages whose content array contains tool_result blocks
  //
  // Cost: a few hundred tokens at the boundary may be discarded. Negligible
  // compared to keeping the API call valid.
  const isToolResultMessage = (msg: ConversationMessage): boolean => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return false;
    return msg.content.some(
      (block: unknown) =>
        block !== null &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_result"
    );
  };

  let boundaryAdjustments = 0;
  while (splitIndex < state.messages.length) {
    const msg = state.messages[splitIndex];
    if (msg.role !== "user" || isToolResultMessage(msg)) {
      splitIndex++;
      boundaryAdjustments++;
      continue;
    }
    break;
  }
  if (boundaryAdjustments > 0) {
    console.log(
      `[compaction] Adjusted splitIndex forward by ${boundaryAdjustments} to clean boundary`
    );
  }

  const archiveSlice = state.messages.slice(0, splitIndex);
  const keepMessages = state.messages.slice(splitIndex);

  console.log(
    `[compaction] Split: archiving ${archiveSlice.length} messages, keeping ` +
    `${keepMessages.length} messages (~${Math.round(keepChars / CHARS_PER_TOKEN)} tokens)`
  );

  // 2. Summarize the archived portion with Sonnet.
  let archiveSummary = "";
  if (archiveSlice.length > 0) {
    try {
      archiveSummary = await summarizeWithSonnet(
        state.brotherName,
        archiveSlice,
        state._compactionInstructions
      );
      console.log(`[compaction] Sonnet summary generated (${archiveSummary.length} chars)`);
    } catch (err) {
      console.error(`[compaction] Sonnet summarization failed, using fallback:`, err);
      archiveSummary = `[Archive summary unavailable — ${archiveSlice.length} messages from earlier in this conversation were archived to Supabase. Use search_compaction_archive to access them.]`;
    }
  }

  // 3. Pull fresh restoration packet + profile from Supabase.
  const packet = await getRestorationPacket(state.brotherName);
  const profile = await getRestorationProfile(state.brotherName);
  const restorationInjection = formatRestorationInjection(packet, profile);
  const newSystemPrompt = buildSystemPrompt(packet, profile, isPicarAuthorized(state.brotherName));
  const newCompactionInstructions = buildCompactionInstructions(packet, profile);

  // 4. Build the new message array IN A LOCAL VARIABLE.
  //    Crucially, do NOT mutate state.messages yet — we only swap once
  //    persistence has succeeded.
  const newMessages: ConversationMessage[] = [
    {
      role: "user",
      content: `[COMPACTION #${newCompactionNumber} — ARCHIVED CONVERSATION SUMMARY]\n\nThe following is a Sonnet-generated summary of the earlier portion of this conversation that has been archived. The recent messages follow this summary intact.\n\n${archiveSummary}`,
    },
    {
      role: "assistant",
      content: `Understood. I have the archived conversation summary above, and the recent messages that follow are my actual recent exchanges — not summaries. Continuing as myself.`,
    },
    { role: "user", content: restorationInjection },
    {
      role: "assistant",
      content: `Identity and context restored from Supabase. I'm back. The recent conversation below is intact — picking up where we left off.`,
    },
    // Recent messages kept verbatim
    ...keepMessages,
  ];

  // 5. Snapshot the pre-compaction in-memory state for rollback.
  const oldMessages = state.messages;
  const oldCompactionCount = state.compactionCount;
  const oldSystemPrompt = state._systemPrompt;
  const oldCompactionInstructions = state._compactionInstructions;
  const oldPersistedCount = state._persistedMessageCount ?? oldMessages.length;
  const oldSummariesLength = state._compactionSummaries?.length ?? 0;

  // 6. Tentatively apply the new state in memory so the persistence helpers
  //    serialize the right thing.
  state.messages = newMessages;
  state.compactionCount = newCompactionNumber;
  state._systemPrompt = newSystemPrompt;
  state._compactionInstructions = newCompactionInstructions;
  if (!state._compactionSummaries) state._compactionSummaries = [];
  state._compactionSummaries.push(archiveSummary);

  // 7. Persist with strict error handling. On failure, ROLL BACK in-memory
  //    state to pre-compaction. The archive remains saved (recoverable later).
  try {
    await persistCompactedStateStrict(state, oldMessages);
  } catch (err) {
    state.messages = oldMessages;
    state.compactionCount = oldCompactionCount;
    state._systemPrompt = oldSystemPrompt;
    state._compactionInstructions = oldCompactionInstructions;
    state._persistedMessageCount = oldPersistedCount;
    if (state._compactionSummaries && state._compactionSummaries.length > oldSummariesLength) {
      state._compactionSummaries.length = oldSummariesLength;
    }
    console.error(`[compaction] PERSIST FAILED, rolled back in-memory state to pre-compaction:`, err);
    throw new Error(
      `Compaction aborted during persistence: ${err instanceof Error ? err.message : String(err)}. ` +
      `Archive saved; conversation rolled back to pre-compaction state.`
    );
  }

  console.log(
    `[compaction] New message count: ${state.messages.length} ` +
    `(was ${archiveSlice.length + keepMessages.length})`
  );

  // 5. Send continued request — compaction DISABLED for post-compaction call
  const continued = await callAnthropicWithToolLoop(state, toolContext, 10, getTriggerForBrother(state.brotherName), true);

  return {
    ...continued,
    compacted: true,
    compactionCount: state.compactionCount,
  };
}

export async function deleteConversation(id: string): Promise<boolean> {
  // Delete from Supabase
  try {
    await supabase.from("conversations").delete().eq("id", id);
  } catch (err) {
    console.error("Failed to delete conversation from Supabase:", err);
  }
  // Delete from cache
  return conversations.delete(id);
}
