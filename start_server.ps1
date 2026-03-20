$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = "C:\Program Files\nodejs\node.exe"
$serverPath = Join-Path $projectRoot "server.js"

Set-Location $projectRoot
Write-Host "Iniciando Planner App en http://localhost:4173"
& $nodePath $serverPath
