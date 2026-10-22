// No server imports, so the client can compute the same window.

const LISTED_MONTHS = 18

/** The first day of the Admin list's window, as YYYY-MM-DD. */
export function listedSince(now: Date) {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() - LISTED_MONTHS
  // Day 0 of the next month is this month's last day; Aug 31 maps to Feb 28.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(now.getUTCDate(), lastDay)
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

/** Whether a YYYY-MM or YYYY-MM-DD release date falls in the window from `since`. */
export const releasedSince = (releaseDate: string, since: string) =>
  releaseDate !== '' && releaseDate >= since.slice(0, releaseDate.length)
