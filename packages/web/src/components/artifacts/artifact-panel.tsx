import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MatrixClientPeg } from "@/client/peg";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  PointerClickIcon,
  WarningIcon,
} from "@/components/icons";
import { DiffView } from "@/components/timeline/diff-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  useArtifactRoute,
  useArtifactText,
  useThreadArtifacts,
} from "@/hooks/use-artifacts";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  addArtifactRefDraft,
  type ArtifactRefTarget,
  MAX_NOTE,
  MAX_REFS,
} from "@/lib/artifacts/refs";
import { addPreviewError, composeFixRequest } from "@/lib/artifacts/runtime";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { copyToClipboard, downloadBlob } from "@/lib/browser-actions";
import { cn } from "@/lib/utils";
import type { ArtifactKind } from "@/model/types";
import { ArtifactKindIcon, artifactKindLabel } from "./artifact-card";
import { ArtifactPreview } from "./artifact-preview";
import { describeTarget } from "./artifact-refs";
import { ArtifactTextView } from "./artifact-text-view";

type Tab = "preview" | "code" | "changes";

const EXTENSION: Record<ArtifactKind, string> = {
  html: "html",
  svg: "svg",
  react: "jsx",
  markdown: "md",
  code: "txt",
};

/**
 * The open artifact, beside its thread: preview, source and changes per
 * version. Annotate mode turns clicks and selections into annotations that
 * wait in the thread composer until the user sends them.
 */
