# Architecture

Bản đồ kho và luồng làm việc. Hợp đồng chi tiết nằm ở `README.md`. File này không thay thế spec hay README.

## Cây kho

```text
xAI-pi/
├── AGENTS.md                 # con trỏ cho agent
├── README.md                 # hợp đồng runtime
├── web_search.ts             # tool web_search, dual-backend
├── x_search.ts               # tool x_search, xAI trực tiếp
├── xai-compact.ts            # compact /tree workaround xAI Responses
├── agentrouter-language-adapter.ts      # Vietnamese → English wire adapter
├── agentrouter-language-adapter.test.ts # offline policy/hook tests
└── docs/
    ├── ARCHITECTURE.md       # tài liệu này
    ├── web_search.md         # tài liệu vendor Web Search
    ├── x_search.md           # tài liệu vendor X Search
    ├── grok-4.6.md           # ghi chú model (tham khảo)
    ├── Reasoning.md
    ├── Maximizing Cache Hits.md
    ├── What Breaks Caching.md
    ├── Context Compaction.md
    └── plans/active/         # spec hiện hành + kế hoạch; đọc Status/Result nếu file có
```

Bốn extension cố ý tách rời. Sửa hoặc xóa một file không được làm file kia hết load; test adapter chỉ import subject under test.

## Bản đồ tài liệu

| Câu hỏi | Đọc |
|---|---|
| Kho này làm gì? File nào là sản phẩm? | `README.md` |
| Agent nên đọc gì trước khi sửa? | `AGENTS.md` |
| Request đi đâu theo model? | mục Luồng runtime dưới đây |
| Tham số public / timeout / truncation | `README.md` |
| Shape API xAI gốc | `docs/web_search.md`, `docs/x_search.md` |
| Mapping Codex, SSE, lỗi đã chứng minh | `docs/plans/active/web-search-openai-codex-spec.md` |
| Workaround compact Grok (Pi 0.84.3) | `xai-compact.ts` và `docs/plans/active/xai-compact-workaround-spec.md` |
| Adapter tiếng Việt cho AgentRouter | `agentrouter-language-adapter.ts` và `docs/plans/active/agentrouter-vietnamese-language-adapter.md` |
| Việc hiện tại, bằng chứng, rollback | Việc hiện tại: kế hoạch còn việc trong `docs/plans/active/` (Status/Result nếu có); Spec Codex/compact không phải việc mở. Bằng chứng/rollback: file tương ứng, kể cả spec. |
| Ghi chú cache/reasoning Grok | các file `docs/*.md` còn lại — không phải hợp đồng sản phẩm |

Thứ tự ưu tiên khi lệch nhau: code đang chạy → `README.md` → spec trong `docs/plans/active/` → tài liệu vendor → ghi chú tham khảo.

## Luồng làm việc trong kho

```mermaid
flowchart TD
  start[Yeu cau] --> agents[AGENTS.md]
  agents --> arch[docs/ARCHITECTURE.md]
  arch --> readme[README.md hop dong]
  readme --> which{Tool nao?}
  which -->|web_search| ws[web_search.ts]
  which -->|x_search| xs[x_search.ts]
  which -->|compact xAI| xc[xai-compact.ts]
  which -->|AgentRouter Vietnamese adapter| ar[agentrouter-language-adapter.ts]
  ws --> spec[plans/active Codex spec neu dung backend]
  spec --> check[node --experimental-strip-types --check]
  xs --> check
  xc --> check
  ar --> check
  check --> live{Can live?}
  live -->|Khong| done[Bao cao syntax + review]
  live -->|Co va duoc phep| smoke[Smoke tren dung model]
  smoke --> done
```

Cài vào Pi chỉ khi người dùng yêu cầu:

```mermaid
flowchart LR
  src[File trong kho] --> ext["/root/.pi/agent/extensions/"]
  ext --> reload["/reload do nguoi dung"]
  reload --> runtime[Pi load extension]
```

Riêng adapter phải load bằng explicit configured path ở vị trí cuối, không copy vào auto-discovery trước các payload hook khác.

Rollback `web_search` toàn cục: chép lại `/root/.pi/agent/extensions/web_search.ts.bak` rồi `/reload`. Rollback `xai-compact` toàn cục: xóa `/root/.pi/agent/extensions/xai-compact.ts` rồi `/reload`.

## Luồng runtime `web_search`

Active model lấy từ `ctx.model`. Auth lấy từ `ctx.modelRegistry.getApiKeyAndHeaders(model)`.

