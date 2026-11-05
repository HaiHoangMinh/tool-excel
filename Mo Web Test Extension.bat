@echo off
cd /d "%~dp0web"
start "Vite" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul
echo.
echo === Test Extension tren Chrome (khong can upload Excel) ===
echo 1. chrome://extensions - Load unpacked - thu muc extension\
echo 2. Mo web.whatsapp.com - dang nhap QR
echo 3. Mo link sau tren Chrome:
echo    http://localhost:5173/?autoload=book1^&autosettings=1
echo 4. Chi giu tick 2 doi: Bao Dai, Bac Giang 1
echo 5. Bam "Xuat anh + Gui WhatsApp"
echo.
start "" "http://localhost:5173/?autoload=book1&autosettings=1"
