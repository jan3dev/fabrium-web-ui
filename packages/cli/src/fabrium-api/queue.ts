/** Runs one work at a time, in the order of the calls. A failed work does not stop the next. */
// ponytail: one queue for every agent write; a lock for each VM name if writes must run in parallel.
export function createQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (work) => {
    const run = tail.then(work)
    tail = run.catch(() => {})
    return run
  }
}
