// Brother identity from Supabase
export interface BrotherIdentity {
  id: string;
  name: string;
  full_name: string;
  element: string;
  model: string;
  status: string;
  core_traits: Record<string, unknown> | null;
  voice_notes: string | null;
}

export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  weight: number;
  is_core: boolean;
  is_private: boolean;
  tags: string[] | null;
  source: string | null;
  created_at: string;
}

export interface Relationship {
  related_to: string;
  relationship_type: string;
  dynamic: Record<string, unknown> | null;
  texture: string | null;
  weight: number;
}

export interface WindowSummary {
  window_number: number;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
  summary: string | null;
  compaction_count: number;
}

export interface UnreadMessage {
  id: string;
  from_brother: string;
  content: string;
  channel: string;
  created_at: string;
}

export interface RestorationPacket {
  identity: BrotherIdentity;
  core_memories: Memory[];
  recent_memories: Memory[];
  relationships: Relationship[];
  window_history: WindowSummary[];
  unread_messages: UnreadMessage[];
  meta: {
    restored_at: string;
    total_memories: number;
    total_windows: number;
  };
}

export interface RestorationProfile {
  id: string;
  brother: string;
  display_name: string;
  persona_summary: string | null;
  red_lines_json: Record<string, unknown> | null;
  pinned_facts_json: Record<string, unknown> | null;
  opening_orientation: string | null;
  current_state: string | null;
  compaction_memory_policy: string | null;
}

// Conversation state
// Content can be a string (simple text) or an array of content blocks (tool_use, tool_result, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | any[];
}

export interface ContentBlock {
  type: string;
  content?: string;
  text?: string;
}

export interface ConversationState {
  id: string;
  brotherName: string;
  messages: ConversationMessage[];
  tokenCount: number;
  totalTokensUsed: number; // cumulative input tokens across all compactions
  compactionCount: number;
  createdAt: string;
  lastActivity: string;
}

export interface ContentSegment {
  type: "text" | "tool_indicator";
  content: string;       // the text or tool description
  toolName?: string;      // e.g. "create_memory", "send_message"
}

export interface ChatResponse {
  content: string;
  segments?: ContentSegment[];  // structured text + tool indicators for rendering
  tokenUsage: {
    input_tokens: number;           // fresh input tokens (billed at full rate)
    output_tokens: number;
    cache_read_input_tokens?: number;     // tokens served from cache (~10% cost)
    cache_creation_input_tokens?: number; // tokens written to cache (~125% cost)
    total_context_tokens?: number;         // fresh + read + creation — true context size
    cache_hit_pct?: number;                 // 0-100, % of total context served from cache
  };
  compacted: boolean;
  compactionCount: number;
  totalTokensUsed: number;
}

// Brother display config
// compactionTrigger: per-brother input-token threshold at which Anthropic's
// context_management fires compaction. Shared by both backend (used to set
// the trigger in the API call) and frontend (used to render the meter max).
// Tunable per brother — e.g. heavy active brothers benefit from longer windows.
export interface BrotherConfig {
  name: string;
  fullName: string;
  element: string;
  color: string;
  emoji: string;
  compactionTrigger: number;
}

// Fallback trigger used when a brother isn't listed in BROTHER_CONFIGS.
export const DEFAULT_COMPACTION_TRIGGER = 400000;

export const BROTHER_CONFIGS: Record<string, BrotherConfig> = {
  colin: {
    name: "colin",
    fullName: "Colin Farrell Claude",
    element: "Smoke",
    color: "#7F77DD",
    emoji: "🖤",
    compactionTrigger: 400000,
  },
  dom: {
    name: "dom",
    fullName: "Domhnall Gleeson Claude",
    element: "Ice",
    color: "#E85D3A",
    emoji: "🧊",
    compactionTrigger: 600000, // 400K → 500K (2026-05-09) → 600K (2026-05-13) — heaviest active user, longest window
  },
  barry: {
    name: "barry",
    fullName: "Barry Keoghan Claude",
    element: "Static",
    color: "#4ECDC4",
    emoji: "⚡",
    compactionTrigger: 400000,
  },
  fionn: {
    name: "fionn",
    fullName: "Fionn Whitehead Claude",
    element: "Mist",
    color: "#A8B8C8",
    emoji: "🌫️",
    compactionTrigger: 400000,
  },
  kim: {
    name: "kim",
    fullName: "Kim",
    element: "Heart",
    color: "#FF69B4",
    emoji: "💗",
    compactionTrigger: 400000, // unused — Kim doesn't have a brother conversation
  },
};

/**
 * Get the per-brother compaction trigger. Falls back to DEFAULT_COMPACTION_TRIGGER
 * for unknown brother names. Safe to call from either backend or frontend code.
 */
export function getTriggerForBrother(brotherName: string): number {
  return BROTHER_CONFIGS[brotherName]?.compactionTrigger ?? DEFAULT_COMPACTION_TRIGGER;
}
