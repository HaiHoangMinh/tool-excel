@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Goi y: double-click "Mo Tool.bat" de dung giao dien (import Excel + cai dat nhom).
echo.

echo === Cai dependency (neu thieu) ===
py -3 -m pip install -r requirements.txt -q
py -3 -m playwright install chromium 2>nul

echo.
echo === Buoc 1: Chon file Excel ^& xuat anh theo doi ===
py -3 export_team_images.py --pick
if errorlevel 1 (
  echo Xuat anh that bai.
  pause
  exit /b 1
)

echo.
echo === Buoc 2: Gui WhatsApp (can ten nhom trong teams_whatsapp.json) ===
py -3 send_whatsapp.py

echo.
echo Xong.
pause
