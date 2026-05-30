import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

let _client: Anthropic | null = null;
let _envLoaded = false;

function loadEnv() {
  if (_envLoaded) return;
  _envLoaded = true;
  try {
    const envPath = join(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local may not exist in production
  }
}

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    loadEnv();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY — add it to .env.local");
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export const COMPACTION_BETA = "compact-2026-01-12";
export const COMPACTION_TYPE = "compact_20260112";
export const MODEL = "claude-opus-4-6";
export const DEFAULT_MAX_TOKENS = 8192;
// Compaction trigger: at this many input tokens (true context size — fresh +
// cached + cache-creation), context_management fires and we run our sliding
// window compaction.
//
// Edit history:
//   - 400K → 350K on 2026-04-27 for cost reduction
//   - 350K → 400K on 2026-05-02: 1h cache TTL + hardened compaction were
//     handling cost reduction effectively; restoring 400K for longer
//     unbroken context windows + fewer compaction events per conversation
//   - 2026-05-09: triggers became per-brother. Source of truth moved to
//     BROTHER_CONFIGS[brotherName].compactionTrigger in src/lib/types.ts
//     so backend and frontend share the same value. DEFAULT_TRIGGER_TOKENS
//     stays here only as a final fallback for unknown brothers and for any
//     code path that doesn't have a brother name available.
//
// System prompt + tools + last-message prefix are cached at 1h TTL so the
// bulk of each turn's input tokens are billed at ~10% of input cost.
export { DEFAULT_COMPACTION_TRIGGER as DEFAULT_TRIGGER_TOKENS, getTriggerForBrother } from "./types";
