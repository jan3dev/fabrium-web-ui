import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MatrixClientPeg } from "@/client/peg";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileDiffIcon,
  PointerClickIcon,
  PrinterIcon,
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
import { Spinner } from "@/components/ui/spinner";
import {
  useArtifactRoute,
  useArtifactText,
  useThreadArtifacts,
} from "@/hooks/use-artifacts";
import { useActor } from "@/hooks/use-actor";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStyleDraft } from "@/hooks/use-style-draft";
import {
  addArtifactRefDraft,
  type ArtifactRefTarget,
  MAX_REFS,
} from "@/lib/artifacts/refs";
import {
  addValueRef,
  designSystemSectionPage,
  designSystemSections,
  type DesignSystemSection,
  parseDesignSystem,
  type TokenSection,
} from "@/lib/artifacts/design-system";
import {
  isFrameKind,
  type PresenterMessage,
  presenterChannel,
  readFrames,
  stepFrame,
  stepZoom,
  ZOOM_KEYS,
} from "@/lib/artifacts/frames";
import { addPreviewError, composeFixRequest } from "@/lib/artifacts/runtime";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { annotationNote } from "@/lib/artifacts/styles";
import { copyToClipboard, downloadBlob } from "@/lib/browser-actions";
import { isEditableKeyboardTarget } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import type { ArtifactKind } from "@/model/types";
import { ArtifactKindIcon, artifactKindLabel } from "./artifact-card";
import { ArtifactPreview, type ArtifactPreviewHandle, PrintFrame } from "./artifact-preview";
import { AnnotationForm } from "./artifact-refs";
import { ArtifactTextView } from "./artifact-text-view";
import { DesignSystemNav } from "./design-system-nav";
import { FrameControls, FrameRail, type PresentMode } from "./frame-rail";
import { StyleInspector } from "./style-inspector";

type Tab = "preview" | "code" | "changes";

