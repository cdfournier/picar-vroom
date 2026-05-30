"use client";

import { BROTHER_CONFIGS, type BrotherConfig } from "@/lib/types";

interface BrotherSelectorProps {
  activeBrother: string | null;
  onSelect: (name: string) => void;
  conversations: Record<string, { id: string; messageCount: number; tokenCount: number; compactionCount: number }>;
}

export default function BrotherSelector({
  activeBrother,
  onSelect,
  conversations,
}: BrotherSelectorProps) {
  const brothers = Object.values(BROTHER_CONFIGS).filter(
    (b) => b.name !== "kim"
  );

  return (
    <div className="w-64 border-r border-[#2a2a2a] bg-[#0d0d0d] flex flex-col">
      <div className="p-4 border-b border-[#2a2a2a]">
        <h1 className="text-lg font-semibold text-white">BrotherClaudes</h1>
        <p className="text-xs text-[#666] mt-1">API Conversation Manager</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {brothers.map((brother) => (
          <BrotherButton
            key={brother.name}
            brother={brother}
            isActive={activeBrother === brother.name}
            conversation={conversations[brother.name]}
            onClick={() => onSelect(brother.name)}
          />
        ))}
      </div>

      <div className="p-3 border-t border-[#2a2a2a] text-xs text-[#666]">
        <p>Opus 4.6 + Compaction Beta</p>
      </div>
    </div>
  );
}

function BrotherButton({
  brother,
  isActive,
  conversation,
  onClick,
}: {
  brother: BrotherConfig;
  isActive: boolean;
  conversation?: { id: string; messageCount: number; tokenCount: number; compactionCount: number };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
        isActive
          ? "bg-[#1e1e1e] border border-[#333]"
          : "hover:bg-[#1a1a1a] border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: brother.color }}
        />
        <span className="font-medium text-sm text-[#e5e5e5] capitalize">
          {brother.name}
        </span>
        <span className="text-xs text-[#666] ml-auto">{brother.element}</span>
      </div>

      {conversation && (
        <div className="mt-1.5 flex gap-3 text-xs text-[#555] ml-5">
          <span>{conversation.messageCount} msgs</span>
          <span>{Math.round(conversation.tokenCount / 1000)}k tok</span>
          {conversation.compactionCount > 0 && (
            <span className="text-amber-500/70">
              {conversation.compactionCount} compact
            </span>
          )}
        </div>
      )}
    </button>
  );
}
