import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createPreviewSession,
  restartPreview,
  stopPreview,
} from "@/client/fabrium-api";
import { MatrixClientPeg } from "@/client/peg";
import { AnnotationForm } from "@/components/artifacts/artifact-refs";
import { StyleInspector } from "@/components/artifacts/style-inspector";
import { AppWindowIcon, CloseIcon, EllipsisIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { useActor } from "@/hooks/use-actor";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePreviewStatus } from "@/hooks/use-preview-status";
import { useStyleDraft } from "@/hooks/use-style-draft";
import { refreshRoomPreviews, usePreviewRoute, useThreadPreviews, type PreviewRef } from "@/hooks/use-previews";
import {
  addArtifactRefDraft,
  MAX_REF_SNIPPET,
  MAX_REFS,
  type ArtifactRefTarget,
} from "@/lib/artifacts/refs";
import { annotationNote } from "@/lib/artifacts/styles";
import { copyToClipboard } from "@/lib/browser-actions";
import { setComposerFill } from "@/lib/quote-draft-store";
import { cn } from "@/lib/utils";
import type { PreviewSession } from "@/model/types";
import { addConsoleEntry, frameUrl, postToBridge, readBridgeMessage, sameSite, type BridgeCommand } from "./bridge";
import { PreviewStatusBadge } from "./preview-card";
import { logTail, PreviewConsole, type ConsoleTab } from "./preview-console";
import { PreviewPhone } from "./preview-phone";
import { PreviewState } from "./preview-state";
import { DEVICE_WIDTH, PreviewToolbar, type PreviewDevice } from "./preview-toolbar";

/** Same as spec §5.5: the app runs on a foreign origin, so `allow-same-origin` grants it nothing of ours. */
// `allow-same-origin` is safe only on a foreign site (sameSite guard below). Popups keep the
// sandbox: no `allow-popups-to-escape-sandbox`, so a window the app opens is no more trusted.
const PREVIEW_FRAME_SANDBOX = "allow-scripts allow-forms allow-same-origin allow-popups allow-downloads";

const DEVICE_KEY = "fabrium:preview-device:v1";

function loadDevice(): PreviewDevice {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    return v === "tablet" || v === "phone" ? v : "desktop";
  } catch {
    return "desktop";
  }
}

function saveDevice(device: PreviewDevice): void {
  try {
    localStorage.setItem(DEVICE_KEY, device);
  } catch {
    // Private mode: the width holds for this panel only.
  }
}

function errorText(status: number): string {
  if (status === 404) return "This preview is not available.";
  if (status === 403) return "You don't have access to this preview.";
  return "Can't reach the preview. Retrying…";
}

/**
 * The open preview, beside its thread: the agent's running app in a frame on
 * the preview origin, its state while it is not running, its console and logs.
 * Annotations and "Ask agent to fix" fill the thread composer; nothing is sent
 * for the user.
 */
