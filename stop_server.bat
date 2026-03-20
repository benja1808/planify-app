@echo off
setlocal
set "APP_DIR=C:\Users\benja\.gemini\antigravity\scratch\planner_app"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*planner_app\\server.js*' }; if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'Servidor detenido.' } else { Write-Host 'No habia servidor ejecutandose.' }"
