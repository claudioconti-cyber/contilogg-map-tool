@echo off
setlocal ENABLEDELAYEDEXPANSION

REM ====== CONFIGURÁVEL ======
REM Defina a subpasta padrão (pode sobrescrever passando como argumento: start-app.bat src)
set "SUBFOLDER=app"
if not "%~1"=="" set "SUBFOLDER=%~1"
REM ==========================

REM Caminho absoluto da subpasta a partir da pasta onde o .bat está
set "TARGET=%~dp0%SUBFOLDER%"

if not exist "%TARGET%" (
  echo [ERRO] Pasta nao encontrada: "%TARGET%"
  pause
  exit /b 1
)

if not exist "%TARGET%\package.json" (
  echo [ERRO] Nao encontrei package.json em "%TARGET%".
  pause
  exit /b 1
)

REM Abre uma nova janela do PowerShell, navega para a pasta alvo,
REM instala dependencias se necessario e executa "npx playwright install" antes do "npm start"
start "Contilogg - npm start" powershell -NoLogo -NoExit -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "Set-Location -LiteralPath (Resolve-Path '%TARGET%');" ^
  "$needInstall = -not (Test-Path -LiteralPath 'node_modules') -or ((Get-ChildItem -LiteralPath 'node_modules' -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0);" ^
  "if ($needInstall) {" ^
    "Write-Host 'node_modules nao encontrado (EXECUTANDO PELA PRIMEIRA VEZ). Instalando dependencias (npm i)...' -ForegroundColor Yellow;" ^
    "npm i;" ^
    "if ($LASTEXITCODE -ne 0) { Write-Error 'Falha ao instalar dependencias.'; exit 1 };" ^
    "Write-Host 'Instalando navegadores do Playwright (npx playwright install)...' -ForegroundColor Yellow;" ^
    "npx playwright install;" ^
    "if ($LASTEXITCODE -ne 0) { Write-Warning 'Falha ao instalar navegadores do Playwright. Voce pode rodar manualmente: npx playwright install' }" ^
  "};" ^
  "npm start"
