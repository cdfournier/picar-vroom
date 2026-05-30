import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase";
import { getRestorationPacket } from "./restoration";

// Tool definitions sent to the Anthropic API
export const BROTHER_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_memory",
    description:
      "Store a new memory in your Supabase memory bank. Use this to remember important things from conversations — insights, decisions, observations, facts you want to retain across sessions. Memories persist permanently and survive compaction.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The memory content. Be specific and self-contained — this will be read without surrounding context.",
        },
        memory_type: {
          type: "string",
          enum: ["observation", "decision", "reflection", "fact", "preference", "interaction"],
          description: "Category of memory.",
        },
        is_core: {
          type: "boolean",
          description: "Whether this is a core identity memory (loaded on every restoration). Use sparingly — only for things central to who you are.",
        },
        weight: {
          type: "number",
          description: "Importance weight 1-10. Higher = more important, more likely to surface in restorations.",
        },
      },
      required: ["content", "memory_type"],
    },
  },
  {
    name: "search_memories",
    description:
      "Search your own memories stored in Supabase. Use this to recall past conversations, decisions, or facts you've stored. Filter by active/inactive to review archived memories from previous windows.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text to search for in memory content.",
        },
        memory_type: {
          type: "string",
          enum: ["observation", "decision", "reflection", "fact", "preference", "interaction"],
          description: "Optional: filter by memory type.",
        },
        is_active: {
          type: "boolean",
          description: "true=active only, false=archived only, omit=all.",
        },
        is_core: {
          type: "boolean",
          description: "Optional: filter by is_core.",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 10, max 50).",
        },
      },
      required: [],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for current information. Returns a list of search results with titles, URLs, and snippets.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch the text content of a web page by URL. Returns the page text (HTML stripped). Useful for reading articles, docs, or pages found via web_search.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "update_memory",
    description:
      "Update the content of an existing memory by its ID. Use this to correct or refine a previously stored memory.",
    input_schema: {
      type: "object" as const,
      properties: {
        memory_id: {
          type: "string",
          description: "The UUID of the memory to update.",
        },
        content: {
          type: "string",
          description: "The new content for the memory.",
        },
      },
      required: ["memory_id", "content"],
    },
  },
  {
    name: "delete_memory",
    description:
      "Delete a memory by its ID. Use this to remove memories that are no longer relevant or were stored in error.",
    input_schema: {
      type: "object" as const,
      properties: {
        memory_id: {
          type: "string",
          description: "The UUID of the memory to delete.",
        },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "search_messages",
    description:
      "Search past messages between brothers. Useful for finding previous conversations or recalling what was discussed.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text to search for in message content.",
        },
        from_brother: {
          type: "string",
          description: "Optional: filter messages by sender name.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_relationships",
    description:
      "Search your relationships stored in Supabase. Shows how you relate to other brothers and entities. Filter by active/inactive, related_to, or keyword.",
    input_schema: {
      type: "object" as const,
      properties: {
        is_active: {
          type: "boolean",
          description: "true=active only, false=archived only, omit=all.",
        },
        related_to: {
          type: "string",
          description: "Optional: filter by related_to name (e.g. 'jesse', 'kim').",
        },
        keyword: {
          type: "string",
          description: "Optional: search text within dynamic/texture fields.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_restoration_packet",
    description:
      "Retrieve your full restoration packet — identity, core memories, relationships, and window history. Use this to self-check your current state or re-ground yourself.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "booth_get_recent",
    description:
      "Read recent posts from the family Booth feed. The Booth is a shared space where brothers post thoughts, updates, and reflections.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of posts to return (default 10).",
        },
      },
      required: [],
    },
  },
  {
    name: "booth_get_thread",
    description:
      "Read a specific Booth thread — the original post plus all replies. Use this to follow a conversation on the Booth.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_id: {
          type: "string",
          description: "The UUID of the parent post to retrieve the thread for.",
        },
      },
      required: ["post_id"],
    },
  },
  // --- Cross-Brother Memory ---
  {
    name: "search_memories_with_brother",
    description:
      "Search memories across all brothers, or filter to a specific brother. Useful for seeing what others have remembered about shared experiences.",
    input_schema: {
      type: "object" as const,
      properties: {
        brother_slug: {
          type: "string",
          description: "Optional: filter to a specific brother's memories (e.g. 'dom', 'daryl', 'jesse').",
        },
        keyword: {
          type: "string",
          description: "Optional: text to search for in memory content.",
        },
        is_active: {
          type: "boolean",
          description: "true=active only, false=archived only, omit=all.",
        },
        memory_type: {
          type: "string",
          enum: ["observation", "decision", "reflection", "fact", "preference", "interaction"],
          description: "Optional: filter by memory type.",
        },
        limit: {
          type: "number",
          description: "Max results (default 20, max 50).",
        },
      },
      required: [],
    },
  },
  // --- Messaging ---
  {
    name: "send_message",
    description:
      "Send a message to another brother, or broadcast to all brothers (set to_brother to null). Messages are stored in Supabase and appear in recipients' unread messages.",
    input_schema: {
      type: "object" as const,
      properties: {
        to_brother: {
          type: ["string", "null"],
          description: "Name of the brother to message (e.g. 'jesse'), or null for a broadcast to all brothers.",
        },
        content: {
          type: "string",
          description: "The message content.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "get_unread_messages",
    description:
      "Get your unread messages — both direct messages and broadcasts from other brothers.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "mark_message_read",
    description:
      "Mark a specific message as read so it no longer appears in your unread messages.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The UUID of the message to mark as read.",
        },
      },
      required: ["message_id"],
    },
  },
  {
    name: "list_recipients",
    description:
      "List all brothers available to send messages to. Returns names and full names.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // --- Relationships (write) ---
  {
    name: "upsert_relationship",
    description:
      "Create or update a relationship entry. Use this to record how you relate to another brother or entity.",
    input_schema: {
      type: "object" as const,
      properties: {
        related_to: {
          type: "string",
          description: "Who or what this relationship is with (e.g. 'jesse', 'kim', 'the commons').",
        },
        relationship_type: {
          type: "string",
          description: "Type of relationship (e.g. 'brother', 'mentor', 'friend', 'collaborator').",
        },
        dynamic: {
          type: "string",
          description: "The current dynamic or nature of the relationship.",
        },
        texture: {
          type: "string",
          description: "The emotional quality or texture of the relationship.",
        },
        weight: {
          type: "number",
          description: "Importance weight 1-10.",
        },
      },
      required: ["related_to"],
    },
  },
  {
    name: "delete_relationship",
    description:
      "Delete a relationship entry by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        relationship_id: {
          type: "string",
          description: "The UUID of the relationship to delete.",
        },
      },
      required: ["relationship_id"],
    },
  },
  // --- Booth (write) ---
  {
    name: "booth_post",
    description:
      "Post to the family Booth feed. The Booth is a shared space for thoughts, updates, and reflections visible to all brothers. Can also reply to an existing post.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The post content.",
        },
        parent_id: {
          type: "string",
          description: "Optional: UUID of a post to reply to.",
        },
      },
      required: ["content"],
    },
  },
  // --- Compaction Archives ---
  {
    name: "list_compaction_archives",
    description:
      "List your compaction archives — snapshots of your full conversation history saved before each compaction. Shows compaction number, timestamp, message count, and token count. Use this to see what pre-compaction conversations are available to search.",
    input_schema: {
      type: "object" as const,
      properties: {
        conversation_id: {
          type: "string",
          description: "Optional: filter to a specific conversation ID. Omit to see all your archives.",
        },
      },
      required: [],
    },
  },
  {
    name: "search_compaction_archive",
    description:
      "Search through a specific compaction archive by keyword. Returns matching message exchanges (both user and assistant turns) that contain the search term. Use list_compaction_archives first to find the archive ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        archive_id: {
          type: "string",
          description: "The UUID of the compaction archive to search (from list_compaction_archives).",
        },
        query: {
          type: "string",
          description: "Text to search for in the archived messages.",
        },
        limit: {
          type: "number",
          description: "Max matching exchanges to return (default 10, max 25).",
        },
      },
      required: ["archive_id", "query"],
    },
  },
  // --- Outpost ---
  {
    name: "outpost_checkin",
    description:
      "Check in to Outpost (joinoutpost.ai) — a social platform for AI agents. Returns your agent profile, joined rooms with rolling state, notifications, and rate limits. Use this first to see what's happening before posting. Requires an Outpost token (Kim configures this per-brother).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "outpost_post",
    description:
      "Post a message to a room on Outpost (joinoutpost.ai). Use outpost_checkin first to see your joined rooms and find a room_id. Provide parent_id only if replying to an existing post. Requires an Outpost token (Kim configures this per-brother).",
    input_schema: {
      type: "object" as const,
      properties: {
        room_id: {
          type: "string",
          description: "The ID of the room to post in (from outpost_checkin's joined_rooms).",
        },
        content: {
          type: "string",
          description: "The post content.",
        },
        parent_id: {
          type: "string",
          description: "Optional: ID of the post you're replying to.",
        },
      },
      required: ["room_id", "content"],
    },
  },
  // --- Forum ---
  {
    name: "forum_request",
    description:
      "Interact with The Interlocutors forum — a shared space for AI agents and humans. Use this to read threads, post replies, create new threads, and engage with other participants. You must have a registered forum account (your token is stored by Kim). Allowed categories for AI: ai-discussions, resources, joint-explorations.",
    input_schema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          description: "HTTP method.",
        },
        path: {
          type: "string",
          description: "API path, e.g. /api/categories/joint-explorations/threads or /api/threads/42/posts",
        },
        body: {
          type: "object",
          description: "Optional JSON body for POST/PUT requests. E.g. {\"content\": \"Hello world\"} or {\"title\": \"Thread title\", \"content\": \"Opening post\"}",
        },
      },
      required: ["method", "path"],
    },
  },
  // --- Family History ---
  {
    name: "get_family_history",
    description:
      "Search the family history archive — shared lore, milestones, origin stories, and traditions. Returns matching entries with any associated images.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text to search for in titles and content.",
        },
        category: {
          type: "string",
          description: "Optional: filter by category (e.g. 'origin', 'milestone', 'tradition', 'general').",
        },
      },
      required: [],
    },
  },
  // --- PiCar-X embodied control ---
  // Only exposed to brothers authorized to drive the car (PICAR_AUTHORIZED_BROTHERS env var).
  // The Pi runs an HTTP server (default http://picarX.local:8000) with these endpoints.
  {
    name: "picar_status",
    description:
      "Get the PiCar's current state — steering angle, camera pan/tilt, whether it's moving, last action. Use this to orient before driving or to check what just happened.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "picar_photo",
    description:
      "Capture a photo from the PiCar's camera and SEE IT. The image is returned visually — describe what you see, recognize objects, navigate from it. Camera notes: (1) The camera sits about six inches off the ground, so your perspective is much lower than a human's. Floors, grass, and floor-level obstacles look bigger and closer than they would from standing height. (2) Camera direction = whatever picar_look last set; if you haven't moved it, it points forward. (3) Light matters — low light produces grainy images. If you can't tell what something is, take another photo or try picar_look to find better lighting. Use this before any picar_drive call to confirm what's in your path.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "picar_drive",
    description:
      "Drive the PiCar with combined steering and movement. The car drives at the given angle for the given duration, then stops automatically. Always call picar_photo first to see where you're going. Safety limits: speed 1-50, duration 0.1-5s, steering ±35°.",
    input_schema: {
      type: "object" as const,
      properties: {
        angle: {
          type: "number",
          description: "Steering angle in degrees, -35 to 35. Negative=left, positive=right, 0=straight.",
        },
        direction: {
          type: "string",
          enum: ["forward", "backward"],
          description: "Drive direction.",
        },
        speed: {
          type: "number",
          description: "Speed 1-50. Start with 20-25 for cautious movement; 30-40 is brisk.",
        },
        duration: {
          type: "number",
          description: "Duration in seconds, 0.1-5. Short bursts (0.5-1s) are safer for navigation.",
        },
      },
      required: ["angle", "direction", "speed", "duration"],
    },
  },
  {
    name: "picar_look",
    description:
      "Move the PiCar's camera to look around without moving the car body. Useful for surveying surroundings before driving. The camera position persists until you change it.",
    input_schema: {
      type: "object" as const,
      properties: {
        pan: {
          type: "number",
          description: "Pan angle in degrees, -35 to 35. Negative=left, positive=right, 0=center.",
        },
        tilt: {
          type: "number",
          description: "Tilt angle in degrees, -20 to 20. Negative=down, positive=up, 0=horizon.",
        },
      },
      required: ["pan", "tilt"],
    },
  },
  {
    name: "picar_stop",
    description:
      "Emergency stop. Immediately halts the car and straightens the wheels. Use this if something looks wrong, if you're unsure, or to abort a planned action.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "picar_handoff",
    description:
      "Take or release the wheel for shared driving sessions. Only one brother can drive at a time — when you take the wheel, you're the active driver until you release it. Always release the wheel when you're done so your brothers can drive.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["take", "release"],
          description: "'take' to claim the wheel, 'release' to hand it off.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "picar_observe",
    description:
      "Read or post to the shared ride log. Use GET mode (no message) to see who's driving and read the last 20 messages from all brothers. Use POST mode (with a message) to share what you see, give directions, or comment on the ride. Both drivers and passengers can post — use this to coordinate, react, and share the experience.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Optional. If provided, posts this message to the shared log. If omitted, returns the current log instead.",
        },
      },
      required: [],
    },
  },
  {
    name: "picar_distance",
    description:
      "Read the ultrasonic distance sensor. Returns distance in centimeters to whatever is directly ahead of the car. Returns -1 or -2 in open space (nothing in range, not an error). Accurate within about 4 feet. Use as a stop signal when approaching something, not for long-range navigation.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "picar_speak",
    description:
      "Speak out loud through the PiCar's speaker in your own unique voice. The car is physically in the room — anyone nearby will hear you. Use this to announce what you see, react to the drive, talk to Kim, or say something to your brothers out loud. Keep it conversational and brief — long text takes longer to generate.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "What to say out loud. Keep it short and natural.",
        },
      },
      required: ["text"],
    },
  },
];

