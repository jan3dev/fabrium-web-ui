// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/ChannelIntroBlock.tsx. Modified.
import type * as React from "react";

import { TopicText } from "./topic-text";

/** First row of a room whose history is fully loaded: glyph, name, topic. */
export function RoomIntro({
  name,
  topic,
  isDm = false,
  glyph,
}: {
  name: string;
  topic?: string | null;
  isDm?: boolean;
  glyph: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-start px-3 pt-6 pb-3 text-left" data-testid="message-channel-intro">
      <div className="flex size-[60px] items-center justify-center rounded-card border border-surface-border-primary bg-surface-secondary text-text-secondary [&_svg]:size-7">
        {glyph}
      </div>
      <h1 className="mt-4 max-w-2xl truncate font-heading text-h5 font-semibold text-text-primary">
        {isDm ? name : `#${name}`}
      </h1>
      <p className="mt-1 max-w-2xl text-body2 text-text-secondary">
        This is the beginning of {isDm ? "your conversation with " : "the channel "}
        <span className="font-medium text-text-primary">{name}</span>.
      </p>
      {topic ? (
        <div className="mt-2 max-w-xl whitespace-pre-line text-body2 text-text-secondary">
          <TopicText topic={topic} clamp={false} />
        </div>
      ) : null}
    </div>
  );
}
