import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  blurOf,
  MAX_STYLE_VALUE,
  num,
  readColor,
  shadowOf,
  shadows,
  withBlur,
  type StyleProp,
  type Styles,
} from "@/lib/artifacts/styles";
import { cn } from "@/lib/utils";

/** `Input` at the inspector's size; `NativeSelect` gets the same override. */
const FIELD = "h-7 px-2 py-0 text-caption1";

const BORDER_STYLES = ["none", "solid", "dashed", "dotted"];
const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="border-t border-border pt-3">
      <summary className="cursor-pointer text-caption1 font-semibold text-text-primary">{title}</summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-26 shrink-0 text-caption1 text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

function NumberRow({
  label,
  value,
  unit,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Row label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
        className={FIELD}
      />
      <span className="w-6 shrink-0 text-caption2 text-text-tertiary">{unit}</span>
    </Row>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string) => void }) {
  const { hex, none } = readColor(value);
  return (
    <Row label={label}>
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="size-7 shrink-0 cursor-pointer rounded-utility border border-border bg-surface-secondary p-0.5"
      />
      <span className="font-mono text-caption1 text-text-secondary">{none ? "None" : hex}</span>
    </Row>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Row label={label}>
      <NativeSelect
        // A value the list lacks (a border that differs per side) reads as the first option.
        value={value && options.includes(value) ? value : options[0]}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </NativeSelect>
    </Row>
  );
}

function TextRow({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string) => void }) {
  return (
    <Row label={label}>
      <Input
        type="text"
        value={value ?? ""}
        placeholder="none"
        maxLength={MAX_STYLE_VALUE}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD, "font-mono")}
      />
    </Row>
  );
}

/**
 * Style controls for the element picked in an artifact or a preview. `values` are the
 * element's CSS values (computed, then edited); every edit goes out as one property and its
 * new CSS value. The caller shows it in the frame and adds it to the annotation: nothing
 * here changes the agent's code.
 */
export function StyleInspector({
  selector,
  values,
  onChange,
}: {
  selector: string;
  values: Styles;
  onChange: (prop: StyleProp, value: string) => void;
}) {
  const px = (prop: StyleProp) => (n: number) => onChange(prop, `${n}px`);
  const opacity = Math.round(num(values.opacity ?? "1") * 100);
  const shadow = values["box-shadow"];
  return (
    <aside
      aria-label="Styles"
      data-testid="style-inspector"
      className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-background p-3"
    >
      <div>
        <h3 className="font-heading text-body2 font-semibold">Styles</h3>
        <p className="truncate font-mono text-caption2 text-text-tertiary" title={selector}>
          {selector}
        </p>
      </div>

      <Section title="Appearance" open>
        <ColorRow label="Fill" value={values["background-color"]} onChange={(v) => onChange("background-color", v)} />
        <ColorRow label="Text" value={values.color} onChange={(v) => onChange("color", v)} />
        <Row label="Opacity">
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => onChange("opacity", String(e.target.valueAsNumber / 100))}
            className="min-w-0 flex-1 accent-accent-brand"
          />
          <span className="w-9 shrink-0 text-right text-caption1 text-text-secondary tabular-nums">{opacity}%</span>
        </Row>
        <NumberRow label="Radius" unit="px" value={num(values["border-radius"])} onChange={px("border-radius")} />
        <SelectRow label="Border" value={values["border-style"]} options={BORDER_STYLES} onChange={(v) => onChange("border-style", v)} />
        <ColorRow label="Color" value={values["border-color"]} onChange={(v) => onChange("border-color", v)} />
        <NumberRow label="Width" unit="px" value={num(values["border-width"])} onChange={px("border-width")} />
      </Section>

      <Section title="Effects" open>
        <NumberRow
          label="Drop shadow"
          unit="px"
          value={shadowOf(shadow, false)}
          onChange={(n) => onChange("box-shadow", shadows(n, shadowOf(shadow, true)))}
        />
        <NumberRow
          label="Inner shadow"
          unit="px"
          value={shadowOf(shadow, true)}
          onChange={(n) => onChange("box-shadow", shadows(shadowOf(shadow, false), n))}
        />
        <NumberRow
          label="Layer blur"
          unit="px"
          value={blurOf(values.filter)}
          onChange={(n) => onChange("filter", withBlur(values.filter, n))}
        />
        <NumberRow
          label="Background blur"
          unit="px"
          value={blurOf(values["backdrop-filter"])}
          onChange={(n) => onChange("backdrop-filter", withBlur(values["backdrop-filter"], n))}
        />
      </Section>

      <Section title="Advanced">
        <TextRow label="Filter" value={values.filter} onChange={(v) => onChange("filter", v)} />
        <TextRow label="Backdrop" value={values["backdrop-filter"]} onChange={(v) => onChange("backdrop-filter", v)} />
        <NumberRow label="Rotate" unit="deg" min={-360} max={360} value={num(values.rotate)} onChange={(n) => onChange("rotate", `${n}deg`)} />
        <SelectRow label="Blend mode" value={values["mix-blend-mode"]} options={BLEND_MODES} onChange={(v) => onChange("mix-blend-mode", v)} />
      </Section>

      <p className="border-t border-border pt-3 text-caption2 text-text-tertiary">
        Changes show in the preview only. Add them to your reply, and the agent applies them.
      </p>
    </aside>
  );
}