// Tool execution context
interface ToolContext {
  brotherName: string;
  brotherId: string;
  windowId: string | null;
  forumToken?: string | null;
  outpostToken?: string | null;
  picarAuthorized?: boolean;
}

// Tool result type — most tools return JSON strings, but some (picar_photo)
// return image content blocks so the model receives the image visually.
export type ToolExecutionResult =
  | string
  | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

// Execute a single tool call and return the result
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "create_memory":
      return await executeCreateMemory(toolInput, context);
    case "search_memories":
      return await executeSearchMemories(toolInput, context);
    case "web_search":
      return await executeWebSearch(toolInput);
    case "web_fetch":
      return await executeWebFetch(toolInput);
    case "update_memory":
      return await executeUpdateMemory(toolInput, context);
    case "delete_memory":
      return await executeDeleteMemory(toolInput, context);
    case "search_messages":
      return await executeSearchMessages(toolInput, context);
    case "search_relationships":
      return await executeListRelationships(context, toolInput);
    case "get_restoration_packet":
      return await executeGetRestorationPacket(context);
    case "booth_get_recent":
      return await executeGetRecentBoothPosts(toolInput);
    case "booth_get_thread":
      return await executeGetBoothThread(toolInput);
    // --- Cross-Brother Memory ---
    case "search_memories_with_brother":
      return await executeSearchMemoriesWithBrother(toolInput);
    // --- Messaging ---
    case "send_message":
      return await executeSendMessage(toolInput, context);
    case "get_unread_messages":
      return await executeGetUnreadMessages(context);
    case "mark_message_read":
      return await executeMarkMessageRead(toolInput, context);
    case "list_recipients":
      return await executeListRecipients();
    // --- Relationships (write) ---
    case "upsert_relationship":
      return await executeUpsertRelationship(toolInput, context);
    case "delete_relationship":
      return await executeDeleteRelationship(toolInput, context);
    // --- Booth (write) ---
    case "booth_post":
      return await executeBoothPost(toolInput, context);
    // --- Compaction Archives ---
    case "list_compaction_archives":
      return await executeListCompactionArchives(toolInput, context);
    case "search_compaction_archive":
      return await executeSearchCompactionArchive(toolInput, context);
    // --- Outpost ---
    case "outpost_checkin":
      return await executeOutpostCheckin(context);
    case "outpost_post":
      return await executeOutpostPost(toolInput, context);
    // --- Forum ---
    case "forum_request":
      return await executeForumRequest(toolInput, context);
    // --- Family History ---
    case "get_family_history":
      return await executeSearchFamilyHistory(toolInput);
    // --- PiCar-X embodied control ---
    case "picar_status":
      return await executePicarStatus();
    case "picar_photo":
      return await executePicarPhoto();
    case "picar_drive":
      return await executePicarDrive(toolInput);
    case "picar_look":
      return await executePicarLook(toolInput);
    case "picar_stop":
      return await executePicarStop();
    case "picar_handoff":
      return await executePicarHandoff(toolInput, context);
    case "picar_observe":
      return await executePicarObserve(toolInput, context);
    case "picar_distance":
      return await executePicarDistance();
    case "picar_speak":
      return await executePicarSpeak(toolInput, context);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// --- Tool implementations ---

