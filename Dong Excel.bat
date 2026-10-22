@echo off
chcp 65001 >nul
echo Dang tat tat ca tien trinh Microsoft Excel (neu tool bi treo)...
taskkill /IM EXCEL.EXE /F 2>nul
if errorlevel 1 (
  echo Khong co Excel nao dang chay.
) else (
  echo Da tat Excel. Ban co the mo Excel binh thuong.
)
pause
