// No server imports, so the client can compute the same window.

const LISTED_MONTHS = 18

/** The first day of the Admin list's window, as YYYY-MM-DD. */
export function listedSince(now: Date) {
  const since = new Date(now)
  since.setMonth(since.getMonth() - LISTED_MONTHS)
  return since.toISOString().slice(0, 10)
}

/** Whether a YYYY-MM or YYYY-MM-DD release date falls in the window from `since`. */
export const releasedSince = (releaseDate: string, since: string) =>
  releaseDate !== '' && releaseDate >= since.slice(0, releaseDate.length)
