import type { Message } from "@earendil-works/pi-ai";
import { renderMessage, type RenderedEntry } from "./render-entries";
import { forEachJsonlLine } from "./jsonl";
import { isCountedMessageEntry } from "./global-indices";

export interface LoadedMessages {
  rendered: RenderedEntry[];
  rawMessages: Message[];
}

export const loadAllMessages = (
  sessionFile: string,
  full: boolean,
  allowedEntryIds?: Set<string>,
): LoadedMessages => {
  const rendered: RenderedEntry[] = [];
  const rawMessages: Message[] = [];
  let messageIndex = 0;

  const processLine = (line: Buffer) => {
    if (line.length === 0) return;
    let entry: any;
    try { entry = JSON.parse(line.toString("utf8")); } catch { return; }
    // Counting rule shared with src/core/global-indices.ts — both index
    // spaces must agree by construction.
    if (!isCountedMessageEntry(entry)) return;

    // Pi >= 1.0 persists the prompt/tool loadout as `role: "system"` message
    // entries. They still occupy a `#N` index (shared counting rule) but are
    // not conversation content, so recall never renders or searches them.
    const allowed = (!allowedEntryIds || allowedEntryIds.has(entry.id))
      && entry.message.role !== "system";
    if (allowed) {
      rendered.push(renderMessage(entry.message, messageIndex, full));
      rawMessages.push(entry.message);
    }
    messageIndex++;
  };

  // Streamed via forEachJsonlLine: large sessions can exceed V8's maximum
  // string length before parsing even starts. A missing file yields an empty
  // result — Pi does not create a new session's JSONL until its first
  // persisted entry.
  forEachJsonlLine(sessionFile, processLine);

  return { rendered, rawMessages };
};
