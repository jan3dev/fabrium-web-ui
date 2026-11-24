import { useState } from "react";
import type { StyleEdit, StyleProp, Styles } from "@/lib/artifacts/styles";

/**
 * The style inspector's draft for a picked element: its CSS values and the user's edits on top.
 * Edits go out through `send` as they happen: to the frame (annotate, where they stay a draft
 * until added to the reply) or as canvas ops that save.
 */
export function useStyleDraft(send: (edit: StyleEdit) => void) {
  const [styles, setStyles] = useState<Styles>({});
  const [changes, setChanges] = useState<Styles>({});
  return {
    values: { ...styles, ...changes },
    changes,
    /** A new element was picked: its values replace the old ones, the edits start empty. */
    picked(computed: Styles) {
      setStyles(computed);
      setChanges({});
    },
    /** New values for the same element; the edits stay on top. */
    refresh(computed: Styles) {
      setStyles(computed);
    },
    change(next: Styles) {
      setChanges((c) => ({ ...c, ...next }));
      for (const [prop, value] of Object.entries(next)) send({ prop: prop as StyleProp, value });
    },
    /** Drops the edits from the frame, or leaves them there (`keep`, once added to the reply). */
    reset(keep = false) {
      send(keep ? { keep: true } : { reset: true });
      setChanges({});
    },
  };
}
