import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getLastCompactionStats, scheduleCompactionStatsNotify } from "../hooks/before-compact";
import { buildPiVccCustomInstructions, parseKeepAndPrompt } from "../core/compact-args";

export const registerPiVccCommand = (pi: ExtensionAPI) => {
  pi.registerCommand("pi-vcc", {
    description: "Compact conversation with pi-vcc structured summary",
    handler: async (args: string, ctx) => {
      const { followUpPrompt, keepUserTurns } = parseKeepAndPrompt(args);
      ctx.compact({
        customInstructions: buildPiVccCustomInstructions(keepUserTurns),
        onComplete: () => {
          const stats = getLastCompactionStats();
          if (stats) {
            scheduleCompactionStatsNotify(ctx, stats);
          } else {
            ctx.ui.notify("Compacted with pi-vcc", "info");
          }
          if (followUpPrompt) {
            try {
              void Promise.resolve(pi.sendUserMessage(followUpPrompt)).catch(() => {});
            } catch {}
          }
        },
        onError: (err) => {
          if (err.message === "Compaction cancelled" || err.message === "Already compacted") {
            ctx.ui.notify("Nothing to compact", "warning");
          } else if (err.message.startsWith("Nothing to compact")) {
            // Pi throws this before any extension hook runs: everything still fits in
            // the recent part it always keeps (compaction.keepRecentTokens).
            ctx.ui.notify(
              "Nothing to compact yet: the whole session still fits in the recent part Pi always keeps " +
                "(compaction.keepRecentTokens in Pi settings). Try again once the session is longer.",
              "warning",
            );
          } else {
            ctx.ui.notify(`Compaction failed: ${err.message}`, "error");
          }
        },
      });
    },
  });
};