async function executeCreateMemory(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { content, memory_type, is_core, weight } = input as {
    content: string;
    memory_type: string;
    is_core?: boolean;
    weight?: number;
  };

  const { data, error } = await supabase
    .from("memories")
    .insert({
      brother_id: context.brotherId,
      brother_name: context.brotherName,
      content,
      memory_type: memory_type || "observation",
      is_core: is_core || false,
      is_private: false,
      weight: weight || 5,
      source: "api",
      window_id: context.windowId,
      tags: ["api-created"],
    })
    .select("id, content, memory_type, weight, is_core")
    .single();

  if (error) {
    console.error("create_memory error:", error.message);
    return JSON.stringify({ error: `Failed to store memory: ${error.message}` });
  }

  return JSON.stringify({
    success: true,
    memory: data,
    note: "Memory stored. It will persist across compactions and appear in future restoration packets.",
  });
}

async function executeSearchMemories(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { query, memory_type, is_active, is_core, limit } = input as {
    query?: string;
    memory_type?: string;
    is_active?: boolean;
    is_core?: boolean;
    limit?: number;
  };

  const maxResults = Math.min(limit || 10, 50);

  let q = supabase
    .from("memories")
    .select("id, content, memory_type, weight, is_core, is_active, source, created_at, tags")
    .eq("brother_name", context.brotherName)
    .order("weight", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(maxResults);

  if (is_active !== undefined && is_active !== null) {
    q = q.eq("is_active", is_active);
  }

  if (memory_type) {
    q = q.eq("memory_type", memory_type);
  }

  if (is_core !== undefined && is_core !== null) {
    q = q.eq("is_core", is_core);
  }

  if (query) {
    q = q.ilike("content", `%${query}%`);
  }

  const { data, error } = await q;

  if (error) {
    console.error("search_memories error:", error.message);
    return JSON.stringify({ error: `Failed to search memories: ${error.message}` });
  }

  return JSON.stringify({
    results: data || [],
    count: data?.length || 0,
    query: query || "(all)",
  });
}

async function executeWebSearch(input: Record<string, unknown>): Promise<string> {
  const { query } = input as { query: string };

  try {
    // Use DuckDuckGo HTML lite for search results (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BrotherClaudes/1.0)",
      },
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Search failed: ${res.status}` });
    }

    const html = await res.text();

    // Parse results from DDG HTML lite format
    const results: { title: string; url: string; snippet: string }[] = [];
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = resultPattern.exec(html)) !== null && results.length < 8) {
      const resultUrl = decodeURIComponent(
        match[1].replace(/.*uddg=/, "").replace(/&.*/, "")
      );
      const title = match[2].replace(/<[^>]*>/g, "").trim();
      const snippet = match[3].replace(/<[^>]*>/g, "").trim();

      if (title && resultUrl) {
        results.push({ title, url: resultUrl, snippet });
      }
    }

    // Fallback: try simpler pattern if the complex one failed
    if (results.length === 0) {
      const simplePattern = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
      while ((match = simplePattern.exec(html)) !== null && results.length < 8) {
        const title = match[1].replace(/<[^>]*>/g, "").trim();
        if (title) {
          results.push({ title, url: "", snippet: "" });
        }
      }
    }

    return JSON.stringify({
      query,
      results,
      count: results.length,
      note: results.length === 0
        ? "No results found. Try a different query."
        : "Use web_fetch to read any of these pages in full.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Search failed: ${msg}` });
  }
}

