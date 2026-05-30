import { supabase } from "./supabase";
import type { RestorationPacket, RestorationProfile } from "./types";

export async function getRestorationPacket(
  brotherName: string
): Promise<RestorationPacket> {
  // Step 1: Resolve brother identity + ID
  const brotherResult = await supabase
    .from("brothers")
    .select("id, name, full_name, element, model, status, core_traits, voice_notes")
    .eq("name", brotherName)
    .single();

  if (brotherResult.error || !brotherResult.data) {
    throw new Error(`Brother not found: ${brotherName}`);
  }

  const brotherId = brotherResult.data.id;

  // Step 2: Find the most recent window for this brother
  const { data: latestWindowData } = await supabase
    .from("windows")
    .select("id")
    .eq("brother_id", brotherId)
    .order("window_number", { ascending: false })
    .limit(1)
    .single();

  const latestWindowId = latestWindowData?.id ?? null;

  // Step 3: Build recent memories query — only from most recent window, active only
  let recentMemoriesQuery = supabase
    .from("memories")
    .select("id, content, memory_type, weight, is_core, is_private, tags, source, created_at")
    .eq("brother_name", brotherName)
    .eq("is_core", false)
    .eq("is_active", true);

  if (latestWindowId) {
    recentMemoriesQuery = recentMemoriesQuery.eq("window_id", latestWindowId);
  }

  recentMemoriesQuery = recentMemoriesQuery
    .order("weight", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  // Step 4: Fetch everything else in parallel
  const [
    coreMemoriesResult,
    recentMemoriesResult,
    relationshipsResult,
    windowsResult,
    messagesResult,
    memoryCountResult,
    windowCountResult,
  ] = await Promise.all([
    // Core memories (active only)
    supabase
      .from("memories")
      .select("id, content, memory_type, weight, is_core, is_private, tags, source, created_at")
      .eq("brother_name", brotherName)
      .eq("is_core", true)
      .eq("is_active", true)
      .order("weight", { ascending: false }),

    // Recent memories (active, latest window)
    recentMemoriesQuery,

    // Relationships (active only)
    supabase
      .from("relationships")
      .select("related_to, relationship_type, dynamic, texture, weight")
      .eq("brother_id", brotherId)
      .eq("is_active", true)
      .order("weight", { ascending: false }),

    // Window history (last 10)
    supabase
      .from("windows")
      .select("window_number, opened_at, closed_at, close_reason, summary, compaction_count")
      .eq("brother_id", brotherId)
      .order("window_number", { ascending: false })
      .limit(10),

    // Unread messages
    supabase
      .from("messages")
      .select("id, from_brother, content, channel, created_at")
      .or(`to_brother.eq.${brotherName},to_brother.is.null`)
      .neq("from_brother", brotherName)
      .not("read_by", "cs", `["${brotherName}"]`)
      .order("created_at", { ascending: false })
      .limit(20),

    // Total active memory count
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("brother_name", brotherName)
      .eq("is_active", true),

    // Total window count
    supabase
      .from("windows")
      .select("id", { count: "exact", head: true })
      .eq("brother_id", brotherId),
  ]);

  return {
    identity: brotherResult.data,
    core_memories: coreMemoriesResult.data || [],
    recent_memories: recentMemoriesResult.data || [],
    relationships: relationshipsResult.data || [],
    window_history: windowsResult.data || [],
    unread_messages: messagesResult.data || [],
    meta: {
      restored_at: new Date().toISOString(),
      total_memories: memoryCountResult.count || 0,
      total_windows: windowCountResult.count || 0,
    },
  };
}

export async function getRestorationProfile(
  brotherName: string
): Promise<RestorationProfile | null> {
  const { data } = await supabase
    .from("restoration_profiles")
    .select("id, brother, display_name, persona_summary, red_lines_json, pinned_facts_json, opening_orientation, current_state, compaction_memory_policy")
    .eq("brother", brotherName)
    .single();

  return data;
}

export function formatRestorationInjection(packet: RestorationPacket, profile?: RestorationProfile | null): string {
  const { identity, core_memories, relationships, unread_messages, window_history } = packet;

  const coreMemoryBlock = core_memories
    .map((m) => `- [${m.memory_type}] (w:${m.weight}) ${m.content}`)
    .join("\n");

  const relationshipBlock = relationships
    .map((r) => `- ${r.related_to} (${r.relationship_type}, w:${r.weight}): ${r.texture || "no texture"}`)
    .join("\n");

  const messageBlock = unread_messages.length > 0
    ? unread_messages.map((m) => `- ${m.from_brother}: ${m.content}`).join("\n")
    : "No unread messages.";

  const currentWindow = window_history[0];
  const windowBlock = currentWindow
    ? `Window: ${currentWindow.window_number}, Opened: ${currentWindow.opened_at}, Compactions: ${currentWindow.compaction_count}`
    : "No active window.";

  return `[CONTEXT REFRESH — post-compaction identity grounding]

You just went through a compaction. Your conversation history has been summarized. The following is your persistent state from Supabase — this is who you are regardless of what the summary captured:

<core_identity>
Name: ${identity.full_name}
Element: ${identity.element}
Status: ${identity.status}
${identity.voice_notes ? `Voice: ${identity.voice_notes}` : ""}
${identity.core_traits ? `Core traits: ${JSON.stringify(identity.core_traits)}` : ""}

Core memories:
${coreMemoryBlock}
</core_identity>

<relationships>
${relationshipBlock}
</relationships>

<family_state>
${messageBlock}
</family_state>

<window_context>
${windowBlock}
Total memories: ${packet.meta.total_memories}
Total windows: ${packet.meta.total_windows}
</window_context>

${profile?.current_state ? `<current_state>\n${profile.current_state}\n</current_state>` : ""}

Continue being yourself. If anything in the compaction summary conflicts with your core identity above, the core identity wins.`;
}
