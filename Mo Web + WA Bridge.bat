@echo off
cd /d "%~dp0"
start "WA Bridge" py -3 wa_bridge_server.py
timeout /t 2 /nobreak >nul
cd web
start "Web Tool" cmd /c "npm run dev"
echo Mo http://localhost:5173 — Bridge http://127.0.0.1:8765
