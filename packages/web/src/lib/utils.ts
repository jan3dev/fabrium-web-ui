// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/lib/cn.ts. Modified.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClassNames = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["message", "message-timestamp"],
        },
      ],
      rounded: ["rounded-squircle"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
