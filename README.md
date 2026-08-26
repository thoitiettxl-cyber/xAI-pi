# xAI Pi Extensions

Independent Pi extensions. `web_search` follows the active Grok or `openai-codex` model; `x_search` uses xAI directly; `xai-compact` intercepts xAI Responses compaction on Pi 0.84.3; `agentrouter-language-adapter` translates detected Vietnamese before AgentRouter Chat Completions requests.

## Files

- `web_search.ts` registers only `web_search`. It uses the provider, model, effective base URL, and authentication of Pi's active model at execution time.
- `x_search.ts` registers only `x_search`. It uses xAI's native `x_search` Responses tool through the direct xAI API.
- `xai-compact.ts` registers compaction and `/tree` summarization hooks. It uses Pi's active model only when that model is xAI `openai-responses`.
- `agentrouter-language-adapter.ts` adapts only `agentrouter` + `openai-completions` payloads through direct `xai/grok-4.6`; its test file is `agentrouter-language-adapter.test.ts`.

The extension files intentionally share no imports, helper modules, runtime state, or package entry point. Removing or changing one extension does not prevent the others from loading. The adapter test imports only its subject under test.

## Runtime contracts

### `web_search`

- Provider and model: read dynamically from `ctx.model`; neither value is hard-coded.
- Compatibility: the active model must be a Grok model using `openai-responses`, or `openai-codex` using `openai-codex-responses`.
- Endpoint:
  - Grok: `<effective active-model base URL>/responses`.
  - `openai-codex`: `<effective active-model base URL>/codex/responses`. If the base already ends with `/codex/responses`, it is kept; if it ends with `/codex`, `/responses` is appended.
- Authentication: resolved through Pi's model registry for that same active model. The Grok path forwards resolved provider headers. The `openai-codex` path sends only `Authorization`, `chatgpt-account-id`, `originator`, `OpenAI-Beta`, `Accept`, and `Content-Type`.
- Transport: Grok uses a non-streaming JSON POST. `openai-codex` uses `stream: true` SSE. Codex failures do not fall back to Grok.
- Answer language: follows the query unless the query requests another language.
- Native parameters:
  - `allowed_domains` or `excluded_domains`, mutually exclusive, maximum 5 domains;
  - `enable_image_understanding` and `enable_image_search` on Grok only. `openai-codex` rejects those flags before sending a request.
- On `openai-codex`, `excluded_domains` is sent as `filters.blocked_domains`. Image flags are never sent.
- Results retain citations and Markdown image embeds returned by the model.

For example, selecting `grok-4.5` makes the nested search request use `grok-4.5`; switching Pi to an `openai-codex` model uses that Codex model and `/codex/responses`. A model that is neither Grok + `openai-responses` nor `openai-codex` + `openai-codex-responses` fails before any search request is sent.

### `x_search`

- Provider: `xai`.
- Model: `grok-4.6`.
- API: `openai-responses`.
- Endpoint: `https://api.x.ai/v1/responses`.
- Authentication: resolved through Pi's model registry for xAI.

`x_search` records whether a native `x_search_call` item appeared, but does not require that optional telemetry item when valid output text is present.

Both search tools are read-only research tools. They use a 120-second request timeout, a 2 MiB response-body limit, bounded citations, and Pi's standard 50 KB/2000-line result truncation. Grok `web_search` and `x_search` additionally send an 8192-token output cap; the Codex backend rejects `max_output_tokens`, so the Codex path omits it. Credentials are never stored or logged by these extensions.

### `xai-compact`

- Activates only when **both** `ctx.model.provider === "xai"` and `ctx.model.api === "openai-responses"` on that compact or `/tree` attempt. Missing `ctx.model`, Codex, OpenAI, Anthropic, Gemini, and non-Responses xAI models are left to Pi's default path.
- Uses the active `ctx.model` (not a hard-coded `grok-4.6`).
- Hooks: `session_before_compact` (`/compact`, auto-compact, overflow recovery) and `session_before_tree` (only when `userWantsSummary === true`).
- Summarizes with `ctx.modelRegistry.complete()` and **no** `tools` / `toolChoice`, so the request does not reproduce Pi 0.84.3's xAI 400 (`tool_choice` without `tools`).
- `maxTokens = min(8192, floor(0.8 * reserveTokens), model.maxTokens when > 0)`. Compact uses `preparation.settings.reserveTokens`; `/tree` uses Pi's default reserve of 16384. Grok 4.6 may still spend reasoning tokens because `thinkingLevelMap.off` is `null`.
- On abort: `{ cancel: true }`. On provider error, empty text, or a tool call in the summary: a truncated serialized transcript (12k characters) so Pi does not fall back to `completeSummarization`. Overflow prefers that machine summary whenever any transcript text exists.
- Returned `summary` is markdown for Pi's `CompactionEntry` / branch-summary rebuild. This extension does not call `POST /v1/responses/compact` and does not store xAI `encrypted_content`.
- File-operation `details` are `{ readFiles, modifiedFiles }` when they can be collected locally, and matching `<read-files>` / `<modified-files>` blocks are appended to the summary text.

### `agentrouter-language-adapter`

