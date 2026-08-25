# Technical spec: xAI-only Pi compaction workaround

Date: 2026-08-25

Status: Implemented in this repository (`xai-compact.ts`). Not copied to `~/.pi/agent/extensions/` and not `/reload`.

## Objective

Khi Pi đang dùng model xAI `openai-responses`, `/compact`, auto-compact, overflow recovery, và `/tree` (khi user chọn summarize) **không** đi `completeSummarization` mặc định. Extension tự tóm tắt bằng `ctx.modelRegistry.complete()` **không** `toolChoice`, trả **summary text** đúng contract Pi.

Khi model hiện tại không phải xAI Responses, extension không can thiệp.

Người implement hoàn thiện file extension trong kho này. Spec này không cài vào `~/.pi/agent/extensions/` và không `/reload`.

## Non-goals

- Không gọi `POST https://api.x.ai/v1/responses/compact`.
- Không lưu hay replay `encrypted_content` / `{ type: "compaction" }`.
- Không vá `@earendil-works/pi-coding-agent` hay `pi-ai`.
- Không đổi `web_search.ts` / `x_search.ts`.
- Không share import, helper, hay entry point với hai extension search.
- Không compact “hộ” khi đang OpenAI / Anthropic / Gemini / Codex.
- Không hard-code `grok-4.6`; dùng `ctx.model` đang chọn.
- Không commit, copy extension, hay `/reload` trong work item spec này.

## Evidence baseline

Pi đã cài: `@earendil-works/pi-coding-agent@0.84.3`. Catalog xAI builtin: `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-build-0.1` — tất cả `provider: "xai"`, `api: "openai-responses"`, `baseUrl: https://api.x.ai/v1`.

| Claim | Grade | Source |
|---|---|---|
| Summarization luôn set `toolChoice: "none"` | Confirmed | `pi-coding-agent` `dist/core/compaction/compaction.js` → `completeSummarization` |
| Adapter gửi `tool_choice` dù không có `tools` | Confirmed | `pi-ai` `dist/api/openai-responses.js` → `buildParams` |
| xAI 400: `A tool_choice was set on the request but no tools were specified` | Confirmed | user error + xAI Responses validation |
| Turn chat/tool bình thường vẫn chạy vì có `tools` | Confirmed | cùng `buildParams`: `params.tools` chỉ khi `immediate.length > 0` |
| 0.84.3 đổi xAI sang Responses và “không expose tools khi compact” | Confirmed | `CHANGELOG.md` 0.84.3 |
| Hook `session_before_compact` có thể trả `compaction` text và bỏ default | Confirmed | Pi `docs/compaction.md`; `examples/extensions/custom-compaction.ts` |
| `complete()` không set `toolChoice` thì adapter không gửi `tool_choice` | Confirmed | `streamSimple` chỉ gán khi `options.toolChoice` defined; ví dụ custom-compaction không set field đó |
| Pi lưu compact là `CompactionEntry.summary` markdown, rebuild = summary + tin từ `firstKeptEntryId` | Confirmed | Pi `docs/compaction.md`, `docs/session-format.md` |
| Adapter Responses **không** convert `type: "compaction"` | Confirmed | `openai-responses-shared.js` `convertResponsesMessages` chỉ user / assistant / toolResult |
| xAI Context Compaction trả blob opaque, phải gửi nguyên item ở đầu `input` | Confirmed | xAI docs `developers/advanced-api-usage/context-compaction` (MCP 2026-08-25) |
| Compact native xAI không cứu request đã quá context | Confirmed | cùng trang xAI, mục Limits |
| `formatFileOperations` public export | Unknown | `serializeConversation` và `convertToLlm` **có** export; `formatFileOperations` không nằm trong `dist/index.d.ts` |
| Pi mới hơn 0.84.3 đã vá `tool_choice` | Unknown | không kiểm được release mới hơn trong session này |
| Thứ tự nhiều extension cùng hook compact | Unknown | nếu có handler khác trả compaction trước/sau, hành vi Pi không được chứng minh ở đây |

`docs/Context Compaction.md` trong kho này là bản vendor xAI — **tham khảo, không phải hợp đồng** cho workaround. Workaround bám contract Pi, không bám API compact native.

## Capability

