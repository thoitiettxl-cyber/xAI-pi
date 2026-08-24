<!-- pi-continuity-work-document: {"schemaVersion":1,"kind":"execution-plan","workItemId":"b41a5516-8469-4d90-8d3d-10d44d1c7c81","templateVersion":1} -->

# Execution Plan: Technical spec: web_search openai-codex backend

Date: 2026-08-24

## Status

Active

## Outcome

Repository-owned technical spec for adding an `openai-codex` backend to the existing `web_search` tool, without implementing the change in this work item.

## Authority And Context

- User request: `Lập spec kỹ thuật`.
- Grill-with-docs decisions: Q1=A, Q2=A, Q3=A, Q4=A. User then required finishing the Codex field table and concluding instead of re-asking mapping questions.
- Current implementation: `web_search.ts` is Grok + `openai-responses` only; JSON POST to `<baseUrl>/responses` with xAI `web_search` fields.
- Pi `openai-codex`: provider `openai-codex`, API `openai-codex-responses`, base `https://chatgpt.com/backend-api`, endpoint `/codex/responses`, ChatGPT Plus/Pro OAuth. Required headers: `Authorization`, `chatgpt-account-id`, `originator`, `OpenAI-Beta`. Transport: WebSocket with SSE fallback, not a non-streaming JSON POST.
- Live field probes (2026-08-24, `gpt-5.4-mini`, POST `https://chatgpt.com/backend-api/codex/responses`, SSE, `tool_choice=none`): accepted `type=web_search`, `filters.allowed_domains`, `filters.blocked_domains`, `search_context_size`, `user_location`, `search_content_types`; rejected `filters.excluded_domains`, `enable_image_understanding`, `enable_image_search` (`unknown_parameter`) and `type=web_search_2025_08_26` (unsupported tool type).
- First post-reload live smoke (2026-08-24, active `openai-codex`, `web_search` with `allowed_domains=["nodejs.org"]`) reached the Codex endpoint but returned HTTP 400 `Unsupported parameter: max_output_tokens`. Codex requests must omit `max_output_tokens`; Grok keeps the existing cap.
- Second post-reload smoke passed request validation but ended with `The provider completed the request without output text`. The implementation had only inspected the terminal event's `response`; Codex output must also be reconstructed from `response.output_item.*`, `response.output_text.*`, `response.content_part.done`, and annotation events when terminal `response.output` is absent.
- Third post-reload smoke succeeded with active `openai-codex`: query constrained to `allowed_domains=["nodejs.org"]` returned `Node.js Current v26.7.0` and a citation to `https://nodejs.org/en/download/current/?utm_source=openai`. This confirms one live Codex model/path executes hosted search and returns parseable citations; it does not prove every Codex model.
- Installed OpenAI SDK `WebSearchTool` types expose `type: web_search | web_search_2025_08_26`, `filters.allowed_domains`, `search_context_size`, `user_location`. They do not type `blocked_domains` or xAI image flags.
- Schema accept is not proof of live search or citations.

## Scope

In scope:

- Write one reviewable technical spec in this execution-plan document.
- Document current vs target request path, auth, field mapping, failure behavior, and acceptance for a future implementer.
- Keep public tool parameters unchanged.
- Record evidence grades and explicit non-blocking assumptions.

Out of scope:

- Do not modify `web_search.ts`, `x_search.ts`, or installed extensions.
- Do not add provider `openai` API-key support.
- Do not add OpenAI-only public parameters.
- Do not run live smoke search.
- Do not commit, push, deploy, or `/reload`.

## Constraints

- Public schema stays `query`, `allowed_domains`, `excluded_domains`, `enable_image_understanding`, `enable_image_search`; max 5 domains; allow/exclude mutually exclusive.
- Grok path must keep the current xAI request shape and `openai-responses` `/responses` JSON POST.
- Codex path must use `/codex/responses`, Codex headers, and `type=web_search` only.
- Never send `filters.excluded_domains`, `enable_image_understanding`, `enable_image_search`, or `max_output_tokens` to Codex.
- Map `excluded_domains` to `filters.blocked_domains` on Codex.
- On Codex, `enable_image_*` must fail clearly before the request.
- No Grok fallback when Codex fails.
- Do not log or print credentials.
- Future implementation verification is `node --experimental-strip-types --check web_search.ts` plus contract/docs review unless live smoke is separately authorized.

