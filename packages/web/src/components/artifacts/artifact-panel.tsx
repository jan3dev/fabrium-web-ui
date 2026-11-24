import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  InfoIcon,
  PanelRightIcon,
  PrinterIcon,
  WarningIcon,
} from "@/components/icons";
import { DiffView } from "@/components/timeline/diff-view";
import { ArtifactEventType } from "@/events/fabrium-artifact";
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import {
  useArtifactRoute,
  useArtifactText,
  useThreadArtifacts,
} from "@/hooks/use-artifacts";
import { useActor } from "@/hooks/use-actor";
import { useAgentFocus } from "@/hooks/use-agent-focus";
import { useArtifactComments } from "@/hooks/use-artifact-comments";
import { assetDataUrls, useArtifactAssets } from "@/hooks/use-artifact-assets";
import { headAuthor, useArtifactDraft } from "@/hooks/use-artifact-draft";
import { type EditorMode, useCanvasEditor } from "@/hooks/use-canvas-editor";
import { useDebounce } from "@/hooks/use-debounce";
import { useGuestIds } from "@/hooks/use-member-roles";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMyPowerLevel } from "@/hooks/use-my-power-level";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useStyleDraft } from "@/hooks/use-style-draft";
import { useThreadEntries } from "@/hooks/use-timeline-entries";
import {
  addArtifactRefDraft,
  type ArtifactRefTarget,
  MAX_REFS,
} from "@/lib/artifacts/refs";
import { inlineAssets } from "@/lib/artifacts/assets";
import { type Box, canStructure, editKeyOf, isCanvasKind, type KeyLike } from "@/lib/artifacts/canvas";
import { type ArtifactComment, RESOLVE_KEY } from "@/lib/artifacts/comments";
import { CURSOR_PIN, PICK_PIN, type PinRequest } from "@/lib/artifacts/pins";
import { sendReaction } from "@/lib/matrix/reactions";
import {
  addValueRef,
  cssValue,
  designSystemSectionPage,
  designSystemSections,
  type DesignSystemSection,
  fontFamilies,
  parseDesignSystem,
  sectionLabel,
  type TokenSection,
} from "@/lib/artifacts/design-system";
import {
  addFrame,
  addToken,
  artboardSection,
  changedFrames,
  deleteFrame,
  duplicateFrame,
  frameSources,
  moveFrame,
  pasteFrame,
  renameFrame,
  resizeFrame,
  setSlideSize,
  setComponentDescription,
  setFrameNotes,
  setFrameSkip,
  setOverview,
  setTokenField,
  slideLayouts,
  withFrames,
} from "@/lib/artifacts/edit";
import {
  FRAME_SIZE,
  type SlideSize,
  type FrameKind,
  isFrameKind,
  MAX_NAME,
  type PresenterMessage,
  presenterChannel,
  readFrames,
  stepFrame,
  stepZoom,
  clampZoom,
  ZOOM_KEYS,
} from "@/lib/artifacts/frames";
import { addPreviewError, composeFitRequest, composeFixRequest } from "@/lib/artifacts/runtime";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { clampTweak, readTweaks, tweakMessage, type TweakValue, writeTweaks } from "@/lib/artifacts/tweaks";
import { annotationNote } from "@/lib/artifacts/styles";
import { copyToClipboard, downloadBlob } from "@/lib/browser-actions";
import { isEditableKeyboardTarget } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import type { ActorKind, ArtifactKind } from "@/model/types";
import { ArtifactKindIcon, artifactKindLabel } from "./artifact-card";
import {
  ArtifactTitleMenu,
  type FrameAction,
  FrameMenu,
  type FrameSize,
  frameUnit,
  NameDialog,
  SizeDialog,
  VersionMenu,
} from "./artifact-menus";
import { ArtifactPreview, type ArtifactPreviewHandle, PrintFrame } from "./artifact-preview";
import { CommentList, FramePins } from "./artifact-comments";
import { AnnotationForm } from "./artifact-refs";
import { ArtifactTextView } from "./artifact-text-view";
import { CanvasToolbar } from "./canvas-toolbar";
import { FloatingToolbar } from "./floating-toolbar";
import { LayersList } from "./layers-list";
import { DesignSystemEditor } from "./design-system-editor";
import { SpeakerNotesField } from "./speaker-notes-field";
import { DesignSystemNav } from "./design-system-nav";
import { LayoutPicker } from "./layout-picker";
import { FrameControls, FrameRail, type PresentMode } from "./frame-rail";
import { FrameProperties, type PaletteColor, StyleInspector } from "./style-inspector";
import { TweaksPanel } from "./tweaks-panel";

type Tab = "preview" | "code" | "changes";
/** The side panel's tabs, in their order. */
const SIDE_TABS = { properties: "Properties", tweaks: "Tweaks", comments: "Comments" } as const;
type SideTab = keyof typeof SIDE_TABS;

