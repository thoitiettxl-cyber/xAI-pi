<!-- pi-continuity-work-document: {"schemaVersion":1,"kind":"execution-plan","workItemId":"5a337d98-add2-492c-a180-96b2e8d28dd7","templateVersion":1} -->

# Execution Plan: Implement web_search openai-codex backend

Date: 2026-08-24

## Status

Active

## Outcome

web_search.ts accepts an active openai-codex model, sends the Codex-mapped hosted web_search request over SSE to /codex/responses, preserves the existing Grok path, and documents the dual-backend contract. Public tool parameters stay unchanged. The global Pi extension matches that repository file so the user can /reload.

## Authority And Context

- User request: Triển khai web-search-openai-codex-spec.md.
- Follow-up user request: Muốn dùng ngay. Tôi sẽ reload. This authorizes installing the repository file over /root/.pi/agent/extensions/web_search.ts. The user owns /reload.
- Deep-validation request: Chia nhiều loại test sâu. Mục đích kiểm tra hoạt động hoàn thiện. This authorizes bounded live Codex searches covering unrestricted search, allow/block domain mapping, multi-citation SSE output, and pre-network validation failures.
- Follow-up user request: đã chuyển sang grok-4.6 . Thực hiện chứng minh. This authorizes bounded live Grok validation of the preserved xAI path, including domain filters and Grok-only image flags.
- Follow-up user request: đã ổn. Tạo một AGENTS.md điểm vào nhỏ gọn, docs/ARCHITECTURE.md Sơ đồ quy trình làm việc và tài liệu của kho lưu trữ.
- Product authority: docs/plans/active/web-search-openai-codex-spec.md sections 1-11 and Units A-D.
- Grill-with-docs decisions already recorded in that spec: dual-backend by active model; no provider openai; public xAI parameter names stay; Codex maps excluded_domains to filters.blocked_domains; Codex image flags are pre-request errors; no Grok fallback.
- Current code: web_search.ts is Grok + openai-responses JSON POST only.
- Pi openai-codex: provider openai-codex, api openai-codex-responses, resolveCodexUrl suffix rules, ChatGPT OAuth headers, SSE with stream:true.
- Live schema probes in the spec remain request-schema evidence only, not live search proof.

## Scope

In scope:

- Update web_search.ts with Grok vs openai-codex routing, Codex tool mapping, Codex URL/headers, and SSE response handling.
- Update tool description/prompt text and README.md web_search contract.
- Run node --experimental-strip-types --check web_search.ts.
- Backup the current global extension and copy the repository web_search.ts to /root/.pi/agent/extensions/web_search.ts.
- Write a compact repository `AGENTS.md` pointer and `docs/ARCHITECTURE.md` workflow/doc map. Do not rewrite product contracts that already live in `README.md`.

Out of scope:

- Do not modify x_search.ts.
- Do not add provider openai API-key support.
- Do not add OpenAI-only public parameters.
- Do not send search_context_size, user_location, or search_content_types.
- Do not implement WebSocket unless SSE is proven insufficient.
- Do not /reload this Pi session; the user will reload.
- Live Codex smoke, bounded deep Codex validation, and bounded live Grok validation are authorized after the user switched the active model to grok-4.6.
- Commit and push are authorized by the follow-up request `commit + push`. No GitHub remote exists; create `thoitiettxl-cyber/xAI-pi` and push `main`.

## Constraints

- Public schema remains query, allowed_domains, excluded_domains, enable_image_understanding, enable_image_search; max 5 domains; allow/exclude mutually exclusive.
- Grok path keeps the current xAI request shape and /responses JSON POST.
- Codex path uses /codex/responses, Codex headers, type=web_search only, stream:true.
- Never send filters.excluded_domains, enable_image_*, or max_output_tokens to Codex.
- No Grok fallback when Codex fails.
- Do not log or print credentials, tokens, or JWT payloads.
- Files remain independent; no shared helper module.
- Acceptance is syntax check plus contract review, not live search proof.

## Approach

- Unit A: classify backend from ctx.model; build Grok vs Codex tool objects; reject Codex image flags before fetch.
- Unit B: resolve Codex URL/headers/account id; POST SSE; parse terminal events into extractResult; keep Grok JSON path unchanged.
- Unit C: update tool description/promptSnippet/guidelines and README.md web_search section for Grok or openai-codex.
- Unit D: run node --experimental-strip-types --check web_search.ts and review the dual-backend contract.
- Install: backup the Grok-only global file, copy the repository file, verify checksums and installed syntax. User reloads.

