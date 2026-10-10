import type { Meta, StoryObj } from "@storybook/react-vite";
import tokensCss from "./tokens.css?raw";
import fabriumTokensCss from "./fabrium-tokens.css?raw";

// Token names are read from the stylesheets, so a new token shows up here
// without editing this file. Primitives (--fab-*) are left out on purpose.
function tokenNames(css: string): string[] {
  const names = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => !n.startsWith("--fab-"));
}

const SEMANTIC = tokenNames(tokensCss);
const FABRIUM = tokenNames(fabriumTokensCss);
const TYPE_SCALE = [
  "text-h1",
  "text-h2",
  "text-h3",
  "text-h4",
  "text-h5",
  "text-subtitle",
  "text-body1",
  "text-body2",
  "text-caption1",
  "text-caption2",
];
const RADII = [
  "rounded-utility",
  "rounded-card",
  "rounded-modal",
  "rounded-pill",
];

function Swatch({ name }: { name: string }) {
  const isShadow = name.startsWith("--elevation-");
  return (
    <div className="flex items-center gap-3">
      <div
        className="size-8 shrink-0 rounded-utility border border-surface-border-secondary"
        style={
          isShadow
            ? {
                boxShadow: `var(${name})`,
                background: "var(--surface-primary)",
              }
            : { background: `var(${name})` }
        }
      />
      <code className="truncate font-mono text-caption1 text-text-secondary">
        {name}
      </code>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-subtitle font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ThemePanel({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      data-theme={theme}
      className="flex min-w-0 flex-1 flex-col gap-8 rounded-card bg-surface-background p-6 text-text-primary"
    >
      <h1 className="font-heading text-h4 font-semibold capitalize">{theme}</h1>
      <Section title="Semantic tokens">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {SEMANTIC.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </div>
      </Section>
      <Section title="Fabrium tokens">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {FABRIUM.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </div>
      </Section>
      <Section title="Type scale">
        {TYPE_SCALE.map((cls) => (
          <p
            key={cls}
            className={`${cls} ${cls.includes("-h") || cls === "text-subtitle" ? "font-heading font-semibold" : ""}`}
          >
            {cls}: Coder · Payments opened a pull request
          </p>
        ))}
      </Section>
      <Section title="Radius and shadow">
        <div className="flex flex-wrap gap-4">
          {RADII.map((cls) => (
            <div
              key={cls}
              className={`${cls} flex h-12 w-32 items-center justify-center border bg-surface-primary text-caption1`}
            >
              {cls}
            </div>
          ))}
          {["shadow-button", "shadow-surface", "shadow-modal"].map((cls) => (
            <div
              key={cls}
              className={`${cls} flex h-12 w-32 items-center justify-center rounded-card bg-surface-primary text-caption1`}
            >
              {cls}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

const meta = {
  title: "Foundations/Tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BothThemes: Story = {
  render: () => (
    <div className="flex flex-col gap-4 xl:flex-row">
      <ThemePanel theme="light" />
      <ThemePanel theme="dark" />
    </div>
  ),
};