## Approach

This document *is* the technical spec. A later implementation needs a new authorization and should follow the work units below without changing the public contract.

## Risks And Recovery

- Schema accept does not prove hosted search runs or returns citations. Future live smoke is a separate authorization.
- Codex backend may differ by model; probes used only `gpt-5.4-mini`. Treat schema as backend-level until a second model contradicts it.
- If this spec is wrong, revise the document before any code change.
- Auth refresh during a future live test can rotate OAuth tokens; never print secrets.
- Recovery for a bad future implementation: revert `web_search.ts` and docs to the Grok-only contract. Recovery for a bad spec: edit this file only.

## Progress

- [x] Record the evidence baseline.
- [x] Write the capability gap matrix and Codex request/response mapping.
- [x] Write phased work units for a future implementation without executing them.
- [x] State confirmed decisions, out-of-scope items, risks, and acceptance evidence.
- [ ] Future implementation of `web_search.ts` (not authorized by this work item).
- [ ] Future contract/docs update of `README.md` (only when implementation is authorized).

## Decisions

- Dual-backend by active model: Grok stays; `openai-codex` is a second backend.
- Provider `openai` (API key / `api.openai.com`) is out of this round.
- Public xAI parameter names stay. Codex maps `excluded_domains` → `filters.blocked_domains` and rejects image flags.
- Acceptance for implementation is syntax plus contract review, not live smoke, unless separately authorized.
- This work item publishes the spec only.

Promote lasting product or architecture decisions into repository-owned decision documentation only after authority exists.

## Validation

- This file exists under `docs/plans/active/` and contains outcome, evidence baseline, gap matrix, field mapping, decisions, non-goals, and acceptance.
- The spec does not claim live search or citation proof.
- No product source files were modified.

## Result

Spec authored in this document. Implementation remains unauthorized.

---

# Technical spec

## 1. Objective and non-goals

**Objective:** When Pi's active model is `openai-codex` (`openai-codex-responses`), the existing `web_search` tool must call hosted `web_search` on that model. When the active model is Grok + `openai-responses`, behavior stays as today.

**Non-goals:**

- New tool name or second extension file.
- Provider `openai` Platform API-key path.
- Exposing `search_context_size`, `user_location`, or `search_content_types` on the public tool schema.
- Feature parity for image understanding / image search on Codex.
- Client-side crawling or a Grok fallback after Codex failure.
- Live proof that Codex actually searches or returns citations.

## 2. Evidence baseline and confidence

| Claim | Grade | Source |
|---|---|---|
| Current tool requires Grok id + `openai-responses`, POST JSON `<baseUrl>/responses`, xAI tool fields | confirmed | `web_search.ts` plus live `grok-4.6` matrix after the dual-backend install |
| Public params: `query`, mutually exclusive domain lists max 5, two image flags | confirmed | `webSearchParameters` in `web_search.ts`; `README.md`; `docs/web_search.md` |
| Limits: 120s, 2 MiB, 8192 output tokens, citation cap 50, Pi truncate 50KB/2000 lines | confirmed | `web_search.ts` constants + `truncateHead` |
| Parser does not require `web_search_call`; uses `output_text` + annotations/`citations` | confirmed | `extractResult` |
| `openai-codex` is a distinct Pi provider with OAuth and `/codex/responses` | confirmed | installed `openai-codex.js`, `openai-codex-responses.js` |
| Codex rejects `store: true`; default stream is true; SSE headers include `OpenAI-Beta: responses=experimental` | confirmed | `openai-codex-responses.js` comments and `buildSSEHeaders` |
| Account id comes from JWT claim `https://api.openai.com/auth`.chatgpt_account_id | confirmed | `extractAccountId` in `openai-codex-responses.js` |
| Codex request schema accepts `type=web_search` and listed OpenAI-shaped fields | confirmed | live probes, `tool_choice=none`, HTTP 200 `response.created` |
| Codex rejects xAI `filters.excluded_domains` and `enable_image_*` | confirmed | live probes, HTTP 400 `unknown_parameter` |
| Codex rejects `web_search_2025_08_26` | confirmed | live probe, HTTP 400 unsupported tool type |
| Codex rejects top-level `max_output_tokens` | confirmed | post-reload live `web_search` smoke, HTTP 400 unsupported parameter |
| Installed SDK types omit `blocked_domains` | confirmed | `WebSearchTool.Filters` in installed `responses.d.ts` |
| Codex hosted search runs and returns citations on the tested active model/path | confirmed | third post-reload live `web_search` smoke with `allowed_domains=["nodejs.org"]` |
| Live Grok `grok-4.6` path still searches, honors public domain filters, accepts image flags, and returns citations | confirmed | post-switch live Grok matrix: unrestricted multi-source, `NODEJS.ORG.` allow-list, `excluded_domains=["nodejs.org"]`, `example.com` insufficient source, `enable_image_search` Markdown embed, `enable_image_understanding` homepage image description |
| All Codex catalog models share this tool schema | inferred | one model probed (`gpt-5.4-mini`); treat as backend-level until contradicted |

