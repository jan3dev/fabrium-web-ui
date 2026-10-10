/** The few colours that must exist as literal hex: `<meta name="theme-color">` and the inline theme bootstrap in index.html run without CSS. `colors.test.ts` checks each still equals the primitive it names. */
export const BRAND_COLORS = {
  /** Page background in the dark theme. */
  background: "#070708",
  /** Page background in the light theme; text colour in the dark one. */
  foreground: "#f5f5f8",
} as const;

/** Which `--fab-*` primitive each value above copies. Adding a colour without adding it here is a type error. */
export const BRAND_COLOR_PRIMITIVES: Record<keyof typeof BRAND_COLORS, string> = {
  background: "--fab-metal-1000",
  foreground: "--fab-metal-50",
};