export function PreviewPanel({
  roomId,
  threadRootId,
  workforceSpaceId,
  preview,
}: {
  roomId: string;
  threadRootId: string;
  workforceSpaceId: string | null;
  preview: PreviewRef;
}) {
  const { agentId, name } = preview;
  const isMobile = useIsMobile();
  const route = usePreviewRoute();
  const event = useThreadPreviews(roomId, threadRootId, workforceSpaceId).find(
    (p) => p.author.id === agentId && p.name === name,
  );
  const agent = useActor(agentId, roomId);
  const viewer = useActor(MatrixClientPeg.safeGet()?.getUserId() ?? "", roomId);
  // Only people restart or stop an app, annotate it, or ask for fixes; agents use their tools.
  const isHuman = viewer.kind === "human";
  const { info, log, error } = usePreviewStatus(agentId, name);
  // The room header lists the running apps on a slower poll: it follows this one's status
  // once it is known (not on mount, when the header has just polled).
  const status = info?.status;
  useEffect(() => {
    if (status) refreshRoomPreviews();
  }, [status]);
  const title = info?.title ?? event?.title ?? name;
  const running = info?.status === "running";
  // Changes on every run, also when a restart goes from running to running between two polls.
  const run = running ? info.since : null;

  const [session, setSession] = useState<PreviewSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const [path, setPath] = useState("/");
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<ConsoleTab>("console");
  const [device, setDevice] = useState<PreviewDevice>(loadDevice);
  const [annotating, setAnnotating] = useState(false);
  const [target, setTarget] = useState<{ path: string; target: ArtifactRefTarget } | null>(null);
  const [note, setNote] = useState("");
  const [mobileView, setMobileView] = useState<"preview" | "thread">("preview");
  const frame = useRef<HTMLIFrameElement>(null);
  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;

  // A session for each run: a stop or restart ends the old one on the gateway.
  useEffect(() => {
    // The old session ends with the old run: never show its URL while the new one loads.
    setSession(null);
    setSrc(null);
    if (!run) return;
    let live = true;
    setSessionError(null);
    createPreviewSession(agentId, name).then(
      (s) => {
        if (!live) return;
        // A misconfigured `previews.origin` must never put the agent's app on Fabrium's site.
        if (sameSite(new URL(s.url).hostname, window.location.hostname)) {
          setSessionError("Previews are on the same site as Fabrium. Ask an admin to fix the previews setting.");
          return;
        }
        setSession(s);
        setSrc(s.url);
        setPath("/");
        setErrors([]);
      },
      (err: unknown) => live && setSessionError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [run, agentId, name]);

  const origin = session ? new URL(session.url).origin : null;
  const command = (c: BridgeCommand, extra?: Record<string, unknown>) => {
    if (origin) postToBridge(frame.current, origin, c, extra);
  };
  const draft = useStyleDraft((edit) =>
    "reset" in edit ? command("style-reset") : "keep" in edit ? command("style-keep") : command("style", edit),
  );

  useEffect(() => {
    if (!origin) return;
    function onMessage(e: MessageEvent) {
      if (!frame.current || e.source !== frame.current.contentWindow || e.origin !== origin) return;
      const m = readBridgeMessage(e.data, origin!);
      if (m?.type === "location") {
        setPath(m.path);
        // A new page has a new bridge: the old pick and its style edits are gone with the old page.
        setTarget(null);
        setNote("");
        draft.picked({});
        // The new bridge also starts out of pick mode.
        if (annotatingRef.current) postToBridge(frame.current, origin!, "pick", { on: true });
      } else if (m?.type === "console") {
        setErrors((list) => addConsoleEntry(list, m.message));
      } else if (m?.type === "picked" && annotatingRef.current) {
        setTarget({ path: m.path, target: m.target });
        draft.picked(m.styles);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  // Follows the toggle only; `command` is rebuilt every render.
  useEffect(() => {
    if (origin) postToBridge(frame.current, origin, "pick", { on: annotating });
  }, [annotating, origin]);

  const act = (label: string, call: (a: string, n: string) => Promise<void>) => () =>
    call(agentId, name).catch((err: unknown) =>
      toast.error(`${label} failed`, {
        description: err instanceof Error ? err.message : String(err),
      }),
    );
  const restart = act("Restart", restartPreview);
  const stop = act("Stop", stopPreview);

  function load(url: string) {
    setSrc(url);
    setLoads((n) => n + 1);
  }

  function navigate(input: string) {
    const url = origin ? frameUrl(input, origin) : null;
    if (url) load(url);
    else toast.error("Enter a path in this app, like /todos");
  }

  /** Drops the pick. The style edits leave the page too, unless they were added to the reply (`keep`). */
  function resetAnnotation(keep = false) {
    draft.reset(keep);
    setTarget(null);
    setNote("");
  }

  /** An annotation of this preview in the thread composer: the agent gets the page and the target. */
  function addRef(t: ArtifactRefTarget, at: string, refNote: string): boolean {
    const added = addArtifactRefDraft(roomId, threadRootId, {
      identifier: name,
      title,
      version: 0,
      event_id: event?.eventId ?? threadRootId,
      target: t,
      note: refNote,
      preview: { agent: agentId, path: at },
    });
    if (!added) toast.error(`A reply holds at most ${MAX_REFS} annotations. Send it first.`);
    return added;
  }

  function addAnnotation() {
    if (!target || !addRef(target.target, target.path, annotationNote(draft.changes, note))) return;
    resetAnnotation(true);
    toast("Annotation added to your reply");
  }

  /** Spec §3.1 step 5: the composer gets an @mention of the agent and the error; the user sends it. */
  function askToFix(text: string, where: string) {
    if (!addRef({ kind: "text", text: text.slice(0, MAX_REF_SNIPPET), where }, path, "")) return;
    setComposerFill(roomId, threadRootId, { text: "Can you fix this error in the preview?", mention: agentId });
    if (isMobile) setMobileView("thread");
    toast("Added to your reply");
  }

  const fatal = error && !info ? errorText(error.status) : null;
  const live = running && session !== null && src !== null;
  // Only an Expo app without react-native-web has `web: false`.
  const phoneOnly = info?.web === false;
  const width = DEVICE_WIDTH[device];
  const hidden = isMobile && mobileView === "thread";

  return (
    <section
      aria-label={`Preview: ${title}`}
      data-testid="preview-panel"
      className={cn(
        "flex min-w-0 flex-col bg-background",
        !isMobile
          ? "relative h-full flex-1 border-l border-border"
          : hidden
            ? "fixed inset-x-0 top-0 z-50 border-b border-border"
            : "fixed inset-0 z-50",
      )}
    >
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {isMobile ? (
          <SegmentedControl
            legend="Show"
            testId="preview-mobile-view"
            optionTestIdPrefix="preview-mobile-view"
            size="compact"
            value={mobileView}
            options={[
              { value: "preview", label: "Preview" },
              { value: "thread", label: "Thread" },
            ]}
            onValueChange={setMobileView}
          />
        ) : (
          <AppWindowIcon className="size-4 shrink-0 text-text-tertiary" />
        )}
        <div className={cn("min-w-0 flex-1", isMobile && "sr-only")}>
          <h2 className="truncate font-heading text-subtitle font-semibold">{title}</h2>
          <p className="truncate text-caption1 text-text-tertiary">{agent.displayName}</p>
        </div>
        {isMobile ? <div className="flex-1" /> : null}
        {info ? <PreviewStatusBadge status={info.status} /> : null}
        {live && info.kind === "expo" ? <PreviewPhone session={session} /> : null}
        <div className="flex shrink-0 items-center gap-0.5">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton size="small" icon={<EllipsisIcon />} label="More actions" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isHuman && info ? (
                <>
                  <DropdownMenuItem onSelect={restart}>Restart app</DropdownMenuItem>
                  <DropdownMenuItem onSelect={stop} disabled={info.status === "stopped"}>
                    Stop app
                  </DropdownMenuItem>
                </>
              ) : null}
              {/* The link is the access (spec D3): whoever has it can use the app until it stops. */}
              <DropdownMenuItem
                disabled={!live}
                onSelect={() => src && copyToClipboard(src, "Link copied. It works until the app stops.")}
              >
                Copy link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton size="small" icon={<CloseIcon />} label="Close preview" onClick={route.close} />
        </div>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col", hidden && "hidden")}>
        <PreviewToolbar
          path={path}
          disabled={!live}
          device={device}
          annotating={annotating && live}
          onNavigate={navigate}
          onBack={() => command("back")}
          onForward={() => command("forward")}
          onReload={() => navigate(path)}
          onDeviceChange={(d) => {
            setDevice(d);
            saveDevice(d);
          }}
          onAnnotatingChange={
            isHuman
              ? (on) => {
                  resetAnnotation();
                  setAnnotating(on);
                }
              : undefined
          }
          onOpenInNewTab={() => src && window.open(src, "_blank", "noopener,noreferrer")}
        />
        <div className="flex min-h-0 flex-1">
          <div className={cn("relative min-h-0 min-w-0 flex-1", width && "bg-surface-secondary")}>
            {fatal || sessionError ? (
              <p role="alert" className="p-4 text-body2 text-text-tertiary">
                {fatal ?? sessionError}
              </p>
            ) : !info ? (
              <div className="flex h-full items-center justify-center">
                <Spinner size="medium" className="text-text-tertiary" />
              </div>
            ) : (
              <>
                {live && !phoneOnly ? (
                  <iframe
                    key={`${session.url}#${loads}`}
                    ref={frame}
                    src={src}
                    title={title}
                    data-testid="preview-frame"
                    className={cn(
                      "mx-auto block h-full max-w-full border-0 bg-background",
                      width ? "border-x border-border" : "w-full",
                    )}
                    style={width ? { width } : undefined}
                    sandbox={PREVIEW_FRAME_SANDBOX}
                    referrerPolicy="no-referrer"
                    allow=""
                  />
                ) : running ? (
                  <div className="flex h-full items-center justify-center">
                    <Spinner size="medium" className="text-text-tertiary" />
                  </div>
                ) : null}
                <PreviewState
                  status={info.status}
                  title={title}
                  agentName={agent.displayName}
                  exitCode={info.exit_code}
                  since={info.since}
                  log={log}
                  phoneOnly={phoneOnly}
                  onRestart={isHuman ? restart : undefined}
                  onStop={isHuman ? stop : undefined}
                  onAskFix={isHuman && log ? () => askToFix(logTail(log), "App log") : undefined}
                />
              </>
            )}
          </div>
          {/* ponytail: desktop only; on a phone the panel has no room beside the app. Add a sheet when asked. */}
          {annotating && live && !isMobile && target?.target.kind === "element" ? (
            <StyleInspector selector={target.target.selector} values={draft.values} onChange={draft.change} />
          ) : null}
        </div>
        {annotating && live ? (
          <div className="shrink-0 border-t border-border p-3" data-testid="preview-annotation-bar">
            {target ? (
              <AnnotationForm
                target={target.target}
                note={note}
                onNoteChange={setNote}
                onAdd={addAnnotation}
                onCancel={() => resetAnnotation()}
              />
            ) : (
              <p className="text-caption1 text-text-tertiary">Click an element in the preview to annotate it.</p>
            )}
          </div>
        ) : null}
        <PreviewConsole
          log={log}
          errors={errors}
          open={drawerOpen}
          tab={drawerTab}
          onOpenChange={setDrawerOpen}
          onTabChange={setDrawerTab}
          onAskFix={isHuman ? askToFix : undefined}
        />
      </div>
    </section>
  );
}
