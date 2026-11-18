import { useState } from "react";
import type { StyleEdit, StyleProp, Styles } from "@/lib/artifacts/styles";

/**
 * The style inspector's draft for a picked element: its CSS values and the user's edits on top.
 * Edits go to the frame through `send` as they happen; they stay a draft until added to the reply.
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
    change(prop: StyleProp, value: string) {
      setChanges((c) => ({ ...c, [prop]: value }));
      send({ prop, value });
    },
    /** Drops the edits from the frame, or leaves them there (`keep`, once added to the reply). */
    reset(keep = false) {
      send(keep ? { keep: true } : { reset: true });
      setChanges({});
    },
  };
}
