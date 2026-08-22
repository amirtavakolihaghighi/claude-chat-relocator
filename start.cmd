@echo off
setlocal enabledelayedexpansion
title Claude Chat Relocator
cd /d "%~dp0"

echo.
echo   Claude Chat Relocator
echo   ---------------------
echo.

rem ---- 1. Is Node installed? -------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, and this app needs it to run.
  echo.
  echo   1. Go to   https://nodejs.org
  echo   2. Download the "LTS" version and install it
  echo      ^(the default options are fine - just keep clicking Next^)
  echo   3. Close this window and double-click start.cmd again
  echo.
  echo   Press any key to open the download page...
  pause >nul
  start "" "https://nodejs.org"
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo   Node.js !NODEVER! found.

rem ---- 2. First run? Install the libraries. ----------------------------
if not exist "node_modules" (
  echo.
  echo   First run - downloading the libraries this needs.
  echo   This happens once and takes about a minute.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Something went wrong while downloading.
    echo   Check that you are connected to the internet and try again.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   Done.
)

rem ---- 3. Go. ----------------------------------------------------------
echo.
echo   Starting... your browser will open in a moment.
echo   Leave this window open while you use the app.
echo   Close it, or press Ctrl+C, when you are finished.
echo.

call npm start

rem Only reached if the server stops or fails to start.
echo.
echo   The app has stopped.
pause
