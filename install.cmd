@echo off
rem quick-export installer: creates a Windows service + startup app so the local export
rem service is always running. Self-elevates to administrator.
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
node scripts\service\install.mjs
echo.
pause
