import type { Meta } from "@storybook/react-vite";
import { PresenceBadge, PresenceDot } from "./presence-dot";

const meta = { title: "People/Presence" } satisfies Meta;
export default meta;

const STATUSES = ["online", "away", "offline"] as const;

export const Dots = {
  render: () => (
    <div className="flex items-center gap-4">
      {STATUSES.map((s) => (
        <PresenceDot key={s} status={s} />
      ))}
    </div>
  ),
};

export const Badges = {
  render: () => (
    <div className="flex items-center gap-2">
      {STATUSES.map((s) => (
        <PresenceBadge key={s} status={s} />
      ))}
    </div>
  ),
};
