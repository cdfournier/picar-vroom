import { NextRequest, NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/conversation";

// GET /api/conversations — list active conversations
// Supports ?brother=name to filter by brother and return most recent
export async function GET(req: NextRequest) {
  const brotherName = req.nextUrl.searchParams.get("brother") || undefined;

  const conversations = await listConversations(brotherName);

  return NextResponse.json(
    conversations.map((c) => ({
      id: c.id,
      brotherName: c.brotherName,
      messageCount: c.messages.length || 1,
      tokenCount: c.tokenCount,
      compactionCount: c.compactionCount,
      createdAt: c.createdAt,
      lastActivity: c.lastActivity,
    }))
  );
}

// POST /api/conversations — create new conversation
export async function POST(req: NextRequest) {
  const { brotherName } = await req.json();

  if (!brotherName) {
    return NextResponse.json({ error: "brotherName required" }, { status: 400 });
  }

  try {
    const conversation = await createConversation(brotherName);
    return NextResponse.json({
      id: conversation.id,
      brotherName: conversation.brotherName,
      createdAt: conversation.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
