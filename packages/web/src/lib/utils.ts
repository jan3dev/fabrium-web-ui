// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/lib/cn.ts. Modified.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the design-system scales. Without this, `text-body2` reads
// as a text colour and a later `text-text-primary` would drop it.
const mergeClassNames = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["h1", "h2", "h3", "h4", "h5", "subtitle", "body1", "body2", "caption1", "caption2"],
        },
      ],
      rounded: [{ rounded: ["utility", "card", "modal", "pill"] }],
      shadow: [{ shadow: ["button", "surface", "modal"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
