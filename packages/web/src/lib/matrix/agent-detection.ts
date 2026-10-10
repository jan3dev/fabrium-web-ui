export interface RosterAgent {
  userId: string;
  name: string;
  role: string | undefined;
  avatarUrl: string | undefined;
  rooms: string[];
  persona?: string;
  project?: string;
}

interface RawAgent {
  user_id?: string;
  name?: string;
  role?: string;
  avatar_url?: string;
  rooms?: string[];
  persona?: unknown;
  project?: unknown;
}

export function parseWorkforceRoster(content: unknown): RosterAgent[] | null {
  if (!content || typeof content !== "object") return null;
  const c = content as { version?: number; agents?: RawAgent[] };
  if (c.version !== 1 || !Array.isArray(c.agents)) return null;
  const out: RosterAgent[] = [];
  for (const a of c.agents) {
    if (!a.user_id) continue;
    out.push({
      userId: a.user_id,
      name: a.name ?? a.user_id,
      role: a.role,
      avatarUrl: a.avatar_url,
      rooms: Array.isArray(a.rooms) ? a.rooms : [],
      ...(typeof a.persona === "string" && a.persona ? { persona: a.persona } : {}),
      ...(typeof a.project === "string" && a.project ? { project: a.project } : {}),
    });
  }
  return out;
}

export function makeAgentSet(agents: RosterAgent[]): Set<string> {
  return new Set(agents.map((a) => a.userId));
}

export function filterHumans(
  candidates: string[],
  isAgent: (userId: string) => boolean,
): string[] {
  return candidates.filter((id) => !isAgent(id));
}
