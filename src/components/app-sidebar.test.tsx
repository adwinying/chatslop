import { expect, test } from 'vitest'
import { dateGroups } from '~/components/app-sidebar'

const at = (date: string) => ({
  title: date,
  lastMessageAt: new Date(date).getTime(),
})

test('groups Threads by local day', () => {
  const now = new Date('2026-10-22T09:00').getTime()
  const threads = [
    '2026-10-22T00:00',
    '2026-10-21T23:59',
    '2026-10-21T00:00',
    '2026-10-20T23:59',
    '2026-10-15T00:00',
    '2026-10-14T23:59',
    '2026-09-22T00:00',
    '2026-09-21T23:59',
  ].map(at)

  expect(
    dateGroups(threads, now).map((g) => [
      g.label,
      g.threads.map((t) => t.title),
    ]),
  ).toEqual([
    ['Today', ['2026-10-22T00:00']],
    ['Yesterday', ['2026-10-21T23:59', '2026-10-21T00:00']],
    ['Last 7 days', ['2026-10-20T23:59', '2026-10-15T00:00']],
    ['Last 30 days', ['2026-10-14T23:59', '2026-09-22T00:00']],
    ['Older', ['2026-09-21T23:59']],
  ])
})
