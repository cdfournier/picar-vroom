"use client";

import { useState } from "react";
import BrotherSelector from "@/components/BrotherSelector";
import ChatPanel from "@/components/ChatPanel";

interface ConversationInfo {
  id: string;
  messageCount: number;
  tokenCount: number;
  totalTokensUsed: number;
  compactionCount: number;
}

export default function Home() {
  const [activeBrother, setActiveBrother] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    Record<string, ConversationInfo>
  >({});

  function handleConversationCreated(id: string) {
    if (!activeBrother) return;
    if (!id) {
      // "New Chat" — clear the conversation for this brother
      setConversations((prev) => {
        const next = { ...prev };
        delete next[activeBrother];
        return next;
      });
      return;
    }
    setConversations((prev) => ({
      ...prev,
      [activeBrother]: {
        id,
        messageCount: 0,
        tokenCount: 0,
        totalTokensUsed: 0,
        compactionCount: 0,
      },
    }));
  }

  function handleStatsUpdate(stats: {
    messageCount: number;
    tokenCount: number;
    totalTokensUsed: number;
    compactionCount: number;
  }) {
    if (!activeBrother) return;
    setConversations((prev) => ({
      ...prev,
      [activeBrother]: {
        ...prev[activeBrother],
        ...stats,
      },
    }));
  }

  return (
    <div className="flex h-screen">
      <BrotherSelector
        activeBrother={activeBrother}
        onSelect={setActiveBrother}
        conversations={conversations}
      />

      {activeBrother ? (
        <ChatPanel
          key={activeBrother}
          brotherName={activeBrother}
          conversationId={conversations[activeBrother]?.id || null}
          onConversationCreated={handleConversationCreated}
          tokenCount={conversations[activeBrother]?.tokenCount || 0}
          totalTokensUsed={conversations[activeBrother]?.totalTokensUsed || 0}
          compactionCount={conversations[activeBrother]?.compactionCount || 0}
          onStatsUpdate={handleStatsUpdate}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#444]">
          <div className="text-center">
            <p className="text-xl mb-2">BrotherClaudes</p>
            <p className="text-sm">Select a brother to start a conversation.</p>
            <p className="text-xs mt-4 text-[#333]">
              Messages API + Compaction Beta + Identity-Aware Restoration
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