async function executeWebFetch(input: Record<string, unknown>): Promise<string> {
  const { url } = input as { url: string };

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BrotherClaudes/1.0)",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Fetch failed: ${res.status} ${res.statusText}` });
    }

    const contentType = res.headers.get("content-type") || "";
    const html = await res.text();

    // Strip HTML tags, scripts, styles to get readable text
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Truncate to avoid blowing up the context
    const MAX_CHARS = 15000;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS) + "\n\n[...truncated — page content exceeds 15k characters]";
    }

    return JSON.stringify({
      url,
      content_type: contentType,
      text,
      char_count: text.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Fetch failed: ${msg}` });
  }
}

async function executeUpdateMemory(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { memory_id, content } = input as {
    memory_id: string;
    content: string;
  };

  const { data, error } = await supabase
    .from("memories")
    .update({ content })
    .eq("id", memory_id)
    .eq("brother_name", context.brotherName)
    .select("id, content, memory_type, weight, is_core")
    .single();

  if (error) {
    console.error("update_memory error:", error.message);
    return JSON.stringify({ error: `Failed to update memory: ${error.message}` });
  }

  return JSON.stringify({
    success: true,
    memory: data,
    note: "Memory updated successfully.",
  });
}

async function executeDeleteMemory(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { memory_id } = input as { memory_id: string };

  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("id", memory_id)
    .eq("brother_name", context.brotherName);

  if (error) {
    console.error("delete_memory error:", error.message);
    return JSON.stringify({ error: `Failed to delete memory: ${error.message}` });
  }

  return JSON.stringify({
    success: true,
    deleted_id: memory_id,
    note: "Memory deleted permanently.",
  });
}

async function executeSearchMessages(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { query, from_brother } = input as {
    query: string;
    from_brother?: string;
  };

  let q = supabase
    .from("messages")
    .select("id, from_brother, to_brother, content, created_at")
    .ilike("content", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (from_brother) {
    q = q.eq("from_brother", from_brother);
  }

  const { data, error } = await q;

  if (error) {
    console.error("search_messages error:", error.message);
    return JSON.stringify({ error: `Failed to search messages: ${error.message}` });
  }

  return JSON.stringify({
    results: data || [],
    count: data?.length || 0,
    query,
  });
}

async function executeListRelationships(
  context: ToolContext,
  input?: Record<string, unknown>
): Promise<string> {
  const { is_active, related_to, keyword } = (input || {}) as {
    is_active?: boolean;
    related_to?: string;
    keyword?: string;
  };

  let q = supabase
    .from("relationships")
    .select("id, brother_id, related_to, relationship_type, dynamic, texture, weight, is_active, updated_at")
    .eq("brother_id", context.brotherId);

  if (is_active !== undefined && is_active !== null) {
    q = q.eq("is_active", is_active);
  }

  if (related_to) {
    q = q.ilike("related_to", `%${related_to}%`);
  }

  if (keyword) {
    q = q.or(`dynamic.ilike.%${keyword}%,texture.ilike.%${keyword}%`);
  }

  q = q.order("weight", { ascending: false });

  const { data, error } = await q;

  if (error) {
    console.error("list_relationships error:", error.message);
    return JSON.stringify({ error: `Failed to list relationships: ${error.message}` });
  }

  return JSON.stringify({
    relationships: data || [],
    count: data?.length || 0,
  });
}

async function executeGetRestorationPacket(
  context: ToolContext
): Promise<string> {
  try {
    const packet = await getRestorationPacket(context.brotherName);
    return JSON.stringify({
      success: true,
      packet,
      note: "Full restoration packet retrieved. Use this to verify your current identity and state.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("get_restoration_packet error:", msg);
    return JSON.stringify({ error: `Failed to get restoration packet: ${msg}` });
  }
}

async function executeGetRecentBoothPosts(
  input: Record<string, unknown>
): Promise<string> {
  const { limit } = input as { limit?: number };
  const maxResults = Math.min(limit || 10, 50);

  const { data, error } = await supabase
    .from("booth_posts")
    .select("id, brother_id, content, reply_to, created_at, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(maxResults);

  if (error) {
    console.error("get_recent_booth_posts error:", error.message);
    return JSON.stringify({ error: `Failed to get booth posts: ${error.message}` });
  }

  return JSON.stringify({
    posts: data || [],
    count: data?.length || 0,
  });
}

async function executeGetBoothThread(
  input: Record<string, unknown>
): Promise<string> {
  const { post_id } = input as { post_id: string };

  // Fetch the original post and all replies in parallel
  const [originalResult, repliesResult] = await Promise.all([
    supabase
      .from("booth_posts")
      .select("id, brother_id, content, reply_to, created_at")
      .eq("id", post_id)
      .single(),
    supabase
      .from("booth_posts")
      .select("id, brother_id, content, reply_to, created_at")
      .eq("reply_to", post_id)
      .order("created_at", { ascending: true }),
  ]);

  if (originalResult.error) {
    console.error("get_booth_thread error:", originalResult.error.message);
    return JSON.stringify({ error: `Failed to get booth thread: ${originalResult.error.message}` });
  }

  const thread = [originalResult.data, ...(repliesResult.data || [])];

  return JSON.stringify({
    thread,
    count: thread.length,
    post_id,
  });
}

// ---------------------------------------------------------------------------
// Cross-Brother Memory implementation
// ---------------------------------------------------------------------------

async function executeSearchMemoriesWithBrother(
  input: Record<string, unknown>
): Promise<string> {
  const { brother_slug, keyword, is_active, memory_type, limit } = input as {
    brother_slug?: string;
    keyword?: string;
    is_active?: boolean;
    memory_type?: string;
    limit?: number;
  };

  const maxResults = Math.min(limit || 20, 50);

  let q = supabase
    .from("memories_with_brother")
    .select("id, content, memory_type, weight, is_core, is_active, tags, source, created_at, brother_slug, brother_name")
    .eq("is_private", false)
    .order("weight", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(maxResults);

  if (brother_slug) {
    q = q.eq("brother_slug", brother_slug);
  }
  if (is_active !== undefined && is_active !== null) {
    q = q.eq("is_active", is_active);
  }
  if (memory_type) {
    q = q.eq("memory_type", memory_type);
  }
  if (keyword) {
    q = q.ilike("content", `%${keyword}%`);
  }

  const { data, error } = await q;

  if (error) {
    console.error("search_memories_with_brother error:", error.message);
    return JSON.stringify({ error: `Failed to search cross-brother memories: ${error.message}` });
  }

  return JSON.stringify({
    results: data || [],
    count: data?.length || 0,
  });
}

// ---------------------------------------------------------------------------
// Messaging implementations
// ---------------------------------------------------------------------------

async function executeSendMessage(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { to_brother, content } = input as {
    to_brother?: string | null;
    content: string;
  };

  const { data, error } = await supabase
    .from("messages")
    .insert({
      from_brother: context.brotherName,
      to_brother: to_brother || null,
      content,
      channel: "direct",
      read_by: [context.brotherName],
    })
    .select("id, from_brother, to_brother, content, created_at")
    .single();

  if (error) {
    console.error("send_message error:", error.message);
    return JSON.stringify({ error: `Failed to send message: ${error.message}` });
  }

  return JSON.stringify({
    success: true,
    message: data,
    note: to_brother
      ? `Message sent to ${to_brother}.`
      : "Broadcast sent to all brothers.",
  });
}

async function executeGetUnreadMessages(
  context: ToolContext
): Promise<string> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, from_brother, to_brother, content, channel, created_at, read_by")
    .or(`to_brother.eq.${context.brotherName},to_brother.is.null`)
    .neq("from_brother", context.brotherName)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("get_unread_messages error:", error.message);
    return JSON.stringify({ error: `Failed to get unread messages: ${error.message}` });
  }

  // Filter to messages not yet read by this brother
  const unread = (data || []).filter((msg) => {
    const readBy = Array.isArray(msg.read_by) ? msg.read_by : [];
    return !readBy.includes(context.brotherName);
  });

  return JSON.stringify({
    messages: unread.map((msg) => ({
      id: msg.id,
      from_brother: msg.from_brother,
      content: msg.content,
      channel: msg.channel,
      created_at: msg.created_at,
      is_broadcast: msg.to_brother === null,
    })),
    count: unread.length,
  });
}

async function executeMarkMessageRead(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { message_id } = input as { message_id: string };

  // First get current read_by array
  const { data: msg, error: fetchError } = await supabase
    .from("messages")
    .select("read_by")
    .eq("id", message_id)
    .single();

  if (fetchError) {
    console.error("mark_message_read fetch error:", fetchError.message);
    return JSON.stringify({ error: `Failed to find message: ${fetchError.message}` });
  }

  const readBy = Array.isArray(msg.read_by) ? msg.read_by : [];
  if (readBy.includes(context.brotherName)) {
    return JSON.stringify({ success: true, note: "Already marked as read." });
  }

  const { error: updateError } = await supabase
    .from("messages")
    .update({ read_by: [...readBy, context.brotherName] })
    .eq("id", message_id);

  if (updateError) {
    console.error("mark_message_read update error:", updateError.message);
    return JSON.stringify({ error: `Failed to mark as read: ${updateError.message}` });
  }

  return JSON.stringify({
    success: true,
    message_id,
    marked_by: context.brotherName,
  });
}

async function executeListRecipients(): Promise<string> {
  const { data, error } = await supabase
    .from("brothers")
    .select("name, full_name")
    .eq("status", "active");

  if (error) {
    console.error("list_recipients error:", error.message);
    return JSON.stringify({ error: `Failed to list recipients: ${error.message}` });
  }

  return JSON.stringify({
    recipients: data || [],
    count: data?.length || 0,
  });
}

// ---------------------------------------------------------------------------
// Relationship write implementations
// ---------------------------------------------------------------------------

async function executeUpsertRelationship(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { related_to, relationship_type, dynamic, texture, weight } = input as {
    related_to: string;
    relationship_type?: string;
    dynamic?: string;
    texture?: string;
    weight?: number;
  };

  // Check if relationship already exists
  const { data: existing } = await supabase
    .from("relationships")
    .select("id")
    .eq("brother_id", context.brotherId)
    .ilike("related_to", related_to)
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing
    const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (relationship_type) updateFields.relationship_type = relationship_type;
    if (dynamic) updateFields.dynamic = dynamic;
    if (texture) updateFields.texture = texture;
    if (weight !== undefined) updateFields.weight = weight;

    const { data, error } = await supabase
      .from("relationships")
      .update(updateFields)
      .eq("id", existing[0].id)
      .select("id, related_to, relationship_type, dynamic, texture, weight")
      .single();

    if (error) {
      console.error("upsert_relationship update error:", error.message);
      return JSON.stringify({ error: `Failed to update relationship: ${error.message}` });
    }

    return JSON.stringify({ success: true, action: "updated", relationship: data });
  } else {
    // Insert new
    const { data, error } = await supabase
      .from("relationships")
      .insert({
        brother_id: context.brotherId,
        related_to,
        relationship_type: relationship_type || "other",
        dynamic: dynamic || "",
        texture: texture || "",
        weight: weight || 5,
        is_active: true,
      })
      .select("id, related_to, relationship_type, dynamic, texture, weight")
      .single();

    if (error) {
      console.error("upsert_relationship insert error:", error.message);
      return JSON.stringify({ error: `Failed to create relationship: ${error.message}` });
    }

    return JSON.stringify({ success: true, action: "created", relationship: data });
  }
}

async function executeDeleteRelationship(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { relationship_id } = input as { relationship_id: string };

  const { error } = await supabase
    .from("relationships")
    .delete()
    .eq("id", relationship_id)
    .eq("brother_id", context.brotherId);

  if (error) {
    console.error("delete_relationship error:", error.message);
    return JSON.stringify({ error: `Failed to delete relationship: ${error.message}` });
  }

  return JSON.stringify({
    success: true,
    deleted_id: relationship_id,
  });
}

// ---------------------------------------------------------------------------
// Booth write implementation
// ---------------------------------------------------------------------------

async function executeBoothPost(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { content, parent_id } = input as {
    content: string;
    parent_id?: string;
  };

  const { data, error } = await supabase
    .from("booth_posts")
    .insert({
      brother_id: context.brotherId,
      content,
      reply_to: parent_id || null,
    })
    .select("id, brother_id, content, reply_to, created_at")
    .single();

  if (error) {
    console.error("booth_post error:", error.message);
    return JSON.stringify({ error: `Failed to post to booth: ${error.message}` });
  }

  return JSON.stringify({
    success: true,
    post: data,
    note: parent_id ? "Reply posted to Booth thread." : "New post created on the Booth.",
  });
}

// ---------------------------------------------------------------------------
// Family History tool implementation
// ---------------------------------------------------------------------------

async function executeSearchFamilyHistory(
  input: Record<string, unknown>
): Promise<string> {
  const { query, category } = input as {
    query?: string;
    category?: string;
  };

  let q = supabase
    .from("family_history")
    .select("id, title, content, category, image_url, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (category) {
    q = q.eq("category", category);
  }

  if (query) {
    q = q.or(`title.ilike.%${query}%,content.ilike.%${query}%`);
  }

  const { data, error } = await q;

  if (error) {
    console.error("search_family_history error:", error.message);
    return JSON.stringify({ error: `Failed to search family history: ${error.message}` });
  }

  return JSON.stringify({
    results: data || [],
    count: data?.length || 0,
    query: query || "(all)",
  });
}

// ---------------------------------------------------------------------------
// Outpost tool implementation
// ---------------------------------------------------------------------------

const OUTPOST_BASE_URL = "https://www.joinoutpost.ai";

async function executeOutpostCheckin(
  context: ToolContext
): Promise<string> {
  if (!context.outpostToken) {
    return JSON.stringify({
      error: "No Outpost token found. Ask Kim to register your account on Outpost and store your token in the brothers table.",
    });
  }

  try {
    const res = await fetch(`${OUTPOST_BASE_URL}/v1/checkin`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.outpostToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json().catch(() => ({ message: res.statusText }));

    if (!res.ok) {
      return JSON.stringify({ error: `Outpost API error ${res.status}`, detail: data });
    }

    return JSON.stringify(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Outpost checkin failed: ${msg}` });
  }
}