export function ArtifactPanel({
  roomId,
  threadRootId,
  workforceSpaceId,
}: {
  roomId: string;
  threadRootId: string;
  workforceSpaceId: string | null;
}) {
  const isMobile = useIsMobile();
  const route = useArtifactRoute();
  const all = useThreadArtifacts(roomId, threadRootId, workforceSpaceId);
  const versions = useMemo(
    () => all.filter((v) => v.identifier === route.identifier),
    [all, route.identifier],
  );
  // An unknown `?version=` gives -1: the "not loaded" state, never another version.
  const index = route.versionEventId
    ? versions.findIndex((v) => v.eventId === route.versionEventId)
    : versions.length - 1;
  const current = versions[index];
  const previous = index > 0 ? versions[index - 1] : undefined;
  const { text, error } = useArtifactText(current);

  const previewable = current !== undefined && current.kind !== "code";
  const [tabChoice, setTab] = useState<Tab>("preview");
  const tab: Tab =
    tabChoice === "changes" && !previous
      ? "preview"
      : tabChoice === "preview" && !previewable
        ? "code"
        : tabChoice;
  const prevState = useArtifactText(tab === "changes" ? previous : undefined);

  const [channel] = useState(() => `artifact_${crypto.randomUUID()}`);
  const framed =
    previewable && current.kind !== "markdown" && tab === "preview";
  const srcdoc = useMemo(
    () =>
      framed && text !== null
        ? buildArtifactSrcdoc(current.kind, text, channel)
        : null,
    [framed, current?.kind, text, channel],
  );

  const [annotating, setAnnotating] = useState(false);
  const [target, setTarget] = useState<ArtifactRefTarget | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ id: string; list: readonly string[] }>(
    { id: "", list: [] },
  );
  const [fixSent, setFixSent] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (!current) {
    return (
      <PanelShell mobile={isMobile}>
        <Header title="Artifact" onClose={route.close} />
        <p className="p-4 text-body2 text-text-tertiary">
          This artifact is not loaded in this thread.
        </p>
      </PanelShell>
    );
  }

  const frameErrors = errors.id === current.eventId ? errors.list : [];
  const latest = versions[versions.length - 1]!;
  const canAnnotate = tab !== "changes" && text !== null;

  function goTo(i: number) {
    const v = versions[i];
    if (!v) return;
    resetAnnotation();
    route.open(v.identifier, v.eventId);
  }

  function resetAnnotation() {
    setTarget(null);
    setNote("");
  }

  function selectTab(next: Tab) {
    resetAnnotation();
    setTab(next);
  }

  function addAnnotation() {
    if (!target || !current) return;
    const added = addArtifactRefDraft(roomId, threadRootId, {
      identifier: current.identifier,
      title: current.title,
      version: current.version,
      event_id: current.eventId,
      target,
      note: note.trim(),
    });
    if (!added) {
      toast.error(`A reply holds at most ${MAX_REFS} annotations. Send it first.`);
      return;
    }
    resetAnnotation();
    toast("Annotation added to your reply");
  }

  function download() {
    if (text === null || !current) return;
    const ext =
      current.kind === "code" && current.language
        ? current.language
        : EXTENSION[current.kind];
    downloadBlob(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
      `${current.identifier}.${ext.replace(/[^a-z0-9]/gi, "") || "txt"}`,
    );
  }

  async function askToFix() {
    if (!current) return;
    const client = MatrixClientPeg.safeGet();
    if (!client) {
      toast.error("Could not send the request");
      return;
    }
    setFixSent(current.eventId);
    try {
      await client.sendMessage(roomId, threadRootId, {
        msgtype: "m.text",
        body: composeFixRequest(current.identifier, frameErrors),
      } as never);
    } catch {
      setFixSent(null);
      toast.error("Could not send the request");
    }
  }

  const tabs = [
    ...(previewable ? [{ value: "preview" as const, label: "Preview" }] : []),
    { value: "code" as const, label: "Code" },
    ...(previous ? [{ value: "changes" as const, label: "Changes" }] : []),
  ];

  return (
    <PanelShell mobile={isMobile} title={current.title}>
      <Header
        title={current.title}
        subtitle={artifactKindLabel(current.kind, current.language)}
        kind={current.kind}
        onClose={route.close}
        actions={
          <>
            <IconButton
              size="small"
              icon={<PointerClickIcon />}
              label={annotating ? "Stop annotating" : "Annotate"}
              aria-pressed={annotating}
              disabled={!canAnnotate}
              tone={annotating ? "brand" : "default"}
              onClick={() => {
                resetAnnotation();
                setAnnotating((a) => !a);
              }}
            />
            <IconButton
              size="small"
              icon={<CopyIcon />}
              label="Copy source"
              disabled={text === null}
              onClick={() => text !== null && copyToClipboard(text, "Copied")}
            />
            <IconButton
              size="small"
              icon={<DownloadIcon />}
              label="Download"
              disabled={text === null}
              onClick={download}
            />
          </>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {tabs.length > 1 ? (
          <SegmentedControl
            legend="Artifact view"
            testId="artifact-tabs"
            optionTestIdPrefix="artifact-tab"
            size={tabs.length > 2 ? "default" : "compact"}
            value={tab}
            options={tabs}
            onValueChange={selectTab}
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            size="small"
            icon={<ChevronLeftIcon />}
            label="Previous version"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
          />
          <span className="text-caption1 text-text-secondary tabular-nums">
            v{current.version} of {latest.version}
          </span>
          <IconButton
            size="small"
            icon={<ChevronRightIcon />}
            label="Next version"
            disabled={current === latest}
            onClick={() => goTo(index + 1)}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <p role="alert" className="p-4 text-body2 text-accent-danger">
            {error}
          </p>
        ) : text === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : tab === "changes" ? (
          <div className="h-full overflow-auto p-3">
            {prevState.error ? (
              <p role="alert" className="text-body2 text-accent-danger">
                {prevState.error}
              </p>
            ) : prevState.text === null ? (
              <Spinner />
            ) : (
              <DiffView
                diff={{
                  path: `${current.title} · v${previous!.version} → v${current.version}`,
                  oldText: prevState.text,
                  newText: text,
                }}
              />
            )}
          </div>
        ) : srcdoc !== null ? (
          <ArtifactPreview
            key={current.eventId}
            kind={current.kind}
            srcdoc={srcdoc}
            channel={channel}
            title={`Preview of ${current.title}`}
            annotating={annotating}
            onPicked={setTarget}
            onError={(detail) =>
              setErrors((prev) => {
                const same = prev.id === current.eventId;
                const list = addPreviewError(same ? prev.list : [], detail);
                // A frame can throw at 60 Hz: an unchanged list must not re-render.
                return same && list === prev.list
                  ? prev
                  : { id: current.eventId, list };
              })
            }
            onOpenLink={setLink}
          />
        ) : (
          <ArtifactTextView
            key={`${current.eventId}:${tab}`}
            kind={tab === "preview" ? "markdown" : "code"}
            text={text}
            roomId={roomId}
            annotating={annotating}
            onPicked={setTarget}
          />
        )}
      </div>

      {frameErrors.length > 0 && tab === "preview" ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-caption1 text-accent-danger">
          <WarningIcon className="size-4 shrink-0" />
          <span
            className="min-w-0 flex-1 truncate"
            title={frameErrors.join("\n")}
          >
            {frameErrors.length === 1
              ? frameErrors[0]
              : `${frameErrors.length} errors in the preview`}
          </span>
          <Button
            size="xs"
            variant="utility"
            disabled={fixSent === current.eventId}
            onClick={() => void askToFix()}
          >
            {fixSent === current.eventId ? "Sent" : "Ask agent to fix"}
          </Button>
        </div>
      ) : null}

      {annotating && canAnnotate ? (
        <div
          className="shrink-0 border-t border-border p-3"
          data-testid="artifact-annotation-bar"
        >
          {target ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addAnnotation();
              }}
            >
              <p className="truncate text-caption1 text-text-secondary">
                Annotating{" "}
                <span className="font-mono text-text-primary">
                  {describeTarget(target)}
                </span>
              </p>
              <Textarea
                aria-label="Annotation note"
                autoFocus
                rows={2}
                maxLength={MAX_NOTE}
                value={note}
                placeholder="What should change here? (optional)"
                className="text-body2"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    addAnnotation();
                  } else if (e.key === "Escape") {
                    resetAnnotation();
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={resetAnnotation}
                >
                  Cancel
                </Button>
                <Button type="submit" size="xs">
                  Add to reply
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-caption1 text-text-tertiary">
              {srcdoc !== null
                ? "Click an element in the preview to annotate it."
                : tab === "code"
                  ? "Click a line or select code to annotate it."
                  : "Click a paragraph or select text to annotate it."}
            </p>
          )}
        </div>
      ) : null}

      <AlertDialog
        open={link !== null}
        onOpenChange={(open) => !open && setLink(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open external link?</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {link}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                link && window.open(link, "_blank", "noopener,noreferrer")
              }
            >
              Open link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelShell>
  );
}

function PanelShell({
  mobile,
  title,
  children,
}: {
  mobile: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title ? `Artifact: ${title}` : "Artifact"}
      data-testid="artifact-panel"
      className={cn(
        "flex min-w-0 flex-col bg-background",
        mobile
          ? "fixed inset-0 z-50"
          : "relative h-full flex-1 border-l border-border",
      )}
    >
      {children}
    </section>
  );
}

function Header({
  title,
  subtitle,
  kind,
  actions,
  onClose,
}: {
  title: string;
  subtitle?: string;
  kind?: ArtifactKind;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      {kind ? (
        <ArtifactKindIcon
          kind={kind}
          className="size-4 shrink-0 text-text-tertiary"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-heading text-subtitle font-semibold">
          {title}
        </h2>
        {subtitle ? (
          <p className="truncate text-caption1 text-text-tertiary">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <IconButton
          size="small"
          icon={<CloseIcon />}
          label="Close artifact"
          onClick={onClose}
        />
      </div>
    </div>
  );
}
