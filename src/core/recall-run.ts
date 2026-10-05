import { loadAllMessages, type LoadedMessages } from "./load-messages";
import { searchEntriesDetailed, getTouchedFiles } from "./search-entries";
import { formatRecallOutput, formatTouchedOutput } from "./format-recall";
import { getActiveLineageEntryIds, type LineageSessionManagerLike } from "./lineage";
import { expandEntryFile } from "./drill-down";
import type { RecallScope } from "./recall-scope";
import type { RecallRequest } from "./recall-request";

export const SEARCH_PAGE_SIZE = 5;
export const RANGE_PAGE_SIZE = 20;
export const RECENT_COUNT = 25;

/**
 * The session as one recall call sees it. Scope is applied here, once, and
 * every action reads through it. Loads are cached per call.
 */
export interface RecallView {
  sessionFile: string;
  scope: RecallScope;
  load(full: boolean): LoadedMessages;
}

export const openRecallView = (
  sessionFile: string,
  scope: RecallScope,
  sessionManager: LineageSessionManagerLike,
): RecallView => {
  const lineageEntryIds = scope === "lineage" ? getActiveLineageEntryIds(sessionManager) : undefined;
  const cache = new Map<boolean, LoadedMessages>();
  return {
    sessionFile,
    scope,
    load(full) {
      let loaded = cache.get(full);
      if (!loaded) {
        loaded = loadAllMessages(sessionFile, full, lineageEntryIds);
        cache.set(full, loaded);
      }
      return loaded;
    },
  };
};

export const invalidExpandIndices = (requested: number[], available: Set<number>): number[] =>
  requested.filter((i) => !Number.isInteger(i) || !available.has(i));

/** Surface-specific wording: the tool says page:N, the command says /pi-vcc-recall … page:N. */
export interface RecallPagingHints {
  outOfRange(query: string, scope: RecallScope, totalPages: number, truncated: boolean): string;
  nextPage(query: string, scope: RecallScope, page: number): string;
}

const IGNORED_REASON: Record<RecallRequest["action"]["kind"], string> = {
  drill: "a #N:path query runs alone",
  touched: "mode:'touched' runs alone",
  expand: "expand runs alone; send the rest in a separate call",
  range: "range runs alone; send the rest in a separate call",
  search: "",
  recent: "page applies to query or range results",
};

/** One line naming params the action did not use, so nothing is dropped silently. */
export const ignoredNote = (request: RecallRequest): string =>
  request.ignored?.length
    ? `Ignored: ${request.ignored.join(", ")} (${IGNORED_REASON[request.action.kind]}).\n\n`
    : "";

export const runRecall = (request: RecallRequest, view: RecallView, hints: RecallPagingHints): string =>
  ignoredNote(request) + runAction(request, view, hints);

