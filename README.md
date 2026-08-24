# xAI Pi Search Extensions

Two independent Pi extensions for hosted search tools. `web_search` follows the active Grok or `openai-codex` model; `x_search` uses xAI directly.

## Files

- `web_search.ts` registers only `web_search`. It uses the provider, model, effective base URL, and authentication of Pi's active model at execution time.
- `x_search.ts` registers only `x_search`. It uses xAI's native `x_search` Responses tool through the direct xAI API.

The files intentionally share no imports, helper modules, runtime state, or package entry point. Removing or changing either extension does not prevent the other from loading.

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

Both tools are read-only research tools. They use a 120-second request timeout, a 2 MiB response-body limit, bounded citations, and Pi's standard 50 KB/2000-line result truncation. Grok `web_search` and `x_search` additionally send an 8192-token output cap; the Codex backend rejects `max_output_tokens`, so the Codex path omits it. Credentials are never stored or logged by these extensions.

## Official references

- `docs/ARCHITECTURE.md` — sơ đồ luồng và bản đồ tài liệu
- `docs/web_search.md`
- `docs/x_search.md`

## Installation

Copy each extension independently into Pi's global extension directory:

```sh
cp web_search.ts /root/.pi/agent/extensions/web_search.ts
cp x_search.ts /root/.pi/agent/extensions/x_search.ts
```

Run `/reload` in an active Pi session or start a new Pi process afterward.

## Validation

Syntax-check each file independently:

```sh
node --experimental-strip-types --check web_search.ts
node --experimental-strip-types --check x_search.ts
```

A live `web_search` smoke test additionally requires valid authentication managed outside this repository and either an active Grok model using an OpenAI Responses-compatible provider whose endpoint supports xAI's native `web_search`, or an authenticated `openai-codex` model. Syntax-checking the Codex path is not proof that hosted search or citations ran. A live `x_search` smoke test requires configured `xai/grok-4.6` authentication. Live API calls may incur provider usage charges.
