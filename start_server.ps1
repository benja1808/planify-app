$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = "C:\Program Files\nodejs\node.exe"
$serverPath = Join-Path $projectRoot "server.js"

Set-Location $projectRoot
Write-Host "Iniciando Planner App (si 4173 esta ocupado, usara el siguiente puerto libre)"
& $nodePath $serverPath
