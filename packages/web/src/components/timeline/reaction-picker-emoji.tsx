// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/custom-emoji/ui/EmojiPicker.tsx. Modified.
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import * as React from "react";

/**
 * emoji-mart mounts its search input inside a shadow root, asynchronously.
 * Turn off spellcheck/autocorrect on it and focus it ourselves, so focus does
 * not race Radix's focus scope.
 */
function prepareSearchInput(host: HTMLElement): () => void {
  const root = host.querySelector("em-emoji-picker")?.shadowRoot;
  if (!root) return () => undefined;
  const apply = () => {
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) return false;
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.focus();
    return true;
  };
  if (apply()) return () => undefined;
  const observer = new MutationObserver(() => {
    if (apply()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** The emoji picker. Lazy-loaded: emoji-mart's data is large. */
export default function PickerEmoji({ onPick }: { onPick: (emoji: string) => void }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => (hostRef.current ? prepareSearchInput(hostRef.current) : undefined), []);
  return (
    <div ref={hostRef}>
      <Picker
        data={data}
        onEmojiSelect={(e: { native?: string }) => {
          if (e.native) onPick(e.native);
        }}
        autoFocus
        maxFrequentRows={2}
        perLine={8}
        previewPosition="none"
        skinTonePosition="none"
        set="native"
        theme={document.documentElement.dataset.theme === "light" ? "light" : "dark"}
      />
    </div>
  );
}
