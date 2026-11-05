@echo off
cd /d "%~dp0"
echo.
echo === WA Bridge (web localhost hoac Vercel) ===
echo URL: http://127.0.0.1:8765
echo Mo trang web (vd. tool-excel-puce.vercel.app), giu cua so nay mo, F5 trang.
echo Lan dau Chrome co the hoi quyen mang noi bo - chon Cho phep.
echo.
py -3 wa_bridge_server.py
pause
