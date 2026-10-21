# What CLIProxyAPI passes through for Codex and Claude

Research for [#2](https://github.com/adwinying/chatslop/issues/2). Date: 2026-10-21.

Sources, pinned:

- CLIProxyAPI (CPA) `main` at [`ce07d18`](https://github.com/router-for-me/CLIProxyAPI/tree/ce07d189b3de2a39d37fd68ae093b102ce3aabee) (tag `v8.0.37`). Links below marked `CPA:` resolve against this commit.
- AI SDK `main` at [`e6230e4`](https://github.com/vercel/ai/tree/e6230e43ba9def164550eea562c457e23be9efa6) (`ai` 7.0.148, `@ai-sdk/openai` 4.0.99, `@ai-sdk/anthropic` 4.0.85). Links marked `AI SDK:`.
- Anthropic docs: [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).
- OpenAI docs: [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

Not checked: the live instance on nas. Its image is pinned by digest (ops skill), so its CPA version is unknown and may predate `v8.0.37`. Everything below comes from source and docs. The live checks that would settle the open points are listed at the end.

## How CPA routes

CPA routes by model name, not by endpoint. The endpoint only picks the wire format. Translators live at `internal/translator/<upstream>/<client-format>`.

| Endpoint | Format | To Codex | To Claude |
| --- | --- | --- | --- |
| `POST /v1/responses` | OpenAI Responses | near-passthrough | translated (`claude/openai/responses`) |
| `POST /v1/chat/completions` | OpenAI Chat | translated (`codex/openai/chat-completions`) | translated (`claude/openai/chat-completions`) |
| `POST /v1/messages` | Anthropic Messages | translated (`codex/claude`) | passthrough plus cloaking |
| `GET /v1/models` | OpenAI or Anthropic list, picked by header | | |

Source: CPA: [`internal/api/server_routes.go#L67-L90`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/api/server_routes.go#L67-L90).

The two native pairings carry the most: Codex through `/v1/responses` with `@ai-sdk/openai`, and Claude through `/v1/messages` with `@ai-sdk/anthropic`. The matrix assumes those. Cross pairings work but go through translators; see "Other routes" below.

## Capability matrix

| | Codex via `/v1/responses` + `@ai-sdk/openai` | Claude via `/v1/messages` + `@ai-sdk/anthropic` |
| --- | --- | --- |
| Reasoning control | `reasoning.effort` passes through. Levels per CPA's registry: `low medium high xhigh` (gpt-5.5) or `low medium high xhigh max` (gpt-6.x, gpt-5.6). No `none`/`minimal` on current Codex models. Unsupported level returns 400. | `thinking: {type: "adaptive"}` + `output_config.effort` (`low medium high xhigh max`, varies by model). Legacy `budget_tokens` for 4.5-era models. Unsupported level returns 400. |
| Streamed reasoning | Yes. `response.reasoning_summary_text.delta` events pass through untouched. Only when `reasoning.summary` is set (`auto`/`detailed`). | Yes, but only with `thinking.display: "summarized"`. Omit it and CPA injects `display: "updates"` on Opus 5.5, Fable 5.1, Sonnet 5, Sonnet 5.5, which streams no reasoning text in a chat with no tool calls. |
| Web search | Yes. `{type: "web_search"}` passes through (`web_search_preview` renamed). `include: web_search_call.action.sources` kept. | Yes. `web_search_*` server tools pass through (empty domain lists stripped). Use `webSearch_20260318` or `_20250305`; `_20260209` needs a beta CPA may drop. |
| Images | Yes. `input_image` passes through. Send base64 data URLs. | Yes. `image` blocks pass through. Send base64. |
| PDF | Probably. `input_file` with `file_data` passes through; CPA's own Claude-to-Codex translator emits exactly that, but no first-party doc says the ChatGPT Codex backend accepts it. Verify live. | Yes. `document` blocks pass through (native Anthropic feature). |
| Text files | Inline as `input_text`. `@ai-sdk/openai` throws on `text/plain` file parts unless `passThroughUnsupportedFiles: true`, and Codex backend support for that is unknown. | Yes. `@ai-sdk/anthropic` sends `text/plain` as a `document` with a text source. |
| Model list | `GET /v1/models` (Bearer): every model CPA serves, Codex and Claude mixed, fields `id object created owned_by` only. Filter by `owned_by`. | Same endpoint with `anthropic-version` header: Anthropic shape (`display_name`, `max_input_tokens`, `max_tokens`, `created_at`). Non-`claude-` IDs get cloaked as `claude-fable-5-dd-<reversed id>` unless `disable-cloaking-model-list`. |
| AI SDK config | `createOpenAI({ baseURL: "https://llm.iadw.in/v1", apiKey })`, `openai.responses(id)`, `providerOptions.openai: { store: false, reasoningSummary: "auto" }`, `openai.tools.webSearch()`. | `createAnthropic({ baseURL: "https://llm.iadw.in/v1", apiKey })`, `providerOptions.anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort }`, `anthropic.tools.webSearch_20260318()`. |

Neither list endpoint reports reasoning levels, input types, or web search support. That fits the plan of Admin-set Model capabilities.

## Details and evidence

### Codex through `/v1/responses`

The request translator is close to a passthrough. It forces `stream: true`, `store: false`, `parallel_tool_calls: true`; rewrites `include` to `["reasoning.encrypted_content"]` plus `web_search_call.action.sources` if the caller asked; strips `max_output_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `user`, `truncation`, `context_management`, prompt cache fields; maps `system` role to `developer`; renames `web_search_preview*` to `web_search`. CPA: [`codex_openai-responses_request.go#L15-L63`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/responses/codex_openai-responses_request.go#L15-L63), [`#L118-L148`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/responses/codex_openai-responses_request.go#L118-L148), [`#L391-L398`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/responses/codex_openai-responses_request.go#L391-L398).

Consequences for chatslop:

- `maxOutputTokens` and `temperature` are silently dropped for Codex.
- Non-streaming calls (title generation with `generateText`) still work. CPA streams upstream and returns the `response.completed` payload. CPA: [`codex_openai-responses_response.go#L77-L98`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/responses/codex_openai-responses_response.go#L71-L98).
- Set `store: false` in the AI SDK. With the default `store: true`, `@ai-sdk/openai` replays earlier web search calls (and other stored items) as `item_reference` IDs, which point at nothing because CPA never lets the upstream store them. With `store: false` the SDK sends the full items and adds `reasoning.encrypted_content` itself. AI SDK: [`convert-to-openai-responses-input.ts#L1133-L1136`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai/src/responses/convert-to-openai-responses-input.ts#L1133-L1136), [`openai-responses-language-model.ts#L593-L598`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai/src/responses/openai-responses-language-model.ts#L593-L598). OpenAI documents encrypted reasoning items as the stateless path ([Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)). This is inferred from code; one live multi-turn request would confirm it.

Response events pass through unchanged; CPA only fills `response.model` on `response.created`/`in_progress`. CPA: [`codex_openai-responses_response.go#L15-L39`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/responses/codex_openai-responses_response.go#L15-L39).

Reasoning summaries are opt-in on the OpenAI side ("This output will not be included unless you explicitly opt in", [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)). `@ai-sdk/openai` defaults `reasoningSummary` to `detailed` whenever an effort other than `none` is set, so passing an effort is enough. AI SDK: [`03-openai.mdx#L276-L277`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/content/providers/01-ai-sdk-providers/03-openai.mdx#L276-L277). The SDK treats any `gpt-5+` ID as a reasoning model, so the Codex IDs (`gpt-6.1-sol` etc.) get `developer` system messages and reasoning params without `forceReasoning`. AI SDK: [`openai-language-model-capabilities.ts`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai/src/openai-language-model-capabilities.ts).

With `openai.tools.webSearch()` the SDK adds `include: ["web_search_call.action.sources"]`, which CPA keeps. AI SDK: [`openai-responses-language-model.ts#L585`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai/src/responses/openai-responses-language-model.ts#L585).

File parts: the SDK sends images as `input_image`, PDFs as `input_file` with a base64 `file_data`, and throws on other types unless `passThroughUnsupportedFiles` is on. AI SDK: [`convert-to-openai-responses-input.ts#L644-L710`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai/src/responses/convert-to-openai-responses-input.ts#L644-L710), [`03-openai.mdx#L212-L214`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/content/providers/01-ai-sdk-providers/03-openai.mdx#L212-L214). Codex PDF evidence is indirect: CPA converts Claude `document` PDFs to `{"type":"input_file","file_data":"data:application/pdf;base64,..."}` when routing to Codex. CPA: [`codex_claude_request.go#L165-L170`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/claude/codex_claude_request.go#L165-L170). Use data URLs, not Convex URLs: the upstream cannot reach a private Convex storage URL anyway.

### Claude through `/v1/messages`

No translator runs; the Claude executor edits the body. Relevant edits:

- **Cloaking.** By default CPA disguises any non-Claude-Code client as Claude Code. The top-level `system` becomes Claude Code's minimal prompt, and the caller's system blocks move to a mid-conversation system message after the first user turn (or a system reminder on older models). `disable-claude-cloak-mode: true` turns this off. CPA: [`claude_executor_cloaking.go#L318-L323`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/runtime/executor/claude_executor_cloaking.go#L318-L323), [`config.example.yaml#L436-L444`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/config.example.yaml#L436-L444). chatslop's system prompt still reaches the model, in a different slot.
- **Thinking display.** If the caller sets no `thinking.display`, CPA sets `"updates"` on Opus 5.5, Fable 5.1, Sonnet 5 and Sonnet 5.5. CPA: [`claude_executor_request.go#L419-L440`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/runtime/executor/claude_executor_request.go#L419-L440). Per Anthropic, `"updates"` returns empty thinking text except progress notes between tool calls, and `"omitted"` is already the default on every 5.x model. Only `"summarized"` streams reasoning text as `thinking_delta` ([Thinking: controlling display](https://platform.claude.com/docs/en/build-with-claude/thinking#controlling-thinking-display)). So chatslop must always send `display: "summarized"` when it wants reasoning shown.
- **Web search.** `web_search_*` tools pass through; CPA only deletes empty `allowed_domains`/`blocked_domains`. Built-in tools keep their names during OAuth tool renaming. CPA: [`claude_executor.go#L91-L117`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/runtime/executor/claude_executor.go#L91-L117), [`claude_executor_request.go#L2886-L2893`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/runtime/executor/claude_executor_request.go#L2885-L2892).
- **Beta headers.** On `api.anthropic.com`, CPA forwards only betas real Claude Code sends and drops the rest. CPA: [`config.example.yaml#L446-L454`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/config.example.yaml#L446-L454). `@ai-sdk/anthropic` adds `code-execution-web-tools-2026-02-09` for `webSearch_20260209`, while `_20250305` and `_20260318` need no beta. AI SDK: [`anthropic-prepare-tools.ts#L358-L400`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/anthropic/src/anthropic-prepare-tools.ts#L358-L380). Pick `_20260318`.

Thinking config in `@ai-sdk/anthropic`: `providerOptions.anthropic.thinking: { type: "adaptive", display: "summarized" }` plus `effort`. The portable top-level `reasoning: "low" | ... | "max"` maps to the same thing and sets `display: "summarized"` for adaptive models. AI SDK: [`anthropic-language-model.ts#L3612-L3628`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/anthropic/src/anthropic-language-model.ts#L3612-L3628), [`05-anthropic.mdx#L674-L696`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/content/providers/01-ai-sdk-providers/05-anthropic.mdx#L674-L696), [`26-reasoning.mdx`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/content/docs/03-ai-sdk-core/26-reasoning.mdx). Opus 5.5 and Sonnet 5.5 cannot turn thinking off ([Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking); AI SDK [`05-anthropic.mdx#L305-L319`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/content/providers/01-ai-sdk-providers/05-anthropic.mdx#L305-L319)), so a "reasoning off" option only applies to some Claude Models.

Text files: `@ai-sdk/anthropic` turns `text/plain` file parts into `document` blocks with a text source. AI SDK: [`convert-to-anthropic-prompt.ts#L471-L500`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/packages/anthropic/src/convert-to-anthropic-prompt.ts#L471-L500).

### Reasoning validation (both)

CPA checks the requested level against its model registry ([`models.json`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/registry/models/models.json), refreshed at runtime from `router-for-me/models`). On native same-family routes an unsupported level is a 400 (`level "x" not supported, valid levels: ...`), not a clamp. CPA: [`internal/thinking/validate.go#L56-L77`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/thinking/validate.go#L56-L77), [`#L135-L142`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/thinking/validate.go#L135-L142). Codex models flagged `support_configuration_update` (gpt-6 Astra/Sol/Luna, gpt-6.1-sol) skip validation on `/v1/responses` and go straight upstream. CPA: [`internal/thinking/apply.go#L269-L290`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/thinking/apply.go#L269-L290). Admin-set reasoning levels must match the registry, or users get 400s.

CPA also reads a level from a model-name suffix, `gpt-6.1-sol(high)`, which overrides the body. CPA: [`internal/thinking/suffix.go`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/thinking/suffix.go). Not needed with the AI SDK options above.

### Model list

`GET /v1/models` picks the format per request: `anthropic-version` header (or `claude-cli` user agent) gets the Anthropic shape, anything else the OpenAI shape. CPA: [`server_routes.go#L602-L645`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/api/server_routes.go#L602-L645).

- OpenAI shape keeps only `id`, `object`, `created`, `owned_by`. CPA: [`openai_handlers.go#L81-L108`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/sdk/api/handlers/openai/openai_handlers.go#L81-L108).
- Anthropic shape: `id`, `type`, `display_name`, `created_at`, `max_input_tokens`, `max_tokens`, plus `has_more/first_id/last_id`; non-Claude IDs cloaked. CPA: [`model_registry.go#L1763-L1788`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/registry/model_registry.go#L1763-L1788), [`client/claude/models/models.go#L12-L56`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/client/claude/models/models.go#L12-L56).
- `GET /v1/models?client_version=cpa` returns the Codex CLI catalog, which carries `supported_reasoning_levels`, `default_reasoning_level`, `input_modalities`, `context_window`, and `cpa_capabilities.web_search`. CPA: [`client/codex/models/models.go#L550-L559`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/client/codex/models/models.go#L548-L558). It is shaped for the Codex CLI and could seed Admin defaults, but it is an internal format that changes with Codex releases. I would not build on it.
- If the live config has `home.enabled`, both lists come from a different handler. Check.

### Auth

CPA accepts the client key as `Authorization: Bearer` or `x-api-key`. CPA: [`config_access/provider.go#L64-L83`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/access/config_access/provider.go#L64-L83). Both AI SDK providers work with `apiKey`. Both default `baseURL`s end in `/v1`, so point them at `https://llm.iadw.in/v1`. AI SDK: [`05-anthropic.mdx#L89-L104`](https://github.com/vercel/ai/blob/e6230e43ba9def164550eea562c457e23be9efa6/content/providers/01-ai-sdk-providers/05-anthropic.mdx#L89-L104).

### Other routes

- **`/v1/chat/completions` to Codex** (`openai.chat()` or `@ai-sdk/openai-compatible`). `reasoning_effort` maps to `reasoning.effort` (default `medium`); reasoning streams back as non-standard `delta.reasoning_content`, which `@ai-sdk/openai-compatible` reads and `openai.chat()` does not. Web search tools pass through, but citations have no Chat Completions field. CPA: [`codex_openai_request.go#L71-L84`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/chat-completions/codex_openai_request.go#L71-L84), [`codex_openai_response.go#L146-L153`](https://github.com/router-for-me/CLIProxyAPI/blob/ce07d189b3de2a39d37fd68ae093b102ce3aabee/internal/translator/codex/openai/chat-completions/codex_openai_response.go#L146-L153). Worse than Responses on every row.
- **Claude through `/v1/responses`** and **Codex through `/v1/messages`** both exist, with web search, PDF, and reasoning mapping. So one provider package could serve every Model. I'd keep the two native pairings: each translator layer is another place for a field to go missing, and the native routes need no translation.

## Open follow-ups (live checks, need Adwin's sign-off)

These hit `https://llm.iadw.in` with the client key. None changes state, but each one spends subscription quota.

1. `GET /v1/models` three ways: plain Bearer, with `anthropic-version: 2023-06-01`, and with `?client_version=cpa`. Confirms the live shapes, which Models are enabled, and whether IDs are cloaked.
2. Find the deployed CPA version (ops: `docker inspect cli-proxy-api` on nas, or `GET /v0/management/latest-version` with the management key) and read `config.yaml` for `disable-claude-cloak-mode`, `disable-cloaking-model-list`, `home.enabled`.
3. `POST /v1/responses`, `gpt-6.1-sol`, `stream: true`, `reasoning: {effort: "low", summary: "auto"}`. Expect `response.reasoning_summary_text.delta`.
4. Same, with `tools: [{type: "web_search"}]` and a news question. Expect `web_search_call` items and `url_citation` annotations.
5. Same, with an `input_file` PDF as a base64 `file_data` data URL. Settles Codex PDF support.
6. Two-turn `/v1/responses` through `@ai-sdk/openai` with web search, once with `store: true` and once with `store: false`. Confirms the `item_reference` failure and the fix.
7. `POST /v1/messages`, `claude-sonnet-5-5`, `stream: true`, `thinking: {type: "adaptive", display: "summarized"}`, `output_config: {effort: "low"}`. Expect `thinking_delta` events with text.
8. Same, with `tools: [{type: "web_search_20260318", name: "web_search"}]`. Confirms server web search on the Claude subscription.
9. Same, with a base64 PDF `document` block and a `text` source `document` block.
10. Same as 7 without `display`. Confirms CPA's `updates` injection leaves the reasoning panel empty.
