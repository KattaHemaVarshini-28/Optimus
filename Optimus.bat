@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

:: 1. Check if Optimus is installed in user's LocalAppData
set "INSTALLED_EXE=%LOCALAPPDATA%\optimus\Optimus.exe"
if exist "%INSTALLED_EXE%" (
    start "" "%INSTALLED_EXE%"
    exit /b 0
)

:: 2. Check for local pre-packaged binary
if exist "%SCRIPT_DIR%out\Optimus-win32-x64\Optimus.exe" (
    start "" "%SCRIPT_DIR%out\Optimus-win32-x64\Optimus.exe"
    exit /b 0
)

:: 3. Check for local installer
if exist "%SCRIPT_DIR%Optimus-0.8.0 Setup.exe" (
    start "" "%SCRIPT_DIR%Optimus-0.8.0 Setup.exe"
    exit /b 0
)
if exist "%SCRIPT_DIR%out\make\squirrel.windows\x64\Optimus-0.8.0 Setup.exe" (
    start "" "%SCRIPT_DIR%out\make\squirrel.windows\x64\Optimus-0.8.0 Setup.exe"
    exit /b 0
)

:: 4. If Node.js is installed on this laptop
where node >nul 2>nul
if %errorlevel% equ 0 (
    if not exist "%SCRIPT_DIR%node_modules" (
        echo [Optimus] First-time setup: installing dependencies...
        call npm install
    )
    echo [Optimus] Starting application...
    start "" npm start
    exit /b 0
)

:: 5. Download and launch the standalone installer automatically
echo [Optimus] Downloading installer from GitHub Releases...
set "TEMP_SETUP=%TEMP%\Optimus-Setup.exe"
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://github.com/KattaHemaVarshini-28/Optimus/releases/download/v0.8.0/Optimus-0.8.0-Setup.exe', '%TEMP_SETUP%')"

if exist "%TEMP_SETUP%" (
    echo [Optimus] Installing and launching...
    start "" "%TEMP_SETUP%"
    exit /b 0
)

echo [Optimus] Could not automatically launch. Please install Node.js (https://nodejs.org) or download Optimus from GitHub Releases.
pause
