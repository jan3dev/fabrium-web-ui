import type { RuntimeModule } from "./srcdoc";

// The frame cannot fetch, so the parent loads runtimes from its own origin
// (vendored by scripts/build-artifact-runtime.mjs) and posts their source.
// A success is memoised for the page; a failure is not, so a retry can work.
const cache = new Map<RuntimeModule, Promise<string>>();

function load(name: RuntimeModule): Promise<string> {
  const hit = cache.get(name);
  if (hit) return hit;
  const pending = fetch(
    `${import.meta.env.BASE_URL}artifact-runtime/${name}.js`,
  )
    .then((r) => {
      // A missing file comes back as the app's index.html with a 200.
      if (!r.ok || r.headers.get("content-type")?.includes("text/html"))
        throw new Error(`Could not load the ${name} runtime (${r.status}).`);
      return r.text();
    })
    .catch((err: unknown) => {
      cache.delete(name);
      throw err instanceof Error
        ? err
        : new Error(`Could not load the ${name} runtime.`);
    });
  cache.set(name, pending);
  return pending;
}

/** In the order asked: Tailwind before React, React before Babel. */
export async function loadRuntimes(names: readonly RuntimeModule[]) {
  return Promise.all(
    names.map(async (name) => ({ name, source: await load(name) })),
  );
}

/** Errors the preview threw, deduplicated, capped: a frame can throw at 60 Hz. */
export function addPreviewError(
  errors: readonly string[],
  detail: unknown,
): readonly string[] {
  // One line each: the list goes into a message the user sends.
  const message = String(
    (detail as { message?: unknown } | null)?.message ?? "Error",
  )
    .replace(/\s+/g, " ")
    .slice(0, 500);
  return errors.includes(message) || errors.length >= 10
    ? errors
    : [...errors, message];
}

/** An ordinary thread message, phrased as the user would. */
export function composeFixRequest(
  identifier: string,
  errors: readonly string[],
): string {
  const list = errors.map((e) => `- ${e}`).join("\n");
  return `The preview of artifact \`${identifier}\` throws ${errors.length === 1 ? "an error" : `${errors.length} errors`}:\n${list}\nCan you fix it?`;
}