## 3. Domain language

| Term | Meaning in this spec |
|---|---|
| Active model | `ctx.model` at `web_search` execute time |
| Grok backend | Current path: Grok id + `openai-responses` + `/responses` + xAI tool object |
| Codex backend | `provider === "openai-codex"` and `api === "openai-codex-responses"` + `/codex/responses` + OpenAI-shaped tool object |
| Public parameters | Tool schema the model calling `web_search` sees |
| Wire fields | JSON sent to the nested Responses/Codex endpoint |
| Schema accept | HTTP 200 and a `response.created` (or equivalent) event; not search proof |

Do not call ChatGPT OAuth "OpenAI API". Provider `openai` is a different Pi provider.

## 4. Gap matrix

| Capability | Current | Target | Evidence | Intentional? | Impact | Dependencies | Risk / reversibility | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Tool available on Codex active model | Fail in `assertCompatibleModel` | Accept `openai-codex` + `openai-codex-responses` | `web_search.ts` | No; current Grok-only gate | User on Codex cannot search | Routing | Revert compat check | Codex model no longer rejected before fetch |
| Nested endpoint | `<baseUrl>/responses` | Codex: `<baseUrl>/codex/responses` unless already suffixed | `responsesEndpoint` vs `resolveCodexUrl` | Yes if left Grok-only | Wrong path 404/400 | Routing | Revert URL helper | Codex URL matches Pi resolver rules |
| Auth / headers | Bearer from registry; Accept JSON | Codex: Bearer + `chatgpt-account-id` + `originator` + `OpenAI-Beta`; do not forward arbitrary extra headers blindly | `resolveRequest` vs `buildBaseCodexHeaders` | No | 401/400 | Registry `getApiKeyAndHeaders` + JWT account id | Revert header builder | Request uses Codex header set; secrets not logged |
| Transport | Non-stream JSON POST | Codex: `stream: true`, parse SSE (WebSocket optional) | current `fetch` vs Pi Codex client | No | JSON parse fail or hang | SSE reader | Revert to Grok-only | Completed Codex body feeds existing extractor or clear error |
| Wire `type` | `web_search` | `web_search` only; never `web_search_2025_08_26` | live probe | Keep | 400 if versioned type used | Tool builder | Low | Codex builder emits `type=web_search` |
| `allowed_domains` | `filters.allowed_domains` | Same on both backends | live probe + current builder | Keep | Allow-list works on Codex at schema layer | Domain normalize | Low | Same public field; Codex wire uses `filters.allowed_domains` |
| `excluded_domains` | `filters.excluded_domains` | Grok unchanged; Codex `filters.blocked_domains` | live 400 vs accepted `blocked_domains` | Yes: name change is backend-only | Exclude would 400 if unmapped | Tool builder | Revert mapping | Codex never sends `excluded_domains` |
| Image flags | xAI wire fields | Grok unchanged; Codex pre-request error | live 400 | Yes | Clear fail vs silent drop | Param check | Low | Error message names the unsupported flags |
| OpenAI-only extras | Absent | Do not add to public schema; do not send unless a later spec says so | Q3=A | Yes | Smaller surface | None | N/A | Public schema unchanged |
| Citations | Parse annotations + `citations` | Reuse parser; still do not require `web_search_call` | `extractResult` | Keep | Unknown whether Codex emits same shape | SSE complete payload | Parser stays conservative | No new hard dependency on a call item |
| Fallback | N/A | No Grok fallback on Codex failure | Q1=A | Yes | Avoid second credential/cost | None | N/A | Codex errors stay Codex errors |

