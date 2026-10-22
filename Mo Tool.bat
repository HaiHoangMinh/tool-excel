@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 -m pip install -r requirements.txt -q 2>nul
py -3 -m playwright install chromium 2>nul
start "" py -3 app_gui.py
