import { useContext, useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { WorkforceSpaceContext } from "@/hooks/use-workforce";
import { designSystemKey as key } from "@/events/fabrium-design-systems";
import type { DesignSystemEntry, DesignSystemPrefs } from "@/model/types";

const scopeKey = (s: DesignSystemEntry) => (s.for ?? []).join(",");

interface DesignSystemsSectionProps {
  /** The workspace's list (spec §5.6): what the user may pick as their own default. */
  workspace: DesignSystemEntry[];
  prefs: DesignSystemPrefs;
  /** Owners and admins edit the workspace's list; everyone else reads it. */
  canManage: boolean;
  onChangeWorkspace: (systems: DesignSystemEntry[]) => void;
  onChangePrefs: (prefs: DesignSystemPrefs) => void;
}

/** Design systems: the user's own choice, and the workspace's list with its defaults. */
export function DesignSystemsSection({
  workspace,
  prefs,
  canManage,
  onChangeWorkspace,
  onChangePrefs,
}: DesignSystemsSectionProps) {
  const selectId = useId();
  const mine = prefs.off ? "off" : prefs.default && workspace.some((s) => key(s) === key(prefs.default!)) ? key(prefs.default) : "";
  const update = (i: number, patch: Partial<DesignSystemEntry>) => {
    const changed = { ...workspace[i]!, ...patch };
    // One default per scope: a new default replaces the one for the same kinds.
    onChangeWorkspace(
      workspace.map((s, j) =>
        j === i ? changed : changed.isDefault && s.isDefault && scopeKey(s) === scopeKey(changed) ? { ...s, isDefault: false } : s,
      ),
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor={selectId} className="block text-body2 font-semibold text-text-primary">
          Your design system
        </label>
        <p className="text-caption1 text-text-secondary">
          Agents use it for new slides and designs you ask for. It applies to you only.
        </p>
        <NativeSelect
          id={selectId}
          data-testid="design-system-mine"
          value={mine}
          onChange={(e) => {
            const v = e.target.value;
            const pick = workspace.find((s) => key(s) === v);
            onChangePrefs(v === "off" ? { off: true } : pick ? { off: false, default: { roomId: pick.roomId, identifier: pick.identifier } } : { off: false });
          }}
        >
          <option value="">Workspace default</option>
          <option value="off">Off for me</option>
          {workspace.map((s) => (
            <option key={key(s)} value={key(s)}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <p className="text-body2 font-semibold text-text-primary">Workspace design systems</p>
        {workspace.length === 0 ? (
          <p className="text-caption1 text-text-secondary">
            {canManage
              ? "None yet. Open a design system and choose Add to workspace in its title menu."
              : "None yet. Owners and admins add them."}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="design-system-list">
            {workspace.map((s, i) => (
              <li key={key(s)} className="space-y-2 rounded-card border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-body2 font-medium text-text-primary">{s.name}</span>
                  {canManage ? (
                    <Button size="xs" variant="ghost" onClick={() => onChangeWorkspace(workspace.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption1 text-text-secondary">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={s.isDefault}
                      disabled={!canManage}
                      onChange={(e) => update(i, { isDefault: e.target.checked })}
                    />
                    Default
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={s.for?.length === 1 && s.for[0] === "slides"}
                      disabled={!canManage}
                      onChange={(e) => update(i, { for: e.target.checked ? ["slides"] : undefined })}
                    />
                    Slides only
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The section with the workspace's live data. */
export function DesignSystemsSettings() {
  const ds = useDesignSystems(useContext(WorkforceSpaceContext));
  const fail = () => toast.error("Could not save the design systems.");
  return (
    <DesignSystemsSection
      workspace={ds.workspace}
      prefs={ds.prefs}
      canManage={ds.canManage}
      onChangeWorkspace={(systems) => void ds.saveWorkspace(systems).catch(fail)}
      onChangePrefs={(prefs) => void ds.savePrefs(prefs).catch(fail)}
    />
  );
}
