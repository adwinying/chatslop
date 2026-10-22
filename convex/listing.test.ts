import { expect, test } from 'vitest'
import { listedSince } from '@/convex/listing'

test('the window starts 18 months back, clamped to the month end', () => {
  expect(listedSince(new Date('2026-10-22T12:00:00Z'))).toBe('2025-04-22')
  expect(listedSince(new Date('2026-08-31T12:00:00Z'))).toBe('2025-02-28')
})
