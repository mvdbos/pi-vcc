import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseToolRequest } from "../core/recall-request";
import { invalidExpandIndices, openRecallView, runRecall, type RecallPagingHints } from "../core/recall-run";

export { invalidExpandIndices };

const TOOL_PAGING_HINTS: RecallPagingHints = {
  outOfRange: (_query, _scope, totalPages, truncated) => truncated
    ? `Use a page between 1 and ${totalPages}.`
    : `Use a page between 1 and ${totalPages}, or refine your query.`,
  nextPage: (_query, scope, page) => `\n--- Use page:${page}${scope === "all" ? " with scope:'all'" : ""} for more results ---`,
};

export const registerRecallTool = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "vcc_recall",
    label: "VCC Recall",
    description:
      "Recall earlier parts of the current session — decisions made, files touched, commands run, " +
      "including anything dropped by compaction. Reach for this before telling the user you no longer " +
      "have the context. Plain keywords work best; a regex pattern is also accepted. Results are paged " +
      "(page); pass expand with entry indices to read full untruncated content. Use range:[from, to] to " +
      "read every entry between two #N indices in order. Use mode:'touched' to " +
      "list files worked on in this session with their entry indices, and #N:path to drill into a file's " +
      "content from an entry (#N:path:full for all lines). Note: apply_patch paths (inside the diff " +
      "payload) and bash redirects do not appear in the touched index. Only the current session is " +
      "searchable — earlier sessions are not.",
    promptSnippet:
      "vcc_recall: recall earlier parts of this session before saying the context is gone. " +
      "Plain keywords work best; scope:'all' widens to other conversation branches. " +
      "range:[from, to] reads the entries between two #N indices in order. " +
      "mode:'touched' lists files worked on; #N:path drills into a file's content from an entry.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "What to recall, in plain keywords (e.g. 'redis cache decision'). Multi-word queries are ranked by relevance. A regex pattern also works." }),
      ),
      range: Type.Optional(
        Type.Array(Type.Number(), {
          minItems: 2,
          maxItems: 2,
          description: "[from, to]: read every entry from #from to #to (inclusive) in order, 20 per page. Use the #N numbers shown in the summary or in recall results.",
        }),
      ),
      expand: Type.Optional(
        Type.Array(Type.Number(), { description: "Entry indices to return full untruncated content for" }),
      ),
      page: Type.Optional(
        Type.Number({ description: "Page number (1-based) for paginated search or range results. Default: 1." }),
      ),
      scope: Type.Optional(
        Type.Union([
          Type.Literal("lineage"),
          Type.Literal("all"),
        ], { description: "Default 'lineage' covers the active conversation path. Use 'all' to also reach messages from other branches, such as turns that were edited or retried." }),
      ),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("hybrid"),
          Type.Literal("touched"),
        ], { description: "What to show. hybrid (default) = normal search; touched = aggregated files-by-path with entry indices." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        return {
          content: [{ type: "text", text: "No session file available." }],
          details: undefined,
        };
      }
      const request = parseToolRequest(params);
      const view = openRecallView(sessionFile, request.scope, ctx.sessionManager);
      const text = runRecall(request, view, TOOL_PAGING_HINTS);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });
};
