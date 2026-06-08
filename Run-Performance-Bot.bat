@echo off
setlocal
cd /d "%~dp0"

set "NODE_ROOT=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
set "NODE_EXE=%NODE_ROOT%\bin\node.exe"
set "NODE_PATH=%NODE_ROOT%\node_modules;%NODE_ROOT%\node_modules\.pnpm\node_modules"

if not exist "%NODE_EXE%" (
  echo The bundled Node runtime was not found.
  pause
  exit /b 1
)

"%NODE_EXE%" "tools\performance-bot.js"
if errorlevel 1 (
  echo.
  echo The performance test failed.
  echo Details are available in performance-bot-error-latest.log
  pause
  exit /b 1
)
echo.
echo The newest report is available as performance-report-latest.md
echo The newest raw measurements are available as performance-data-latest.json
echo Both files are overwritten on every run.
pause
