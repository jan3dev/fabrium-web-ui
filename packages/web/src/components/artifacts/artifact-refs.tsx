import { CloseIcon, CommentIcon } from "@/components/icons";
import type { ArtifactRef, ArtifactRefTarget } from "@/lib/artifacts/refs";

/** One line naming what an annotation points at. */
export function describeTarget(t: ArtifactRefTarget): string {
  if (t.kind === "element") return t.selector;
  const text = t.text.replace(/\s+/g, " ").trim();
  const quoted = `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
  return t.where ? `${t.where}: ${quoted}` : quoted;
}

function RefBody({ item: r }: { item: ArtifactRef }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-caption1 text-text-secondary">
        <span className="font-semibold text-text-primary">{r.title}</span> v
        {r.version} · <span className="font-mono">{describeTarget(r.target)}</span>
      </span>
      {r.note.trim() ? (
        <span className="block line-clamp-2 text-caption1 whitespace-pre-wrap text-text-primary">
          {r.note}
        </span>
      ) : null}
    </span>
  );
}

/** Annotations waiting in the composer. */
export function ArtifactRefChips({
  refs,
  onRemove,
}: {
  refs: readonly ArtifactRef[];
  onRemove: (index: number) => void;
}) {
  if (refs.length === 0) return null;
  return (
    <ul aria-label="Artifact annotations" className="mb-2 flex flex-col gap-1">
      {refs.map((r, i) => (
        <li
          key={`${r.event_id}:${i}`}
          className="flex items-start gap-2 rounded-utility border-l-2 border-accent-brand bg-surface-secondary px-2.5 py-1.5"
        >
          <CommentIcon className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" />
          <RefBody item={r} />
          <button
            type="button"
            aria-label={`Remove annotation ${i + 1}`}
            onClick={() => onRemove(i)}
            className="rounded-utility p-0.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Annotations a sent message carries. Each opens its artifact at the annotated version. */
export function ArtifactRefList({
  refs,
  onOpen,
}: {
  refs: readonly ArtifactRef[];
  onOpen?: (ref: ArtifactRef) => void;
}) {
  return (
    <ul aria-label="Artifact annotations" className="mt-1 flex flex-col gap-1">
      {refs.map((r, i) => (
        <li key={`${r.event_id}:${i}`}>
          <button
            type="button"
            disabled={!onOpen}
            onClick={() => onOpen?.(r)}
            className="flex w-full max-w-md items-start gap-2 rounded-utility border-l-2 border-accent-brand bg-surface-secondary px-2.5 py-1.5 text-left enabled:cursor-pointer enabled:hover:bg-surface-tertiary"
          >
            <CommentIcon className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" />
            <RefBody item={r} />
          </button>
        </li>
      ))}
    </ul>
  );
}
