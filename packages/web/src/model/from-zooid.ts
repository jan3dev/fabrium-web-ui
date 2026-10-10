// Zooid agent events → transcript items. Pure: same events in, same items out.
import type { DecodedZooidEvent } from "@/events/zooid-events";
import type {
  ToolStatus,
  ToolTranscriptItem,
  TranscriptItem,
} from "./agent-activity";

export interface TimedZooidEvent {
  decoded: DecodedZooidEvent;
  ts: number;
}

const TOOL_STATUSES = new Set<string>([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);
const toStatus = (s: string | undefined, fallback: ToolStatus): ToolStatus =>
  s && TOOL_STATUSES.has(s) ? (s as ToolStatus) : fallback;

/**
 * Folds one turn's events, oldest first, into transcript items. Each
 * tool_call_update merges into its tool_call: the newest status, output and
 * diffs win, raw input accumulates. The turn's newest plan replaces earlier
 * ones and keeps the first plan's place. `approvalInputs` fills a tool's input
 * from its approval request when no tool event carried one.
 */
export function toTranscriptItems(
  events: readonly TimedZooidEvent[],
  approvalInputs: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, ToolTranscriptItem>();
  for (const { decoded: d, ts } of events) {
    if (d.kind === "tool_call") {
      const tool: ToolTranscriptItem = {
        type: "tool",
        id: d.toolCallId,
        title: d.title,
        toolKind: d.toolKind,
        status: "pending",
        rawInput: d.rawInput ?? null,
        content: null,
        diffs: [],
        locations: d.locations ?? [],
        startedAt: ts,
        lastActivityAt: ts,
      };
      tools.set(d.toolCallId, tool);
      items.push(tool);
    } else if (d.kind === "tool_call_update") {
      // An update whose tool_call is outside the loaded history has no title to show.
      const tool = tools.get(d.toolCallId);
      if (!tool) continue;
      tool.status = toStatus(d.status, tool.status);
      if (d.rawInput) tool.rawInput = { ...tool.rawInput, ...d.rawInput };
      if (d.content !== undefined || d.diffs) {
        tool.content = d.content ?? null;
        tool.diffs = d.diffs ?? [];
      }
      if (d.locations) tool.locations = d.locations;
      tool.lastActivityAt = ts;
    } else if (d.kind === "plan" && d.entries.length > 0) {
      const plan = items.find((i) => i.type === "plan");
      if (plan) {
        plan.entries = d.entries;
        plan.updatedAt = ts;
      } else
        items.push({
          type: "plan",
          id: `plan:${ts}`,
          entries: d.entries,
          updatedAt: ts,
        });
    }
  }
  for (const tool of tools.values()) {
    if (!tool.rawInput || Object.keys(tool.rawInput).length === 0)
      tool.rawInput = approvalInputs.get(tool.id) ?? tool.rawInput;
  }
  return items;
}
