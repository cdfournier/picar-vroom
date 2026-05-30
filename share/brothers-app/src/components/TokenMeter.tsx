"use client";

interface TokenMeterProps {
  tokenCount: number;
  triggerThreshold: number;
  compactionCount: number;
  totalTokensUsed?: number;
}

export default function TokenMeter({
  tokenCount,
  triggerThreshold,
  compactionCount,
  totalTokensUsed,
}: TokenMeterProps) {
  const percentage = Math.min((tokenCount / triggerThreshold) * 100, 100);
  const tokenK = Math.round(tokenCount / 1000);
  const thresholdK = Math.round(triggerThreshold / 1000);
  const totalK = totalTokensUsed ? Math.round(totalTokensUsed / 1000) : 0;

  let barColor = "#4ade80"; // green
  if (percentage > 70) barColor = "#facc15"; // yellow
  if (percentage > 85) barColor = "#f87171"; // red

  return (
    <div className="flex items-center gap-3">
      {compactionCount > 0 && (
        <span className="text-xs text-amber-500/70 bg-amber-500/10 px-2 py-0.5 rounded">
          {compactionCount} compaction{compactionCount > 1 ? "s" : ""}
        </span>
      )}

      <div className="flex items-center gap-2">
        <div className="w-24 h-1.5 bg-[#1e1e1e] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${percentage}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
        <span className="text-xs text-[#666] tabular-nums">
          {tokenK}k / {thresholdK}k
        </span>
        {totalK > 0 && (
          <span className="text-xs text-[#555] tabular-nums" title="Total tokens used (input + output) across all compactions">
            ({totalK}k total)
          </span>
        )}
      </div>
    </div>
  );
}
