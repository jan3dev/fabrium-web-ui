import type { Preview } from "@storybook/react-vite";
import { TooltipProvider } from "../src/components/ui/tooltip";
// The app's full Tailwind layer and design tokens, so stories render with the real theme.
import "../src/index.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    a11y: { test: "todo" },
  },
  globalTypes: {
    theme: {
      description: "App theme",
      defaultValue: "dark",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // Themes switch on data-theme, like the app. Set on <html> so portalled
    // content (menus, dialogs, tooltips) follows too.
    (Story, context) => {
      const theme = context.globals.theme === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      return (
        <TooltipProvider>
          <div className="bg-background p-6 text-foreground">
            <Story />
          </div>
        </TooltipProvider>
      );
    },
  ],
};

export default preview;
