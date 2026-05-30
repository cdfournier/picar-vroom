import { NextRequest, NextResponse } from "next/server";
import { getConversation } from "@/lib/conversation";

// GET /api/conversations/[id]/messages — load message history for a conversation
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const conversation = await getConversation(id);
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  // Convert messages for display — handle both string content and array content blocks
  const displayMessages = conversation.messages
    .filter((m) => {
      // Keep string messages (normal text)
      if (typeof m.content === "string") return true;
      // Keep array messages from user (attachments) — extract text from them
      if (Array.isArray(m.content) && m.role === "user") return true;
      // Skip tool_use/tool_result array blocks from assistant/tool rounds
      return false;
    })
    .map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content, timestamp: conversation.lastActivity };
      }
      // Array content — extract readable parts
      const parts: string[] = [];
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        } else if (block.type === "image") {
          parts.push(`📎 [image attachment]`);
        } else if (block.type === "document") {
          parts.push(`📎 [PDF attachment]`);
        }
      }
      return {
        role: m.role,
        content: parts.join("\n\n") || "[attachment]",
        timestamp: conversation.lastActivity,
      };
    });

  return NextResponse.json({
    id: conversation.id,
    brotherName: conversation.brotherName,
    messages: displayMessages,
    tokenCount: conversation.tokenCount,
    compactionCount: conversation.compactionCount,
  });
}