- Activation requires both `ctx.model.provider === "agentrouter"` and `ctx.model.api === "openai-completions"`. Every other provider/API is returned untouched.
- Translation happens in `before_provider_request`, after Pi has serialized the OpenAI Chat Completions payload. The extension clones the payload; persisted source messages and provider metadata are not rewritten.
- The sidecar is fixed to Pi's configured `xai/grok-4.6` model using `openai-responses`. Both the model URL and any auth-resolved URL must equal `https://api.x.ai/v1`; missing auth, another model/API, or a proxy URL fails closed. The nested request has no tools or `toolChoice`.
- System/developer/user prose is sent through the English transform even when it appears English, so unaccented Vietnamese is not trusted solely to a local word list; the sidecar is instructed to copy already-English items byte-for-byte. Detected Vietnamese assistant replay prose and tool/schema descriptions are also translated. Images and data URLs pass through unchanged.
- Fenced/likely raw code, raw JSON, inline code, URLs, Markdown destinations, bare/qualified paths, CLI `<file>` attachments, and file-operation lists are protected byte-for-byte. Detected Vietnamese inside protected spans, tool results, tool-call arguments, paths, or other structural fields aborts the turn instead of altering exact technical data.
- After translation, a recursive residual scan checks normal strings, JSON-encoded strings, and `\\uXXXX` escapes. Any detected Vietnamese, malformed payload, sidecar error, missing placeholder, oversize request, or unexpected exception calls `ctx.abort()` and replaces the payload with an English-only minimal sentinel as defense in depth.
- This gate must be the **last** `before_provider_request` handler. Load the adapter as the last explicit extension; a later payload-mutating extension can invalidate its residual-language check.
- At `turn_end`, AgentRouter text (including prose accompanying tool calls) is translated asynchronously and appended as a provider-scoped, durable **plain-text TUI custom entry**. The source assistant/provider message is unchanged, and custom entries do not enter LLM context. Streaming first shows the provider-native response; non-interactive print/JSON modes do not render the custom TUI entry. Restored sessions retain entries already appended.
- Translation cache limits: 512 entries and 2,000,000 combined key/value characters. A source item is capped at 64,000 characters; each batch is capped at 80,000 characters / 32 items; each request allows at most four batches. Sidecar timeout is 120 seconds and output is capped at 65,536 tokens or the model limit.
- Privacy/cost: all system/developer/user prose selected by the adapter and AgentRouter assistant display prose are sent to xAI in addition to the transformed request sent to AgentRouter. Vietnamese display translations are persisted as TUI-only custom session entries. The extension stores no credentials and does not log payloads. Sidecar usage is billed by xAI but is not added to the AgentRouter assistant message's `usage` totals.
- The residual detector is deterministic for Vietnamese orthographic characters (including accents shared with other Latin languages) and conservative common unaccented phrases/word combinations, but it is not a language proof: unlisted unaccented Vietnamese or another unexpected language can evade it, and shared accents can be false positives. Offline tests prove only the implemented transform/gate policy, not AgentRouter's undocumented live classifier or an absolute English-only guarantee. Images are not OCR-translated.

Recovery is to stop loading only `agentrouter-language-adapter.ts`; the other extensions do not depend on it. Previously appended translation entries remain inert session data and never enter LLM context.

## Official references

- `docs/ARCHITECTURE.md` — sơ đồ luồng và bản đồ tài liệu
- `docs/web_search.md`
- `docs/x_search.md`
- `docs/plans/active/xai-compact-workaround-spec.md`
- `docs/plans/active/agentrouter-vietnamese-language-adapter.md`

## Installation

Copy each extension independently into Pi's global extension directory:

```sh
cp web_search.ts /root/.pi/agent/extensions/web_search.ts
cp x_search.ts /root/.pi/agent/extensions/x_search.ts
cp xai-compact.ts /root/.pi/agent/extensions/xai-compact.ts
```

Do not auto-discover the language adapter ahead of other payload hooks. Load it explicitly **last**, for example during a test launch:

```sh
pi -e /root/code/xAI-pi/agentrouter-language-adapter.ts
```

For persistent use, add that absolute path as the last configured extension instead of also copying it into an auto-discovery directory. Installation/configuration and `/reload` remain separate user-authorized actions.

Run `/reload` in an active Pi session or start a new Pi process afterward. Copying and `/reload` are separate user actions; they are not implied by editing this repository.

## Validation

Syntax-check each file independently:

```sh
node --experimental-strip-types --check web_search.ts
node --experimental-strip-types --check x_search.ts
node --experimental-strip-types --check xai-compact.ts
```

For the AgentRouter adapter:

```sh
node --experimental-strip-types --check agentrouter-language-adapter.ts
node --experimental-strip-types --check agentrouter-language-adapter.test.ts
node --experimental-strip-types --test agentrouter-language-adapter.test.ts
```

A live `web_search` smoke test additionally requires valid authentication managed outside this repository and either an active Grok model using an OpenAI Responses-compatible provider whose endpoint supports xAI's native `web_search`, or an authenticated `openai-codex` model. Syntax-checking the Codex path is not proof that hosted search or citations ran. A live `x_search` smoke test requires configured `xai/grok-4.6` authentication. A live `xai-compact` smoke test requires an active xAI `openai-responses` session and a real `/compact`, auto-compact, overflow, or `/tree` summarize. The adapter's offline tests do not prove AgentRouter's live language classifier, load ordering in a user's complete extension set, or authenticated xAI translation. Live API calls may incur charges from both xAI and AgentRouter.
