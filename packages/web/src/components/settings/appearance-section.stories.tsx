import type { Meta } from "@storybook/react-vite";
import { ThemeProvider } from "@/components/theme-provider";
import { AppearanceSection } from "./appearance-section";

const meta = {
  title: "Settings/AppearanceSection",
  component: AppearanceSection,
  decorators: [
    (Story) => (
      <ThemeProvider>
        <div className="max-w-md">
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof AppearanceSection>;

export default meta;

/** Picking a theme here applies it to the whole canvas, as in the app. */
export const Default = {};
