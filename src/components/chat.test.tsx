import type { Id } from '@/convex/_generated/dataModel'
import { cleanup, render, screen } from '@testing-library/react'
import { type FunctionReference, getFunctionName } from 'convex/server'
import { afterEach, expect, test, vi } from 'vitest'
import { Chat } from '~/components/chat'

/** What each query returns, by function name. */
const queries = vi.hoisted(() => new Map<string, unknown>())

vi.mock('convex/react', () => ({
  useQuery: (query: FunctionReference<'query'>) =>
    queries.get(getFunctionName(query)),
  useMutation: () => async () => {},
  useAction: () => async () => {},
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  useParams: () => ({}),
}))

afterEach(cleanup)

const prompt = (id: string) => ({
  _id: id,
  role: 'user',
  parts: [{ type: 'text', text: id }],
  attachments: [],
})
const answer = (id: string, contextStartMessageId?: string) => ({
  _id: id,
  role: 'assistant',
  parts: [{ type: 'text', text: id, state: 'done' }],
  status: 'complete',
  modelId: 'm',
  modelName: 'Opus 5.5',
  webSearch: false,
  contextStartMessageId,
})

test("marks where the latest Answer's Context starts", () => {
  queries.set('threads:messages', [
    prompt('p1'),
    answer('a1'),
    prompt('p2'),
    // An older Answer's divider stays hidden.
    answer('a2', 'p2'),
    prompt('p3'),
    answer('a3', 'p3'),
  ])
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked queries ignore it.
  render(<Chat threadId={'t' as Id<'threads'>} />)

  const [divider, ...others] = screen.getAllByText(
    "Earlier messages weren't sent to the Model",
  )
  expect(others).toEqual([])
  const p3 = screen.getByText('p3').closest('article')!
  expect(divider!.compareDocumentPosition(p3)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  const a2 = screen.getByText('a2').closest('article')!
  expect(divider!.compareDocumentPosition(a2)).toBe(
    Node.DOCUMENT_POSITION_PRECEDING,
  )
})