## 5. Target behavior

### 5.1 Routing

```
if no ctx.model → error
else if Grok id && api == openai-responses → Grok backend
else if provider == openai-codex && api == openai-codex-responses → Codex backend
else → error naming provider/id/api
```

Grok detection stays the existing `GROK_MODEL_ID_PATTERN`. Do not treat every `openai-responses` model as Grok.

### 5.2 Public parameter contract (unchanged)

- `query`: required, trimmed, 1–4000, non-blank.
- `allowed_domains` / `excluded_domains`: optional, max 5 unique after normalize, mutually exclusive, hostname-only rules already in `normalizeDomain`.
- `enable_image_understanding` / `enable_image_search`: optional booleans.
- Additional properties forbidden.

Backend-specific handling happens after this validation.

### 5.3 Grok wire object (unchanged)

```json
{
  "type": "web_search",
  "filters": { "allowed_domains": ["example.com"] },
  "enable_image_understanding": true,
  "enable_image_search": true
}
```

`filters` omitted when neither list is present. Image keys omitted when unset.

### 5.4 Codex wire object

Allowed:

```json
{
  "type": "web_search"
}
```

```json
{
  "type": "web_search",
  "filters": { "allowed_domains": ["example.com"] }
}
```

```json
{
  "type": "web_search",
  "filters": { "blocked_domains": ["example.com"] }
}
```

Forbidden on the wire (must not be serialized):

- `filters.excluded_domains`
- `enable_image_understanding`
- `enable_image_search`
- `type: web_search_2025_08_26`
- top-level `max_output_tokens`

If the caller set `enable_image_understanding` or `enable_image_search` on the Codex backend, throw before `fetch`. The message must say Codex/`openai-codex` does not accept those fields.

Do not send `search_context_size`, `user_location`, or `search_content_types` in this round even though Codex schema-accepted them.

### 5.5 Codex HTTP request

- Method: `POST`
- URL: same rules as Pi `resolveCodexUrl`: effective base from registry (`resolved.baseUrl ?? model.baseUrl`); if it already ends with `/codex/responses` keep it; if it ends with `/codex` append `/responses`; otherwise append `/codex/responses`.
- Headers:
  - `Authorization: Bearer <access token>` from `getApiKeyAndHeaders` (apiKey or Authorization header)
  - `chatgpt-account-id` from JWT claim `https://api.openai.com/auth`.chatgpt_account_id
  - `originator: pi`
  - `OpenAI-Beta: responses=experimental`
  - `Accept: text/event-stream`
  - `Content-Type: application/json`
- Body (minimum interoperability set):
  - `model: model.id`
  - `store: false`
  - `stream: true`
  - `input`: same user-language instruction currently used
  - `tools`: one Codex wire object
- Do not send `max_output_tokens`; the live Codex backend rejects it as unsupported. Grok keeps `outputTokenLimit`.
- Timeout: 120s via `AbortSignal.timeout` composed with the tool signal.
- Response body cap: 2 MiB while reading SSE.

Do not invent a WebSocket client unless JSON/SSE proves insufficient. Pi itself prefers WebSocket then SSE; this extension may start with SSE only.

### 5.6 Codex response handling

1. Non-2xx: parse JSON error if present; throw `openai-codex web_search failed (HTTP N): <redacted message>` using existing `apiErrorMessage` / `safeErrorMessage`.
2. 2xx SSE: accumulate until a terminal event (`response.completed`, `response.failed`, `response.incomplete`, or `error`). Reconstruct the Response object from the completed event (or equivalent assembled output) and pass it through `extractResult`.
3. Keep current refusal / empty-text errors.
4. Do not require `web_search_call`.
5. If the stream ends without output text, fail clearly. Do not pretend search succeeded.
6. Reuse `renderResult`, citation caps, usage parsing, and details shape. `details.endpoint` must be the Codex URL. `details.provider` / `details.model` stay the active model.

