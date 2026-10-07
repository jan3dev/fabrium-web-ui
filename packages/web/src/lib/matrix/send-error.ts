/** Short, human reason a send was rejected, from the error the SDK kept on the echo. */
export function describeSendError(err: unknown): string {
  const e = err as { errcode?: string; message?: string; data?: { error?: string } } | null | undefined;
  const detail = e?.data?.error ?? e?.message ?? "";
  if (e?.errcode === "M_FORBIDDEN") {
    return /membership/i.test(detail)
      ? "You're not a member of this room yet"
      : "You don't have permission to send here";
  }
  if (e?.errcode) return e.errcode.replace(/^M_/, "").toLowerCase().replace(/_/g, " ");
  return detail || "Couldn't reach the server";
}
