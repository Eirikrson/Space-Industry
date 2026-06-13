@echo off
setlocal
cd /d "%~dp0..\.."

set "NODE_ROOT=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
set "NODE_EXE=%NODE_ROOT%\bin\node.exe"
set "NODE_PATH=%NODE_ROOT%\node_modules;%NODE_ROOT%\node_modules\.pnpm\node_modules"

if not exist "%NODE_EXE%" (
  echo The bundled Node runtime was not found.
  exit /b 1
)

echo The complete performance test can take several minutes.
echo Please leave this window open until the report paths are shown.
echo.
"%NODE_EXE%" "%~dp0performance-bot.js"
if errorlevel 1 (
  echo.
  echo The performance test failed.
  echo Details are available in bots\performance-bot\performance-bot-error-latest.log
  exit /b 1
)
echo.
echo The newest report is available as bots\performance-bot\performance-report-latest.md
echo The newest raw measurements are available as bots\performance-bot\performance-data-latest.json
echo Both files are overwritten on every run.
