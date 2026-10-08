// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/activityRenderClasses/PlanActivity.tsx. Modified.
import { ListChecksIcon } from "@/components/icons";
import { PlanEntryList } from "@/components/timeline/plan-board";
import type { PlanTranscriptItem } from "@/model/agent-activity";
import { ActivityRow, ActivityRowContent, ActivityRowLabel } from "./activity-row";

export function PlanActivity({ item }: { item: PlanTranscriptItem }) {
  const done = item.entries.filter((e) => e.status === "completed").length;
  return (
    <ActivityRow testId="transcript-plan-item">
      <ListChecksIcon className="size-3.5 shrink-0 text-text-tertiary" />
      <ActivityRowLabel verb="Updated" object={`plan · ${done}/${item.entries.length} done`} />
      <ActivityRowContent>
        <PlanEntryList entries={item.entries} className="py-1.5 pl-5" />
      </ActivityRowContent>
    </ActivityRow>
  );
}
