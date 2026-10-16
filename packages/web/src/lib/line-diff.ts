export type DiffRow = { type: "ctx" | "add" | "del"; text: string };

function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Past this many LCS cells (n·m) the middle shows as a whole delete + add. */
const MAX_CELLS = 4_000_000;

export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  // Shared head and tail are context: an edit usually touches a small middle.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ctx = (lines: string[]): DiffRow[] => lines.map((text) => ({ type: "ctx", text }));
  return [
    ...ctx(a.slice(0, head)),
    ...lcsDiff(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...ctx(a.slice(a.length - tail)),
  ];
}

function lcsDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  // ponytail: no LCS above MAX_CELLS (memory is n·m); Myers' O(ND) diff if big rewrites need line detail.
  if (n * m > MAX_CELLS) {
    return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: "del", text: a[i++] });
  while (j < m) rows.push({ type: "add", text: b[j++] });
  return rows;
}
