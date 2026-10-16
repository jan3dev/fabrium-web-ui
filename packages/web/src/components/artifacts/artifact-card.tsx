import {
  AppWindowIcon,
  CodeIcon,
  ComponentIcon,
  FileTextIcon,
  ImageIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import type { ArtifactKind, ArtifactVersion } from "@/model/types";

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: "Web page",
  svg: "Image",
  react: "Component",
  markdown: "Document",
  code: "Code",
};

const KIND_ICON: Record<ArtifactKind, typeof CodeIcon> = {
  html: AppWindowIcon,
  svg: ImageIcon,
  react: ComponentIcon,
  markdown: FileTextIcon,
  code: CodeIcon,
};

export function artifactKindLabel(
  kind: ArtifactKind,
  language?: string,
): string {
  return kind === "code" && language ? `Code · ${language}` : KIND_LABEL[kind];
}

export function ArtifactKindIcon({
  kind,
  className,
}: {
  kind: ArtifactKind;
  className?: string;
}) {
  const Icon = KIND_ICON[kind];
  return <Icon className={className} />;
}

/** The row an artifact version gets in its thread. Opens the artifact panel. */
export function ArtifactCard({
  artifact,
  active = false,
  onOpen,
}: {
  artifact: ArtifactVersion;
  /** The panel shows this version. */
  active?: boolean;
  onOpen: () => void;
}) {
  const subtitle = [
    artifactKindLabel(artifact.kind, artifact.language),
    artifact.version > 1 ? `v${artifact.version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      data-testid="artifact-card"
      aria-label={`Open artifact: ${artifact.title}`}
      aria-pressed={active}
      onClick={onOpen}
      className={cn(
        "flex w-full max-w-md cursor-pointer items-center gap-3 rounded-card border bg-surface-secondary py-2.5 pr-4 pl-3 text-left transition-colors",
        active
          ? "border-accent-brand"
          : "border-surface-border-primary hover:border-surface-border-secondary",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-utility bg-surface-tertiary text-text-secondary">
        <ArtifactKindIcon kind={artifact.kind} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body2 font-medium text-text-primary">
          {artifact.title}
        </span>
        <span className="block truncate text-caption1 text-text-tertiary">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
