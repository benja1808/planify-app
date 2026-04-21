$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $appDir "server.js"
$outLog = Join-Path $appDir "server.out.log"
$errLog = Join-Path $appDir "server.err.log"

Set-Location $appDir

$nodePath = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $nodePath)) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCmd) {
        Write-Host "No se encontro Node.js en este equipo." -ForegroundColor Red
        exit 1
    }
    $nodePath = $nodeCmd.Source
}

if (Test-Path $outLog) { Remove-Item $outLog -Force }
if (Test-Path $errLog) { Remove-Item $errLog -Force }

$preferredPort = 4173
for ($candidate = 4173; $candidate -le 4183; $candidate++) {
    $busy = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) {
        $preferredPort = $candidate
        break
    }
}

$cmd = 'set "PORT=' + $preferredPort + '" && start "" /b "' + $nodePath + '" "' + $serverPath + '" 1>>"' + $outLog + '" 2>>"' + $errLog + '"'
cmd.exe /c $cmd | Out-Null
Start-Sleep -Seconds 2

try {
    $resp = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$preferredPort" -TimeoutSec 5
    if ($resp.StatusCode -lt 200 -or $resp.StatusCode -ge 400) {
        throw "HTTP status inesperado: $($resp.StatusCode)"
    }
} catch {
    Write-Host "El servidor no respondio en http://127.0.0.1:$preferredPort" -ForegroundColor Red
    if (Test-Path $errLog) {
        Write-Host "server.err.log:" -ForegroundColor Yellow
        Get-Content $errLog
    }
    exit 1
}

Write-Host "Servidor activo en http://127.0.0.1:$preferredPort" -ForegroundColor Green
try {
    cmd.exe /c ('start "" http://127.0.0.1:' + $preferredPort) | Out-Null
} catch {
    Write-Host "No se pudo abrir el navegador automaticamente. Abre http://127.0.0.1:$preferredPort manualmente." -ForegroundColor Yellow
}
exit 0
