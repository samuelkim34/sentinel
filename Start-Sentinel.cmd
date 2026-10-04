@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS ^(24.15 or newer^), then reopen this launcher.
) else (
  node scripts/launch.mjs
)
pause