## Risks And Recovery

- Schema accept is not live search proof. Do not claim Codex citations work after syntax check.
- JWT account-id extraction can fail; abort before fetch with a clear error.
- SSE-only may be insufficient in production; stop at a clear error rather than adding WebSocket in this round.
- A mapping bug can 400 Codex or silently change Grok. Keep builders separate and review both request shapes.
- Recovery: revert web_search.ts and README.md to the Grok-only contract. Leave the spec document unchanged unless it is wrong.
- A bad global install can break web_search after reload. Restore /root/.pi/agent/extensions/web_search.ts.bak over the destination, then the user /reloads.

## Progress

- [x] Unit A: classify backend; Grok vs Codex tool builders; Codex image-flag errors before fetch.
- [x] Unit B: Codex URL/headers/account-id; SSE POST and terminal-event parse; Grok JSON path unchanged.
- [x] Unit C: tool description/prompt text and README.md dual-backend contract.
- [x] Unit D: syntax-check `web_search.ts` and contract review.
- [x] Record the verified result before finalization.
- [x] Install the repository file to /root/.pi/agent/extensions/web_search.ts with a .bak rollback. User reloads.
- [x] Run the first live Codex smoke and record HTTP 400 `Unsupported parameter: max_output_tokens`.
- [x] Install the corrective build that omits `max_output_tokens` on Codex.
- [x] User reloaded the first corrective build; second smoke reached completion but exposed missing SSE delta reconstruction.
- [x] Reconstruct Codex output/citations from output-item, text, content-part, and annotation events; install the second corrective build.
- [x] User reloaded the second corrective build; third live smoke returned a current answer and citation.
- [x] Run the deep Codex test matrix and record pass/fail/unproven boundaries.
- [x] Run the live Grok proof matrix and record pass/fail/unproven boundaries.
- [x] Add compact `AGENTS.md` and `docs/ARCHITECTURE.md`.
- [ ] Commit the repository and push to GitHub.

## Decisions

- Any explicitly provided Codex image flag, including `false`, is treated as set and rejected before auth/fetch.
- Codex request headers are a fixed allow-list. Registry extras are not forwarded.
- Codex base URLs still reject credentials, query, and fragment, matching the Grok URL safety check.
- Transport is SSE-only. No WebSocket client was added.
- Live backend evidence overrides the earlier speculative request body: Codex omits `max_output_tokens`; Grok retains the 8192-token cap.

Promote lasting product or architecture decisions into repository-owned decision documentation only after authority exists.

## Validation

