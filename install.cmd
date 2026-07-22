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
rem Bootstrap dependencies on a clean checkout (node_modules is gitignored).
if not exist "node_modules" (
  echo Installing dependencies ^(npm install^)...
  call npm install
  if %errorlevel% NEQ 0 (
    echo npm install failed. Fix the errors above and retry.
    pause
    exit /b 1
  )
)
node scripts\service\install.mjs
echo.
pause
