import type { Id } from '@/convex/_generated/dataModel'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { type FunctionReference, getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterEach, expect, test, vi } from 'vitest'
import { Chat } from '~/components/chat'

/** What each query returns, by function name. */
const queries = vi.hoisted(() => new Map<string, unknown>())
/** Mutations besides the no-ops, by function name. */
const mutations = vi.hoisted(() => new Map<string, () => Promise<unknown>>())
const location = vi.hoisted(() => ({ hash: '' }))

vi.mock('convex/react', () => ({
  useQuery: (query: FunctionReference<'query'>) =>
    queries.get(getFunctionName(query)),
  useMutation: (mutation: FunctionReference<'mutation'>) =>
    mutations.get(getFunctionName(mutation)) ?? (async () => {}),
  useAction: () => async () => {},
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  useParams: () => ({}),
  useLocation: ({ select }: { select: (at: typeof location) => unknown }) =>
    select(location),
}))

afterEach(() => {
  cleanup()
  queries.clear()
  mutations.clear()
  location.hash = ''
})

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

test('jumps to a search hit older than the newest Messages, shown above them', () => {
  Element.prototype.scrollIntoView = vi.fn<() => void>()
  location.hash = 'p1'
  queries.set('threads:messages', [prompt('p2'), answer('a2')])
  queries.set('threads:message', prompt('p1'))
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked queries ignore it.
  render(<Chat threadId={'t' as Id<'threads'>} />)

  const hit = screen.getByText('p1').closest('article')!
  expect(hit.parentElement).toBe(document.activeElement)
  expect(hit.compareDocumentPosition(screen.getByText('p2'))).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
})

/** A Thread of one Prompt and its Answer, with a Model to edit with. */
function renderThread() {
  queries.set('threads:messages', [prompt('p1'), answer('a1')])
  queries.set('models:options', {
    models: [
      { _id: 'm', name: 'Opus 5.5', attachmentTypes: [], reasoningLevels: [] },
    ],
    providers: [],
    favorites: [],
    modelId: 'm',
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked queries ignore it.
  render(<Chat threadId={'t' as Id<'threads'>} />)
}

test('keeps the Prompt editor open with the edit when the edit is refused', async () => {
  const edit = vi.fn<() => Promise<number>>(async () => {
    throw new ConvexError(
      'An Attachment is gone. Remove it and attach it again.',
    )
  })
  mutations.set('threads:edit', edit)
  renderThread()

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Edit Prompt'), {
    target: { value: 'p1 edited' },
  })
  fireEvent.keyDown(screen.getByLabelText('Edit Prompt'), { key: 'Enter' })
  await waitFor(() => expect(edit).toHaveBeenCalled())
  await act(async () => {})

  expect(screen.getByLabelText('Edit Prompt')).toHaveProperty(
    'value',
    'p1 edited',
  )
})

test('closes the Prompt editor once the edit goes through', async () => {
  mutations.set('threads:edit', async () => 1)
  renderThread()

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.keyDown(screen.getByLabelText('Edit Prompt'), { key: 'Enter' })

  await waitFor(() => expect(screen.queryByLabelText('Edit Prompt')).toBeNull())
})

test('disables every message action, Copy too, while a Live answer exists', () => {
  queries.set('liveAnswers:get', { _id: 'l', parts: [] })
  renderThread()

  const actions = ['Edit', 'Copy', 'Regenerate'].flatMap((name) =>
    screen.getAllByRole('button', { name }),
  )
  expect(actions.map((button) => button.hasAttribute('disabled'))).toEqual(
    actions.map(() => true),
  )
})

/** Uploads that stay in flight: the upload URL never comes. */
function stallUploads() {
  mutations.set('attachments:generateUploadUrl', () => new Promise(() => {}))
}
const file = (name: string) => new File(['notes'], name, { type: 'text/plain' })

test('takes files only once the Draft is known', () => {
  renderThread()
  expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull()

  cleanup()
  queries.set('users:me', { id: 'u1', name: 'Ada' })
  renderThread()
  expect(screen.getByRole('button', { name: 'Attach' })).toBeTruthy()
})

test('Send keeps waiting for an upload after leaving the Thread and coming back', async () => {
  stallUploads()
  queries.set('users:me', { id: 'u2', name: 'Ada' })
  renderThread()
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Read this' },
  })
  fireEvent.change(document.querySelector('input[type=file]')!, {
    target: { files: [file('notes.txt')] },
  })
  await screen.findByLabelText('Uploading notes.txt')

  cleanup()
  renderThread()

  expect(screen.getByLabelText('Uploading notes.txt')).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled'),
  ).toBe(true)
})

test('a file dropped on the Prompt editor joins the edit, not the Draft', async () => {
  stallUploads()
  queries.set('users:me', { id: 'u3', name: 'Ada' })
  renderThread()
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

  fireEvent.drop(screen.getByLabelText('Edit Prompt'), {
    dataTransfer: { types: ['Files'], files: [file('dropped.txt')] },
  })

  const chip = await screen.findByLabelText('Uploading dropped.txt')
  expect(
    chip.closest('form')?.contains(screen.getByLabelText('Edit Prompt')),
  ).toBe(true)
})