const DEFAULT_ARTBOARD = { width: FRAME_SIZE.design[0], height: FRAME_SIZE.design[1] };

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
const NO_TWEAKS: Record<string, TweakValue> = {};

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
  // One pass over the thread for the versions and the comments.
  const thread = useThreadEntries(roomId, threadRootId, workforceSpaceId);
  const all = useThreadArtifacts(thread.replies);
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
  const latest = versions.at(-1);
  const onLatest = current !== undefined && current === latest;
  const { text: versionText, error } = useArtifactText(current);
  const latestState = useArtifactText(latest);
  const edits = useArtifactDraft(roomId, threadRootId, latest, latestState.text);
  // The user's edits, unsent or on their way, show in place of the latest version.
  const text = onLatest && edits.text !== null ? edits.text : versionText;

  const previewable = current !== undefined && current.kind !== "code";
  const [tabChoice, setTab] = useState<Tab>("preview");
  const tab: Tab =
    tabChoice === "changes" && !previous
      ? "preview"
      : tabChoice === "preview" && !previewable
        ? "code"
        : tabChoice;
  // Slides and design also need it for the changed marks.
  const prevState = useArtifactText(
    tab === "changes" || (current && isFrameKind(current.kind)) ? previous : undefined,
  );

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
  // Add slide: the layout picker for a new slide after `picker`, in the deck's design.
  const [picker, setPicker] = useState<number | null>(null);
  const layoutChoice = useMemo(() => {
    if (picker === null || frameKind !== "slides" || text === null) return null;
    const layouts = slideLayouts(text, picker);
    const deck = withFrames(text, layouts.map((l) => l.section));
    return { layouts, srcdoc: buildArtifactSrcdoc("slides", deck, channel) };
  }, [picker, frameKind, text, channel]);
  const me = MatrixClientPeg.safeGet()?.getUserId() ?? "";
  const viewer = useActor(me, roomId);
  // Spec D2 (as `mayAuthorArtifact`, but live): a human who may send the event type and is
  // no guest edits; agents see the viewer.
  const canSend = useMyPowerLevel(roomId).canSendEvent(ArtifactEventType);
  const guest = useGuestIds(roomId, null).has(me);
  const mayEdit = viewer.kind === "human" && canSend && !guest;
  // Frames the shown version changed against the one before, both as edited; null while either loads.
  const changed = useMemo(
    () =>
      frameKind && previous && prevState.text !== null && versionText !== null
        ? changedFrames(prevState.text, versionText)
        : null,
    [frameKind, previous, prevState.text, versionText],
  );

  // Comment mode (spec §3.8, §6.6): the side panel's Comments tab. While it shows, a click picks an
  // element to comment on and open comments have markers. Comments are thread messages with
  // references to this artifact.
  const [annotating, setAnnotating] = useState(false);
  const [, setSearchParams] = useSearchParams();
  const openComments = useArtifactComments(
    roomId,
    thread,
    workforceSpaceId,
    current?.identifier,
    latest ? { eventId: latest.eventId, kind: latest.kind, text: latestState.text } : undefined,
  );
  // The agent cursor (spec §6.8): where an agent works in the latest version while its turn runs.
  const cursor = useAgentFocus(roomId, threadRootId, workforceSpaceId).find(
    (f) => f.identifier === current?.identifier,
  );
  // Pin boxes go straight to PinOverlay: they change on every scroll of the frame.
  const pinSink = useRef<((boxes: Map<string, Box>) => void) | null>(null);
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
  const canvasKind = current && isCanvasKind(current.kind) ? current.kind : null;
  // The design system the thread has, for the colour picker and fonts (spec §6.5).
  const dsArtifact = useMemo(() => [...all].reverse().find((v) => v.kind === "design-system"), [all]);
  const dsText = useArtifactText(canvasKind ? dsArtifact : undefined).text;
  const tokens = useMemo(() => {
    const ds = dsText === null ? null : parseDesignSystem(dsText);
    return {
      palette: (ds?.colors ?? []).flatMap((c): PaletteColor[] => (cssValue(c.value) ? [{ name: c.name, value: c.value }] : [])),
      fonts: fontFamilies(ds?.typography ?? []),
    };
  }, [dsText]);
  // Images, videos and fonts the document names, downloaded for the frame (spec §5.4).
  // A design system's Fonts page names its uploaded fonts the same way (spec §5.1).
  const dsPage = useMemo(
    () => (system && section && section !== "overview" ? designSystemSectionPage(system, section) : null),
    [system, section],
  );
  const media = useArtifactAssets(canvasKind ? text : section === "fonts" ? dsPage : null);
  // Spec §5.6: owners and admins list a design system for the whole workspace.
  const designSystems = useDesignSystems(workforceSpaceId);
  const listed = designSystems.workspace.some((s) => s.roomId === roomId && s.identifier === current?.identifier);
  const cardAssets = useMemo(() => media.assets.filter((a) => a.kind !== "video"), [media.assets]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const canvas = useCanvasEditor({
    kind: current?.kind,
    text,
    active: framed && canvasKind !== null,
    editable: mayEdit && onLatest,
    frame: {
      index: frameIndex,
      unit: frameKind ? frameUnit(frameKind) : "page",
      width: frames[frameIndex]?.width ?? 0,
      height: frames[frameIndex]?.height ?? 0,
    },
    apply: edits.apply,
    step: edits.step,
    post: (type, detail) => preview.current?.post(type, detail),
    me,
  });
  // Tweaks (spec §6.7): the document's controls; changed values are kept per version until Keep or Reset.
  const tweaks = useMemo(() => (canvasKind && text !== null ? readTweaks(text) : []), [canvasKind, text]);
  const [tweakState, setTweakState] = useState<{ id: string; open: boolean; values: Record<string, TweakValue> }>({
    id: "",
    open: false,
    values: {},
  });
  const tweakOwn = tweakState.id === current?.eventId;
  const tweakValues = tweakOwn ? tweakState.values : NO_TWEAKS;
  const tweaksOpen = tweakOwn && tweakState.open && tweaks.length > 0 && framed;
  const tweakFrame = useMemo(
    () => (tweaks.length > 0 ? tweakMessage(tweaks, tweakValues) : null),
    [tweaks, tweakValues],
  );
  const setTweaks = (next: { open?: boolean; values?: Record<string, TweakValue> }) =>
    current && setTweakState((prev) => ({ ...(prev.id === current.eventId ? prev : { open: false, values: {} }), ...next, id: current.eventId }));
  // The doc is edited in place, so its text is part of the key.
  const canvasText = canvas.doc?.text;
  const layers = useMemo(
    () => (canvas.properties && canvas.doc ? canvas.doc.layers(frameIndex) : []),
    [canvas.properties, canvas.doc, canvasText, frameIndex],
  );
  const srcdoc = useMemo(
    () =>
      !framed || text === null
        ? null
        : dsPage !== null
          ? buildArtifactSrcdoc("html", dsPage, channel)
          : // The stamped copy while one is kept: canvas edits then reach the frame as patches, not a reload.
            buildArtifactSrcdoc(current.kind, canvas.doc ? canvas.doc.stamped() : text, channel),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `text` only when no stamped copy is kept
    [framed, current?.kind, canvas.doc ?? text, channel, dsPage],
  );
  // The rail's cards: the plain source, settled, so a drag does not reload every card.
  const railText = useDebounce(text, 400);
  const railSrcdoc = useMemo(
    () => (frameKind && railText !== null ? buildArtifactSrcdoc(frameKind, railText, channel) : null),
    [frameKind, railText, channel],
  );
  const [zoom, setZoom] = useState<number | null>(null);
  // The scale the frame reports: the percentage a fitted frame shows, and where a wheel zoom starts.
  const [scale, setScale] = useState<number | null>(null);
  const [grid, setGrid] = useState(false);
  const [dsEditing, setDsEditing] = useState(false);
  const [dialog, setDialog] = useState<
    { type: "rename" } | { type: "rename-frame"; index: number } | { type: "size"; index: number; add: boolean } | null
  >(null);
  // Changed marks (spec §6.8). Content from someone else that arrives while the panel is
  // open, a new version or a save into one, marks the frames it changed against the
  // content shown before; the panel jumps to the first and outlines the stage for two seconds.
  const seen = useRef<{ head: string; text: string } | null>(null);
  const [arrival, setArrival] = useState<{
    version: string;
    head: string;
    indexes: number[];
    actor: ActorKind;
    jumped: boolean;
  } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const latestText = latestState.text;
  useEffect(() => {
    if (!latest || latestText === null || latest.headEventId.startsWith("~")) return;
    const prev = seen.current;
    if (prev?.head === latest.headEventId) return;
    seen.current = { head: latest.headEventId, text: latestText };
    const author = headAuthor(latest);
    if (!prev || author.id === me || !isFrameKind(latest.kind)) return;
    setArrival({
      version: latest.eventId,
      head: latest.headEventId,
      indexes: changedFrames(prev.text, latestText),
      actor: author.kind,
      jumped: false,
    });
  }, [latest, latestText, me]);
  const currentId = current?.eventId;
  useEffect(() => {
    if (!arrival || arrival.jumped || !current || currentId !== arrival.version) return;
    setArrival({ ...arrival, jumped: true });
    if (arrival.indexes.length === 0) return;
    setFrameState({ id: current.identifier, index: arrival.indexes[0]! });
    setFlash(arrival.head);
    setTimeout(() => setFlash((f) => (f === arrival.head ? null : f)), 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, [arrival, currentId]);
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
    setScale(null);
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
  const dsInvalid = tab === "preview" && current.kind === "design-system" && text !== null && !system;
  const dsEmpty = tab === "preview" && system !== null && dsSections.length === 0;
  const framing = frameKind !== null && srcdoc !== null && frames.length > 0;
  // Edit controls: the latest version, for users with edit rights (spec D2), never while presenting.
  const editable = mayEdit && onLatest && text !== null && !presenting;
  const dsEditor =
    dsEditing && editable && system !== null && section !== undefined && tab === "preview" ? section : null;
  const canAnnotate =
    tab !== "changes" && text !== null && !dsInvalid && !dsEmpty && !(framing && grid) && dsEditor === null;
  const deckNotes = frameKind === "slides" && frames.some((f) => f.notes);
  // Pins: a marker per open comment on an element (comment mode), and the agent cursor on the latest version.
  const commenting = annotating && canAnnotate && !presenting;
  const markers = commenting ? openComments.filter((c) => c.ref.target.kind === "element") : [];
  const cursorShown = cursor !== undefined && onLatest && !presenting;
  // A picked element's note is written in a popover beside it. On a phone, and for a line or a
  // paragraph, the form is in the Comments tab.
  const pickSelector = commenting && !isMobile && srcdoc !== null && target?.kind === "element" ? target.selector : null;
  const pins: PinRequest[] = [
    ...(pickSelector ? [{ id: PICK_PIN, selector: pickSelector }] : []),
    ...markers.flatMap((c) => (c.ref.target.kind === "element" ? [{ id: c.id, selector: c.ref.target.selector }] : [])),
    ...(cursorShown ? [{ id: CURSOR_PIN, selector: cursor.selector }] : []),
  ];
  // The canvas editor (spec §6.4): on by default for an editor of slides and design; for html
  // (style and text only, D3) and for viewers (inspect) while Properties is open. On a phone,
  // retype and delete only.
  const canvasReady =
    canvas.doc !== null && tab === "preview" && srcdoc !== null && !presenting && !grid && (frameKind === null || framing);
  const canvasOn = canvasReady && !annotating;
  const canvasMode: EditorMode = !canvasOn
    ? "off"
    : editable && frameKind && !isMobile
      ? "full"
      : editable && (frameKind || canvas.properties)
        ? "style"
        : canvas.properties
          ? "inspect"
          : "off";
  // On a phone Properties is a sheet (spec §6.1).
  const showProperties = canvasMode !== "off" && canvas.properties;
  // The side panel (spec §6.1): one button in the toolbar opens it, a tab per tool. Properties
  // stays the remembered choice; Tweaks and Comments show over it while they are open.
  const sideTabs = (["properties", "tweaks", "comments"] as const).filter((t) =>
    t === "properties" ? canvasKind && framed && canvasReady : t === "tweaks" ? tweaks.length > 0 && framed : canAnnotate,
  );
  const sideTab: SideTab | null = presenting
    ? null
    : commenting
      ? "comments"
      : tweaksOpen
        ? "tweaks"
        : showProperties
          ? "properties"
          : null;
  /** Canvas keys; on a phone only delete, undo and redo (direct editing is retype, delete and the slide menu). */
  const canvasKey = (k: KeyLike) => {
    const a = editKeyOf(k);
    return (!isMobile || a === "delete" || a === "undo" || a === "redo") && canvas.onKey(k);
  };
  // Marks: what arrived from someone else into this version; else, for a version nobody saved
  // into yet, what it changed against the one before (in its author's color, so a person's
  // edit never shows in the agent's). The user's own edits on top shift the frames: none then.
  const marks =
    arrival?.version === current.eventId && arrival.indexes.length > 0
      ? { indexes: arrival.indexes, actor: arrival.actor }
      : !current.edited && changed && changed.length > 0
        ? { indexes: changed, actor: current.author.kind }
        : undefined;
  const frameEdit =
    editable && frameKind ? { kind: frameKind, onAction: frameAction, onMove: moveByDrag } : undefined;
  const rail = framing
    ? {
        label: frameKind === "slides" ? "Slides" : "Screens",
        frames,
        srcdoc: railSrcdoc ?? srcdoc!,
        channel,
        active: frameIndex,
        edit: frameEdit,
        changed: onLatest && edits.text !== null ? undefined : marks,
        assets: cardAssets,
      }
    : null;
  presenterLink.current = {
    deck: text === null ? null : { type: "deck", title: current.title, text, index: frameIndex },
    go: selectFrame,
  };

  /**
   * One user edit to the shown text; it autosaves into the latest version (spec §5.2). The
   * route names the version by its first event, which a save does not change, so the panel
   * stays on it. A field that commits as it unmounts may still call this while the panel closes.
   */
  function edit(change: (text: string) => string, summary: string, select?: number) {
    if (!current || !edits.apply(change, summary)) return;
    if (select !== undefined) setFrameState({ id: current.identifier, index: select });
  }

  function frameAction(i: number, action: FrameAction) {
    if (!frameKind || text === null) return;
    const unit = frameUnit(frameKind);
    const n = i + 1;
    switch (action.type) {
      case "add":
        // A slide starts from a layout the user picks; an artboard from a size (its own if none).
        if (frameKind === "slides") return setPicker(i);
        return addArtboard(i, action.size ?? frames[i] ?? DEFAULT_ARTBOARD);
      case "duplicate":
        return edit((t) => duplicateFrame(t, i), `Duplicated ${unit} ${n}`, i + 1);
      case "copy":
        return copyToClipboard(frameSources(text)[i] ?? "", `${unit === "slide" ? "Slide" : "Artboard"} copied`);
      case "paste":
        return void paste(frameKind, i);
      case "move":
        return edit((t) => moveFrame(t, i, i + action.by), `Moved ${unit} ${n}`, i + action.by);
      case "skip": {
        const skip = !frames[i]?.skip;
        return edit((t) => setFrameSkip(t, i, skip), `${skip ? "Skipped" : "Included"} ${unit} ${n}`);
      }
      case "delete":
        return edit((t) => deleteFrame(t, i), `Deleted ${unit} ${n}`, Math.max(0, Math.min(i, frames.length - 2)));
      case "resize":
        return resize(frameKind, i, action.size);
      case "rename":
        return setDialog({ type: "rename-frame", index: i });
      case "add-custom":
      case "resize-custom":
        return setDialog({ type: "size", index: i, add: action.type === "add-custom" });
    }
  }

  function resize(kind: FrameKind, i: number, size: FrameSize) {
    edit(
      (t) => resizeFrame(t, i, size.width, size.height),
      `Resized ${frameUnit(kind)} ${i + 1} to ${size.width}×${size.height}`,
    );
  }

  /** Every slide at `size`. The content is not refitted: the toast offers to ask for that in the thread. */
  function setDeckSize(size: SlideSize) {
    if (!current || !edits.apply((t) => setSlideSize(t, size), `Changed the slides to ${size}`)) return;
    const body = composeFitRequest(current.identifier, size);
    toast(`Slides are now ${size}. Check that everything still fits.`, {
      action: {
        label: "Ask Fabrium to fit",
        onClick: () => {
          // The request names the artifact: its new size is saved first.
          edits.flush();
          void ask(body).then((sent) => sent && toast("Request sent"));
        },
      },
    });
  }

  function addArtboard(i: number, size: FrameSize) {
    edit((t) => addFrame(t, i, artboardSection(size)), `Added artboard ${i + 2}`, i + 1);
  }

  function moveByDrag(from: number, to: number) {
    if (frameKind) edit((t) => moveFrame(t, from, to), `Moved ${frameUnit(frameKind)} ${from + 1}`, to);
  }

  /** The clipboard's text is markup from outside: only a section parsed from it is kept. */
  async function paste(kind: FrameKind, i: number) {
    let clip: string;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      toast.error("Could not read the clipboard");
      return;
    }
    // `edits.apply` shows a thrown message as a toast.
    edit(
      (t) => {
        const next = pasteFrame(t, i, clip);
        if (next === null) throw new Error(`The clipboard holds no ${frameUnit(kind)}`);
        return next;
      },
      `Pasted ${frameUnit(kind)} ${i + 2}`,
      i + 1,
    );
  }

  function rename(title: string) {
    edits.flush();
    void edits.send({ title: title.slice(0, 200), summary: `Renamed to ${title}` }).catch(() => {});
  }

  /** The shown version under a new identifier in the same thread, then opens it. */
  function duplicate() {
    if (!current || text === null) return;
    edits.flush();
    const taken = new Set(all.map((v) => v.identifier));
    const stem = `${current.identifier.slice(0, 70)}-copy`;
    let identifier = stem;
    for (let n = 2; taken.has(identifier); n++) identifier = `${stem}-${n}`;
    void edits
      .send({
        identifier,
        title: `${current.title} (copy)`.slice(0, 200),
        text,
        basedOn: current.headEventId,
        summary: `Duplicated from ${current.title} v${current.version}`,
      })
      .then(() => route.open(identifier), () => {});
  }

  /** The shown older version's content, saved into the latest version (not a new version). */
  function restore() {
    if (!current || versionText === null) return;
    if (latestState.text === null) {
      toast.error("The latest version is still loading. Try again in a moment.");
      return;
    }
    const restored = versionText;
    if (edits.apply(() => restored, `Restored v${current.version}`)) edits.flush();
    route.open(current.identifier);
  }

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
    edits.flush();
    resetAnnotation();
    route.open(v.identifier, v.eventId);
  }

  /** Drops the pick. The style edits leave the frame too, unless they were added to the reply (`keep`). */
  function resetAnnotation(keep = false) {
    draft.reset(keep);
    setTarget(null);
    setNote("");
  }

  /** Shows a tab of the side panel; null closes it. Leaving Comments drops a half-made comment. */
  function showSide(next: SideTab | null) {
    resetAnnotation();
    setAnnotating(next === "comments");
    setTweaks({ open: next === "tweaks" });
    if (next === "properties") canvas.setProperties(true);
    // Closed for good, not only until Tweaks or Comments close. Where Properties is no tab, the choice stays.
    else if (next === null && sideTabs.includes("properties")) canvas.setProperties(false);
  }

  function selectTab(next: Tab) {
    edits.flush();
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
      // A comment sent to the agent mentions it (spec §6.6).
      ...(current.author.kind === "agent" ? { agent: current.author.id } : {}),
    });
    if (!added) toast.error(`A reply holds at most ${MAX_REFS} annotations. Send it first.`);
    return added;
  }

  /** Scrolls the thread to the comment's message (`?event=`). */
  function showComment(c: ArtifactComment) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("event", c.messageId);
      return next;
    });
  }

  /** The ✓ reaction resolves a comment (spec §6.6): every reference in its message. */
  function resolveComment(c: ArtifactComment) {
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    sendReaction(client, roomId, c.messageId, RESOLVE_KEY).catch(() => toast.error("Could not resolve the comment"));
  }

  function addToWorkspace() {
    if (!current) return;
    void designSystems
      .saveWorkspace([
        ...designSystems.workspace,
        {
          roomId,
          threadId: threadRootId,
          identifier: current.identifier,
          name: current.title,
          isDefault: designSystems.workspace.length === 0,
        },
      ])
      .then(
        () => toast.success("Added to the workspace design systems."),
        () => toast.error("Could not add the design system."),
      );
  }

  function addAnnotation() {
    if (!target || !addRef(target, annotationNote(draft.changes, note))) return;
    resetAnnotation(true);
    toast("Comment added. Send your reply to post it.");
  }

  function addValue(s: TokenSection, name: string, value: string) {
    if (editable) {
      edit((t) => addToken(t, s, name, value), `Added ${name} to ${sectionLabel(s)}`);
      return;
    }
    const ref = addValueRef(s, name, value);
    if (addRef(ref.target, ref.note)) toast("Added to your reply");
  }

  /** The text with its assets as `data:` URIs (spec §6.9): a file that needs no network. */
  async function withAssets(source: string): Promise<string> {
    if (media.named === 0) return source;
    if (media.assets.length < media.named) toast.error("Some images, videos or fonts are not loaded and were left out.");
    return inlineAssets(source, await assetDataUrls(media.assets));
  }

  async function download() {
    if (text === null || !current) return;
    const ext =
      current.kind === "code" && current.language
        ? current.language
        : EXTENSION[current.kind];
    const body = await withAssets(text);
    downloadBlob(
      new Blob([body], { type: "text/plain;charset=utf-8" }),
      `${current.identifier}.${ext.replace(/[^a-z0-9]/gi, "") || "txt"}`,
    );
  }

  /** `body` as a message in this thread; false, with a toast, when it was not sent. */
  async function ask(body: string): Promise<boolean> {
    try {
      await MatrixClientPeg.get().sendMessage(roomId, threadRootId, { msgtype: "m.text", body } as never);
      return true;
    } catch {
      toast.error("Could not send the request");
      return false;
    }
  }

  async function askToFix() {
    if (!current) return;
    setFixSent(current.eventId);
    if (!(await ask(composeFixRequest(current.identifier, frameErrors)))) setFixSent(null);
  }

  const tabs = [
    ...(previewable ? [{ value: "preview" as const, label: "Preview", Icon: EyeIcon }] : []),
    { value: "code" as const, label: "Code", Icon: CodeIcon },
    ...(previous ? [{ value: "changes" as const, label: "Changes", Icon: FileDiffIcon }] : []),
  ];

  const nextTab = tabs.length > 1 ? tabs[(tabs.findIndex((t) => t.value === tab) + 1) % tabs.length] : undefined;

  const propertiesPanel =
    showProperties && canvas.doc ? (
      <StyleInspector
        title="Properties"
        sheet
        selector={canvas.primary?.name ?? null}
        values={canvas.draft.values}
        onChange={canvas.draft.change}
        readOnly={canvasMode === "inspect"}
        palette={tokens.palette}
        fonts={tokens.fonts}
        background={canvas.selection?.background}
        box={
          canvas.primary && canStructure(canvas.doc.kind)
            ? { x: canvas.primary.x, y: canvas.primary.y, w: canvas.primary.w, h: canvas.primary.h, free: canvas.primary.free }
            : undefined
        }
        onBox={canvas.setBox}
        layers={
          <LayersList
            layers={layers}
            selected={canvas.selection?.ids ?? []}
            onSelect={canvas.select}
          />
        }
        frame={
          frameKind && frames[frameIndex] ? (
            <FrameProperties
              kind={frameKind}
              name={frames[frameIndex].name}
              width={frames[frameIndex].width}
              height={frames[frameIndex].height}
              transition={frames[frameIndex].transition}
              background={canvas.draft.values["background-color"]}
              palette={tokens.palette}
              readOnly={canvasMode === "inspect"}
              onName={(name) =>
                edit((t) => renameFrame(t, frameKind, frameIndex, name), `Renamed ${frameUnit(frameKind)} ${frameIndex + 1}`)
              }
              onSize={(size) => resize(frameKind, frameIndex, size)}
              onDeckSize={setDeckSize}
              onTransition={canvas.frameTransition}
              onBackground={(v) => canvas.frameStyle({ "background-color": v })}
            />
          ) : null
        }
        note={canvasMode === "inspect" ? "You can inspect this artifact. Ask the agent to change it." : null}
      />
    ) : null;

  const tweaksPanel = tweaksOpen ? (
    <TweaksPanel
      controls={tweaks}
      values={tweakValues}
      onChange={(name, v) => {
        const c = tweaks.find((t) => t.name === name);
        if (c) setTweaks({ values: { ...tweakValues, [name]: clampTweak(c, v) } });
      }}
      onReset={() => setTweaks({ values: {} })}
      onKeep={
        editable && canvasKind
          ? () => {
              edit((t) => writeTweaks(t, canvasKind, tweakValues), "Kept tweaks");
              setTweaks({ values: {} });
            }
          : undefined
      }
    />
  ) : null;

  const annotationForm = target ? (
    <AnnotationForm
      target={target}
      note={note}
      onNoteChange={setNote}
      onAdd={addAnnotation}
      onCancel={() => resetAnnotation()}
    />
  ) : null;

  const commentsPanel = (
    <div data-testid="artifact-comments-panel">
      <div className="p-3">
        {annotationForm && !pickSelector ? (
          annotationForm
        ) : (
          <p className="text-caption1 text-text-tertiary">
            {srcdoc !== null
              ? "Click an element in the preview to comment on it."
              : tab === "code"
                ? "Click a line or select code to comment on it."
                : "Click a paragraph or select text to comment on it."}
          </p>
        )}
      </div>
      {/* ponytail: annotation styles are desktop only; a phone's sheet has no room for them. */}
      {srcdoc !== null && !isMobile && target?.kind === "element" ? (
        <StyleInspector sheet selector={target.selector} values={draft.values} onChange={draft.change} />
      ) : null}
      <div className="border-t border-border p-3">
        <CommentList
          comments={openComments}
          onShow={showComment}
          onResolve={viewer.kind === "human" ? resolveComment : undefined}
        />
      </div>
    </div>
  );

  // Beside the artifact, or on a phone in a sheet under it (spec §6.1).
  const sidePanel = sideTab ? (
    <div
      data-testid="artifact-side-panel"
      className={cn("flex min-h-0 flex-col bg-background", isMobile ? "w-full" : "w-64 shrink-0 border-l border-border")}
    >
      <Tabs
        value={sideTab}
        onValueChange={(v) => showSide(v as SideTab)}
        tabs={sideTabs.map((t) => ({
          value: t,
          label:
            t === "comments" && openComments.length > 0 ? (
              <>
                Comments <span className="text-text-secondary">{openComments.length}</span>
              </>
            ) : (
              SIDE_TABS[t]
            ),
        }))}
        className="min-h-0 flex-1"
        listClassName="mb-0 shrink-0 px-2"
        panelClassName="min-h-0 flex-1 overflow-y-auto"
      >
        {sideTab === "comments" ? commentsPanel : sideTab === "tweaks" ? tweaksPanel : propertiesPanel}
      </Tabs>
    </div>
  ) : null;

  return (
    <PanelShell
      mobile={isMobile}
      title={current.title}
      // Undo and redo of the user's edits, outside text fields (they keep their own). Canvas
      // keys while focus is on the stage; Cmd+\ toggles Properties anywhere in the panel.
      onKeyDown={(e) => {
        if (sideTabs.includes("properties") && editKeyOf(e) === "properties") {
          e.preventDefault();
          showSide(sideTab === "properties" ? null : "properties");
          return;
        }
        if (editable && !isEditableKeyboardTarget(e.target) && edits.onKey(e)) e.preventDefault();
        else if (canvasMode !== "off" && canvasMode !== "inspect" && stage.current?.contains(e.target as Node) && canvasKey(e))
          e.preventDefault();
      }}
    >
      <Header
        title={current.title}
        titleMenu={
          mayEdit && text !== null ? (
            <ArtifactTitleMenu
              title={current.title}
              older={!onLatest}
              onRename={() => setDialog({ type: "rename" })}
              onDuplicate={duplicate}
              onRestore={restore}
              onAddToWorkspace={
                current.kind === "design-system" && designSystems.canManage ? (listed ? null : addToWorkspace) : undefined
              }
            />
          ) : undefined
        }
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
            <VersionMenu
              versions={versions}
              current={current.eventId}
              onSelect={(id) => goTo(versions.findIndex((v) => v.eventId === id))}
            />
            <IconButton
              size="small"
              icon={<ChevronRightIcon />}
              label="Next version"
              disabled={onLatest}
              onClick={() => goTo(index + 1)}
            />
          </>
        }
      />

      {current.madeFromOlder ? (
        <div
          role="note"
          data-testid="artifact-older-base"
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-caption1 text-text-secondary"
        >
          <InfoIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {current.madeFromOlder.version === current.version
              ? "Saved over newer changes to this version."
              : `Made from an older version${current.madeFromOlder.version ? ` (v${current.madeFromOlder.version})` : ""}.`}{" "}
            Changes made since then may be missing.
          </span>
          {tab === "changes" || !previous ? null : (
            <Button size="xs" variant="utility" onClick={() => selectTab("changes")}>
              Show changes
            </Button>
          )}
        </div>
      ) : null}

      {system && section && tab === "preview" ? (
        <DesignSystemNav
          sections={dsSections}
          section={section}
          onSectionChange={selectSection}
          onAdd={viewer.kind === "human" ? addValue : undefined}
          editing={dsEditor !== null}
          onEditChange={editable ? setDsEditing : undefined}
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
                scale={scale}
                onZoom={presenting ? undefined : setZoom}
                grid={grid}
                onGrid={presenting ? undefined : toggleGrid}
                onPresent={frameKind === "slides" ? present : undefined}
                notes={deckNotes}
                presenting={presenting}
                onEnd={endPresent}
              />
            ) : null}
            {/* On a phone there is no rail: the open slide's menu sits here. */}
            {isMobile && frameEdit && framing && !grid ? (
              <FrameMenu
                kind={frameEdit.kind}
                index={frameIndex}
                count={frames.length}
                skip={frames[frameIndex]?.skip}
                onAction={(action) => frameAction(frameIndex, action)}
              />
            ) : null}
            {presenting ? null : (
              <>
                <span className="relative inline-flex">
                  <IconButton
                    size="small"
                    icon={<PanelRightIcon />}
                    label={openComments.length > 0 ? `Side panel, ${openComments.length} open comments` : "Side panel"}
                    aria-pressed={sideTab !== null}
                    tone={sideTab !== null ? "brand" : "default"}
                    disabled={sideTabs.length === 0}
                    onClick={() => showSide(sideTab === null ? sideTabs[0]! : null)}
                  />
                  {openComments.length > 0 ? (
                    <span
                      aria-hidden
                      data-testid="artifact-comment-count"
                      className="pointer-events-none absolute -top-1 -right-1 min-w-4 rounded-pill bg-surface-tertiary px-1 text-center text-caption2 font-medium text-text-primary"
                    >
                      {openComments.length}
                    </span>
                  ) : null}
                </span>
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
                  onClick={() => void download()}
                />
                {frameKind && frames.length > 0 ? (
                  <IconButton
                    size="small"
                    icon={<PrinterIcon />}
                    label="Export as PDF"
                    disabled={printDoc !== null}
                    onClick={() =>
                      text !== null &&
                      void withAssets(text).then((t) => setPrintDoc(buildArtifactSrcdoc(frameKind, t, channel, true)))
                    }
                  />
                ) : null}
              </>
            )}
          </div>
          {/* The Present target: fullscreen shows the stage alone. */}
          <div
            ref={stage}
            tabIndex={-1}
            className="relative min-h-0 min-w-0 flex-1 bg-background focus:outline-none"
            onDragEnter={(e) => canvasMode === "full" && e.dataTransfer.types.includes("Files") && setDropping(true)}
          >
            {flash !== null && arrival?.head === flash && arrival.version === current.eventId ? (
              <div
                aria-hidden
                data-testid="artifact-changed-outline"
                className={cn("pointer-events-none absolute inset-0 z-[5] ring-2 ring-inset", RING[arrival.actor])}
              />
            ) : null}
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
            ) : dsEditor !== null && system ? (
              <DesignSystemEditor
                // Not per version: the user's own versions must not reset the field being typed in.
                key={`${edits.generation}:${dsEditor}`}
                system={system}
                section={dsEditor}
                onOverview={(v) => edit((t) => setOverview(t, v), "Edited the overview")}
                onToken={(s, name, field, v) =>
                  edit(
                    (t) => setTokenField(t, s, name, field, v),
                    field === "value" ? `Changed ${name} in ${sectionLabel(s)}` : `Edited the note on ${name}`,
                  )
                }
                onComponent={(name, v) =>
                  edit((t) => setComponentDescription(t, name, v), `Edited the note on ${name}`)
                }
              />
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
                      ? { index: frameIndex, zoom: null, transition: frames[frameIndex]?.transition, present: true }
                      : { index: frameIndex, zoom, canvas: frameKind === "design" }
                    : undefined
                }
                onKey={frameKey}
                onScale={setScale}
                onZoom={(factor) => presenting || setZoom((z) => clampZoom((z ?? scale ?? 1) * factor))}
                editor={{
                  mode: canvasMode,
                  onSelection: canvas.onSelection,
                  onOps: canvas.onOps,
                  onKey: (k) => void canvasKey(k),
                }}
                assets={media.assets}
                pins={pins}
                onPinned={(boxes) => pinSink.current?.(boxes)}
                onDragFiles={() => canvasMode === "full" && setDropping(true)}
                tweaks={tweakFrame}
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
            {srcdoc !== null && pins.length > 0 ? (
              <PinOverlay
                sink={pinSink}
                markers={markers}
                cursorLabel={cursorShown ? cursor.label : null}
                onSelect={showComment}
                draft={pickSelector ? annotationForm : null}
                onCloseDraft={() => resetAnnotation()}
              />
            ) : null}
            {(canvasMode === "full" || canvasMode === "style") &&
            !canvas.properties &&
            canvas.selection?.rect &&
            canvas.selection.ids.length > 0 &&
            !canvas.selection.editing ? (
              <FloatingToolbar
                rect={canvas.selection.rect}
                values={canvas.draft.values}
                onChange={isMobile ? undefined : canvas.draft.change}
                onDuplicate={isMobile ? undefined : () => canvas.action("duplicate")}
                onDelete={() => canvas.action("delete")}
              />
            ) : null}
            {canvasMode === "full" ? (
              <div className="@container pointer-events-none absolute inset-x-2 bottom-2 z-10 flex justify-center [&>*]:pointer-events-auto">
                <CanvasToolbar
                  selected={canvas.selection?.ids.length ?? 0}
                  onInsert={canvas.insert}
                  onAction={canvas.action}
                  onUpload={(kind) => {
                    if (!fileInput.current) return;
                    fileInput.current.accept = kind === "image" ? "image/*" : "video/*";
                    fileInput.current.click();
                  }}
                />
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  data-testid="canvas-file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void canvas.addFile(file);
                  }}
                />
              </div>
            ) : null}
            {/* Files dropped here never reach the frame: this target covers it while a drag is on. */}
            {dropping && canvasMode === "full" ? (
              <div
                data-testid="canvas-drop"
                className="absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-accent-brand bg-accent-brand-transparent"
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => e.target === e.currentTarget && setDropping(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropping(false);
                  const file = e.dataTransfer.files[0];
                  const r = e.currentTarget.getBoundingClientRect();
                  if (file) void canvas.addFile(file, { x: e.clientX - r.left, y: e.clientY - r.top });
                }}
              >
                <p className="pointer-events-none rounded-card bg-surface-primary px-3 py-2 text-body2 text-text-primary shadow-surface">
                  Drop an image or a video
                </p>
              </div>
            ) : null}
          </div>
          {/* Read-only here; never on the slide (the frame hides `aside[data-notes]`). */}
          {framing && frameKind === "slides" && (deckNotes || editable) && !grid ? (
            <details open data-testid="speaker-notes" className="shrink-0 border-t border-border">
              <summary className="cursor-pointer px-3 py-1.5 text-caption1 font-medium text-text-secondary">
                Speaker notes
              </summary>
              {editable ? (
                <SpeakerNotesField
                  key={`${edits.generation}:${frameIndex}`}
                  value={frames[frameIndex]?.notes ?? ""}
                  onCommit={(notes) =>
                    edit((t) => setFrameNotes(t, frameIndex, notes), `Edited the notes on slide ${frameIndex + 1}`)
                  }
                />
              ) : (
                <p className="max-h-40 overflow-y-auto px-3 pb-3 text-body2 whitespace-pre-line text-text-primary">
                  {frames[frameIndex]?.notes || "No notes for this slide."}
                </p>
              )}
            </details>
          ) : null}
        </div>
        {sideTab && isMobile ? (
          // Not modal: the artifact above stays usable, so a tap there selects or picks.
          <Sheet open modal={false} onOpenChange={(open) => !open && showSide(null)}>
            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              className="max-h-[55vh] gap-0"
              onInteractOutside={(e) => e.preventDefault()}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <SheetTitle className="sr-only">{SIDE_TABS[sideTab]}</SheetTitle>
              {sidePanel}
            </SheetContent>
          </Sheet>
        ) : (
          sidePanel
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

      {printDoc !== null ? (
        <PrintFrame srcdoc={printDoc} channel={channel} onDone={() => setPrintDoc(null)} />
      ) : null}

      {layoutChoice && picker !== null ? (
        <LayoutPicker
          open
          layouts={layoutChoice.layouts}
          srcdoc={layoutChoice.srcdoc}
          channel={channel}
          frame={frames[0] ?? { width: FRAME_SIZE.slides[0], height: FRAME_SIZE.slides[1] }}
          onPick={(name) =>
            edit(
              (t) => addFrame(t, picker, slideLayouts(t, picker).find((l) => l.name === name)!.section),
              `Added slide ${picker + 2}`,
              picker + 1,
            )
          }
          onOpenChange={(open) => !open && setPicker(null)}
        />
      ) : null}
      {dialog?.type === "rename" ? (
        <NameDialog
          open
          title="Rename artifact"
          value={current.title}
          maxLength={200}
          onSubmit={rename}
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
      {dialog?.type === "rename-frame" && frameKind ? (
        <NameDialog
          open
          optional
          title={`Rename ${frameUnit(frameKind)} ${dialog.index + 1}`}
          value={frames[dialog.index]?.name ?? ""}
          maxLength={MAX_NAME}
          onSubmit={(name) =>
            edit(
              (t) => renameFrame(t, frameKind, dialog.index, name),
              `Renamed ${frameUnit(frameKind)} ${dialog.index + 1}`,
            )
          }
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
      {dialog?.type === "size" && frameKind ? (
        <SizeDialog
          open
          title={dialog.add ? "Add artboard" : `Resize artboard ${dialog.index + 1}`}
          value={frames[dialog.index] ?? DEFAULT_ARTBOARD}
          onSubmit={(size) => (dialog.add ? addArtboard(dialog.index, size) : resize(frameKind, dialog.index, size))}
          onOpenChange={(open) => !open && setDialog(null)}
        />
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
  onKeyDown,
}: {
  mobile: boolean;
  title?: string;
  children: React.ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
}) {
  return (
    <section
      aria-label={title ? `Artifact: ${title}` : "Artifact"}
      data-testid="artifact-panel"
      onKeyDown={onKeyDown}
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
  titleMenu,
  subtitle,
  kind,
  actions,
  onClose,
}: {
  title: string;
  /** Replaces the plain title: the title menu, for users with edit rights. */
  titleMenu?: React.ReactNode;
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
        {titleMenu ?? (
          <h2 className="truncate font-heading text-subtitle font-semibold">
            {title}
          </h2>
        )}
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

const RING: Record<ActorKind, string> = {
  agent: "ring-actor-agent",
  human: "ring-actor-human",
  system: "ring-actor-system",
};

/** The pins over the frame. Owns the measured boxes, so a scroll in the frame re-renders only this. */
function PinOverlay({
  sink,
  markers,
  cursorLabel,
  onSelect,
  draft,
  onCloseDraft,
}: {
  sink: { current: ((boxes: Map<string, Box>) => void) | null };
  markers: readonly ArtifactComment[];
  cursorLabel: string | null;
  onSelect: (c: ArtifactComment) => void;
  /** The note form for the picked element (`PICK_PIN`), or null. */
  draft: ReactNode;
  onCloseDraft: () => void;
}) {
  const [boxes, setBoxes] = useState<ReadonlyMap<string, Box>>(() => new Map());
  useEffect(() => {
    sink.current = setBoxes;
    return () => {
      sink.current = null;
    };
  }, [sink]);
  const cursorBox = cursorLabel === null ? undefined : boxes.get(CURSOR_PIN);
  const pickBox = draft ? boxes.get(PICK_PIN) : undefined;
  return (
    <FramePins
      draft={pickBox ? { box: pickBox, form: draft, onClose: onCloseDraft } : null}
      comments={markers.flatMap((c) => {
        const box = boxes.get(c.id);
        return box ? [{ id: c.id, box, author: c.author.displayName, onSelect: () => onSelect(c) }] : [];
      })}
      cursor={cursorBox && cursorLabel !== null ? { box: cursorBox, label: cursorLabel } : null}
    />
  );
}
