@echo off
cd /d "%~dp0web"
echo.
echo === Test Extension: 3 nhom dau (Chrome Playwright) ===
echo 1. Cua so Chrome mo ra — neu thay QR WhatsApp, quet trong 4 phut.
echo 2. Sau do tool tu upload Excel va gui Bao Dai, Bac Giang 1, Bac Giang 2.
echo.
npx playwright test e2e/extension-send.spec.ts --reporter=list
pause
