import type { Meta } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { makeFakeClient } from "../../../test/factories";
import { MatrixClientPeg } from "@/client/peg";
import type { MessageSearchHit } from "@/hooks/use-message-search";
import {
  MessageSearchStatus,
  type SearchResult,
  SearchResultRow,
} from "./search-result-item";
import {
  CurrentRoomSearchAction,
  SearchScopeChip,
} from "./search-scope-controls";
import { TopSearch } from "./top-search";

const hit = (
  id: string,
  body: string,
  threadRootId: string | null = null,
): MessageSearchHit => ({
  id,
  roomId: "!general:h.example",
  roomName: "general",
  threadRootId,
  author: {
    id: "@ana:h.example",
    kind: "human",
    displayName: "Ana",
    avatarUrl: null,
  },
  body,
  createdAt: Date.now() - 2 * 3600_000,
});

const results: SearchResult[] = [
  {
    kind: "room",
    room: {
      roomId: "!d:h",
      name: "deploys",
      topic: "Release train",
      isDm: false,
      joined: true,
    },
  },
  {
    kind: "room",
    room: {
      roomId: "!o:h",
      name: "ops-oncall",
      isDm: false,
      isPrivate: true,
      joined: false,
    },
  },
  {
    kind: "message",
    hit: hit(
      "$1",
      "The deploy for payments went out at noon, rollback plan is in the canvas.",
    ),
  },
  {
    kind: "message",
    hit: hit("$2", "Can we deploy after the review?", "$root"),
  },
  { kind: "action", id: "see-all", title: "See all results" },
];

const meta = {
  title: "Search/Results",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

export const Rows = {
  render: () => (
    <div
      className="w-[28rem] rounded-card border border-surface-border-primary bg-surface-primary p-1.5"
      role="listbox"
    >
      <CurrentRoomSearchAction
        roomLabel="#general"
        isDm={false}
        isSelected={false}
        onActivate={() => {}}
        onMouseEnter={() => {}}
      />
      {results.map((result, i) => (
        <SearchResultRow
          key={i}
          result={result}
          query="deploy"
          index={i + 1}
          isSelected={i === 2}
          onSelect={() => {}}
        />
      ))}
    </div>
  ),
};

export const Statuses = {
  render: () => (
    <div className="flex w-[28rem] flex-col gap-2 rounded-card border border-surface-border-primary bg-surface-primary p-1.5">
      <MessageSearchStatus status="loading" error={null} term="deploy" />
      <MessageSearchStatus status="done" error={null} term="deploy" />
      <MessageSearchStatus status="unsupported" error={null} term="deploy" />
      <MessageSearchStatus
        status="error"
        error="Server is unreachable."
        term="deploy"
      />
    </div>
  ),
};

export const ScopeChip = {
  render: () => <SearchScopeChip label="#general" onRemove={() => {}} />,
};

/** Focus the field to open the results. */
export const Field = {
  render() {
    const client = makeFakeClient({ userId: "@me:h.example" });
    const cast = client as unknown as Record<string, unknown>;
    cast.publicRooms = async () => ({ chunk: [] });
    cast.search = async () => ({
      search_categories: { room_events: { results: [] } },
    });
    MatrixClientPeg.injectClientForTest(client);
    return (
      <MemoryRouter>
        <div className="w-[36rem] bg-sidebar p-2">
          <TopSearch />
        </div>
      </MemoryRouter>
    );
  },
};
