@echo off
setlocal
set "APP_DIR=C:\Users\benja\.gemini\antigravity\scratch\planner_app"
cd /d "%APP_DIR%"

if exist "C:\Program Files\nodejs\node.exe" (
  start "Planner Server" cmd /k "cd /d \"%APP_DIR%\" && \"C:\Program Files\nodejs\node.exe\" \"%APP_DIR%\server.js\""
) else (
  start "Planner Server" cmd /k "cd /d \"%APP_DIR%\" && node \"%APP_DIR%\server.js\""
)
