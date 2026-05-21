# Run from project root:
#   .\scripts\make_release.ps1
#
# Produces: dist-shangxue-YYYYMMDD-HHmm.zip
# Contains: backend source + sql + dist + .env + scripts + DEPLOY.md
# Excludes: node_modules, .venv, __pycache__, .git, uploaded media files

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path "frontend/dist")) {
    Write-Host "[!] frontend/dist not found. Run: cd frontend; npm run build" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "backend/.env")) {
    Write-Host "[!] backend/.env not found. Create it from .env.example first." -ForegroundColor Red
    exit 1
}

Get-ChildItem -Path backend -Recurse -Directory -Filter __pycache__ -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$stamp   = Get-Date -Format "yyyyMMdd-HHmm"
$out     = "dist-shangxue-$stamp.zip"
$staging = Join-Path $env:TEMP ("shangxue-stage-" + $stamp)

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Copy-Item DEPLOY.md                (Join-Path $staging "DEPLOY.md")
New-Item  -ItemType Directory -Path (Join-Path $staging "backend") | Out-Null
Copy-Item backend\app              (Join-Path $staging "backend\app") -Recurse
Copy-Item backend\sql              (Join-Path $staging "backend\sql") -Recurse
Copy-Item backend\scripts          (Join-Path $staging "backend\scripts") -Recurse
Copy-Item backend\requirements.txt (Join-Path $staging "backend\requirements.txt")
Copy-Item backend\.env             (Join-Path $staging "backend\.env")
Copy-Item backend\.env.example     (Join-Path $staging "backend\.env.example")
New-Item  -ItemType Directory -Path (Join-Path $staging "backend\uploads") | Out-Null
if (Test-Path backend\uploads\.keep) {
    Copy-Item backend\uploads\.keep (Join-Path $staging "backend\uploads\.keep")
}
New-Item  -ItemType Directory -Path (Join-Path $staging "frontend") | Out-Null
Copy-Item frontend\dist            (Join-Path $staging "frontend\dist") -Recurse

Get-ChildItem -Path $staging -Recurse -Directory -Filter __pycache__ -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $out -CompressionLevel Optimal

Remove-Item $staging -Recurse -Force

$size = (Get-Item $out).Length / 1MB
Write-Host ""
Write-Host "=== Release built ===" -ForegroundColor Green
Write-Host ("  output : {0}" -f $out)
Write-Host ("  size   : {0:N2} MB" -f $size)
Write-Host ""
Write-Host "Upload to server and follow DEPLOY.md for next steps." -ForegroundColor Cyan
