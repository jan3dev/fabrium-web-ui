import type { DesignSystemEntry, DesignSystemPrefs, DesignSystemScope } from "@/model/types";

/**
 * Design systems across threads (spec §5.6). A workspace or project space lists them
 * in one state event; owners and admins write it. A user's own default and "off for
 * me" are account data, and ride on each message they send so the agent learns them.
 * Everything here reads untrusted input: entries that do not fit are dropped.
 */
export const DesignSystemsEventType = "dev.fabrium.design_systems";
export const DesignSystemPrefsType = "dev.fabrium.design_system_prefs";
/** Key inside an `m.room.message`: the sender's own choice, `{ room_id, identifier }` or `{ off: true }`. */
export const DesignSystemContentKey = "dev.fabrium.design_system";

export const MAX_DESIGN_SYSTEMS = 50;
const MAX_NAME = 80;
/** Room and event IDs: a sigil and no whitespace (room version 12 IDs have no server part). */
const ROOM_ID = /^![^\s]{1,254}$/;
const EVENT_ID = /^\$[^\s]{1,254}$/;
/** The daemon's artifact identifier rule (`transport-matrix/src/artifacts.ts`). */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SCOPES: readonly DesignSystemScope[] = ["slides", "design", "motion"];

/** One system's identity: its room and identifier. */
export const designSystemKey = (s: { roomId: string; identifier: string }) => `${s.roomId} ${s.identifier}`;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function name(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, MAX_NAME);
}

/** The systems a `dev.fabrium.design_systems` content lists, in its order; duplicates dropped. */
export function decodeDesignSystems(content: unknown): DesignSystemEntry[] {
  const systems = record(content).systems;
  if (!Array.isArray(systems)) return [];
  const out: DesignSystemEntry[] = [];
  const seen = new Set<string>();
  for (const raw of systems) {
    const s = record(raw);
    const { room_id: roomId, thread_id: threadId, identifier } = s;
    if (typeof roomId !== "string" || !ROOM_ID.test(roomId)) continue;
    // Artifacts live in threads: without one, neither the agent nor the panel can find it.
    if (typeof threadId !== "string" || !EVENT_ID.test(threadId)) continue;
    if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) continue;
    const key = designSystemKey({ roomId, identifier });
    if (seen.has(key)) continue;
    seen.add(key);
    const scope = Array.isArray(s.for) ? SCOPES.filter((k) => (s.for as unknown[]).includes(k)) : [];
    out.push({
      roomId,
      threadId,
      identifier,
      name: name(s.name, identifier),
      isDefault: s.default === true,
      ...(scope.length ? { for: scope } : {}),
    });
    if (out.length >= MAX_DESIGN_SYSTEMS) break;
  }
  return out;
}

/** The state content for `systems`, as the daemon reads it. */
export function encodeDesignSystems(systems: readonly DesignSystemEntry[]): { systems: Record<string, unknown>[] } {
  return {
    systems: systems.slice(0, MAX_DESIGN_SYSTEMS).map((s) => ({
      room_id: s.roomId,
      thread_id: s.threadId,
      identifier: s.identifier,
      name: s.name,
      ...(s.isDefault ? { default: true } : {}),
      ...(s.for?.length ? { for: s.for } : {}),
    })),
  };
}

/** The user's account data; unknown or malformed fields read as unset. */
export function decodeDesignSystemPrefs(content: unknown): DesignSystemPrefs {
  const c = record(content);
  const d = record(c.default);
  const pick =
    typeof d.room_id === "string" && ROOM_ID.test(d.room_id) && typeof d.identifier === "string" && IDENTIFIER.test(d.identifier)
      ? { roomId: d.room_id, identifier: d.identifier }
      : undefined;
  return { off: c.off === true, ...(pick ? { default: pick } : {}) };
}

export function encodeDesignSystemPrefs(prefs: DesignSystemPrefs): Record<string, unknown> {
  return {
    ...(prefs.off ? { off: true } : {}),
    ...(prefs.default ? { default: { room_id: prefs.default.roomId, identifier: prefs.default.identifier } } : {}),
  };
}

/** Project systems first, then the workspace's; a system both list keeps its project entry. */
export function mergeDesignSystems(
  project: readonly DesignSystemEntry[],
  workspace: readonly DesignSystemEntry[],
): DesignSystemEntry[] {
  const seen = new Set<string>();
  return [...project, ...workspace].filter((s) => {
    const key = designSystemKey(s);
    return !seen.has(key) && seen.add(key);
  });
}

/**
 * The system new work uses: none when the user turned them off, else their own default
 * while it is still listed, else the first default for `kind`. Without a kind, a default
 * for every kind wins over one scoped to a kind.
 */
export function activeDesignSystem(
  systems: readonly DesignSystemEntry[],
  prefs: DesignSystemPrefs,
  kind?: DesignSystemScope,
): DesignSystemEntry | null {
  if (prefs.off) return null;
  const own = prefs.default;
  const mine = own && systems.find((s) => designSystemKey(s) === designSystemKey(own));
  if (mine) return mine;
  const defaults = systems.filter((s) => s.isDefault);
  return (
    (kind ? defaults.find((s) => !s.for || s.for.includes(kind)) : defaults.find((s) => !s.for) ?? defaults[0]) ?? null
  );
}

/** What a message carries for the agent: only a personal choice; the workspace's default it finds itself. */
export function designSystemChoice(prefs: DesignSystemPrefs, active: DesignSystemEntry | null): Record<string, unknown> | null {
  if (prefs.off) return { off: true };
  const own = prefs.default;
  return own && active && designSystemKey(active) === designSystemKey(own)
    ? { room_id: own.roomId, identifier: own.identifier }
    : null;
}
