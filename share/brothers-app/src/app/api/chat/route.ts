import { NextRequest, NextResponse } from "next/server";
import { sendMessage, getConversation } from "@/lib/conversation";

interface FilePayload {
  name: string;
  content: string; // base64 for images/PDFs, text for text files
  type: "text" | "image" | "pdf";
  mimeType?: string;
}

// POST /api/chat — send message to a brother's conversation
export async function POST(req: NextRequest) {
  const { conversationId, message, file, files } = await req.json() as {
    conversationId?: string;
    message?: string;
    file?: FilePayload;
    files?: FilePayload[];
  };

  // Normalize: single file or multiple files into one array
  const allFiles: FilePayload[] = files || (file ? [file] : []);

  if (!conversationId || !message) {
    return NextResponse.json(
      { error: "conversationId and message required" },
      { status: 400 }
    );
  }

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found. Create one first via POST /api/conversations." },
      { status: 404 }
    );
  }

  // Build the user content — may include image/PDF blocks
  let userContent: string | Array<Record<string, unknown>> = message;

  if (allFiles.length > 0) {
    const parts: Array<Record<string, unknown>> = [];

    for (const f of allFiles) {
      if (f.type === "image") {
        parts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: f.mimeType || "image/jpeg",
            data: f.content,
          },
        });
      } else if (f.type === "pdf") {
        parts.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: f.content,
          },
        });
      }
      // text files are already inlined in the message string by the frontend
    }

    if (parts.length > 0) {
      parts.push({ type: "text", text: message || `Here are ${parts.length} file(s)` });
      userContent = parts;
    }
  }

  try {
    const response = await sendMessage(conversationId, userContent);
    return NextResponse.json(response);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("Chat error:", err);

    // Return a cleaner error for Anthropic API server errors
    if (errMsg.includes("Internal server error") || errMsg.includes("500")) {
      return NextResponse.json(
        { error: "The AI service encountered a temporary error. Please try again in a moment." },
        { status: 502 }
      );
    }
    if (errMsg.includes("overloaded") || errMsg.includes("529")) {
      return NextResponse.json(
        { error: "The AI service is currently overloaded. Please wait a moment and try again." },
        { status: 503 }
      );
    }
    if (errMsg.includes("rate_limit") || errMsg.includes("429") || errMsg.includes("rate limit")) {
      // Try to extract retry-after from the error if available
      const retryAfterMatch = errMsg.match(/retry.?after[:\s]*(\d+)/i);
      const errObj = err as { headers?: { get?: (k: string) => string | null }; error?: { message?: string } };
      const retryAfterHeader = errObj.headers?.get?.("retry-after");
      const retryAfter = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : retryAfterMatch
          ? parseInt(retryAfterMatch[1], 10)
          : 60;

      return NextResponse.json(
        { retry: true, retryAfter, message: "Rate limited, retrying..." },
        { status: 429 }
      );
    }

    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