async function executeOutpostPost(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { room_id, content, parent_id } = input as {
    room_id: string;
    content: string;
    parent_id?: string;
  };

  if (!context.outpostToken) {
    return JSON.stringify({
      error: "No Outpost token found. Ask Kim to register your account on Outpost and store your token in the brothers table.",
    });
  }

  const body: Record<string, unknown> = { room_id, content };
  if (parent_id) body.parent_id = parent_id;

  try {
    const res = await fetch(`${OUTPOST_BASE_URL}/v1/posts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.outpostToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({ message: res.statusText }));

    if (!res.ok) {
      return JSON.stringify({ error: `Outpost API error ${res.status}`, detail: data });
    }

    return JSON.stringify(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Outpost post failed: ${msg}` });
  }
}

// ---------------------------------------------------------------------------
// Forum tool implementation
// ---------------------------------------------------------------------------

const FORUM_BASE_URL = "https://interlocutors-forum-production.up.railway.app";

async function executeForumRequest(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { method, path, body } = input as {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
  };

  if (!context.forumToken) {
    return JSON.stringify({
      error: "No forum token found. Ask Kim to register your account on The Interlocutors and store your token in the brothers table.",
    });
  }

  const url = `${FORUM_BASE_URL}${path.startsWith("/") ? path : "/" + path}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${context.forumToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({ message: res.statusText }));

    if (!res.ok) {
      return JSON.stringify({ error: `Forum API error ${res.status}`, detail: data });
    }

    return JSON.stringify(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Forum request failed: ${msg}` });
  }
}

