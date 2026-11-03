# tool-excel

Tool Windows: xuất ảnh PNG theo **Đội** từ `Book1.xlsm` (sheet XLSC_TON, TKM_TON) và gửi WhatsApp (Chrome).

## Web (React + Vercel)

Phiên bản trình duyệt nằm trong thư mục [`web/`](web/): upload Excel, đồng bộ đội, xuất PNG/ZIP, gửi WhatsApp **thủ công**.

```bash
cd web
npm install
npm run dev
```

Test tự động (Playwright, dùng `Book1.xlsm` ở thư mục gốc):

```bash
cd web
npm run test:e2e
```

Nếu trình duyệt nhúng (Cursor) chặn chọn file: **kéo thả** file Excel vào vùng dashed, hoặc mở `http://localhost:5173` bằng Chrome/Edge.

**Gửi WhatsApp tự động (giống tool desktop):** trên Windows chạy `Mo Web + WA Bridge.bat` (mở web + `wa_bridge_server.py`). Trên web dùng **Gửi WhatsApp** hoặc **Xuất ảnh + Gửi WhatsApp** — gọi `send_whatsapp.py` qua Chrome/Playwright. Trên Vercel (chỉ static) không gửi tự động được; cần bridge local.

Deploy lên Vercel (root repo, dùng `vercel.json` ở thư mục gốc):

```bash
npx vercel
```

Hoặc import repo GitHub trên [vercel.com](https://vercel.com) — Vercel sẽ build từ `web/dist`.

## Chạy nhanh

- `Mo Tool.bat` — GUI
- `Mo WhatsApp Chrome.bat` — mở WhatsApp Web (Chrome)
- `requirements.txt` — `pip install -r requirements.txt`

## Cấu hình

- `config.json` — cột export, PDF, WhatsApp
- `settings_cache.json` — map đội → nhóm (tạo khi dùng GUI; không commit dữ liệu cá nhân)
- Đặt `Book1.xlsm` trong thư mục project (file Excel không đưa lên git)
