import { describe, test, expect } from "bun:test";
import { filterNoise } from "../src/core/filter-noise";
import { compile, compileRanked } from "../src/core/summarize";
import { buildOwnCut } from "../src/hooks/before-compact";
import { assistantText, userMsg } from "./fixtures";

const generated = "Continue the active /goal goal-123 (#2).\n\n<!-- pi-goal-continuation:goal-123:2:12345678-1234-4321-8123-123456789abc -->";

describe("Goal scheduling prose", () => {
  test("only exact scheduling-only user blocks are filtered", () => {
    expect(filterNoise([{ kind: "user", text: generated }])).toEqual([]);
    expect(filterNoise([{ kind: "user", text: ` \n${generated}\n ` }])).toEqual([]);
    for (const text of [
      `${generated}\nVerify the new login requirement first.`,
      `Explain this marker:\n${generated}`,
      generated.replace("continuation:goal-123:2:", "continuation:other-goal:2:"),
      generated.replace("continuation:goal-123:2:", "continuation:goal-123:3:"),
      generated.replace("12345678-1234-4321-8123-123456789abc", "not-a-uuid"),
      "Continue the active /goal goal-123 (#2).",
    ]) {
      expect(filterNoise([{ kind: "user", text }])).toEqual([{ kind: "user", text }]);
    }
    expect(filterNoise([{ kind: "assistant_text", text: generated }])).toHaveLength(1);
  });

  for (const [name, compiler] of [["ordinary", compile], ["ranked", compileRanked]] as const) {
    test(`${name} summary keeps real objectives and omits scheduling text`, () => {
      const result = compiler({ messages: [
        userMsg("Repair the login validation bug."), assistantText("Validation changed."),
        userMsg(generated), assistantText("Tests passed."), userMsg("Preserve the retry behavior."),
      ] });
      expect(result).toContain("Repair the login validation bug.");
      expect(result).toContain("Preserve the retry behavior.");
      expect(result).not.toContain("pi-goal-continuation");
      expect(result).not.toContain("Continue the active /goal");
      expect(result).toContain("Tests passed.");
    });
    test(`${name} summary retains a mixed genuine user instruction`, () => {
      const result = compiler({ messages: [userMsg(`${generated}\nVerify the new login requirement first.`)] });
      expect(result).toContain("Verify the new login requirement first.");
      expect(result).toContain("pi-goal-continuation");
    });
  }

  test("generated turns still provide original compaction cut boundaries", () => {
    const messages = [userMsg("Repair login"), assistantText("First work"), userMsg(generated), assistantText("More work")];
    const entries = messages.map((message, n) => ({ type: "message", id: `m${n}`, message }));
    const cut = buildOwnCut(entries, 1);
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.firstKeptEntryId).toBe("m2");
    expect(cut.messages).toEqual(messages.slice(0, 2));
    const all = buildOwnCut(entries, 0);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.messages).toEqual(messages);
    expect(all.compactAll).toBe(true);
  });
});
