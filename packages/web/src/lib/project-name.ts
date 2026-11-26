// The project name rule of the control plane, and its name comparison.
import { SERVER_TEXT } from "./fabrium-errors";

const CONTROL = /\p{Cc}/u;

/** The reason a name breaks the rule, or null. The name is trimmed first, as it is sent. */
export function projectNameError(name: string): string | null {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= 64 && !CONTROL.test(trimmed)
    ? null
    : SERVER_TEXT["invalid project name"];
}

export const lowerAscii = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Two names are equal when they differ only in the case of ASCII letters. */
export const sameProjectName = (a: string, b: string) => lowerAscii(a) === lowerAscii(b);
