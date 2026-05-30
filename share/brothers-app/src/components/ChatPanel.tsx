"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { BROTHER_CONFIGS, getTriggerForBrother } from "@/lib/types";
import TokenMeter from "./TokenMeter";

// Max image dimension (longest edge) before upload. Anthropic rejects images
// >2000px in many-image requests and internally downscales >1568px for vision,
// so 1568 is the sweet spot: under the hard limit, no wasted tokens. Images
// larger than this are resized client-side before being sent to a brother.
const MAX_IMAGE_DIMENSION = 1568;

interface ContentSegment {
  type: "text" | "tool_indicator";
  content: string;
  toolName?: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  segments?: ContentSegment[];
  timestamp: string;
  compacted?: boolean;
  fileName?: string;
}

interface AttachedFile {
  name: string;
  content: string;
  type: "text" | "image" | "pdf";
  mimeType?: string; // e.g. "image/jpeg", "image/png"
}

interface ChatPanelProps {
  brotherName: string;
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  tokenCount: number;
  totalTokensUsed: number;
  compactionCount: number;
  onStatsUpdate: (stats: { messageCount: number; tokenCount: number; totalTokensUsed: number; compactionCount: number }) => void;
}

export default function ChatPanel({
  brotherName,
  conversationId,
  onConversationCreated,
  tokenCount,
  totalTokensUsed,
  compactionCount,
  onStatsUpdate,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [resumedConversation, setResumedConversation] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const brother = BROTHER_CONFIGS[brotherName];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [brotherName]);

  // Load most recent conversation for this brother on mount
  const loadRecentConversation = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/conversations?brother=${brotherName}`);
      if (!res.ok) return;

      const conversations = await res.json();
      if (conversations.length === 0) return;

      // Take the most recent conversation
      const recent = conversations[0];
      if (recent.messageCount === 0) return;

      // Load its messages
      const msgRes = await fetch(`/api/conversations/${recent.id}/messages`);
      if (!msgRes.ok) return;

      const data = await msgRes.json();

      // Set the conversation ID in the parent
      onConversationCreated(recent.id);

      // Load messages into chat
      const loadedMessages: Message[] = data.messages.map((m: { role: string; content: string; timestamp: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: m.timestamp || new Date().toISOString(),
      }));

      setMessages(loadedMessages);
      setResumedConversation(true);

      // Update stats
      onStatsUpdate({
        messageCount: data.messages.length,
        tokenCount: data.tokenCount || 0,
        totalTokensUsed: data.totalTokensUsed || 0,
        compactionCount: data.compactionCount || 0,
      });
    } catch (err) {
      console.error("Failed to load recent conversation:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, [brotherName, onConversationCreated, onStatsUpdate]);

  useEffect(() => {
    // Only auto-load if we don't already have a conversation
    if (!conversationId) {
      loadRecentConversation();
    }
  // We only want this to run once on mount per brother, not when conversationId changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brotherName]);

  // Reset messages when brother changes
  useEffect(() => {
    setMessages([]);
    setError(null);
    setAttachedFiles([]);
    setResumedConversation(false);
  }, [brotherName]);

  function handleNewChat() {
    setMessages([]);
    setError(null);
    setAttachedFiles([]);
    setResumedConversation(false);
    // Clear the conversation ID in parent — next message will create a new one
    onConversationCreated("");
    // Reset the token/stats counter
    onStatsUpdate({ messageCount: 0, tokenCount: 0, totalTokensUsed: 0, compactionCount: 0 });
  }

  const [compacting, setCompacting] = useState(false);

  async function handleCompact() {
    if (!conversationId || compacting || loading) return;
    setCompacting(true);
    setError(null);
    try {
      const res = await fetch("/api/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Compaction failed");
      } else {
        // Replace chat with compaction marker + post-compaction response
        // Old messages are archived in Supabase — clear the UI to reflect the fresh context
        const now = new Date().toISOString();
        const newMessages: Message[] = [
          {
            role: "system" as const,
            content: `Compaction event #${data.compactionCount || "?"}. Context was compressed and identity was re-injected from Supabase. Previous messages archived.`,
            timestamp: now,
            compacted: true,
          },
        ];
        if (data.content) {
          newMessages.push({ role: "assistant" as const, content: data.content, timestamp: now });
        }
        setMessages(newMessages);
        onStatsUpdate({
          messageCount: data.messageCount || 0,
          tokenCount: data.tokenCount || 0,
          totalTokensUsed: data.totalTokensUsed || 0,
          compactionCount: data.compactionCount || 0,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compaction failed");
    } finally {
      setCompacting(false);
    }
  }

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;

    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brotherName }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to create conversation");
    }

    const data = await res.json();
    onConversationCreated(data.id);
    return data.id;
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      await processFile(file);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function processFile(file: File) {

    // Check file size (max 10MB for images/PDFs, 5MB for text)
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const maxSize = (isImage || isPdf) ? 10 * 1024 * 1024 : 5 * 1024 * 1024;

    if (file.size > maxSize) {
      setError(`File too large: ${file.name}. Maximum size is ${maxSize / (1024 * 1024)}MB.`);
      return;
    }

    // Handle images — resize down if too large, then read as base64
    if (isImage && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      // GIFs pass through untouched (canvas resize would drop animation).
      if (file.type === "image/gif") {
        const base64 = await readFileAsBase64(file);
        setAttachedFiles((prev) => [...prev, { name: file.name, content: base64, type: "image", mimeType: file.type }]);
        setError(null);
        return;
      }
      // JPEG / PNG / WebP: resize to <= MAX_IMAGE_DIMENSION on the long edge.
      try {
        const { base64, mimeType } = await resizeImageToBase64(file);
        setAttachedFiles((prev) => [...prev, { name: file.name, content: base64, type: "image", mimeType }]);
        setError(null);
      } catch {
        // Fallback: if resize fails for any reason, send the original.
        const base64 = await readFileAsBase64(file);
        setAttachedFiles((prev) => [...prev, { name: file.name, content: base64, type: "image", mimeType: file.type }]);
        setError(null);
      }
      return;
    }

    // Handle PDFs — read as base64 (server will extract text)
    if (isPdf) {
      const base64 = await readFileAsBase64(file);
      setAttachedFiles((prev) => [...prev, { name: file.name, content: base64, type: "pdf", mimeType: "application/pdf" }]);
      setError(null);
      return;
    }

    const supportedTypes = [
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "text/html",
      "text/css",
      "text/javascript",
      "application/javascript",
      "application/typescript",
    ];

    const textExtensions = [".txt", ".md", ".csv", ".json", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".yaml", ".yml", ".toml", ".xml", ".sql", ".sh", ".env", ".log"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();

    if (supportedTypes.includes(file.type) || textExtensions.includes(ext)) {
      // Read as text
      const text = await file.text();
      const truncated = text.length > 50000
        ? text.slice(0, 50000) + "\n\n[...truncated — file exceeds 50k characters]"
        : text;

      setAttachedFiles((prev) => [...prev, { name: file.name, content: truncated, type: "text" }]);
      setError(null);
    } else {
      setError(`Unsupported file type: ${file.type || ext}. Supported: text, code, CSV, JSON, JPEG, PNG, PDF.`);
    }
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:...;base64, prefix — we send raw base64
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Resize an image down so its longest edge is <= MAX_IMAGE_DIMENSION before
  // converting to base64. Two reasons:
  //   1. Anthropic rejects images >2000px on the long edge in many-image
  //      requests (the error Kim hit with Retina screenshots at 2880x1800).
  //   2. Anthropic internally downscales images >1568px for vision anyway,
  //      so anything above that is wasted upload + wasted tokens.
  // Images already within the limit are returned as-is (no quality loss).
  // GIFs are passed through untouched (canvas resize would drop animation).
  function resizeImageToBase64(
    file: File
  ): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const longest = Math.max(img.width, img.height);

        // Already small enough — return original bytes, no re-encoding.
        if (longest <= MAX_IMAGE_DIMENSION) {
          readFileAsBase64(file)
            .then((base64) => resolve({ base64, mimeType: file.type }))
            .catch(reject);
          return;
        }

        const scale = MAX_IMAGE_DIMENSION / longest;
        const newWidth = Math.round(img.width * scale);
        const newHeight = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context for image resize"));
          return;
        }
        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        // Preserve PNG (crisp text/transparency for screenshots); everything
        // else exports as JPEG. Token cost is dimension-based, so format only
        // affects upload size — PNG keeps screenshot text legible.
        const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(outputType, 0.9);
        const base64 = dataUrl.split(",")[1];
        resolve({ base64, mimeType: outputType });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not load image for resizing"));
      };
      img.src = objectUrl;
    });
  }

  function removeAttachment(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || loading) return;

    // Build the message payload — for images/PDFs we send structured data
    let messageContent = text;
    const filePayloads: { name: string; content: string; type: string; mimeType?: string }[] = [];

    if (attachedFiles.length > 0) {
      const binaryFiles = attachedFiles.filter((f) => f.type === "image" || f.type === "pdf");
      const textFiles = attachedFiles.filter((f) => f.type === "text");

      // Binary files go as structured payloads
      for (const f of binaryFiles) {
        filePayloads.push({ name: f.name, content: f.content, type: f.type, mimeType: f.mimeType });
      }

      // Text files get inlined
      if (textFiles.length > 0) {
        const textBlocks = textFiles.map((f) => `<document name="${f.name}">\n${f.content}\n</document>`).join("\n\n");
        messageContent = text ? `${text}\n\n${textBlocks}` : `Here are some files I'd like to share:\n\n${textBlocks}`;
      }

      if (!text && textFiles.length === 0) {
        const names = binaryFiles.map((f) => f.name).join(", ");
        messageContent = `Here are files I'd like to share: ${names}`;
      }
    }

    setInput("");
    setError(null);
    setLoading(true);

    const fileNames = attachedFiles.map((f) => `📎 ${f.name}`).join("\n");
    const displayContent = attachedFiles.length > 0
      ? text
        ? `${text}\n\n${fileNames}`
        : fileNames
      : text;

    const userMsg: Message = {
      role: "user",
      content: displayContent,
      timestamp: new Date().toISOString(),
      fileName: attachedFiles.length > 0 ? attachedFiles.map((f) => f.name).join(", ") : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setAttachedFiles([]);

    try {
      const convId = await ensureConversation();

      const chatBody: Record<string, unknown> = { conversationId: convId, message: messageContent };
      if (filePayloads.length === 1) chatBody.file = filePayloads[0];
      else if (filePayloads.length > 1) chatBody.files = filePayloads;

      const maxRetries = 3;
      let attempt = 0;
      let res: Response | null = null;

      while (attempt <= maxRetries) {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatBody),
        });

        // If conversation was lost (server restart), create a new one and retry
        if (res.status === 404 && attempt === 0) {
          const newRes = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ brotherName }),
          });
          if (!newRes.ok) throw new Error("Failed to recreate conversation");
          const newData = await newRes.json();
          onConversationCreated(newData.id);
          chatBody.conversationId = newData.id;
          continue;
        }

        // Handle 429 rate limit with countdown retry
        if (res.status === 429) {
          attempt++;
          if (attempt > maxRetries) {
            throw new Error("Rate limit reached. Please wait a minute and try again.");
          }

          const retryData = await res.json().catch(() => ({ retryAfter: 60 }));
          const waitSeconds = retryData.retryAfter || 60;

          // Show countdown in UI
          await new Promise<void>((resolve) => {
            let remaining = waitSeconds;
            setRetryCountdown(remaining);
            const interval = setInterval(() => {
              remaining--;
              if (remaining <= 0) {
                clearInterval(interval);
                setRetryCountdown(null);
                resolve();
              } else {
                setRetryCountdown(remaining);
              }
            }, 1000);
          });

          continue;
        }

        // Any other non-OK status — break out and handle as error
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `API error: ${res.status}`);
        }

        // Success — break the retry loop
        break;
      }

      if (!res) throw new Error("No response received");

      const data = await res.json();

      if (data.compacted) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Compaction event #${data.compactionCount}. Context was compressed and identity was re-injected from Supabase.`,
            timestamp: new Date().toISOString(),
            compacted: true,
          },
        ]);
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: data.content,
        segments: data.segments || undefined,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      onStatsUpdate({
        messageCount: messages.length + 2,
        tokenCount: data.tokenUsage.input_tokens,
        totalTokensUsed: data.totalTokensUsed || 0,
        compactionCount: data.compactionCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
      setLoading(false);
      setRetryCountdown(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!brother) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#666]">
        Select a brother to start a conversation.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a2a] bg-[#0d0d0d]">
        <div className="flex items-center gap-3">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: brother.color }}
          />
          <div>
            <h2 className="font-semibold text-white capitalize">{brother.name}</h2>
            <p className="text-xs text-[#666]">{brother.fullName} — {brother.element}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#444]"
          >
            New Chat
          </button>
          <button
            onClick={handleCompact}
            disabled={!conversationId || compacting || loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#444] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {compacting ? "Compressing..." : "Compress"}
          </button>
          <TokenMeter
            tokenCount={tokenCount}
            triggerThreshold={getTriggerForBrother(brotherName)}
            compactionCount={compactionCount}
            totalTokensUsed={totalTokensUsed}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loadingHistory && (
          <div className="text-center text-[#555] mt-20">
            <p className="text-sm">Loading conversation history...</p>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="text-center text-[#444] mt-20">
            <p className="text-lg mb-2">Start a conversation with {brother.name}</p>
            <p className="text-sm">
              A new API conversation will be created with {brother.name}&apos;s restoration packet loaded.
            </p>
            <p className="text-xs text-[#333] mt-3">
              {brother.name} has tools: memory write, memory search, web search, web fetch
            </p>
          </div>
        )}

        {resumedConversation && messages.length > 0 && (
          <div className="flex justify-center mb-2">
            <div className="bg-blue-950/20 border border-blue-800/30 rounded-full px-4 py-1.5 text-xs text-blue-400/80">
              Resumed previous conversation
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            brotherColor={brother.color}
            brotherName={brother.name}
          />
        ))}

        {loading && retryCountdown === null && (
          <div className="flex items-center gap-2 text-[#666]">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: brother.color }}
            />
            <span className="text-sm">{brother.name} is thinking...</span>
          </div>
        )}

        {retryCountdown !== null && (
          <div className="flex items-center gap-2 text-[#888]">
            <span className="text-sm">Rate limited — retrying in {retryCountdown}s...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* File attachment indicator */}
      {attachedFiles.length > 0 && (
        <div className="px-5 py-2 border-t border-[#2a2a2a] bg-[#111] space-y-1">
          {attachedFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-[#888]">📎</span>
              <span className="text-[#aaa]">{file.name}</span>
              <span className="text-[#555]">
                {file.type === "image" ? "(image)" : file.type === "pdf" ? "(PDF)" : `(${(file.content.length / 1024).toFixed(1)}kb)`}
              </span>
              <button
                onClick={() => removeAttachment(i)}
                className="ml-auto text-[#666] hover:text-red-400 transition-colors text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-5 py-3 border-t border-[#2a2a2a] bg-[#0d0d0d]">
        <div className="flex gap-3 items-end">
          {/* File upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-[#1a1a1a] text-[#666] hover:text-[#999] border border-[#2a2a2a]"
            title="Attach a file"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            accept=".txt,.md,.csv,.json,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,.toml,.xml,.sql,.sh,.log,.jpg,.jpeg,.png,.gif,.webp,.pdf,image/jpeg,image/png,image/gif,image/webp,application/pdf"
          />

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${brother.name}...`}
            rows={1}
            className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-[#e5e5e5] placeholder-[#555] resize-none focus:outline-none focus:border-[#444] transition-colors"
            style={{
              minHeight: "42px",
              maxHeight: "120px",
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && attachedFiles.length === 0) || loading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: brother.color + "22",
              color: brother.color,
              border: `1px solid ${brother.color}33`,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  brotherColor,
  brotherName,
}: {
  message: Message;
  brotherColor: string;
  brotherName: string;
}) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-full px-4 py-1.5 text-xs text-amber-400/80">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-[#1e1e1e] text-[#e5e5e5] border border-[#2a2a2a]"
            : "text-[#e5e5e5]"
        }`}
        style={
          !isUser
            ? {
                backgroundColor: brotherColor + "0d",
                border: `1px solid ${brotherColor}1a`,
              }
            : undefined
        }
      >
        {!isUser && (
          <span
            className="text-xs font-medium block mb-1 capitalize"
            style={{ color: brotherColor }}
          >
            {brotherName}
          </span>
        )}
        <div className="whitespace-pre-wrap">
          {message.segments && message.segments.length > 1 ? (
            message.segments.map((seg, i) =>
              seg.type === "tool_indicator" ? (
                <div
                  key={i}
                  className="flex items-center gap-2 my-2 text-xs text-[#555]"
                >
                  <div className="flex-1 h-px bg-[#2a2a2a]" />
                  <span className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-full px-2.5 py-0.5">
                    📝 {seg.content}
                  </span>
                  <div className="flex-1 h-px bg-[#2a2a2a]" />
                </div>
              ) : (
                <span key={i}>{seg.content}</span>
              )
            )
          ) : (
            message.content
          )}
        </div>
      </div>
    </div>
  );
}
