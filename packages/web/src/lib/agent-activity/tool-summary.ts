// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/agentSessionToolSummary.ts. Modified.
// The one-line label of a tool call ("Edited auth.ts +4 -1") and the parts its
// detail view shows. Zooid sends ACP tool kinds, so the kind picks the verb;
// Buzz's per-tool-name classifier has nothing to match here.
import type { DiffBlock } from "@/events/zooid-events";
import { lineDiff } from "@/lib/line-diff";
import type { ToolTranscriptItem } from "@/model/agent-activity";

export interface ToolSummary {
  verb: string;
  /** What the tool acted on: a file name, command, URL or query. */
  object: string | null;
  /** The full form of `object`, e.g. the whole path. */
  objectTitle: string | null;
  /** The command, for shell tools. */
  shellCommand: string | null;
  /** Diffs from the tool's output, else from an old/new string pair in its input. */
  diffs: DiffBlock[];
  stats: { additions: number; deletions: number } | null;
}

// [finished, running]
const VERBS: Record<string, [string, string]> = {
  read: ["Read", "Reading"],
  edit: ["Edited", "Editing"],
  delete: ["Deleted", "Deleting"],
  move: ["Moved", "Moving"],
  search: ["Searched", "Searching"],
  execute: ["Ran", "Running"],
  think: ["Thought", "Thinking"],
  fetch: ["Fetched", "Fetching"],
};

const PATCH_FIELDS = new Set(["diff", "old_string", "new_string", "content"]);

export function shortPath(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;

function filePath(input: Record<string, unknown>): string | null {
  return str(input.file_path) ?? str(input.filepath) ?? str(input.path);
}

/** What the tool acted on, as [short, full]. */
function objectOf(item: ToolTranscriptItem): [string, string] | null {
  const input = item.rawInput ?? {};
  const fp = filePath(input);
  const pick = (v: string | null): [string, string] | null =>
    v ? [v, v] : null;
  switch (item.toolKind) {
    case "read":
    case "edit":
    case "delete":
    case "move":
      if (fp) return [shortPath(fp), fp];
      break;
    case "execute":
      if (str(input.command)) return pick(str(input.command));
      break;
    case "fetch":
      if (str(input.url)) return pick(str(input.url));
      break;
    case "search":
      if (str(input.query) ?? str(input.pattern))
        return pick(str(input.query) ?? str(input.pattern));
      break;
  }
  for (const [k, v] of Object.entries(input)) {
    if (!PATCH_FIELDS.has(k) && typeof v === "string" && v && v.length < 120)
      return [v, v];
  }
  const loc = item.locations[0]?.path;
  return loc ? [shortPath(loc), loc] : null;
}

function inputDiff(item: ToolTranscriptItem): DiffBlock | null {
  const input = item.rawInput;
  if (!input || typeof input.new_string !== "string") return null;
  return {
    path: filePath(input) ?? item.title,
    oldText: typeof input.old_string === "string" ? input.old_string : "",
    newText: input.new_string,
  };
}

export function isToolRunning(item: ToolTranscriptItem): boolean {
  return item.status === "pending" || item.status === "in_progress";
}

export function buildToolSummary(item: ToolTranscriptItem): ToolSummary {
  const verbs = VERBS[item.toolKind];
  const object = verbs ? objectOf(item) : null;
  const fromInput = item.diffs.length === 0 ? inputDiff(item) : null;
  const diffs = fromInput ? [fromInput] : item.diffs;
  let stats: ToolSummary["stats"] = null;
  for (const d of diffs) {
    stats ??= { additions: 0, deletions: 0 };
    for (const row of lineDiff(d.oldText, d.newText)) {
      if (row.type === "add") stats.additions++;
      else if (row.type === "del") stats.deletions++;
    }
  }
  return {
    // A kind without a verb, or nothing to name, falls back to the agent's own title.
    verb: verbs && object ? verbs[isToolRunning(item) ? 1 : 0] : item.title,
    object: object?.[0] ?? null,
    objectTitle: object?.[1] ?? null,
    shellCommand:
      item.toolKind === "execute" ? str(item.rawInput?.command) : null,
    diffs,
    stats,
  };
}