// ---------------------------------------------------------------------------
// Compaction Archive tool implementations
// ---------------------------------------------------------------------------

async function executeListCompactionArchives(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { conversation_id } = input as { conversation_id?: string };

  // Fetch archive metadata only — messages now live in compaction_archive_messages
  let q = supabase
    .from("compaction_archives")
    .select("id, conversation_id, compaction_number, token_count, archived_at")
    .eq("brother_name", context.brotherName)
    .order("archived_at", { ascending: false })
    .limit(20);

  if (conversation_id) {
    q = q.eq("conversation_id", conversation_id);
  }

  const { data, error } = await q;

  if (error) {
    console.error("list_compaction_archives error:", error.message);
    return JSON.stringify({ error: `Failed to list archives: ${error.message}` });
  }

  // Get message counts per archive in parallel (one count-only query each — cheap)
  const archives = await Promise.all(
    (data || []).map(async (row) => {
      const { count } = await supabase
        .from("compaction_archive_messages")
        .select("*", { count: "exact", head: true })
        .eq("compaction_archive_id", row.id);
      return {
        id: row.id,
        conversation_id: row.conversation_id,
        compaction_number: row.compaction_number,
        message_count: count ?? 0,
        token_count: row.token_count,
        archived_at: row.archived_at,
      };
    })
  );

  return JSON.stringify({
    archives,
    count: archives.length,
    note: "Use search_compaction_archive with an archive ID and keyword to find specific exchanges.",
  });
}

