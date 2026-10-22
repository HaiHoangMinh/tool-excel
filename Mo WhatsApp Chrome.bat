@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Mo WhatsApp Web bang Google Chrome cai tren may (khong dung Chromium Playwright).
echo Lan dau: quet QR trong cua so Chrome.
echo.
py -3 -m pip install playwright -q 2>nul
py -3 send_whatsapp.py %*
pause
