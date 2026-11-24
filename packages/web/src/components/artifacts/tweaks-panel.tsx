import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MAX_TWEAK_TEXT, type TweakControl, type TweakValue, type TweakValues, tweakValue } from "@/lib/artifacts/tweaks";

const FIELD = "h-7 px-2 py-0 text-caption1";

function Control({ control: c, value, onChange }: { control: TweakControl; value: TweakValue; onChange: (v: TweakValue) => void }) {
  switch (c.type) {
    case "color":
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={c.label}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className="size-7 shrink-0 cursor-pointer rounded-utility border border-border bg-surface-secondary p-0.5"
          />
          <span className="font-mono text-caption1 text-text-secondary">{value as string}</span>
        </div>
      );
    case "range":
      return (
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label={c.label}
            min={c.min}
            max={c.max}
            step={c.step}
            value={value as number}
            onChange={(e) => onChange(e.target.valueAsNumber)}
            className="min-w-0 flex-1 accent-accent-brand"
          />
          <span className="w-14 shrink-0 text-right font-mono text-caption1 text-text-secondary">
            {value as number}
            {c.unit}
          </span>
        </div>
      );
    case "select":
      return (
        <NativeSelect aria-label={c.label} value={value as string} onChange={(e) => onChange(e.target.value)} className={FIELD}>
          {c.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      );
    case "toggle":
      return (
        <input
          type="checkbox"
          aria-label={c.label}
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 accent-accent-brand"
        />
      );
    case "text":
      return (
        <Input
          aria-label={c.label}
          value={value as string}
          maxLength={MAX_TWEAK_TEXT}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD}
        />
      );
  }
}

/**
 * The agent's tweak controls (spec §6.7), drawn by the app, never in the frame: a tab of the
 * artifact's side panel. Changes
 * apply live in the preview; Keep saves them into the artifact (absent for viewers who
 * cannot edit), Reset goes back to the document's values.
 */
export function TweaksPanel({
  controls,
  values,
  onChange,
  onKeep,
  onReset,
}: {
  controls: readonly TweakControl[];
  /** Changed values by control name; the rest show the document's. */
  values: TweakValues;
  onChange: (name: string, value: TweakValue) => void;
  onKeep?: () => void;
  onReset: () => void;
}) {
  const changed = Object.keys(values).length > 0;
  return (
    <aside aria-label="Tweaks" data-testid="tweaks-panel" className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-3">
        {controls.map((c) => (
          <label key={c.name} className="flex flex-col gap-1">
            <span className="text-caption1 text-text-secondary">{c.label}</span>
            <Control control={c} value={tweakValue(c, values)} onChange={(v) => onChange(c.name, v)} />
          </label>
        ))}
      </div>
      <div className="flex gap-2 border-t border-border pt-3">
        {onKeep ? (
          <Button size="xs" disabled={!changed} onClick={onKeep}>
            Keep
          </Button>
        ) : null}
        <Button size="xs" variant="utility" disabled={!changed} onClick={onReset}>
          Reset
        </Button>
      </div>
      <p className="text-caption2 text-text-tertiary">
        {onKeep
          ? "Changes show in the preview. Keep saves them into the artifact."
          : "Changes show in the preview only. You cannot edit this artifact."}
      </p>
    </aside>
  );
}
