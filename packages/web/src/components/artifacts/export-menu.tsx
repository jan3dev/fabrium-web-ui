import { useId } from "react";
import { ChevronDownIcon, DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentRequest } from "@/lib/artifacts/runtime";
import type { ArtifactKind } from "@/model/types";

/** The file a download gives, by extension. */
const FORMAT: Record<string, string> = {
  html: "Web page",
  json: "JSON",
  svg: "SVG image",
  jsx: "React component",
  md: "Markdown",
  txt: "Text",
};

/** What the agent makes, per kind (spec §6.9, §3.12). */
const AGENT: Partial<Record<ArtifactKind, { request: AgentRequest; label: string }[]>> = {
  slides: [
    { request: "pptx", label: "PowerPoint (.pptx)" },
    { request: "google-slides", label: "Google Slides" },
    { request: "png", label: "Current slide as PNG" },
  ],
  design: [
    { request: "pptx", label: "PowerPoint (.pptx)" },
    { request: "png", label: "Current artboard as PNG" },
    { request: "build", label: "Build this design" },
  ],
  whiteboard: [{ request: "png", label: "PNG" }],
  motion: [{ request: "mp4", label: "MP4" }],
};

/**
 * The artifact's Export menu: the files the app makes (download, PDF), then the ones the agent
 * makes, each a fixed request in the thread. `onAsk` is left out where no agent can be asked;
 * `askBlocked` says why the agent's entries are off.
 */
export function ExportMenu({
  kind,
  extension,
  disabled = false,
  onDownload,
  onPdf,
  onAsk,
  askBlocked = null,
}: {
  kind: ArtifactKind;
  /** The download's file extension. */
  extension: string;
  disabled?: boolean;
  onDownload: () => void;
  onPdf?: () => void;
  onAsk?: (request: AgentRequest) => void;
  askBlocked?: string | null;
}) {
  const labelId = useId();
  const agent = onAsk ? (AGENT[kind] ?? []) : [];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* Compact: the floating toolbar must not grow over the frame. */}
        <Button size="xs" variant="utility" disabled={disabled} aria-label="Export" data-testid="artifact-export" className="px-1.5">
          <DownloadIcon />
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onDownload}>
          {FORMAT[extension] ?? "File"} (.{extension})
        </DropdownMenuItem>
        {onPdf ? <DropdownMenuItem onSelect={onPdf}>PDF</DropdownMenuItem> : null}
        {agent.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-labelledby={labelId}>
              <DropdownMenuLabel id={labelId} className="text-caption1 text-text-secondary">
                Ask the agent
              </DropdownMenuLabel>
              {askBlocked ? <p className="px-2 pb-1 text-caption1 text-text-secondary">{askBlocked}</p> : null}
              {agent.map((a) => (
                <DropdownMenuItem key={a.request} disabled={askBlocked !== null} onSelect={() => onAsk?.(a.request)}>
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
