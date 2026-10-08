// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/lib/mentionHighlightExtension.ts. Modified.
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const mentionHighlightKey = new PluginKey("mentionHighlight");

const CHIP = "rounded-utility px-0.5 font-medium";
const HUMAN_CHIP = `${CHIP} bg-chip-brand-background text-chip-brand-foreground`;
const AGENT_CHIP = `${CHIP} bg-actor-agent-transparent text-actor-agent`;
const ROOM_CHIP = `${CHIP} bg-surface-secondary text-text-primary`;

export type MentionHighlightStorage = {
  names: string[];
  agentNames: string[];
  roomNames: string[];
};

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Push new known names into the editor and redraw its chips. */
export function syncMentionHighlight(
  editor: {
    storage: object;
    state: { tr: Transaction };
    view: { dispatch: (tr: Transaction) => void };
  },
  next: MentionHighlightStorage,
): void {
  const storage = (
    editor.storage as { mentionHighlight?: MentionHighlightStorage }
  ).mentionHighlight;
  if (
    !storage ||
    (sameList(storage.names, next.names) &&
      sameList(storage.agentNames, next.agentNames) &&
      sameList(storage.roomNames, next.roomNames))
  ) {
    return;
  }
  Object.assign(storage, next);
  editor.view.dispatch(editor.state.tr.setMeta(mentionHighlightKey, true));
}

/**
 * Decorates `@Name` and `#room` tokens the composer knows as chips, so a picked
 * mention reads as one unit while it is still plain text in the document.
 */
export const MentionHighlightExtension = Extension.create<
  unknown,
  MentionHighlightStorage
>({
  name: "mentionHighlight",

  addStorage() {
    return { names: [], agentNames: [], roomNames: [] };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: mentionHighlightKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, storage),
          // ponytail: full rebuild per doc change; map decorations instead if
          // long drafts ever lag.
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(mentionHighlightKey)
              ? buildDecorations(tr.doc, storage)
              : old,
        },
        props: {
          decorations(state) {
            return mentionHighlightKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `@Name` / `#room` patterns, longest name first so "Coder · Payments" wins
 * over "Coder". Exported for tests.
 */
export function buildHighlightPattern(
  prefix: "@" | "#",
  names: readonly string[],
): RegExp | null {
  if (names.length === 0) return null;
  const alternatives = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  return new RegExp(
    `(?:^|(?<=[\\s(]))${prefix}(${alternatives})(?=\\W|$)`,
    "gi",
  );
}

function buildDecorations(
  doc: ProseMirrorNode,
  { names, agentNames, roomNames }: MentionHighlightStorage,
): DecorationSet {
  const agents = new Set(agentNames.map((n) => n.toLowerCase()));
  const patterns: [RegExp | null, string][] = [
    [
      buildHighlightPattern(
        "@",
        names.filter((n) => !agents.has(n.toLowerCase())),
      ),
      HUMAN_CHIP,
    ],
    [buildHighlightPattern("@", agentNames), AGENT_CHIP],
    [buildHighlightPattern("#", roomNames), ROOM_CHIP],
  ];
  if (patterns.every(([p]) => !p)) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const [pattern, className] of patterns) {
      if (!pattern) continue;
      for (const match of node.text.matchAll(pattern)) {
        const from = pos + (match.index ?? 0);
        decorations.push(
          Decoration.inline(
            from,
            from + match[0].length,
            { class: className, spellcheck: "false" },
            { inclusiveEnd: false },
          ),
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}
