@echo off
rem quick-export uninstaller: removes the Windows service + startup app. Self-elevates.
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
node scripts\service\uninstall.mjs
echo.
pause
