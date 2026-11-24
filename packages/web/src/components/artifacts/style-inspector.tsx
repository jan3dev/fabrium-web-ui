import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Box } from "@/lib/artifacts/canvas";
import { SLIDE_SIZES, type SlideSize, TRANSITIONS } from "@/lib/artifacts/frames";
import {
  blurOf,
  contrast,
  flipScale,
  layoutOf,
  MAX_STYLE_VALUE,
  num,
  readColor,
  scaleOf,
  type Shadow,
  shadowOf,
  shadows,
  skewOf,
  STYLE_PROPS,
  type StyleProp,
  type Styles,
  withBlur,
  withSkew,
  writeLayout,
  writeScale,
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
const DIRECTIONS = ["none", "row", "column", "grid"];
const ALIGNS = ["normal", "flex-start", "center", "flex-end", "stretch", "baseline"];
const JUSTIFIES = ["normal", "flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"];
const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
const TEXT_ALIGNS = ["start", "left", "center", "right", "justify"];
const GENERIC_FONTS = ["system-ui", "sans-serif", "serif", "monospace"];
const SIDES = ["top", "right", "bottom", "left"] as const;

/** A named colour the picker offers first: the design system's. */
export interface PaletteColor {
  name: string;
  value: string;
}

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
  name,
  value,
  unit,
  min = 0,
  max,
  disabled,
  onChange,
}: {
  label: string;
  /** The accessible name, when the visible label repeats in another group. */
  name?: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Row label={label}>
      <Input
        type="number"
        aria-label={name}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
        className={FIELD}
      />
      <span className="w-6 shrink-0 text-caption2 text-text-tertiary">{unit}</span>
    </Row>
  );
}

/** The design system's colours by name, then the free picker. */
function Swatches({
  palette,
  onPick,
  indent = true,
}: {
  palette: readonly PaletteColor[];
  onPick: (value: string) => void;
  /** Under a row's control rather than on its own. */
  indent?: boolean;
}) {
  if (palette.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", indent && "pl-28")}>
      {palette.slice(0, 16).map((c) => (
        <button
          key={c.name}
          type="button"
          title={`${c.name}: ${c.value}`}
          aria-label={c.name}
          onClick={() => onPick(c.value)}
          // The swatch is the colour itself: a value, not chrome.
          style={{ backgroundColor: c.value }}
          className="size-5 rounded-utility border border-border"
        />
      ))}
    </div>
  );
}

