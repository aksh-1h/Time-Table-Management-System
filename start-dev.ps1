<#
  TT-FOP Development Startup Script
  ===================================
  Starts both the Python parser service and the Next.js dev server
  in parallel. No Docker required — uses local Python venv + npm.

  Usage:
    .\start-dev.ps1

  Prerequisites:
    - Python 3.12+ with venv created in parser-service\venv
    - Node.js 18+ with npm dependencies installed in tt-fop-app
#>

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TT-FOP Development Server Launcher" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$parserDir = Join-Path $rootDir "parser-service"
$appDir = Join-Path $rootDir "tt-fop-app"

# ── Check prerequisites ──
$venvPython = Join-Path $parserDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "[!] Python venv not found at $venvPython" -ForegroundColor Yellow
    Write-Host "    Creating virtual environment..." -ForegroundColor Yellow
    Push-Location $parserDir
    python -m venv venv
    & "$venvPython" -m pip install --upgrade pip
    & "$venvPython" -m pip install -r requirements.txt
    Pop-Location
    Write-Host "    [OK] Virtual environment created and dependencies installed." -ForegroundColor Green
}

$nodeModules = Join-Path $appDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[!] node_modules not found. Running npm install..." -ForegroundColor Yellow
    Push-Location $appDir
    npm install
    Pop-Location
    Write-Host "    [OK] npm dependencies installed." -ForegroundColor Green
}

Write-Host ""
Write-Host "[1/2] Starting Python Parser Service (http://localhost:8000)..." -ForegroundColor Magenta

$parserJob = Start-Job -ScriptBlock {
    param($dir, $python)
    Set-Location $dir
    & $python main.py
} -ArgumentList $parserDir, $venvPython

# Wait a moment for the parser to start
Start-Sleep -Seconds 3

Write-Host "[2/2] Starting Next.js Dev Server (http://localhost:3000)..." -ForegroundColor Magenta
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Both services are starting!" -ForegroundColor Green
Write-Host "  Parser:  http://localhost:8000" -ForegroundColor Green
Write-Host "  App:     http://localhost:3000" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop both services." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

try {
    # Run Next.js in the foreground so Ctrl+C works
    Push-Location $appDir
    npm run dev
}
finally {
    Write-Host "`n[*] Shutting down parser service..." -ForegroundColor Yellow
    Stop-Job $parserJob -ErrorAction SilentlyContinue
    Remove-Job $parserJob -Force -ErrorAction SilentlyContinue
    Pop-Location
    Write-Host "[*] All services stopped." -ForegroundColor Green
}
