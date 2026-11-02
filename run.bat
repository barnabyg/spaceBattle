@echo off
rem Starts Space Battle: installs dependencies on first run, then opens the game in Firefox.
rem Close this window, or press Ctrl+C in it, to stop the game.
cd /d "%~dp0"

where npm >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is needed. Install it from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call npm run dev
if errorlevel 1 pause
