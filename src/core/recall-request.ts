import { parseDrillDown } from "./drill-down";
import { normalizeRecallMode, normalizeRecallScope, parseRecallScope, type RecallScope } from "./recall-scope";

export type DrillTarget = NonNullable<ReturnType<typeof parseDrillDown>>;

/** The one thing a recall call does. Exactly one action runs per call. */
export type RecallAction =
  | { kind: "drill"; target: DrillTarget }
  | { kind: "touched"; page?: number }
  | { kind: "expand"; indices: number[] }
  | { kind: "search"; query: string; page: number }
  | { kind: "recent"; query?: string };

export interface RecallRequest {
  scope: RecallScope;
  action: RecallAction;
}

export interface RecallToolParams {
  query?: string;
  expand?: number[];
  page?: number;
  scope?: string;
  mode?: string;
}

/**
 * Tool params -> request. The precedence lives here and only here:
 * #N:path drill-down, then mode:'touched', then expand, then query search,
 * then the most recent entries.
 */
export const parseToolRequest = (params: RecallToolParams): RecallRequest => {
  const scope = normalizeRecallScope(params.scope);
  const q = params.query?.trim();
  const target = q ? parseDrillDown(q) : null;
  if (target) return { scope, action: { kind: "drill", target } };
  if (normalizeRecallMode(params.mode) === "touched") return { scope, action: { kind: "touched", page: params.page } };
  const indices = [...new Set(params.expand ?? [])];
  if (indices.length > 0) return { scope, action: { kind: "expand", indices } };
  if (q) return { scope, action: { kind: "search", query: params.query!, page: Math.max(1, params.page ?? 1) } };
  return { scope, action: { kind: "recent", query: params.query } };
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
