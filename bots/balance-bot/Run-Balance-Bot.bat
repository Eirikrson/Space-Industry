@echo off
setlocal
cd /d "%~dp0..\.."

set "NODE_ROOT=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
set "NODE_EXE=%NODE_ROOT%\bin\node.exe"
set "NODE_PATH=%NODE_ROOT%\node_modules;%NODE_ROOT%\node_modules\.pnpm\node_modules"

if not exist "%NODE_EXE%" (
  echo The bundled Node runtime was not found.
  pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0balance-bot.js"
if errorlevel 1 (
  echo.
  echo The Balance Bot stopped with an error.
  echo Check the newest folder in bots\balance-bot\archive for details.
  pause
  exit /b 1
)

echo.
echo The Balance Bot has stopped.
echo The run is stored in bots\balance-bot\archive.
pause
