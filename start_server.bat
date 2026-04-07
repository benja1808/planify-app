@echo off
setlocal
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "%APP_DIR%"
echo Iniciando Planner App en http://localhost:4173

if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%APP_DIR%\server.js"
) else (
  node "%APP_DIR%\server.js"
)

if errorlevel 1 (
    echo.
    echo El servidor se cerro por un error.
    pause
)