```mermaid
flowchart TD
  exec[execute web_search] --> model{ctx.model}
  model -->|Khong co| err1[Loi: can active model]
  model -->|Grok id va openai-responses| grok[Backend Grok]
  model -->|provider openai-codex va api openai-codex-responses| codex[Backend Codex]
  model -->|Khac| err2[Loi: ke provider / id / api]

  grok --> gtool[Tool xAI: filters.excluded_domains, enable_image_*]
  gtool --> gpost["JSON POST /responses + max_output_tokens"]
  gpost --> gparse[Parse JSON]
  gparse --> extract[extractResult + renderResult]

  codex --> img{Co enable_image_*?}
  img -->|Co, ke ca false| err3[Loi truoc mang]
  img -->|Khong| cmap[Map excluded_domains thanh filters.blocked_domains]
  cmap --> cpost["SSE POST /codex/responses, khong max_output_tokens"]
  cpost --> crec[Ghep output tu event SSE neu terminal thieu output]
  crec --> extract

  extract --> out[Text + Sources, cat 50KB / 2000 dong]
  cpost -.->|Loi Codex| nofb[Khong fallback Grok]
```

Giới hạn chung: timeout 120s, body 2 MiB, tối đa 50 citation. Grok và `x_search` gửi trần 8192 output token; Codex từ chối field đó.

## Luồng runtime `xai-compact`

Chỉ khi `ctx.model.provider === "xai"` và `ctx.model.api === "openai-responses"`.

```mermaid
flowchart TD
  ev["session_before_compact / session_before_tree"] --> gate{xAI openai-responses?}
  gate -->|Khong| skip[return void / default Pi]
  gate -->|Tree va userWantsSummary khac true| skip
  gate -->|Co| ser["serialize convertToLlm + serializeConversation"]
  ser --> llm["complete ctx.model, khong tools/toolChoice"]
  llm -->|text| ret["return compaction hoac summary markdown"]
  llm -->|abort| cancel["return cancel true"]
  llm -->|loi / rong / toolCall| mach["summary may: cat transcript"]
  mach --> ret
```

Không gọi `POST /v1/responses/compact`. Overflow trên xAI không được `return void`.

## Luồng runtime `agentrouter-language-adapter`

Chỉ nhận `agentrouter` + `openai-completions`; extension phải là `before_provider_request` handler cuối.

```mermaid
flowchart TD
  req[before_provider_request] --> gate{agentrouter + Chat Completions?}
  gate -->|Không| keep[Giữ payload]
  gate -->|Có| clone[structuredClone payload]
  clone --> collect[Dịch prose; bảo vệ code/URL/file]
  collect --> sidecar[direct xai/grok-4.6, không tools/toolChoice]
  sidecar --> restore[Khôi phục placeholder + scan residual]
  restore -->|Safe| send[Payload có prose đã transform sang English]
  collect -->|Technical Vietnamese / lỗi| block[ctx.abort + English sentinel]
  sidecar -->|Lỗi / malformed / quá giới hạn| block
  restore -->|Còn Vietnamese| block
  reply[turn_end AgentRouter có text] --> display[xAI dịch sang tiếng Việt]
  display --> entry[Append TUI custom entry, không vào LLM context]
```

Tool output, tool-call argument, raw JSON/code, path hoặc protected span có tiếng Việt được detector nhận ra sẽ bị chặn thay vì sửa dữ liệu kỹ thuật. Sidecar yêu cầu effective URL đúng `https://api.x.ai/v1`. Cache bị chặn theo số entry/ký tự; source transcript giữ nguyên provider-native. TUI entry plain-text được lưu riêng, provider-scoped và không vào LLM context; streaming/non-TUI vẫn thấy source response. Detector heuristic không chứng minh payload tuyệt đối English-only hay classifier live của AgentRouter.

## Luồng runtime `x_search`

Không phụ thuộc model đang chat.

```mermaid
flowchart TD
  xexec[execute x_search] --> xfix["Co dinh xai / grok-4.6"]
  xfix --> xauth[Registry auth cho xAI]
  xauth --> xurl{"Base = https://api.x.ai/v1?"}
  xurl -->|Khong| xerr[Loi truoc mang]
  xurl -->|Co| xpost["JSON POST https://api.x.ai/v1/responses"]
  xpost --> xparse[Parse text + citation]
  xparse --> xout[Khong bat buoc item x_search_call]
```

## Kiểm tra

```sh
node --experimental-strip-types --check web_search.ts
node --experimental-strip-types --check x_search.ts
node --experimental-strip-types --check xai-compact.ts
node --experimental-strip-types --check agentrouter-language-adapter.ts
node --experimental-strip-types --check agentrouter-language-adapter.test.ts
node --experimental-strip-types --test agentrouter-language-adapter.test.ts
```

Syntax/test offline không chứng minh hosted search, citation, compact, classifier live AgentRouter, load order thực tế, hay sidecar có auth. Live smoke cần quyền riêng vì có thể phát sinh chi phí; compact live cần phiên xAI Responses thật và `/compact` hoặc `/tree` summarize.