### 5.7 Failure matrix

| Condition | Behavior |
|---|---|
| No active model | Error |
| Neither Grok nor Codex compat | Error with provider/id/api |
| Codex + image flags | Error before network |
| Codex + both domain lists | Existing mutual-exclusion error |
| Registry auth fail | Existing resolve error |
| JWT missing account id | Error; do not send the request |
| HTTP 4xx/5xx | Surface provider message, redacted |
| Timeout / abort | Existing timeout/cancel errors |
| Codex 2xx but no text | Existing empty-output error |
| Codex fail after accept | No Grok retry |

## 6. Priorities and sequencing

Uncertainty reduction (field probes) is already done for request schema. Remaining unknown is live search/citations; it is gated and not required to implement the dual-backend contract.

Implementation order, when later authorized:

1. Routing + Codex tool mapping + pre-request image-flag errors (unit-testable without network).
2. Codex URL/headers/SSE read + reuse `extractResult`.
3. Description / `README.md` contract text.
4. `node --experimental-strip-types --check web_search.ts`.

Do not invert 1 and 2: a Codex HTTP client without mapping will 400 on current xAI fields.

## 7. Future work units

These units are for a later authorized implementation. They are not part of this work item's completion.

### Unit A — Compat and mapping

- Objective: classify backend; build the correct tool object; reject Codex image flags.
- Dependencies: none.
- Deliverable: functions in `web_search.ts` only.
- Acceptance: Grok builder output unchanged for current fixtures; Codex builder never emits forbidden fields; image flags throw.
- Rollback: delete the new branch logic.

### Unit B — Codex transport

- Objective: POST SSE to `/codex/responses` with Codex headers and parse a completed response.
- Dependencies: A.
- Deliverable: `resolveRequest` / execute path split.
- Acceptance: wrong API still fails before fetch; Codex path uses `/codex/responses` and does not log secrets.
- Rollback: restore single Grok `fetch`.

### Unit C — Contract text

- Objective: tool description + `README.md` `web_search` section describe Grok or `openai-codex`.
- Dependencies: A.
- Deliverable: docs + `description` / `promptSnippet`.
- Acceptance: docs no longer say Grok-only.
- Rollback: restore previous strings.

### Unit D — Mandatory verification

- Objective: repository-required syntax check.
- Dependencies: A–C.
- Acceptance: `node --experimental-strip-types --check web_search.ts` passes.
- Live smoke: only if a later request authorizes it.

## 8. Confirmed decisions and constraints

1. Search backend = active model (not a detached xAI call while chatting on Codex).
2. Keep Grok; add Codex.
3. No `openai` API-key provider this round.
4. Public schema unchanged.
5. Codex exclude mapping is `blocked_domains`.
6. Codex image flags are hard errors.
7. No Grok fallback.
8. Implementation acceptance is syntax + contract review.
9. This work item does not implement code.

## 9. Open questions

**Blocking for this spec:** none.

**Non-blocking for a future implementation:**

- Does a completed Codex `web_search` response include `output_text` annotations compatible with `extractResult`? Owner: implementer during an authorized live smoke.
- Do other Codex models reject fields that `gpt-5.4-mini` accepted? Owner: implementer if a specific model fails.
- Should SSE-only suffice, or must WebSocket be added? Owner: implementer if SSE is rejected in production.

## 10. Unconfirmed or out of scope

- Live search, citations, `sources_used`, image embeds on Codex.
- `search_context_size` / `user_location` / `search_content_types` as public or defaulted wire fields.
- Combining allow + block lists (public contract stays mutually exclusive).
- Raising the domain cap from 5.
- Provider `openai`, Azure, Copilot, or proxies.
- `x_search` changes.

## 11. Definition of done

**This work item:** spec sections 1–10 are in this file; product source is untouched; the spec does not claim live Codex search.

**A future implementation (separate authorization):** Units A–D done; Grok behavior preserved; Codex uses the mapping in §5; `node --experimental-strip-types --check web_search.ts` passes; README/tool text match the dual-backend contract.
