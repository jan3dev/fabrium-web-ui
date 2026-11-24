/**
 * The VM launches that zooid asked the control plane for, create and recreate, kept in memory for 10 minutes
 * (contracts section 2, "A VM that is launching"). The control plane lists a new VM late, and a launch can go on
 * after a 5xx or no answer, so for the rule of the project VM and for a project in use a recent launch counts as
 * the live VM of its name. A restart of the daemon forgets them.
 */
export const LAUNCH_TTL_MS = 10 * 60_000

export interface Launch {
  name: string
  /** The project of the request, or null for a personal VM. */
  project_id: string | null
  at: number
}

export function createLaunches(now: () => number = Date.now) {
  const byName = new Map<string, Launch>()
  const fresh = (launch: Launch) => now() - launch.at < LAUNCH_TTL_MS
  return {
    /** Before the control plane call. A newer launch of a name replaces the older one. */
    add(name: string, projectId: string | null): Launch {
      const launch = { name, project_id: projectId, at: now() }
      byName.set(name, launch)
      return launch
    },
    /** After a 4xx refusal: that launch does not happen. */
    drop(launch: Launch): void {
      if (byName.get(launch.name) === launch) byName.delete(launch.name)
    },
    /** The launch of the name in the last 10 minutes. */
    get(name: string): Launch | undefined {
      const launch = byName.get(name)
      if (launch && !fresh(launch)) byName.delete(name)
      return launch && fresh(launch) ? launch : undefined
    },
    /** True while a launch of the last 10 minutes has the project. */
    hasProject(id: string): boolean {
      return [...byName.values()].some((launch) => fresh(launch) && launch.project_id === id)
    },
  }
}

export type Launches = ReturnType<typeof createLaunches>
