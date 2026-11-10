import { Input } from "@/components/ui/input";

export const DEFAULT_AUTO_STOP_HOURS = 12;
const MAX_HOURS = 168;

/** The hours in `text`, or `null` when it is not an integer from 1 to 168. */
export function parseAutoStopHours(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const hours = Number(text.trim());
  return hours >= 1 && hours <= MAX_HOURS ? hours : null;
}

/** The hours to start with: the VM's own value when it is valid, else the default. */
export function initialAutoStopHours(current: number | null | undefined): string {
  return String(
    typeof current === "number" && parseAutoStopHours(String(current)) !== null
      ? current
      : DEFAULT_AUTO_STOP_HOURS,
  );
}

/** The "Auto-stop after (hours)" input of the New VM and Start dialogs. */
export function AutoStopField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-body2 font-medium text-text-primary" htmlFor={id}>
        Auto-stop after (hours)
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_HOURS}
        step={1}
        aria-describedby={`${id}-hint`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <p id={`${id}-hint`} className="text-caption1 text-text-tertiary">
        The VM stops itself after this many hours of uptime.
      </p>
    </div>
  );
}
