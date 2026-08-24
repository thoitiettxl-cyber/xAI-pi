<!-- pi-continuity-work-document: {"schemaVersion":1,"kind":"execution-plan","workItemId":"7d6f442e-2293-4ab0-9532-8466310ab959","templateVersion":1} -->

# Execution Plan: Deploy direct-xAI x_search extension

Date: 2026-08-24

## Status

Active

## Outcome

Bản extension x_search toàn cục dùng provider xai, endpoint https://api.x.ai/v1 và auth xAI do Pi phân giải; kiểm thử smoke không còn phụ thuộc cliproxy.

## Authority And Context

- Người dùng yêu cầu: “Tiến hành cập nhật x_search”.
- Nguồn triển khai: /root/code/xAI-pi/x_search.ts.
- Đích triển khai: /root/.pi/agent/extensions/x_search.ts.
- Tài liệu xAI trong document /x_search.md mô tả Responses API trực tiếp tại https://api.x.ai/v1 với native x_search.

## Scope

In scope:

- Sao lưu bản x_search toàn cục hiện tại.
- Thay bản toàn cục bằng x_search.ts trong repository.
- Kiểm tra cú pháp và xác nhận nội dung triển khai khớp nguồn.
- Reload extension nếu runtime hiện tại cho phép; nếu không, yêu cầu người dùng chạy /reload.
- Kiểm thử smoke x_search sau reload.

Out of scope:

- Không thay đổi web_search.ts.
- Không cập nhật README.md.
- Không đọc hoặc hiển thị token OAuth/API key.
- Không thay đổi provider hay auth xAI.

## Constraints

- Giữ nguyên mọi thay đổi và file không liên quan.
- Không sử dụng hoặc khôi phục CLIProxyAPI.
- Bản triển khai phải cố định provider xai và endpoint https://api.x.ai/v1.
- Không tuyên bố thành công nếu chưa có kiểm thử thực thi sau reload.

## Approach

- Ghi nhận trạng thái và checksum nguồn/đích trước thay đổi.
- Sao lưu /root/.pi/agent/extensions/x_search.ts thành /root/.pi/agent/extensions/x_search.ts.bak.
- Chép /root/code/xAI-pi/x_search.ts vào đích toàn cục.
- Chạy kiểm tra cú pháp và checksum để xác nhận triển khai.
- Reload extension runtime.
- Gọi x_search bằng truy vấn công khai và xác nhận không còn đường dẫn cliproxy.

## Risks And Recovery

- Nếu bản mới không nạp hoặc xAI trả lỗi, chép /root/.pi/agent/extensions/x_search.ts.bak trở lại đích rồi chạy /reload.
- Reload có thể thay đổi tool registration giữa phiên; dừng ngay khi trạng thái thành công được quan sát.
- Nếu smoke test phát sinh lỗi upstream, giữ nguyên bằng chứng lỗi và không suy diễn thành lỗi auth.

## Progress

- [x] Backed up the former global extension and deployed the repository `x_search.ts` to `/root/.pi/agent/extensions/x_search.ts`.
- [x] Verified deployed syntax, direct-xAI constants, and source/target checksum equality.
- [ ] Reload the Pi runtime and run the live `x_search` smoke test.

## Decisions

- Retain `/root/.pi/agent/extensions/x_search.ts.bak` as the exact pre-update rollback copy until live validation succeeds.

Promote lasting product or architecture decisions into repository-owned decision documentation only after authority exists.

## Validation

- node --experimental-strip-types --check /root/.pi/agent/extensions/x_search.ts
- sha256sum nguồn và đích phải giống nhau sau chép.
- Sau reload, mô tả tool/runtime phải dùng provider xai thay vì cliproxy.
- Smoke test x_search trả dữ liệu trích dẫn hoặc lỗi cụ thể từ xAI, không phải provider_error: cliproxy is unavailable.

Evidence recorded 2026-08-24:

- `node --experimental-strip-types --check /root/.pi/agent/extensions/x_search.ts` passed.
- Source and deployed SHA-256 both equal `e0c00ebb72074862be2b8a456ea1bcef4bda229546dc0f1193a72b25c9653964`.
- Rollback SHA-256 is `4bf1aca745e2ab3d3e9dfc121b62b76d6abc3f37777ca35436aab976216a2556`.
- Deployed source declares `PROVIDER_ID = "xai"` and `EXPECTED_BASE_URL = "https://api.x.ai/v1"`; no `cliproxy` occurrence remains.

## Result

The global extension file is updated and statically verified. Runtime reload and live `x_search` proof remain pending.
