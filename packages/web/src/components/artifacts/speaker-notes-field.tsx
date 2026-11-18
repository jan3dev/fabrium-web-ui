import { useEffect, useLayoutEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useFieldDraft } from "@/hooks/use-field-draft";
import { cleanNotes, MAX_NOTES } from "@/lib/artifacts/frames";

/** Quiet time after typing before the notes are committed. */
export const NOTES_IDLE_MS = 600;

const sameNotes = (text: string, value: string) => cleanNotes(text).slice(0, MAX_NOTES) === value;

/**
 * Speaker notes of the open slide, editable as plain text. Commits shortly after typing
 * stops, on blur, and when it unmounts with a change pending (the slide changes, the
 * panel closes). The unmount commit runs in a layout cleanup: before any passive effect
 * cleanup, so before the draft's own unmount flush sends what was committed.
 */
export function SpeakerNotesField({ value, onCommit }: { value: string; onCommit: (notes: string) => void }) {
  const notes = useFieldDraft(value, onCommit, sameNotes);
  const { dirty, text, commit } = notes;
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(commit, NOTES_IDLE_MS);
    return () => clearTimeout(t);
  }, [dirty, text, commit]);
  useLayoutEffect(() => () => commit(), [commit]);
  return (
    <div className="px-3 pb-3">
      <Textarea
        aria-label="Speaker notes"
        placeholder="Add notes for this slide"
        value={text}
        maxLength={MAX_NOTES}
        onChange={(e) => notes.change(e.target.value)}
        onBlur={commit}
        className="max-h-40 min-h-16 text-body2"
      />
    </div>
  );
}
