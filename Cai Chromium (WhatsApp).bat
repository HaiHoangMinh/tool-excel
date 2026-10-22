@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Tool uu tien Google Chrome tren may (config whatsapp_browser=chrome).
echo Chi cai Chromium Playwright khi khong co Chrome/Edge:
py -3 -m pip install playwright -q
py -3 -m playwright install chromium
echo.
echo Xong. Nen dung Chrome that — chay lai "Gui WhatsApp" trong Mo Tool.bat
pause
