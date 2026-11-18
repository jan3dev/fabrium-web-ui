import { useCallback, useRef, useState } from "react";

const trimmedEqual = (text: string, value: string) => text.trim() === value;

/**
 * The text of a field that commits `value` changes. While the user has not typed since
 * the last commit, the field follows `value` (an undo, a moved slide, a save from
 * someone else), unless `same` says the text already holds it (the echo of its own commit,
 * so a trailing space typed before an idle commit stays). `commit` reports a typed change
 * once; calling it again without typing does nothing.
 */
export function useFieldDraft(
  value: string,
  onCommit: (text: string) => void,
  same: (text: string, value: string) => boolean = trimmedEqual,
) {
  const [state, setState] = useState({ text: value, dirty: false, from: value });
  let cur = state;
  if (value !== state.from) {
    cur = { ...state, text: state.dirty || same(state.text, value) ? state.text : value, from: value };
    setState(cur);
  }
  const latest = useRef({ cur, onCommit, same });
  latest.current = { cur, onCommit, same };
  const commit = useCallback(() => {
    const { cur, onCommit, same } = latest.current;
    if (!cur.dirty) return;
    setState((s) => ({ ...s, dirty: false }));
    if (!same(cur.text, cur.from)) onCommit(cur.text);
  }, []);
  const change = useCallback((text: string) => setState((s) => ({ ...s, text, dirty: true })), []);
  return { text: cur.text, dirty: cur.dirty, change, commit };
}