| Capability | Current | Target | Impact |
|---|---|---|---|
| `/compact` trên Grok | 400 `tool_choice` không `tools` | Summary text, session tiếp tục | Unblock compact |
| Auto-compact (`threshold`) trên Grok | Cùng 400, có thể crash phiên dài | Cùng workaround | Tránh fail khi gần cửa sổ |
| Overflow recovery trên Grok | Compact default fail → không recover | Text summary từ conversation đã serialize | Cứu turn quá cửa sổ **theo kiểu Pi**, không dùng API native |
| `/tree` summarize trên Grok | Cùng `completeSummarization` | Hook `session_before_tree` | Tránh 400 khi đổi nhánh |
| Compact khi không phải xAI Responses | Default Pi | Không hook | Không đổi Claude/GPT |
| Compact native xAI blob | Không có trong Pi | Vẫn không có | Tradeoff cố ý |

## Activation

Chỉ xử lý khi **cả hai** đúng trên `ctx.model` của **lần compact đó**:

```ts
ctx.model?.provider === "xai" && ctx.model?.api === "openai-responses"
```

Không dùng `id.startsWith("grok")` một mình. Custom model xAI Responses cũng phải vào. Model xAI nếu ai đó khai `openai-completions` thì **bỏ qua** (không phải bug 0.84.3).

Không có `ctx.model` → bỏ qua (default Pi).

Đổi model giữa phiên: lần compact theo model **đang chọn**, không theo lịch sử.

## Runtime

```text
/compact | auto-compact | overflow
        │
        ▼
session_before_compact
        │
        ├─ không xAI Responses ──► return void
        │
        └─ xAI Responses
                │ serialize messagesToSummarize + turnPrefixMessages
                │ (convertToLlm + serializeConversation)
                │ nhét previousSummary + customInstructions nếu có
                │ complete(ctx.model, { messages }, {
                │   maxTokens, signal, cacheRetention: "none", sessionId: uuidv7()
                │ })
                │ KHÔNG tools, KHÔNG toolChoice
                │
                ├─ text ──► return { compaction: { summary, firstKeptEntryId, tokensBefore, usage, details? } }
                ├─ abort ──► return { cancel: true }
                └─ lỗi / rỗng ──► fallback máy (bắt buộc có summary) HOẶC cancel
                                   KHÔNG return void
```

`/tree`:

- Không xAI Responses → `return void`.
- xAI và `userWantsSummary !== true` → `return void` (đừng tự summarize).
- xAI và user muốn summary → cùng `complete()` không `toolChoice`; trả `{ summary: { summary, usage, details? } }`.
- Lỗi trên xAI: summary máy hoặc `{ cancel: true }`. Không `return void`.

Pi sau hook: ghi JSONL như compact bình thường. Lần chat sau gửi **summary markdown + tin giữ lại**. Không có blob xAI.

## Contract implementer phải giữ

### File sản phẩm

Một file mới, độc lập:

```text
xAI-pi/xai-compact.ts
```

Không import `web_search.ts` / `x_search.ts`. Xóa file này không được làm search extension hết load.

Cài đặt (khi user **riêng** yêu cầu copy/`/reload`):

```text
cp xai-compact.ts /root/.pi/agent/extensions/xai-compact.ts
```

### Imports cho phép (tối thiểu)

Từ `@earendil-works/pi-coding-agent`: `ExtensionAPI`, `convertToLlm`, `serializeConversation`.

Từ `@earendil-works/pi-ai`: `uuidv7` (như ví dụ Pi). Không bịa export khác.

Tự viết formatter file-ops trong file này nếu cần. Đừng import symbol không có trong `dist/index.d.ts`.

### LLM call

```ts
await ctx.modelRegistry.complete(
  ctx.model,
  { messages: summaryMessages }, // không field tools
  {
    maxTokens,          // bám reserveTokens của preparation.settings nếu có; trần hợp lý ≤ 8192
    signal: event.signal,
    cacheRetention: "none",
    sessionId: uuidv7(),
    // không toolChoice
  },
);
```

Lấy text từ `response.content` type `"text"`. Nếu có `toolCall` trong content → coi như fail, đi fallback máy.

Prompt: tóm tắt structured (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context). Giữ path/tên hàm/error. Tôn trọng `event.customInstructions`. Split turn: gộp `turnPrefixMessages`.