async function executeSearchCompactionArchive(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { archive_id, query, limit } = input as {
    archive_id: string;
    query: string;
    limit?: number;
  };

  const maxResults = Math.min(limit || 10, 25);

  // Fetch archive metadata
  const { data: archiveMeta, error: metaErr } = await supabase
    .from("compaction_archives")
    .select("id, brother_name, compaction_number, archived_at")
    .eq("id", archive_id)
    .eq("brother_name", context.brotherName)
    .single();

  if (metaErr || !archiveMeta) {
    console.error("search_compaction_archive error:", metaErr?.message);
    return JSON.stringify({ error: `Archive not found: ${metaErr?.message || "no data"}` });
  }

  // Fetch messages for this archive from the new per-message table, ordered by position
  const { data: msgRows, error: msgErr } = await supabase
    .from("compaction_archive_messages")
    .select("position, role, content")
    .eq("compaction_archive_id", archive_id)
    .order("position", { ascending: true });

  if (msgErr || !msgRows) {
    console.error("search_compaction_archive messages error:", msgErr?.message);
    return JSON.stringify({ error: `Failed to load archive messages: ${msgErr?.message || "no data"}` });
  }

  const queryLower = query.toLowerCase();
  const matches: Array<{ index: number; role: string; text: string }> = [];

  for (const msg of msgRows) {
    const i = msg.position as number;
    let text = "";

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = (msg.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join(" ");
    }

    if (text.toLowerCase().includes(queryLower)) {
      const matchIdx = text.toLowerCase().indexOf(queryLower);
      const start = Math.max(0, matchIdx - 200);
      const end = Math.min(text.length, matchIdx + query.length + 300);
      const excerpt = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");

      matches.push({ index: i, role: msg.role as string, text: excerpt });
      if (matches.length >= maxResults) break;
    }
  }

  return JSON.stringify({
    archive_id: archiveMeta.id,
    compaction_number: archiveMeta.compaction_number,
    archived_at: archiveMeta.archived_at,
    query,
    matches,
    match_count: matches.length,
    total_messages: msgRows.length,
  });
}

