# Extension Chrome — Gửi WhatsApp Web

Dùng cùng trang Tool Excel trên Vercel (hoặc `localhost:5173`): web xuất ảnh, extension thao tác tab **web.whatsapp.com** (tìm nhóm theo tên, gửi ảnh + caption).

## Cài đặt (mỗi máy gửi)

1. Mở Chrome → `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `extension/` trong repo
4. Mở [web.whatsapp.com](https://web.whatsapp.com) → quét QR (một lần)
5. Mở trang tool (vd. `https://tool-excel-puce.vercel.app`) → **F5**
6. Badge **WA Extension: bật** → cấu hình tên nhóm → **Xuất ảnh + Gửi WhatsApp**

## Lưu ý

- Extension chỉ chạy trên máy **đang mở Chrome** (không cần Python / WA Bridge).
- Tab WhatsApp Web phải **đăng nhập**; lúc gửi Chrome có thể chuyển sang tab WA.
- Tên nhóm phải **trùng** với tên trên WhatsApp Web.
- Deploy Vercel mới cần có UI web mới; extension cài local từ repo.

Web chỉ gửi WhatsApp qua **Extension** (không Cloud API, không WA Bridge).