function ColorRow({
  label,
  name,
  value,
  palette = [],
  onChange,
}: {
  label: string;
  name?: string;
  value: string | undefined;
  palette?: readonly PaletteColor[];
  onChange: (value: string) => void;
}) {
  const { hex, none } = readColor(value);
  return (
    <>
      <Row label={label}>
        <input
          type="color"
          aria-label={name}
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="size-7 shrink-0 cursor-pointer rounded-utility border border-border bg-surface-secondary p-0.5"
        />
        <span className="font-mono text-caption1 text-text-secondary">{none ? "None" : hex}</span>
      </Row>
      <Swatches palette={palette} onPick={onChange} />
    </>
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

function TextRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  /** Suggestions, offered in this order. */
  options?: readonly string[];
  onChange: (value: string) => void;
}) {
  const list = useId();
  return (
    <Row label={label}>
      <Input
        type="text"
        value={value ?? ""}
        placeholder="none"
        maxLength={MAX_STYLE_VALUE}
        spellCheck={false}
        autoComplete="off"
        list={options ? list : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD, "font-mono")}
      />
      {options ? (
        <datalist id={list}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </Row>
  );
}

function ShadowRows({
  label,
  shadow,
  palette,
  onChange,
}: {
  label: string;
  shadow: Shadow;
  palette: readonly PaletteColor[];
  onChange: (shadow: Shadow) => void;
}) {
  const field = (key: "x" | "y" | "blur" | "spread", text: string) => (
    <NumberRow
      label={text}
      name={`${label} ${text.toLowerCase()}`}
      unit="px"
      min={key === "blur" ? 0 : -1000}
      value={shadow[key]}
      onChange={(n) => onChange({ ...shadow, [key]: n })}
    />
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-caption1 font-medium text-text-primary">{label}</legend>
      {field("x", "Offset X")}
      {field("y", "Offset Y")}
      {field("blur", "Blur")}
      {field("spread", "Spread")}
      <ColorRow label="Color" name={`${label} color`} value={shadow.color} palette={palette} onChange={(color) => onChange({ ...shadow, color })} />
    </fieldset>
  );
}

/**
 * Style controls for a picked element (annotate, a preview) or the canvas selection (the
 * Properties panel, spec §6.5). `values` are the element's CSS values (computed, then
 * edited); every edit goes out as properties and their new CSS values. Only the controls of
 * `props` show: the preview bridge sets fewer properties than the artifact frame. With
 * `readOnly` it is the inspect view.
 */
export function StyleInspector({
  title = "Styles",
  selector,
  values,
  onChange,
  props = STYLE_PROPS,
  readOnly = false,
  palette = [],
  fonts = [],
  background,
  box,
  onBox,
  layers,
  frame,
  note = "Changes show in the preview only. Add them to your reply, and the agent applies them.",
  sheet = false,
}: {
  title?: string;
  /** What is selected, as a selector or a layer name; null when nothing is (then `frame` shows). */
  selector: string | null;
  values: Styles;
  onChange: (changes: Styles) => void;
  props?: readonly StyleProp[];
  readOnly?: boolean;
  /** The design system's colours, offered first. */
  palette?: readonly PaletteColor[];
  /** The design system's fonts, offered first. */
  fonts?: readonly string[];
  /** The colour behind the element, for the contrast check. */
  background?: string;
  /** Position and size in canvas px; `free` layers have a position to edit. */
  box?: Box & { free: boolean };
  onBox?: (box: Box) => void;
  /** The layers list: the first section. */
  layers?: ReactNode;
  /** The slide or artboard's properties, shown while nothing is selected. */
  frame?: ReactNode;
  /** A line under the controls; null for none. */
  note?: string | null;
  /** In the side panel or a sheet: full width, no side border, no heading (the tab names it). */
  sheet?: boolean;
}) {
  const has = (p: StyleProp) => props.includes(p);
  const set = (prop: StyleProp) => (value: string) => onChange({ [prop]: value });
  const px = (prop: StyleProp) => (n: number) => onChange({ [prop]: `${n}px` });
  const opacity = Math.round(num(values.opacity ?? "1") * 100);
  const shadow = values["box-shadow"];
  const [drop, inner] = [shadowOf(shadow, false), shadowOf(shadow, true)];
  const [sx, sy] = scaleOf(values.scale);
  const [kx, ky] = skewOf(values.transform);
  const textContrast = has("color") && background ? contrast(values, background) : null;
  const rotate = has("rotate") ? (
    <NumberRow label="Rotate" unit="deg" min={-360} max={360} value={num(values.rotate)} onChange={(n) => onChange({ rotate: `${n}deg` })} />
  ) : null;
  const flip = (axis: "h" | "v") => onChange({ scale: flipScale(values.scale, axis) });
  return (
    <aside
      aria-label={title}
      data-testid="style-inspector"
      className={cn(
        "flex shrink-0 flex-col gap-3 overflow-y-auto bg-background p-3",
        sheet ? "min-h-0 w-full" : "w-64 border-l border-border",
      )}
    >
      <div>
        {sheet ? null : <h3 className="font-heading text-body2 font-semibold">{title}</h3>}
        <p className="truncate font-mono text-caption2 text-text-tertiary" title={selector ?? undefined}>
          {selector ?? "Nothing selected"}
        </p>
      </div>

      {layers ? (
        <Section title="Layers" open>
          {layers}
        </Section>
      ) : null}

      {selector === null ? (
        frame
      ) : (
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-3">
          {box ? (
            <Section title="Position and size" open>
              <NumberRow label="X" unit="px" min={-10000} value={box.x} disabled={!box.free} onChange={(x) => onBox?.({ ...box, x })} />
              <NumberRow label="Y" unit="px" min={-10000} value={box.y} disabled={!box.free} onChange={(y) => onBox?.({ ...box, y })} />
              <NumberRow label="W" name="Width" unit="px" min={1} value={box.w} onChange={(w) => onBox?.({ ...box, w })} />
              <NumberRow label="H" name="Height" unit="px" min={1} value={box.h} onChange={(h) => onBox?.({ ...box, h })} />
              {rotate}
              {has("scale") ? (
                <div className="flex gap-1 pl-28">
                  <Button type="button" size="xs" variant="utility" aria-pressed={sx < 0} onClick={() => flip("h")}>
                    Flip H
                  </Button>
                  <Button type="button" size="xs" variant="utility" aria-pressed={sy < 0} onClick={() => flip("v")}>
                    Flip V
                  </Button>
                </div>
              ) : null}
            </Section>
          ) : null}

          {has("display") ? (
            <Section title="Layout">
              <SelectRow label="Direction" value={layoutOf(values)} options={DIRECTIONS} onChange={(d) => onChange(writeLayout(d as never))} />
              <NumberRow label="Gap" unit="px" value={num(values.gap)} onChange={px("gap")} />
              <NumberRow label="Padding" unit="px" value={num(values.padding)} onChange={px("padding")} />
              <SelectRow label="Align" value={values["align-items"]} options={ALIGNS} onChange={set("align-items")} />
              <SelectRow label="Justify" value={values["justify-content"]} options={JUSTIFIES} onChange={set("justify-content")} />
            </Section>
          ) : null}

          {has("color") ? (
            <Section title="Typography" open={has("font-size")}>
              {has("font-family") ? (
                <TextRow label="Font" value={values["font-family"]} options={[...fonts, ...GENERIC_FONTS]} onChange={set("font-family")} />
              ) : null}
              {has("font-size") ? <NumberRow label="Font size" unit="px" value={num(values["font-size"])} onChange={px("font-size")} /> : null}
              {has("font-weight") ? <SelectRow label="Weight" value={values["font-weight"]} options={WEIGHTS} onChange={set("font-weight")} /> : null}
              {has("line-height") ? (
                <NumberRow label="Line height" unit="px" value={num(values["line-height"])} onChange={px("line-height")} />
              ) : null}
              {has("letter-spacing") ? (
                <NumberRow label="Letter spacing" unit="px" min={-100} value={num(values["letter-spacing"])} onChange={px("letter-spacing")} />
              ) : null}
              {has("text-align") ? <SelectRow label="Alignment" value={values["text-align"]} options={TEXT_ALIGNS} onChange={set("text-align")} /> : null}
              <ColorRow label="Text" value={values.color} palette={palette} onChange={set("color")} />
              {textContrast ? (
                <p data-testid="contrast" className={cn("pl-28 text-caption2", textContrast === "good" ? "text-text-secondary" : "text-accent-danger")}>
                  Contrast: {textContrast}
                </p>
              ) : null}
            </Section>
          ) : null}

          <Section title="Appearance" open>
            <ColorRow label="Fill" value={values["background-color"]} palette={palette} onChange={set("background-color")} />
            <Row label="Opacity">
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                onChange={(e) => onChange({ opacity: String(e.target.valueAsNumber / 100) })}
                className="min-w-0 flex-1 accent-accent-brand"
              />
              <span className="w-9 shrink-0 text-right text-caption1 text-text-secondary tabular-nums">{opacity}%</span>
            </Row>
            <NumberRow label="Radius" unit="px" value={num(values["border-radius"])} onChange={px("border-radius")} />
            <SelectRow label="Border" value={values["border-style"]} options={BORDER_STYLES} onChange={set("border-style")} />
            <ColorRow label="Color" name="Border color" value={values["border-color"]} palette={palette} onChange={set("border-color")} />
            <NumberRow label="Width" name="Border width" unit="px" value={num(values["border-width"])} onChange={px("border-width")} />
            {has("border-top-width") ? (
              <details>
                <summary className="cursor-pointer pl-28 text-caption1 text-text-secondary">More</summary>
                <div className="mt-2 flex flex-col gap-2">
                  {SIDES.map((side) => (
                    <NumberRow
                      key={side}
                      label={`${side[0]!.toUpperCase()}${side.slice(1)}`}
                      name={`Border ${side} width`}
                      unit="px"
                      value={num(values[`border-${side}-width`])}
                      onChange={px(`border-${side}-width`)}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </Section>

          <Section title="Effects" open>
            <ShadowRows label="Drop shadow" shadow={drop} palette={palette} onChange={(s) => onChange({ "box-shadow": shadows(s, inner) })} />
            <ShadowRows label="Inner shadow" shadow={inner} palette={palette} onChange={(s) => onChange({ "box-shadow": shadows(drop, s) })} />
            <NumberRow label="Layer blur" unit="px" value={blurOf(values.filter)} onChange={(n) => onChange({ filter: withBlur(values.filter, n) })} />
            <NumberRow
              label="Background blur"
              unit="px"
              value={blurOf(values["backdrop-filter"])}
              onChange={(n) => onChange({ "backdrop-filter": withBlur(values["backdrop-filter"], n) })}
            />
          </Section>

          <Section title="Advanced">
            <TextRow label="Filter" value={values.filter} onChange={set("filter")} />
            <TextRow label="Backdrop" value={values["backdrop-filter"]} onChange={set("backdrop-filter")} />
            {box ? null : rotate}
            {has("scale") ? (
              <NumberRow
                label="Scale"
                unit="%"
                value={Math.round(Math.abs(sx) * 100)}
                onChange={(n) => onChange({ scale: writeScale([(Math.sign(sx) || 1) * (n / 100), (Math.sign(sy) || 1) * (n / 100)]) })}
              />
            ) : null}
            {has("transform") ? (
              <>
                <NumberRow label="Skew X" unit="deg" min={-89} max={89} value={kx} onChange={(n) => onChange({ transform: withSkew(n, ky) })} />
                <NumberRow label="Skew Y" unit="deg" min={-89} max={89} value={ky} onChange={(n) => onChange({ transform: withSkew(kx, n) })} />
              </>
            ) : null}
            <SelectRow label="Blend mode" value={values["mix-blend-mode"]} options={BLEND_MODES} onChange={set("mix-blend-mode")} />
          </Section>
        </fieldset>
      )}

      {note ? <p className="border-t border-border pt-3 text-caption2 text-text-tertiary">{note}</p> : null}
    </aside>
  );
}

/**
 * The open slide or artboard while nothing is selected (spec §6.5): background (the design
 * system's colours only, when it has any), size (artboards), transition (slides), name.
 * Name and size commit on Enter or when the field is left. A deck's slide size is one
 * choice for all its slides.
 */
const SIZES = Object.keys(SLIDE_SIZES) as SlideSize[];

export function FrameProperties({
  kind,
  name,
  width,
  height,
  transition,
  background,
  palette = [],
  readOnly = false,
  onName,
  onSize,
  onDeckSize,
  onTransition,
  onBackground,
}: {
  kind: "slides" | "design";
  name: string;
  width: number;
  height: number;
  transition: string;
  background: string | undefined;
  palette?: readonly PaletteColor[];
  readOnly?: boolean;
  onName: (name: string) => void;
  onSize: (size: { width: number; height: number }) => void;
  /** Slides: the size of every slide. */
  onDeckSize?: (size: SlideSize) => void;
  onTransition: (transition: string) => void;
  onBackground: (color: string) => void;
}) {
  const unit = kind === "slides" ? "Slide" : "Artboard";
  const commit = (fn: (v: string) => void) => ({
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => fn(e.currentTarget.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && fn(e.currentTarget.value),
  });
  return (
    <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-3">
      <Section title={unit} open>
        <Row label="Name">
          <Input key={name} defaultValue={name} maxLength={120} className={FIELD} {...commit((v) => v !== name && onName(v))} />
        </Row>
        {palette.length > 0 ? (
          <div role="group" aria-label="Background" className="flex flex-col gap-1">
            <span className="text-caption1 text-text-secondary">Background</span>
            <Swatches palette={palette} onPick={onBackground} indent={false} />
          </div>
        ) : (
          <ColorRow label="Background" value={background} onChange={onBackground} />
        )}
        {kind === "design" ? (
          <>
            <Row label="Width">
              <Input
                key={`w${width}`}
                type="number"
                min={100}
                max={10000}
                defaultValue={width}
                className={FIELD}
                {...commit((v) => Number(v) !== width && onSize({ width: Number(v), height }))}
              />
            </Row>
            <Row label="Height">
              <Input
                key={`h${height}`}
                type="number"
                min={100}
                max={10000}
                defaultValue={height}
                className={FIELD}
                {...commit((v) => Number(v) !== height && onSize({ width, height: Number(v) }))}
              />
            </Row>
          </>
        ) : (
          <SelectRow label="Transition" value={transition} options={TRANSITIONS} onChange={onTransition} />
        )}
      </Section>
      {kind === "slides" ? (
        <Section title="Deck" open>
          <Row label="Slide size">
            <NativeSelect
              value={SIZES.find((s) => SLIDE_SIZES[s][0] === width && SLIDE_SIZES[s][1] === height)}
              onChange={(e) => onDeckSize?.(e.target.value as SlideSize)}
              className={FIELD}
            >
              {SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Row>
        </Section>
      ) : null}
    </fieldset>
  );
}
