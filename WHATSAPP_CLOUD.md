# Gửi WhatsApp trực tiếp trên web (Vercel)

Cách này **không cần PC bật** — server Vercel gọi **WhatsApp Cloud API** (Meta).

## Khác gì so với Bridge + Playwright?

| | Cloud API (Vercel) | Bridge (PC) |
|---|------------------|-------------|
| PC tắt | Vẫn gửi được | Không gửi được |
| Đích gửi | **Số điện thoại** từng người (cột **SĐT Cloud**) | **Tên nhóm** trên WhatsApp Web |
| Chuẩn bị | Tài khoản Meta Business + token | Chrome + quét QR |

Cloud API gửi **1:1** tới số đã đăng ký (người nhận phải nằm trong cửa sổ 24h hoặc dùng template — với ảnh báo cáo nội bộ thường chat trước với số Business).

## Bước 1 — Meta Developer

1. [developers.facebook.com](https://developers.facebook.com) → tạo app → thêm sản phẩm **WhatsApp**.
2. Lấy **Temporary** hoặc **Permanent** access token (System User khuyến nghị cho production).
3. Copy **Phone number ID** (WhatsApp → API Setup).

## Bước 2 — Biến môi trường trên Vercel

Project → **Settings** → **Environment Variables**:

| Biến | Ví dụ |
|------|--------|
| `WHATSAPP_TOKEN` | EAAxxxx… |
| `WHATSAPP_PHONE_NUMBER_ID` | 123456789012345 |
| `WA_API_SECRET` | chuỗi bí mật tự đặt (khuyến nghị) |
| `VITE_WA_API_SECRET` | **cùng giá trị** `WA_API_SECRET` (build web) |

Redeploy sau khi thêm biến.

## Bước 3 — Trên web

1. Mỗi đội: bật **Gửi**, điền **SĐT Cloud** (E.164 không dấu `+`, vd `84901234567`).
2. Badge **WA Cloud: bật** → **Xuất ảnh + Gửi WhatsApp**.

## Kiểm tra

- `https://<tên-app>.vercel.app/api/wa/health` → `"ok": true` khi token + phone id đúng.

## Bảo mật

- Không commit token vào git.
- Luôn đặt `WA_API_SECRET` + `VITE_WA_API_SECRET` trên site public.
- Có thể bật thêm **Vercel Deployment Protection** cho nội bộ.