`details` nên `{ readFiles, modifiedFiles }` lấy từ `preparation.fileOps` nếu có, để lần compact sau còn tích lũy. Append block `<read-files>` / `<modified-files>` vào summary nếu làm được local.

### Cấm fallback default trên xAI

`return void` / summary rỗng trên xAI = Pi gọi lại `completeSummarization` = 400.

| Kết quả | Bắt buộc |
|---|---|
| Có text | Trả compaction/summary |
| `signal.aborted` | `{ cancel: true }` |
| Lỗi mạng/API/rỗng/toolCall | Summary máy: cắt `serializeConversation(...)` (ví dụ 8–16k ký tự) + notify error; **hoặc** `{ cancel: true }` + notify. Overflow (`reason === "overflow"`) **phải** ra summary máy, không cancel nếu còn có text cắt được |

Notify ngắn, không dump payload/credential.

### Không làm trong code

- `fetch` tới `/v1/responses/compact`
- Gán `summary = encrypted_content`
- `toolChoice: "none"` trên `complete()`
- Đổi model user sang Gemini/OpenAI để compact (ngoài scope; user chỉ muốn xAI)
- Log API key / headers

## Công thức `grok-4.6`

`thinkingLevelMap.off` là `null` → không tắt thinking. Compact trên 4.6 có thể tốn reasoning. Chấp nhận. Đừng giả `reasoning: "off"` nếu model không hỗ trợ.

## Phased work

Implemented in `xai-compact.ts` (2026-08-25): skeleton, happy path, fail-closed, tree, and docs. Copy/`/reload` still needs separate authorization.

1. **Skeleton** — done: `xai-compact.ts` hook hai event, gate xAI, non-xAI `return`.
2. **Happy path compact** — done: serialize + `complete()` + trả `compaction`.
3. **Fail-closed** — done: abort / lỗi / rỗng / overflow theo bảng trên.
4. **Tree** — done: `session_before_tree` cùng gate.
5. **Docs** — done: `README.md` hợp đồng file thứ ba; `AGENTS.md` / `ARCHITECTURE.md` trỏ file. Copy/`/reload` vẫn cần ủy quyền riêng.

Mỗi phase tự kiểm: `node --experimental-strip-types --check xai-compact.ts`. Syntax không chứng minh compact live.

## Acceptance (khi implement)

- Non-xAI: `/compact` vẫn default Pi.
- xAI Responses: `/compact` không còn 400 `tool_choice` / no tools.
- Overflow trên xAI: có `CompactionEntry` text hoặc cancel có chủ đích; không fallback 400.
- `/tree` summarize trên xAI: không 400.
- Session JSONL: `summary` đọc được như markdown, không phải blob.
- `web_search.ts` / `x_search.ts` không đổi.
- Không in credential.

Live smoke cần session Grok thật và compact thật — **không** thuộc work item spec này.

## Risks

- `complete()` trên Grok vẫn có thể fail khác (quota, timeout). Fail-closed bằng summary máy, không default Pi.
- Summary máy mất chất lượng so với LLM; overflow vẫn tốt hơn crash.
- Nhiều compact handler: hành vi không rõ. Extension này khi gate match phải **tự trả** compaction, không dựa handler khác.
- Pi upgrade vá `tool_choice` thì extension thừa nhưng vẫn an toàn nếu chỉ `complete()` không `toolChoice`.
- Copy vào `~/.pi/agent/extensions/` là mutation runtime — chỉ khi user yêu cầu đúng hành động.

Recovery: xóa `xai-compact.ts` khỏi kho và/hoặc khỏi `~/.pi/agent/extensions/` rồi `/reload`. Search extension không bị ảnh hưởng.

## Open questions (không chặn spec)

- Trần `maxTokens`: đã chọn `min(8192, floor(0.8 * reserveTokens), model.maxTokens when > 0)`; compact lấy `preparation.settings.reserveTokens`, `/tree` dùng reserve 16384. Ghi trong README.
- Có nên `session_compact_failed` chỉ để notify? Không bắt buộc cho workaround. Không implement.

## Definition of done (spec này)

- [x] Spec nằm `docs/plans/active/xai-compact-workaround-spec.md`
- [x] `xai-compact.ts` trong kho
- [x] README / AGENTS / ARCHITECTURE trỏ file thứ ba
- [ ] Copy vào `~/.pi/agent/extensions/` và `/reload` — cần ủy quyền riêng
