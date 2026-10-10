import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";

interface InlineEditProps {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

export function InlineEdit({ initialValue, onSave, onCancel }: InlineEditProps) {
  const [value, setValue] = useState(initialValue);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && value !== initialValue) {
        onSave(value.trim());
      } else {
        onCancel();
      }
    }
    if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <textarea
      aria-label="Edit message"
      className="w-full resize-none rounded-utility border border-surface-border-secondary bg-surface-secondary px-3 py-2 text-body2 text-text-primary focus:outline-none focus:ring-1 focus:ring-ring"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      autoFocus
      rows={3}
    />
  );
}

type SendEvent = (
  roomId: string,
  threadId: string | null,
  type: string,
  content: Record<string, unknown>,
) => Promise<{ event_id: string }>;

export async function sendEditEvent(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  body: string,
) {
  await (client.sendEvent as unknown as SendEvent).call(client, roomId, null, "m.room.message", {
    msgtype: "m.text",
    body: `* ${body}`,
    "m.new_content": { msgtype: "m.text", body },
    "m.relates_to": { rel_type: "m.replace", event_id: eventId },
  });
}
