# AGENTS

Kho Pi extension độc lập: `web_search.ts`, `x_search.ts`, `xai-compact.ts`, và `agentrouter-language-adapter.ts` không dùng chung import, helper, hay entry point.

## Đọc theo thứ tự

1. `docs/ARCHITECTURE.md` — sơ đồ luồng và bản đồ tài liệu
2. `README.md` — hợp đồng runtime
3. File extension cần sửa (`web_search.ts`, `x_search.ts`, `xai-compact.ts`, hoặc `agentrouter-language-adapter.ts`)

## Chỉ đường

| Việc | Nguồn |
|---|---|
| Hợp đồng mọi extension | `README.md` |
| Luồng backend, cài đặt, kiểm tra | `docs/ARCHITECTURE.md` |
| API vendor Web Search | `docs/web_search.md` |
| API vendor X Search | `docs/x_search.md` |
| Spec dual-backend Codex | `docs/plans/active/web-search-openai-codex-spec.md` |
| Spec compact xAI-only | `docs/plans/active/xai-compact-workaround-spec.md` |
| Kế hoạch adapter AgentRouter | `docs/plans/active/agentrouter-vietnamese-language-adapter.md` |
| Việc đang mở | Kế hoạch trong `docs/plans/active/` còn việc — đọc Status/Result nếu file có. Spec Codex/compact là hợp đồng (hàng Spec), không phải việc mở. |
| Ghi chú Grok/cache (tham khảo, không phải hợp đồng) | `docs/grok-4.6.md`, `docs/Reasoning.md`, `docs/Maximizing Cache Hits.md`, `docs/What Breaks Caching.md`, `docs/Context Compaction.md` |

## Ràng buộc ngắn

- Public schema `web_search` không đổi. Grok giữ field xAI; Codex map `excluded_domains` → `filters.blocked_domains`, từ chối `enable_image_*`, không gửi `max_output_tokens`, không fallback Grok.
- `x_search` cố định `xai/grok-4.6` và `https://api.x.ai/v1/responses`.
- `xai-compact` chỉ chạy khi `ctx.model.provider === "xai"` và `ctx.model.api === "openai-responses"`; không `toolChoice`; không gọi compact native xAI.
- `agentrouter-language-adapter` chỉ chạy với `agentrouter` + `openai-completions`, phải là `before_provider_request` handler cuối, và chỉ dùng direct `xai/grok-4.6` tại `https://api.x.ai/v1` làm sidecar.
- Adapter dịch prose trên clone của payload; không dịch tool output/code/JSON/path có tiếng Việt mà abort + sentinel tiếng Anh. Không tuyên bố live nếu chưa smoke bằng auth thật.
- Không lưu hoặc in credential.
- Không commit, copy extension, hay `/reload` trừ khi người dùng yêu cầu đúng hành động đó.
- Kiểm tra: `node --experimental-strip-types --check` từng file extension; adapter chạy thêm `node --experimental-strip-types --test agentrouter-language-adapter.test.ts`. Syntax/test offline không chứng minh live search, compact, hay AgentRouter.
