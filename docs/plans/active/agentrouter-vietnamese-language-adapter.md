<!-- pi-continuity-work-document: {"schemaVersion":1,"kind":"execution-plan","workItemId":"fa973b4a-d154-4c08-b028-8863665609d2","templateVersion":1} -->

# Execution Plan: AgentRouter Vietnamese Language Adapter

Date: 2026-08-26

## Status

Active

## Outcome

Add a standalone Pi extension that transforms AgentRouter-bound conversational prose through the configured direct xAI sidecar, blocks detected unsafe Vietnamese residuals, and presents provider-scoped Vietnamese TUI translations without spoofing AgentRouter's harness gate.

## Authority And Context

- The user explicitly selected option B: a Vietnamese↔English Pi language adapter using xAI as the sidecar.
- AgentRouter-bound requests use provider id `agentrouter`; the sidecar must use Pi-managed xAI authentication and must not expose credentials.
- Pi 0.84.3 exposes `before_provider_request` for final serialized-payload replacement, `turn_end` after source-message persistence, and TUI-only custom entries that do not participate in LLM context.
- Repository contracts require each extension to remain standalone and prohibit copying it into the global extension directory or running `/reload` unless explicitly requested.

## Scope

In scope:

- Create one independent extension file for provider-scoped Vietnamese↔English translation.
- Translate conversational prose on a cloned final AgentRouter payload while preserving tool calls, identifiers, code, JSON, paths, and binary/image blocks.
- Append provider-scoped Vietnamese plain-text TUI entries after AgentRouter turns without replacing source assistant messages or entering LLM context.
- Fail closed before AgentRouter transmission when translation or the implemented residual detector classifies the payload unsafe.
- Document runtime contract, privacy/cost implications, installation opt-in, recovery, and validation.
- Add deterministic local validation or tests if the repository shape supports them without adding dependencies.

Out of scope:

- Spoofing curl, User-Agent, TLS fingerprints, or any AgentRouter harness/WAF bypass.
- Changing AgentRouter configuration, API keys, or upstream policies.
- Installing/copying the extension globally, reloading Pi, or modifying Android/managed services.
- Live API smoke tests or paid sidecar calls without separate authorization.
- General-purpose translation for providers other than `agentrouter`.

## Constraints

- No credentials may be stored, printed, or logged.
- Use the configured direct xAI provider/model through Pi's model registry; never route translation through AgentRouter.
- Keep the extension standalone with no imports from the repository's other extensions.
- Do not mutate persisted source messages in the pre-send translation path.
- Preserve unrelated work, including the existing untracked plan file.
- Repository-required syntax validation is `node --experimental-strip-types --check` for each changed extension.
- A safe fallback must replace payloads classified unsafe with an English sentinel and abort the active turn; the heuristic cannot prove all unaccented text is English.

## Approach

- Verify Pi model-registry completion, provider-payload, abort, message lifecycle, custom-entry, and renderer APIs from installed primary documentation and runtime source.
- Adapt the final `openai-completions` payload in a last-loaded `before_provider_request` handler rather than modifying persisted context or pinning a stale per-run system prompt.
- Use direct `xai/grok-4.6` for bounded batch translation with protected spans, a residual scan, abort, and an English-only sentinel.
- Keep provider replies intact and append durable provider-scoped TUI translation entries at `turn_end`; do not use the provider-blind Markdown transformer.
- Run syntax checks and deterministic behavior-focused validation without network calls.
- Review the final diff, record fresh validation evidence, and finalize only when repository proof passes.

## Risks And Recovery

- Translation can alter technical meaning or executable text; protect code/tool structures and make translation instructions strict and bounded.
- Tool results or repository context can contain Vietnamese outside ordinary prose; inspect every outgoing text block and fail closed when the implemented detector finds a residual.
- AgentRouter's classifier is undocumented; deterministic Unicode/word heuristics cannot prove absolute English-only output, especially for unlisted unaccented Vietnamese. State this limit and require live evidence before compatibility claims.
- Nested xAI translation adds latency, usage cost, and sends content to a second provider; document this explicitly and scope activation to AgentRouter.
- If the extension misbehaves, recovery is to stop loading or remove only this standalone extension; no other extension depends on it, and existing custom entries remain inert non-context session data.

## Progress

- [x] Draft the standalone extension, offline tests, and repository contract updates.
- [x] Run behavior-appropriate and repository-required proof.
- [x] Record the verified result before finalization.

## Decisions

- Translate at the final Chat Completions payload seam because Pi catches hook exceptions and continues, early abort is not always active, and a per-run system override can become stale.
- Scope activation to `agentrouter` + `openai-completions`; unknown payload roles/shapes fail closed.
- Require direct `xai/grok-4.6` at `https://api.x.ai/v1`; never translate through AgentRouter or a proxy.
- Preserve protected/technical data byte-for-byte; detected Vietnamese there, in tool output, raw JSON/code, or structural fields aborts instead of being rewritten.
- Keep persisted assistant/provider replay messages unchanged; assistant prose in the cloned outbound replay may be translated, and Vietnamese display text is stored only in non-context custom entries.
- Send all system/developer/user prose through the sidecar, including apparently English text, to avoid trusting the local unaccented-word heuristic as a pass-through authority; accept and document the added disclosure, latency, and cost.
- Use `turn_end` custom entries because Pi's Markdown transformer lacks provider/message identity and could transform another provider's identical text.
- Require the adapter to load after every other payload-mutating extension.

Promote lasting product or architecture decisions into repository-owned decision documentation only after authority exists.

## Validation

- Syntax-check the new extension with Node's TypeScript stripping.
- Run deterministic tests for provider gating, Vietnamese detection, protected segments, message-copy behavior, translation parsing, and fail-closed residual-language handling.
- Review git diff and status to ensure only authorized files changed and unrelated untracked work remains untouched.
- Do not claim live AgentRouter compatibility without a separately authorized authenticated smoke test.

Sequential offline proof after the latest adapter/docs changes:

- `node --no-warnings --experimental-strip-types --check web_search.ts` passed.
- `node --no-warnings --experimental-strip-types --check x_search.ts` passed.
- `node --no-warnings --experimental-strip-types --check xai-compact.ts` passed.
- `node --no-warnings --experimental-strip-types --check agentrouter-language-adapter.ts` passed.
- `node --no-warnings --experimental-strip-types --check agentrouter-language-adapter.test.ts` passed.
- `node --no-warnings --experimental-strip-types --test --test-concurrency 1 --test-reporter tap agentrouter-language-adapter.test.ts` passed 19/19.
- `pi --offline --no-extensions -e ./agentrouter-language-adapter.ts --list-models agentrouter` listed `gpt-5.6-sol`; no live translation or AgentRouter request was made.
- `git diff --check` passed with empty output.
- `git status --short` shows only authorized product files plus preserved unrelated untracked `docs/plans/active/commit-push-xai-compact.md`.
- Continuity still has unresolved uncertain operations, so this evidence does not grant checkpoint or plan-move authority.

## Result

Standalone adapter is in `agentrouter-language-adapter.ts` with offline coverage in `agentrouter-language-adapter.test.ts` and runtime contracts in `README.md` / `docs/ARCHITECTURE.md` / `AGENTS.md`. Sequential syntax, 19/19 offline tests, AgentRouter model listing, and diff/status review passed. Remaining limits: no authenticated live smoke, no global install/`/reload`/commit, and Continuity uncertain operations still block checkpoint/plan finalization. Unrelated untracked `docs/plans/active/commit-push-xai-compact.md` was left untouched.
