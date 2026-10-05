import { parseDrillDown } from "./drill-down";
import { normalizeRecallMode, normalizeRecallScope, parseRecallScope, type RecallScope } from "./recall-scope";

export type DrillTarget = NonNullable<ReturnType<typeof parseDrillDown>>;

/** The one thing a recall call does. Exactly one action runs per call. */
export type RecallAction =
  | { kind: "drill"; target: DrillTarget }
  | { kind: "touched"; page?: number }
  | { kind: "expand"; indices: number[] }
  | { kind: "range"; range: unknown[]; page: number }
  | { kind: "search"; query: string; page: number }
  | { kind: "recent"; query?: string };

export interface RecallRequest {
  scope: RecallScope;
  action: RecallAction;
  /** Params the caller set that this action does not use. Defaults (page:1, expand:[]) are not listed. */
  ignored?: string[];
}

export interface RecallToolParams {
  query?: string;
  expand?: number[];
  range?: unknown[];
  page?: number;
  scope?: string;
  mode?: string;
}

/**
 * Tool params -> request. The precedence lives here and only here:
 * #N:path drill-down, then mode:'touched', then expand, then range, then
 * query search, then the most recent entries.
 */
export const parseToolRequest = (params: RecallToolParams): RecallRequest => {
  const scope = normalizeRecallScope(params.scope);
  const q = params.query?.trim();
  const indices = [...new Set(params.expand ?? [])];
  const hasRange = Array.isArray(params.range) && params.range.length > 0;
  const set = {
    query: Boolean(q),
    expand: indices.length > 0,
    range: hasRange,
    page: (params.page ?? 1) > 1,
    touched: normalizeRecallMode(params.mode) === "touched",
  };
  const req = (action: RecallAction, uses: (keyof typeof set)[]): RecallRequest => {
    const ignored = (Object.keys(set) as (keyof typeof set)[])
      .filter((k) => set[k] && !uses.includes(k))
      .map((k) => (k === "touched" ? "mode" : k));
    return ignored.length > 0 ? { scope, action, ignored } : { scope, action };
  };

  const target = q ? parseDrillDown(q) : null;
  if (target) return req({ kind: "drill", target }, ["query"]);
  if (set.touched) return req({ kind: "touched", page: params.page }, ["touched", "page"]);
  if (set.expand) return req({ kind: "expand", indices }, ["expand"]);
  if (hasRange) return req({ kind: "range", range: params.range!, page: Math.max(1, params.page ?? 1) }, ["range", "page"]);
  if (q) return req({ kind: "search", query: params.query!, page: Math.max(1, params.page ?? 1) }, ["query", "page"]);
  return req({ kind: "recent", query: params.query }, []);
};

/** /pi-vcc-recall args -> request. A person types a query, scope:all and page:N only. */
export const parseCommandRequest = (args: string): RecallRequest => {
  const parsed = parseRecallScope(args.trim());
  const scope = parsed.scope;
  const pageMatch = parsed.text.match(/\bpage:(\d+)\b/i);
  const page = pageMatch ? Math.max(1, parseInt(pageMatch[1], 10)) : 1;
  const query = parsed.text.replace(/\bpage:\d+\b/i, "").trim();
  if (!query) return { scope, action: { kind: "recent" } };
  return { scope, action: { kind: "search", query, page } };
};