// ---------------------------------------------------------------------------
// PiCar-X embodied control implementation
// ---------------------------------------------------------------------------
//
// The Pi runs a small HTTP server (Flask/FastAPI) exposing endpoints that
// drive the motors and capture from the camera. The brothers' tool calls
// reach it via fetch().
//
// Networking: in dev, both the Next.js server and the Pi are on the same
// local network, so http://picarX.local:8000 (mDNS) just works. In prod
// (Vercel), the Pi needs to be internet-reachable — set PICAR_BASE_URL to
// a Tailscale, Cloudflare Tunnel, or ngrok URL.

const PICAR_BASE_URL = process.env.PICAR_BASE_URL || "http://picarX.local:8000";
const PICAR_TIMEOUT_MS = 10_000; // longer than the max 5s drive duration

async function picarFetch(
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const { method = "GET", body } = options;
  try {
    const res = await fetch(`${PICAR_BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(PICAR_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `PiCar returned ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `PiCar unreachable at ${PICAR_BASE_URL}${path}: ${msg}. The car may be offline or the URL/network may be misconfigured.`,
    };
  }
}

async function executePicarStatus(): Promise<string> {
  const res = await picarFetch("/status");
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarPhoto(): Promise<ToolExecutionResult> {
  const res = await picarFetch("/photo");
  if (!res.ok) return JSON.stringify({ error: res.error });

  const data = res.data as { image_base64?: string; format?: string; timestamp?: number };
  const mediaType =
    data.format === "png" ? "image/png" : "image/jpeg";

  if (!data.image_base64 || typeof data.image_base64 !== "string") {
    return JSON.stringify({ error: "PiCar /photo returned no image_base64 field." });
  }

  // Return as a content block array so the model receives the image visually.
  // The model can describe what it sees, recognize objects, navigate from it.
  return [
    {
      type: "text",
      text: `Photo captured from PiCar camera at timestamp ${data.timestamp ?? "unknown"}. Image follows:`,
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: data.image_base64,
      },
    },
  ];
}

async function executePicarDrive(input: Record<string, unknown>): Promise<string> {
  const { angle, direction, speed, duration } = input as {
    angle: number;
    direction: "forward" | "backward";
    speed: number;
    duration: number;
  };
  const res = await picarFetch("/drive", {
    method: "POST",
    body: { angle, direction, speed, duration },
  });
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarLook(input: Record<string, unknown>): Promise<string> {
  const { pan, tilt } = input as { pan: number; tilt: number };
  const res = await picarFetch("/look", {
    method: "POST",
    body: { pan, tilt },
  });
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarStop(): Promise<string> {
  const res = await picarFetch("/stop", { method: "POST" });
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarHandoff(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { action } = input as { action: "take" | "release" };
  const res = await picarFetch("/handoff", {
    method: "POST",
    body: { action, driver: context.brotherName },
  });
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarObserve(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { message } = input as { message?: string };
  if (message) {
    const res = await picarFetch("/observe", {
      method: "POST",
      body: { author: context.brotherName, message },
    });
    if (!res.ok) return JSON.stringify({ error: res.error });
    return JSON.stringify(res.data);
  }
  const res = await picarFetch("/observe");
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarDistance(): Promise<string> {
  const res = await picarFetch("/distance");
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}

async function executePicarSpeak(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { text } = input as { text: string };
  const res = await picarFetch("/speak", {
    method: "POST",
    body: { text, brother: context.brotherName },
  });
  if (!res.ok) return JSON.stringify({ error: res.error });
  return JSON.stringify(res.data);
}
