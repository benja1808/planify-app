@echo off
setlocal
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$serverPath = Join-Path '%APP_DIR%' 'server.js'; $escaped = [regex]::Escape($serverPath); $procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match $escaped }; if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'Servidor detenido.' } else { Write-Host 'No habia servidor ejecutandose.' }"
