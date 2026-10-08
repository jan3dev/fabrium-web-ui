import { useTheme, type Theme } from "@/components/theme-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";

const OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-body2 font-medium text-text-primary">Theme</p>
        <p className="text-caption1 text-text-secondary">Kept on this browser.</p>
      </div>
      <SegmentedControl
        legend="Theme"
        options={OPTIONS}
        value={theme}
        onValueChange={setTheme}
        testId="theme-control"
        optionTestIdPrefix="theme"
      />
    </div>
  );
}
