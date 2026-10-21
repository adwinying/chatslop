# Hand-rolled resumable streaming

Answers stream from a scheduled Convex action running AI SDK `streamText`. About once a second the action writes the full UIMessage `parts` snapshot to a `liveAnswers` row, which every open tab subscribes to. A transactional finish mutation then inserts the Answer and deletes the Live answer. We rejected the Convex Agent component and persistent-text-streaming: neither keeps reasoning, sources and provider metadata as structured parts the way we need ([Resumable chunked streaming on Convex with AI SDK](https://github.com/adwinying/chatslop/issues/5), [Data model](https://github.com/adwinying/chatslop/issues/10)).

## Consequences

- Actions run at most once, so a restart kills a stream without warning. A scheduled timeout mutation finalizes any Live answer left behind.
- Resuming happens at snapshot granularity (about one second), not token by token.