const EXTENSION: Record<ArtifactKind, string> = {
  html: "html",
  svg: "svg",
  react: "jsx",
  markdown: "md",
  code: "txt",
  slides: "html",
  design: "html",
  "design-system": "json",
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

  // Design system: parsed once per version; the open section is kept per artifact and
  // falls back to the first one with content.
  const system = useMemo(
    () => (current?.kind === "design-system" && text !== null ? parseDesignSystem(text) : null),
    [current?.kind, text],
  );
  const [dsChoice, setDsChoice] = useState<{ id: string; key: DesignSystemSection }>({ id: "", key: "overview" });
  const dsSections = useMemo(() => (system ? designSystemSections(system) : []), [system]);
  // Slides and design: the frames, read from the source (never from the frame).
  const frameKind = current && isFrameKind(current.kind) ? current.kind : null;
  const frames = useMemo(
    () => (frameKind && text !== null ? readFrames(frameKind, text) : []),
    [frameKind, text],
  );
  const section = dsSections.find((s) => s.key === dsChoice.key && dsChoice.id === current?.identifier)?.key ?? dsSections[0]?.key;

  const [channel] = useState(() => `artifact_${crypto.randomUUID()}`);
  const framed =
    previewable &&
    current.kind !== "markdown" &&
    tab === "preview" &&
    (current.kind !== "design-system" || (section !== undefined && section !== "overview"));
  const srcdoc = useMemo(
    () =>
      !framed || text === null
        ? null
        : system && section && section !== "overview"
          ? buildArtifactSrcdoc("html", designSystemSectionPage(system, section), channel)
          : buildArtifactSrcdoc(current.kind, text, channel),
    [framed, current?.kind, text, channel, system, section],
  );
  const viewer = useActor(MatrixClientPeg.safeGet()?.getUserId() ?? "", roomId);

  const [annotating, setAnnotating] = useState(false);
  const [target, setTarget] = useState<ArtifactRefTarget | null>(null);
  const [note, setNote] = useState("");
  const preview = useRef<ArtifactPreviewHandle>(null);
  const draft = useStyleDraft((edit) => preview.current?.style(edit));
  const [errors, setErrors] = useState<{ id: string; list: readonly string[] }>(
    { id: "", list: [] },
  );
  const [fixSent, setFixSent] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // The open frame, kept per artifact, so a new version stays on its frame and another
  // artifact starts at the first.
  const [frameState, setFrameState] = useState<{ id: string; index: number }>({ id: "", index: 0 });
  const frameIndex = Math.min(
    frameState.id === current?.identifier ? frameState.index : 0,
    Math.max(0, frames.length - 1),
  );
  const [zoom, setZoom] = useState<number | null>(null);
  const [grid, setGrid] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // Present: skipped slides are left out. Fullscreen is separate (F toggles it), so a
  // presentation run from the presenter window can stay in a normal window.
  const [presenting, setPresenting] = useState(false);
  const leavingFullscreen = useRef(false);
  // The presenter window's session; it gets the deck and sends `go` over a BroadcastChannel.
  const [presenter, setPresenter] = useState<string | null>(null);
  const presenterLink = useRef<{ deck: PresenterMessage | null; go: (index: number) => void } | null>(null);
  const presenterChannelRef = useRef<BroadcastChannel | null>(null);
  const [printDoc, setPrintDoc] = useState<string | null>(null);

  useEffect(() => {
    // Esc in fullscreen ends the presentation; F leaves fullscreen only.
    const onChange = () => {
      if (document.fullscreenElement) return;
      if (leavingFullscreen.current) leavingFullscreen.current = false;
      else {
        setPresenting(false);
        setPresenter(null);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Present, zoom and the grid belong to the open artifact: another one starts without them.
  const artifactId = current?.identifier;
  useEffect(() => {
    setPresenting(false);
    setPresenter(null);
    setZoom(null);
    setGrid(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  }, [artifactId]);

  useEffect(() => {
    if (!presenter) return;
    const ch = new BroadcastChannel(presenterChannel(presenter));
    ch.onmessage = (e: MessageEvent<unknown>) => {
      const d = e.data as { type?: unknown; index?: unknown } | null;
      if (d?.type === "hello" && presenterLink.current?.deck) ch.postMessage(presenterLink.current.deck);
      else if (d?.type === "go" && typeof d.index === "number") presenterLink.current?.go(d.index);
    };
    presenterChannelRef.current = ch;
    return () => {
      ch.postMessage({ type: "end" } satisfies PresenterMessage);
      ch.close();
      presenterChannelRef.current = null;
    };
  }, [presenter]);
  // The deck once per text (none while a version loads); a slide change is only its index.
  useEffect(() => {
    const deck = presenterLink.current?.deck;
    if (deck) presenterChannelRef.current?.postMessage(deck);
  }, [presenter, text]);
  useEffect(() => {
    presenterChannelRef.current?.postMessage({ type: "go", index: frameIndex } satisfies PresenterMessage);
  }, [frameIndex]);

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
  const dsInvalid = tab === "preview" && current.kind === "design-system" && text !== null && !system;
  const dsEmpty = tab === "preview" && system !== null && dsSections.length === 0;
  const framing = frameKind !== null && srcdoc !== null && frames.length > 0;
  const canAnnotate = tab !== "changes" && text !== null && !dsInvalid && !dsEmpty && !(framing && grid);
  const deckNotes = frameKind === "slides" && frames.some((f) => f.notes);
  const rail = framing
    ? { label: frameKind === "slides" ? "Slides" : "Screens", frames, srcdoc: srcdoc!, channel, active: frameIndex }
    : null;
  presenterLink.current = {
    deck: text === null ? null : { type: "deck", title: current.title, text, index: frameIndex },
    go: selectFrame,
  };

  function selectFrame(i: number) {
    if (!current || i === frameIndex || i < 0 || i >= frames.length) return;
    resetAnnotation();
    setFrameState({ id: current.identifier, index: i });
  }

  /** A key from the panel or the frame; true when it did something. */
  function frameKey(key: string): boolean {
    if (key === "zoomIn" || key === "zoomOut" || key === "zoomFit") {
      // No zoom while presenting or in the grid: the browser keeps its own zoom keys.
      if (presenting || grid) return false;
      setZoom(key === "zoomFit" ? null : stepZoom(zoom, key === "zoomIn" ? 1 : -1));
      return true;
    }
    if (presenting && key === "Escape") endPresent();
    else if (presenting && key === "f") toggleFullscreen();
    else {
      const next = stepFrame(key, frameIndex, frames, presenting);
      if (next !== null) selectFrame(next);
      return next !== null;
    }
    return true;
  }

  function present(mode: PresentMode) {
    const start =
      mode === "start" || frames[frameIndex]?.skip
        ? stepFrame(mode === "start" ? "Home" : "ArrowRight", frameIndex, frames, true)
        : frameIndex;
    if (start === null) {
      toast.error("Every slide is skipped");
      return;
    }
    setAnnotating(false);
    setGrid(false);
    selectFrame(start);
    setPresenting(true);
    stage.current?.focus();
    if (mode === "notes") {
      const session = crypto.randomUUID();
      setPresenter(session);
      // Opening the window uses up the click, so this window goes fullscreen with F.
      if (!window.open(`/present/${session}`, "_blank", "popup,width=1200,height=760"))
        toast.error("Allow pop-ups to open the presenter view");
      return;
    }
    stage.current?.requestFullscreen().catch(() => {});
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      leavingFullscreen.current = true;
      void document.exitFullscreen();
    } else stage.current?.requestFullscreen().catch(() => {});
  }

  function endPresent() {
    setPresenting(false);
    setPresenter(null);
    if (document.fullscreenElement) void document.exitFullscreen();
  }

  function toggleGrid(on: boolean) {
    resetAnnotation();
    setAnnotating(false);
    setGrid(on);
  }

  function selectSection(key: DesignSystemSection) {
    if (!current || key === section) return;
    resetAnnotation();
    setDsChoice({ id: current.identifier, key });
  }

  function goTo(i: number) {
    const v = versions[i];
    if (!v) return;
    resetAnnotation();
    route.open(v.identifier, v.eventId);
  }

  /** Drops the pick. The style edits leave the frame too, unless they were added to the reply (`keep`). */
  function resetAnnotation(keep = false) {
    draft.reset(keep);
    setTarget(null);
    setNote("");
  }

  function selectTab(next: Tab) {
    resetAnnotation();
    setTab(next);
  }

  /** False, with a toast, when the composer already holds the most annotations a reply carries. */
  function addRef(refTarget: ArtifactRefTarget, refNote: string): boolean {
    if (!current) return false;
    const added = addArtifactRefDraft(roomId, threadRootId, {
      identifier: current.identifier,
      title: current.title,
      version: current.version,
      event_id: current.eventId,
      target: refTarget,
      note: refNote,
    });
    if (!added) toast.error(`A reply holds at most ${MAX_REFS} annotations. Send it first.`);
    return added;
  }

  function addAnnotation() {
    if (!target || !addRef(target, annotationNote(draft.changes, note))) return;
    resetAnnotation(true);
    toast("Annotation added to your reply");
  }

  function addValue(s: TokenSection, name: string, value: string) {
    const ref = addValueRef(s, name, value);
    if (addRef(ref.target, ref.note)) toast("Added to your reply");
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
    ...(previewable ? [{ value: "preview" as const, label: "Preview", Icon: EyeIcon }] : []),
    { value: "code" as const, label: "Code", Icon: CodeIcon },
    ...(previous ? [{ value: "changes" as const, label: "Changes", Icon: FileDiffIcon }] : []),
  ];

  const nextTab = tabs.length > 1 ? tabs[(tabs.findIndex((t) => t.value === tab) + 1) % tabs.length] : undefined;

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
          </>
        }
      />

      {system && section && tab === "preview" ? (
        <DesignSystemNav
          sections={dsSections}
          section={section}
          onSectionChange={selectSection}
          onAdd={viewer.kind === "human" ? addValue : undefined}
        />
      ) : null}

      <div
        className="flex min-h-0 flex-1"
        // Frame navigation while focus is on the rail or the stage (also in fullscreen);
        // inside the frame, the frame forwards the keys.
        onKeyDown={
          framing
            ? (e) => {
                const t = e.target as HTMLElement;
                if (e.altKey || isEditableKeyboardTarget(t)) return;
                if (e.ctrlKey || e.metaKey) {
                  const zoomKey = ZOOM_KEYS[e.key];
                  if (zoomKey && frameKey(zoomKey)) e.preventDefault();
                  return;
                }
                // Space presses buttons and opens <details> (speaker notes, inspector sections).
                if (e.key === " " && t.closest("button, summary, a, [role=button]")) return;
                if (frameKey(e.key === "F" ? "f" : e.key)) e.preventDefault();
              }
            : undefined
        }
      >
        {rail && !isMobile && !grid ? <FrameRail {...rail} onSelect={selectFrame} /> : null}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Floats over the artifact, outside the Present target. */}
          <div
            role="toolbar"
            aria-label="Artifact tools"
            data-testid="artifact-toolbar"
            // Keys in the toolbar and its menus (they bubble here through React) never move the frame.
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-1 rounded-card border border-border bg-surface-primary p-1 shadow-surface"
          >
            {/* One slot: the button shows the view it switches to (preview → code → changes). */}
            {nextTab && !presenting ? (
              <IconButton
                size="small"
                icon={<nextTab.Icon />}
                label={`Show ${nextTab.label.toLowerCase()}`}
                data-testid={`artifact-tab-${nextTab.value}`}
                onClick={() => selectTab(nextTab.value)}
              />
            ) : null}
            {framing ? (
              <FrameControls
                zoom={zoom}
                onZoom={presenting ? undefined : setZoom}
                grid={grid}
                onGrid={presenting ? undefined : toggleGrid}
                onPresent={frameKind === "slides" ? present : undefined}
                notes={deckNotes}
                presenting={presenting}
                onEnd={endPresent}
              />
            ) : null}
            {presenting ? null : (
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
                {frameKind && frames.length > 0 ? (
                  <IconButton
                    size="small"
                    icon={<PrinterIcon />}
                    label="Export as PDF"
                    disabled={printDoc !== null}
                    onClick={() => text !== null && setPrintDoc(buildArtifactSrcdoc(frameKind, text, channel, true))}
                  />
                ) : null}
              </>
            )}
          </div>
          {/* The Present target: fullscreen shows the stage alone. */}
          <div ref={stage} tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 bg-background focus:outline-none">
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
            ) : dsInvalid ? (
              <p role="alert" className="p-4 text-body2 text-text-secondary">
                This design system can&apos;t be shown: its content is not a valid JSON object.
              </p>
            ) : dsEmpty ? (
              <p className="p-4 text-body2 text-text-secondary">
                This design system is empty. Ask the agent to add colors, type or components.
              </p>
            ) : rail && grid ? (
              <FrameRail
                grid
                {...rail}
                onSelect={(i) => {
                  setGrid(false);
                  selectFrame(i);
                }}
              />
            ) : srcdoc !== null ? (
              <ArtifactPreview
                // A section is its own document: a new frame, like a new version.
                key={`${current.eventId}:${section ?? ""}`}
                kind={system ? "html" : current.kind}
                srcdoc={srcdoc}
                channel={channel}
                title={`Preview of ${current.title}`}
                annotating={annotating}
                handle={preview}
                onPicked={(picked, computed) => {
                  setTarget(picked);
                  draft.picked(computed);
                }}
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
                frame={
                  frameKind
                    ? presenting
                      ? { index: frameIndex, zoom: null, transition: frames[frameIndex]?.transition }
                      : { index: frameIndex, zoom }
                    : undefined
                }
                onKey={frameKey}
              />
            ) : (
              <ArtifactTextView
                key={`${current.eventId}:${tab}`}
                kind={tab === "preview" ? "markdown" : "code"}
                text={tab === "preview" && system ? system.overview : text}
                roomId={roomId}
                annotating={annotating}
                onPicked={setTarget}
              />
            )}
          </div>
          {/* Read-only here; never on the slide (the frame hides `aside[data-notes]`). */}
          {framing && deckNotes && !grid ? (
            <details open data-testid="speaker-notes" className="shrink-0 border-t border-border">
              <summary className="cursor-pointer px-3 py-1.5 text-caption1 font-medium text-text-secondary">
                Speaker notes
              </summary>
              <p className="max-h-40 overflow-y-auto px-3 pb-3 text-body2 whitespace-pre-line text-text-primary">
                {frames[frameIndex]?.notes || "No notes for this slide."}
              </p>
            </details>
          ) : null}
        </div>
        {/* ponytail: desktop only; on a phone the panel has no room beside the frame. Add a sheet when asked. */}
        {annotating && srcdoc !== null && !isMobile && target?.kind === "element" ? (
          <StyleInspector selector={target.selector} values={draft.values} onChange={draft.change} />
        ) : null}
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
            <AnnotationForm
              target={target}
              note={note}
              onNoteChange={setNote}
              onAdd={addAnnotation}
              onCancel={() => resetAnnotation()}
            />
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

      {printDoc !== null ? (
        <PrintFrame srcdoc={printDoc} channel={channel} onDone={() => setPrintDoc(null)} />
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
