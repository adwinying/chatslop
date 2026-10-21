# Resumable chunked streaming on Convex with AI SDK

Ticket: #5. Researched 2026-10-21 against `@convex-dev/agent` 0.7.8 ([`942a1a9`][agent]), `@convex-dev/persistent-text-streaming` 0.3.4 ([`4154ffd`][pts]), `ai` 7.0.148 ([`e6230e4`][ai-src]), and convex-backend `95d8719`.

Inputs from closed tickets: Codex runs on `@ai-sdk/openai` Responses with `store: false`, Claude on `@ai-sdk/anthropic`. Both stream reasoning summaries and can use provider-native web search (#2). Convex is self-hosted in one container (#3).

## Answer

Hand-roll it (option c). A scheduled action runs `streamText`, folds `toUIMessageStream()` into a `UIMessage` with `readUIMessageStream`, and patches a separate draft document with the full `parts` snapshot about once per second. On finish, one mutation copies the parts into the message and deletes the draft. Reload, other tabs, and other devices read the draft through an ordinary query.

The AI SDK provides the hard parts for free: reasoning, sources, provider-executed web search, and provider metadata all live in `UIMessage.parts`. Each component would either drop something we need (persistent-text-streaming has no reasoning and no stop) or take over the data model and the stop semantics (Agent). Borrow the Agent's patterns, not the component.

## Comparison

Assumed message: ~2.4 KB reasoning summary + ~3.6 KB answer (~6 KB), streamed over ~25 s.

| | (a) Agent component | (b) persistent-text-streaming | (c) Hand-rolled draft doc |
|---|---|---|---|
| Reasoning | Yes. Deltas are `UIMessageChunk`s. | No. One `text` string per chunk. | Yes. `sendReasoning` defaults to `true`. |
| Sources / web search | Yes, with `sendSources: true` (default `false`). | No. | Yes, with `sendSources: true`. |
| Resume after reload | Yes. Any client, from DB deltas. | Partly. Only the tab that POSTs drives generation, inside an HTTP action. Others read the DB. | Yes. Any client, from the draft doc. |
| Stop | `abortStream`. A stop saves the partial as `failed` and leaves it out of later context. A stop before the first delta is lost. | None built in. | Ours to define, e.g. a `stopped` status that stays in context. |
| Writes per message (default settings) | ~100 `addDelta` mutations (250 ms throttle), ~20 KB of delta rows, deleted 5 min later. Plus stream row, pending message, final save. | ~40 `addChunk` mutations (one per sentence), ~4 KB of rows, kept. | ~25 patches (1 s throttle), ~75 KB written in total because each patch rewrites the full snapshot. Plus insert, finish, delete. |
| Bandwidth per viewer | ~O(answer size). A cursor query fetches only new deltas, but each cursor advance opens a new subscription. | O(n²). `getStreamText` returns the whole text on every chunk: ~70 KB. Text only. | O(n²) at a bounded n: ~75 KB. Only the draft query reruns, not the thread list. |
| Regenerate / edit | `deleteMessageRange` + `promptMessageId`. Old replies must be deleted first or they become context. | Neutral: one stream per message. | Plain mutations on our own tables. |
| Per-message Model | Build an `Agent` per call. `messages.model` is recorded. | N/A. | A field on our message. |
| Self-hosted | Works (components run in the OSS backend). Skip the AI Gateway examples, which are Cloud-only. | Works, but needs an HTTP route, CORS, and a Bearer token on `/http`. | Nothing special. |
| Dictates data model | Heavily. Threads and messages live in component tables. | Lightly. Only a stream ID per message. | Not at all. |

Self-hosting has no per-call billing, so "cost" means SQLite writes, CPU, and WebSocket bytes. For fewer than 20 users, every column is cheap. The deciding rows are reasoning, stop, and the data model.

## Findings

### AI SDK (all options)

- `toUIMessageStream` defaults to `sendReasoning = true` and `sendSources = false` ([`to-ui-message-stream.ts#L25-L26`][ai-tums]). The reference page claims `sendReasoning` defaults to `false` ([docs][ai-tums-docs]). The source wins, but pass both flags explicitly.
- `UIMessageChunk` includes `reasoning-start/delta/end`, `source-url`, `source-document`, and tool chunks with `providerExecuted`. Each reasoning chunk carries `providerMetadata` ([ui-message-chunks.ts#L257-L376][ai-chunks]).
- `convertToModelMessages` maps each reasoning part's `providerMetadata` back to `providerOptions` ([convert-to-model-messages.ts#L254-L259][ai-convert]). Persisting final `UIMessage.parts` with metadata intact therefore keeps OpenAI encrypted reasoning (needed with `store: false`, #2) and Anthropic thinking signatures replayable. Do not strip metadata when saving.
- `readUIMessageStream` turns a chunk stream into successive `UIMessage` snapshots ([reference][ai-read]).
- `smoothStream({ chunking: "word" | "line" | RegExp | ... })` regroups text and reasoning deltas ([reference][ai-smooth]). Hand-rolled code doesn't need it: a time-based flush already sets the granularity.
- `abortSignal` cancels the provider call. `onAbort` receives the completed steps ([stopping streams][ai-stop], [error handling][ai-err]).

### Convex platform facts

- A query update sends the whole new result. `QueryUpdated` carries the full `value`, not a diff ([protocol.ts#L238-L242][cx-protocol]). So any query that reads a doc patched during streaming resends its full result on every patch. Keep streaming state out of the thread list query.
- Documents are capped at 1 MiB and 16 levels of nesting ([limits][limits]). 1 MiB is plenty for one answer, including encrypted reasoning.
- Actions are at-most-once and never retried ([scheduled functions][sched]). A container restart mid-answer kills the action silently, so every option needs a timeout that finalizes stuck messages.
- Action timeouts: Convex runtime 30 min, Node 10 min ([limits][limits]). The actions page still says 10 min for both ([actions][actions]). Self-hosted can change them with `V8_ACTION_USER_TIMEOUT_SECS` / `NODE_ACTION_USER_TIMEOUT_SECS` ([knobs.rs#L202-L219][knobs]). Run generation in the default runtime (no `"use node"`), as the Agent example does ([streaming.ts][agent-ex]).
- Components run in the open-source backend (`crates/model/src/components`, convex-backend `95d8719`). The self-hosting README lists no component caveat ([self-hosted README][sh]).

### (a) Agent component

- Storage: `streamingMessages` (one per stream) + `streamDeltas` (`{streamId, start, end, parts}`), next to the component's own `threads` and `messages` ([schema.ts#L19-L150][agent-schema]).
- Writer: `DeltaStreamer` buffers `UIMessageChunk`s, merges adjacent text and reasoning deltas, and writes at most every `throttleMs` (default 250), single-flighted. The default `chunking` is `/[\p{P}\s]/u`, effectively per word ([streaming.ts#L163-L168][agent-defaults]). `sendSources` defaults to `false` ([same][agent-defaults]).
- Reader: `listDeltas` returns deltas from the client's cursor, at most 100 per stream per call ([streams.ts#L121][agent-listdeltas]). The hook moves the cursor after each batch, which changes the query args ([useDeltaStreams.ts#L105][agent-hook]).
- Lifecycle: streams time out after 10 min without a heartbeat. Finished or aborted streams and their deltas are deleted 5 min later ([streams.ts#L68-L69][agent-timeouts]). On failure or abort, `finalizeMessage` rebuilds the partial reply from the deltas ([messages.ts#L484][agent-finalize]).
- Stop: `abortStream` marks the row `aborted`. The runner notices on its next `addDelta`, which returns `false`, then aborts `streamText` through the streamer's `AbortController` ([streaming.ts#L495-L511][agent-abort], [streamText.ts#L155-L181][agent-st]). Open gaps ([#391][i391]): a stop is stored as `failed` with `error: "async abort"`, the partial is excluded from later context (`statuses: ["success"]`), and a stop before the first delta is lost.
- Regenerate: if a `promptMessageId` is reused, earlier replies become context. Delete them first with `deleteMessageRange` ([agent-usage.mdx][agent-usage], [messages.mdx#L287-L320][agent-msgs]).
- Open bug: `new Agent(...)` fails to typecheck (TS2590) with `ai` >= 7.0.141 ([#417][i417]). The current `ai` is 7.0.148.
- Deltas can be used without the `Agent` class (`DeltaStreamer` + `syncStreams`), but they still need a thread from the component ([streaming.mdx][agent-docs]).

### (b) persistent-text-streaming

- Schema: `streams {status}` + `chunks {streamId, text}` ([schema.ts][pts-schema]). Text only. The reasoning request [#11][pts11] was closed with no schema change. The suggested workaround is to JSON-encode both into `text`.
- The writer runs inside an HTTP action started by the "driven" browser's POST ([README][pts]). It writes to the DB whenever an incoming piece contains `.`, `!` or `?` ([client/index.ts#L29-L30][pts-delim]). After the client disconnects it keeps writing to the DB ([#L139][pts-delim]). Whether the backend keeps a disconnected HTTP action alive is not documented. Unverified.
- Readers call `getStreamText`, which concatenates every chunk on each run ([lib.ts#L96][pts-get]). That is O(n²) bandwidth for non-driving viewers and after a reload.
- Timeout: a cron marks streams `timeout` 20 min after creation, not after the last chunk as the comment says ([lib.ts#L124-L188][pts-timeout]). Long answers get cut off.
- Stop: no API. [#16][pts16] is open, and the maintainer points to the Agent's deltas instead.

### (c) Hand-rolled draft doc (recommended)

Schema (ours):

```ts
messages: { threadId, role, status: "pending" | "streaming" | "done" | "stopped" | "error",
            model, parts /* UIMessage parts */, error? }
messageDrafts: { messageId, parts }   // exists only while streaming
```

Flow:

1. `send` mutation: insert the user message and a `pending` assistant message (with the chosen Model), insert the draft, schedule `generate`, and schedule a timeout mutation.
2. `generate` action: `streamText({ model, messages: await convertToModelMessages(history), abortSignal })`. Iterate `readUIMessageStream({ stream: result.toUIMessageStream({ sendReasoning: true, sendSources: true }) })`. Keep the latest snapshot. Every ≥1 s, single-flighted (the `DeltaStreamer` pattern), call `saveDraft({ messageId, parts })`.
3. `saveDraft` returns `{ stop: boolean }`. A Stop button sets the message status to `stopping`. The runner sees it on its next flush and aborts. Worst-case latency is one flush interval, plus the wait for the first chunk.
4. `finish` mutation: copy the final parts to `messages`, set `done`, `stopped`, or `error`, delete the draft, and cancel the timeout. All in one transaction, so the UI never flashes.
5. Timeout mutation: if the message is still `pending` or `streaming`, copy the draft's parts and mark it `error`. This covers container restarts.

Client: the thread query reads `messages` only. The streaming bubble subscribes to `getDraft(messageId)`. Both render the same `parts`.

Regenerate = reset the assistant message, recreate the draft, reschedule. Edit-and-resend = patch the user message, delete later messages, then the same steps. Both are plain mutations on our tables. `stopped` replies stay in context because we write the history query.

If draft bandwidth ever matters, switch to append-only chunk rows with a cursor, as the Agent does. That gives O(n) bytes, at the cost of client-side merging.

## Open points

- Live check: store one real Codex and one real Claude web-search reply. Documents allow 16 levels of nesting, and nested keys may be up to 1024 chars ([limits][limits]). `parts` → tool output → provider metadata nests deeply, and we don't control that shape. If it overflows, store `parts` as a JSON string.
- Pick the flush interval by feel: 1 s is a guess. Smooth on the client with a typewriter effect if 1 s chunks feel jumpy.

[agent]: https://github.com/get-convex/agent/tree/942a1a91c9770fdfbfc83cfc4dab895c6765119f
[agent-schema]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/component/schema.ts#L19-L150
[agent-defaults]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/vercel/client/streaming.ts#L163-L168
[agent-abort]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/vercel/client/streaming.ts#L495-L511
[agent-st]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/vercel/client/streamText.ts#L155-L181
[agent-listdeltas]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/component/streams.ts#L121
[agent-timeouts]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/component/streams.ts#L68-L69
[agent-finalize]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/component/messages.ts#L484
[agent-hook]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/src/vercel/react/useDeltaStreams.ts#L105
[agent-usage]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/docs/agent-usage.mdx
[agent-msgs]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/docs/messages.mdx#L287-L320
[agent-docs]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/docs/streaming.mdx
[agent-ex]: https://github.com/get-convex/agent/blob/942a1a91c9770fdfbfc83cfc4dab895c6765119f/example/convex/chat/streaming.ts
[i391]: https://github.com/get-convex/agent/issues/391
[i417]: https://github.com/get-convex/agent/issues/417
[pts]: https://github.com/get-convex/persistent-text-streaming/tree/4154ffd3463948d70da62327592d1c49883cf8ba
[pts-schema]: https://github.com/get-convex/persistent-text-streaming/blob/4154ffd3463948d70da62327592d1c49883cf8ba/src/component/schema.ts
[pts-delim]: https://github.com/get-convex/persistent-text-streaming/blob/4154ffd3463948d70da62327592d1c49883cf8ba/src/client/index.ts#L29-L30
[pts-get]: https://github.com/get-convex/persistent-text-streaming/blob/4154ffd3463948d70da62327592d1c49883cf8ba/src/component/lib.ts#L96
[pts-timeout]: https://github.com/get-convex/persistent-text-streaming/blob/4154ffd3463948d70da62327592d1c49883cf8ba/src/component/lib.ts#L124-L188
[pts11]: https://github.com/get-convex/persistent-text-streaming/issues/11
[pts16]: https://github.com/get-convex/persistent-text-streaming/issues/16
[ai-tums]: https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/ai/src/ui-message-stream/to-ui-message-stream.ts#L25-L26
[ai-tums-docs]: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
[ai-read]: https://ai-sdk.dev/docs/reference/ai-sdk-ui/read-ui-message-stream
[ai-smooth]: https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream
[ai-stop]: https://ai-sdk.dev/docs/advanced/stopping-streams
[ai-err]: https://ai-sdk.dev/docs/ai-sdk-core/error-handling
[limits]: https://docs.convex.dev/production/state/limits
[sched]: https://docs.convex.dev/scheduling/scheduled-functions
[actions]: https://docs.convex.dev/functions/actions
[knobs]: https://github.com/get-convex/convex-backend/blob/95d8719/crates/common/src/knobs.rs#L202-L219
[sh]: https://github.com/get-convex/convex-backend/blob/95d8719/self-hosted/README.md
[ai-chunks]: https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/ai/src/ui-message-stream/ui-message-chunks.ts#L257-L376
[ai-convert]: https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/ai/src/ui/convert-to-model-messages.ts#L254-L259
[cx-protocol]: https://github.com/get-convex/convex-backend/blob/95d8719/npm-packages/convex/src/browser/sync/protocol.ts#L238-L242
[ai-src]: https://github.com/vercel/ai/tree/e6230e43ba9def164550eea562c457e23be9efa6