- `node --experimental-strip-types --check /root/code/xAI-pi/web_search.ts` passed with empty output.
- `continuity_validate` could not bind that command: not on the executable allow-list.
- Extra out-of-repo contract script `/tmp/web_search_codex_contract.ts` passed: incompatible models fail before fetch; Codex image flags fail before fetch; Grok still sends `filters.excluded_domains` plus image flags and no `stream`; Codex maps `excluded_domains` to `filters.blocked_domains`, sets `stream: true`, uses `/codex/responses`, allow-listed headers, and parses a completed SSE payload. Temporary `node_modules` symlinks were removed afterward.
- Public parameter schema is unchanged: `query`, `allowed_domains`, `excluded_domains`, `enable_image_understanding`, `enable_image_search`.
- README and tool description/prompt text describe Grok or `openai-codex`, not Grok-only.
- `x_search.ts` was not modified.
- First live Codex smoke reached the backend but failed before search with HTTP 400 `Unsupported parameter: max_output_tokens`; this disproved the original request-body assumption and did not prove hosted search or citations.
- Corrective source and installed `/root/.pi/agent/extensions/web_search.ts` match SHA-256 `d567f437041e6953480861b07eb4f8bc13b3c702165884e9c8b6019368fa0376`. Rollback `/root/.pi/agent/extensions/web_search.ts.bak` remains `5b96a66a7d87d9f927e55066689bfba0bee49a72b0cbe123a15c9fda6b2facbb`. Installed syntax check passed.
- Updated offline contract script passed and asserts Codex omits `max_output_tokens` while Grok keeps `max_output_tokens` and no `stream`.
- Second smoke passed HTTP/schema but failed with `The provider completed the request without output text`. Review against Pi's Responses parser localized the cause: terminal `response.output` can be absent while output arrives in SSE item/text events.
- The updated contract fixture now supplies `response.output_item.added`, text delta/done, annotation, output-item done, and a terminal response without output; reconstruction returns answer and citation. Syntax and contract checks passed.
- Second corrective source and installed extension match SHA-256 `03f2f347cdd57355de4d3aec280c1159faefeb312f17916d0c5d17f0d6e1c11a`. Original rollback remains `5b96a66a7d87d9f927e55066689bfba0bee49a72b0cbe123a15c9fda6b2facbb`.
- Third post-reload live smoke passed: active `openai-codex`, `allowed_domains=["nodejs.org"]`, answer `Node.js Current v26.7.0`, citation `https://nodejs.org/en/download/current/?utm_source=openai`.
- Deep live matrix passed:
  - unrestricted Vietnamese query returned three current ecosystem versions with separate citations from `nodejs.org`, `python.org`, and `blog.rust-lang.org`;
  - allow-list normalization accepted `NODEJS.ORG.` and returned only `nodejs.org` citations;
  - block-list excluded `nodejs.org` and returned a citation from `endoflife.date`, with no blocked-domain citation;
  - a 12-row Markdown release table completed with two official Node.js citations;
  - an insufficient-source query constrained to `example.com` reported that it could not verify the fact and did not escape the allow-list.
- Pre-network/schema guards passed with expected errors: allow+exclude conflict, both Codex image flags (including explicit `false`), scheme-bearing domain, blank query, six-domain overflow, and duplicate domain.
- Expanded offline contract passed: incompatible model and missing JWT fail before fetch; pre-aborted cancellation; HTTP 400 message propagation; malformed SSE; missing terminal event; 2 MiB declared-body limit; 50 KB output truncation; Codex SSE reconstruction; Grok/Codex wire-shape separation. The first expanded run failed only because the test expected `2 MB` while `formatSize` renders `2.0MB`; the expectation was corrected and the rerun passed.
- Final installed syntax check passed. Source and installed SHA-256 remain `03f2f347cdd57355de4d3aec280c1159faefeb312f17916d0c5d17f0d6e1c11a`; rollback remains `5b96a66a7d87d9f927e55066689bfba0bee49a72b0cbe123a15c9fda6b2facbb`.
- Live Grok `grok-4.6` matrix passed:
  - official Node.js Current allow-list returned v26.7.0 and a `nodejs.org` citation;
  - unrestricted Vietnamese query returned Node.js Current v26.7.0, Python 3.14.7, and Rust 1.98.0 with official-site citations;
  - allow-list normalization accepted `NODEJS.ORG.` and cited only `nodejs.org`;
  - `excluded_domains=["nodejs.org"]` returned a Wikipedia citation and no `nodejs.org` citation;
  - `allowed_domains=["example.com"]` reported the fact could not be verified from that source;
  - a Markdown release table of 8 Node.js versions completed with official citations;
  - `enable_image_search=true` returned a Markdown image embed of the Node.js logo;
  - `enable_image_understanding=true` ran without a Codex-style pre-request error and described the homepage hex logo;
  - pre-network/schema guards still failed correctly for allow+exclude, blank query, scheme-bearing domain, and duplicate domains;
  - a 5-domain allow-list was accepted. A 6-domain overflow was not re-invoked in this Grok session; that schema limit was already proven against the same public parameters on Codex.
- Not proven after the Grok switch: mid-flight cancellation/120-second timeout, chunked body overflow, live 50 KB truncation, alternate Grok or Codex models/base URLs, expired-token refresh, or WebSocket transport (not implemented). Pixel-level proof that `enable_image_understanding` inspected a fetched image (versus describing a known logo) was not independently established.

## Result

Implemented and installed the corrected dual-backend `web_search`. Codex and Grok live matrices passed their core cases. Compact `AGENTS.md` now points at `docs/ARCHITECTURE.md` and `README.md`; `docs/ARCHITECTURE.md` maps repository docs and runtime/install flows. Remaining unproven runtime boundaries are unchanged.
