import { NextRequest, NextResponse } from "next/server";
import { sendMessage, getConversation } from "@/lib/conversation";

// POST /api/compact — trigger manual compaction for a conversation
export async function POST(req: NextRequest) {
  const { conversationId } = await req.json() as { conversationId?: string };

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    console.log(`[compact] Manual compaction requested for ${conversationId}. Token count: ${conversation.tokenCount}, Messages: ${conversation.messages.length}`);

    // Send a small prompt with forceCompact — the low trigger threshold
    // will cause compaction to fire before generating a response
    const response = await sendMessage(
      conversationId,
      "[System: Manual compaction triggered. Your context will now be compressed and your identity restored from Supabase.]",
      { forceCompact: true }
    );

    console.log(`[compact] Result for ${conversationId}: compacted=${response.compacted}, tokenUsage=${JSON.stringify(response.tokenUsage)}`);
    return NextResponse.json(response);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("Compact error:", err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
