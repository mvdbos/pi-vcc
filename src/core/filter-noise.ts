import type { NormalizedBlock } from "../types";

const NOISE_TOOLS = new Set([
  "TodoWrite", "TodoRead", "ToolSearch", "WebSearch",
  "AskUser", "ExitSpecMode", "GenerateDroid",
]);

const NOISE_STRINGS = [
  "Continue from where you left off.",
  "No response requested.",
  "IMPORTANT: TodoWrite was not called yet.",
];

const XML_WRAPPER_RE = /<(system-reminder|ide_opened_file|command-message|context-window-usage)[^>]*>[\s\S]*?<\/\1>/g;

// Content filtering happens after cut selection: keep generated user-turn
// boundaries, but omit only Goal's complete scheduling-only message shape.
const GOAL_CONTINUATION_RE = /^Continue the active \/goal ([^\s:<>]+) \(#([1-9]\d*)\)\.\n\n<!-- pi-goal-continuation:\1:\2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} -->$/;

const isNoiseUserBlock = (text: string): boolean => {
  const trimmed = text.trim();
  if (GOAL_CONTINUATION_RE.test(trimmed)) return true;
  if (NOISE_STRINGS.some((s) => trimmed.includes(s))) return true;
  const stripped = trimmed.replace(XML_WRAPPER_RE, "").trim();
  return stripped.length === 0;
};

const cleanUserText = (text: string): string =>
  text.replace(XML_WRAPPER_RE, "").trim();

export const filterNoise = (blocks: NormalizedBlock[]): NormalizedBlock[] => {
  const out: NormalizedBlock[] = [];
  for (const b of blocks) {
    if (b.kind === "tool_call" && NOISE_TOOLS.has(b.name)) continue;
    if (b.kind === "tool_result" && NOISE_TOOLS.has(b.name)) continue;
    if (b.kind === "user") {
      if (isNoiseUserBlock(b.text)) continue;
      const cleaned = cleanUserText(b.text);
      if (!cleaned) continue;
      out.push({ kind: "user", text: cleaned });
      continue;
    }
    out.push(b);
  }
  return out;
};