const runAction = (request: RecallRequest, view: RecallView, hints: RecallPagingHints): string => {
  const { action } = request;
  const scopeAll = view.scope === "all";

  switch (action.kind) {
    case "drill": {
      // Honors scope like every other recall path: the target entry must be on
      // the active lineage unless scope:'all'. expandEntryFile keeps loading
      // unfiltered so #N stays aligned with the global message index.
      const t = action.target;
      if (!scopeAll && !view.load(false).rendered.some((m) => m.index === t.index)) {
        return `Cannot expand indices outside active lineage: ${t.index}. Use scope:'all' to reach other branches.`;
      }
      return expandEntryFile(view.sessionFile, t.index, t.pathPattern, t.full, t.offset, t.limit);
    }

    case "touched": {
      const { rendered, rawMessages } = view.load(false);
      return formatTouchedOutput(getTouchedFiles(rawMessages, rendered), action.page);
    }

    case "expand": {
      const byIndex = new Map(view.load(true).rendered.map((m) => [m.index, m]));
      const invalid = invalidExpandIndices(action.indices, new Set(byIndex.keys()));
      if (invalid.length > 0) {
        return `Cannot expand indices outside ${scopeAll ? "session history" : "active lineage"}: ${invalid.join(", ")}`;
      }
      const expanded = action.indices.map((i) => byIndex.get(i)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      return (scopeAll ? "Scope: all\n\n" : "") + formatRecallOutput(expanded);
    }

    case "range":
      return runRange(action.range, action.page, view);

    case "search":
      return runSearch(action.query, action.page, view, hints);

    case "recent": {
      const { rendered } = view.load(false);
      return (scopeAll ? "Scope: all\n\n" : "") + formatRecallOutput(rendered.slice(-RECENT_COUNT), action.query);
    }
  }
};

/**
 * Entries #from..#to in order, RANGE_PAGE_SIZE per page, same per-entry clip
 * as search and recent. Indices are the global #N space shared with summaries
 * (global-indices.ts), so a ref copied from a summary lands on its message.
 */
const runRange = (range: unknown[], page: number, view: RecallView): string => {
  const [from, to] = range;
  if (range.length !== 2 || !Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (from as number) > (to as number)) {
    return `Invalid range ${JSON.stringify(range)}: use range:[from, to] with two #N indices, from <= to.`;
  }
  const lo = from as number, hi = to as number;
  const scopeAll = view.scope === "all";
  const { rendered } = view.load(false);
  const entries = rendered.filter((m) => m.index >= lo && m.index <= hi);

  if (entries.length === 0) {
    if (!scopeAll && loadAllMessages(view.sessionFile, false).rendered.some((m) => m.index >= lo && m.index <= hi)) {
      return `No messages #${lo}..#${hi} on the active lineage; they are on another branch. Use scope:'all' to reach them.`;
    }
    const last = rendered[rendered.length - 1];
    return `No messages #${lo}..#${hi} in session history${last ? ` (last entry is #${last.index})` : ""}.`;
  }

  const totalPages = Math.ceil(entries.length / RANGE_PAGE_SIZE);
  const counts = `${entries.length} messages${scopeAll ? ", scope: all" : ""}`;
  if (page > totalPages) {
    return `Page ${page} is outside the available range 1-${totalPages} (#${lo}..#${hi}: ${counts}). Use a page between 1 and ${totalPages}.`;
  }
  const start = (page - 1) * RANGE_PAGE_SIZE;
  const header = totalPages > 1
    ? `Range #${lo}..#${hi}, page ${page}/${totalPages} (${counts})`
    : `Range #${lo}..#${hi} (${counts})`;
  const footer = page < totalPages
    ? `\n--- Use range:[${lo}, ${hi}] page:${page + 1}${scopeAll ? " scope:'all'" : ""} for the next ${RANGE_PAGE_SIZE} ---`
    : "";
  return formatRecallOutput(entries.slice(start, start + RANGE_PAGE_SIZE), undefined, header) + footer;
};

const runSearch = (query: string, page: number, view: RecallView, hints: RecallPagingHints): string => {
  const { rendered, rawMessages } = view.load(false);
  const { hits, totalBeforeCap, truncated } = searchEntriesDetailed(rendered, rawMessages, query);
  // Single source of truth for page count: hits.length, the same array
  // that's actually paginated below (already floor-filtered and capped).
  const totalPages = Math.ceil(hits.length / SEARCH_PAGE_SIZE);
  const scopeSuffix = view.scope === "all" ? " (scope: all)" : "";
  // The hard cap can discard genuine matches; hits.length alone would then
  // understate the real total. Say so explicitly. Neutral wording ("showing",
  // not "showing top"): regex-path hits are chronological with no relevance
  // score, so "top" would falsely imply a ranking only the BM25 path has.
  const truncationNote = truncated
    ? ` — showing ${hits.length} of ${totalBeforeCap} matches, refine your query for more precise results`
    : "";

  // The hard cap creates a fixed reachable page range (1..totalPages). A page
  // beyond it isn't "no matches": say which pages exist instead of falling
  // through to formatRecallOutput's zero-hit message, which would be false.
  if (hits.length > 0 && page > totalPages) {
    return `Page ${page} is outside the available range 1-${totalPages} ` +
      `(${hits.length} matches${scopeSuffix}${truncationNote}). ` +
      hints.outOfRange(query, view.scope, totalPages, truncated);
  }

  const start = (page - 1) * SEARCH_PAGE_SIZE;
  const header = totalPages > 1
    ? `Page ${page}/${totalPages} (${hits.length} total matches${scopeSuffix}${truncationNote})`
    : `${hits.length} matches${scopeSuffix}${truncationNote}`;
  const footer = page < totalPages ? hints.nextPage(query, view.scope, page + 1) : "";
  return formatRecallOutput(hits.slice(start, start + SEARCH_PAGE_SIZE), query, header) + footer;
};
