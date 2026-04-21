@echo off
setlocal
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "%APP_DIR%"

if exist "C:\Program Files\nodejs\node.exe" (
  start "Planner Server" cmd /k "cd /d \"%APP_DIR%\" && \"C:\Program Files\nodejs\node.exe\" \"%APP_DIR%\server.js\""
  start "PDF Server" cmd /k "cd /d \"%APP_DIR%\" && \"C:\Program Files\nodejs\node.exe\" \"%APP_DIR%\pdf-server.js\""
) else (
  start "Planner Server" cmd /k "cd /d \"%APP_DIR%\" && node \"%APP_DIR%\server.js\""
  start "PDF Server" cmd /k "cd /d \"%APP_DIR%\" && node \"%APP_DIR%\pdf-server.js\""
)
