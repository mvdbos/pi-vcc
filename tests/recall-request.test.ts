import { describe, it, expect } from "bun:test";
import { parseToolRequest } from "../src/core/recall-request";
import { ignoredNote } from "../src/core/recall-run";

describe("parseToolRequest", () => {
  it("does not report filler defaults as ignored", () => {
    const r = parseToolRequest({ query: "auth", page: 1, expand: [], mode: "hybrid", scope: "lineage" });
    expect(r.action.kind).toBe("search");
    expect(r.ignored).toBeUndefined();
    expect(ignoredNote(r)).toBe("");
  });

  // 0f00af1: expand next to query was once silently turned into a search;
  // now expand wins and the dropped query is named.
  it("names the query dropped by expand", () => {
    const r = parseToolRequest({ query: "auth", expand: [4], page: 2 });
    expect(r.action).toEqual({ kind: "expand", indices: [4] });
    expect(ignoredNote(r)).toBe("Ignored: query, page (expand runs alone; send the rest in a separate call).\n\n");
  });

  it("keeps page for range and names the query", () => {
    const r = parseToolRequest({ range: [10, 50], page: 2, query: "auth" });
    expect(r.action).toEqual({ kind: "range", range: [10, 50], page: 2 });
    expect(r.ignored).toEqual(["query"]);
  });

  it("names everything touched does not use", () => {
    const r = parseToolRequest({ mode: "touched", query: "x", expand: [1], page: 2 });
    expect(r.action.kind).toBe("touched");
    expect(r.ignored).toEqual(["query", "expand"]);
  });

  it("names page without anything to page", () => {
    const r = parseToolRequest({ page: 3 });
    expect(r.action.kind).toBe("recent");
    expect(ignoredNote(r)).toBe("Ignored: page (page applies to query or range results).\n\n");
  });
});
