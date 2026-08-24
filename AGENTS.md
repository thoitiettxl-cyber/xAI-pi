# AGENTS

Kho Pi extension độc lập: `web_search.ts` và `x_search.ts` không dùng chung import, helper, hay entry point.

## Đọc theo thứ tự

1. `docs/ARCHITECTURE.md` — sơ đồ luồng và bản đồ tài liệu
2. `README.md` — hợp đồng runtime
3. File extension cần sửa

## Chỉ đường

| Việc | Nguồn |
|---|---|
| Hợp đồng `web_search` / `x_search` | `README.md` |
| Luồng backend, cài đặt, kiểm tra | `docs/ARCHITECTURE.md` |
| API vendor Web Search | `docs/web_search.md` |
| API vendor X Search | `docs/x_search.md` |
| Spec dual-backend Codex | `docs/plans/active/web-search-openai-codex-spec.md` |
| Việc đang mở | `docs/plans/active/` |
| Ghi chú Grok/cache (tham khảo, không phải hợp đồng) | `docs/grok-4.6.md`, `docs/Reasoning.md`, `docs/Maximizing Cache Hits.md`, `docs/What Breaks Caching.md`, `docs/Context Compaction.md` |

## Ràng buộc ngắn

- Public schema `web_search` không đổi. Grok giữ field xAI; Codex map `excluded_domains` → `filters.blocked_domains`, từ chối `enable_image_*`, không gửi `max_output_tokens`, không fallback Grok.
- `x_search` cố định `xai/grok-4.6` và `https://api.x.ai/v1/responses`.
- Không lưu hoặc in credential.
- Không commit, copy extension, hay `/reload` trừ khi người dùng yêu cầu đúng hành động đó.
- Kiểm tra: `node --experimental-strip-types --check web_search.ts` và tương tự cho `x_search.ts`. Syntax không chứng minh live search.
