import { Badge } from "@/components/ui/badge";
import type { SlashCommandMeta } from "@/lib/slash-commands";
import { SuggestionList } from "./mention-autocomplete";

interface SlashCommandListProps {
  commands: SlashCommandMeta[];
  activeIdx: number;
  onSelect: (cmd: SlashCommandMeta) => void;
  onHover: (idx: number) => void;
}

export function SlashCommandList({
  commands,
  activeIdx,
  onSelect,
  onHover,
}: SlashCommandListProps) {
  return (
    <SuggestionList
      label="Command suggestions"
      items={commands}
      selectedIndex={activeIdx}
      getKey={(c) => c.name}
      onSelect={onSelect}
      onHover={onHover}
    >
      {(cmd) => (
        <>
          <span className="font-mono font-semibold text-accent-brand">
            /{cmd.name}
          </span>
          <span className="min-w-0 truncate text-caption1 text-text-secondary">
            {cmd.description}
          </span>
          {cmd.source === "agent" && (
            <Badge tone="agent" className="ml-auto">
              Agent
            </Badge>
          )}
        </>
      )}
    </SuggestionList>
  );
}
