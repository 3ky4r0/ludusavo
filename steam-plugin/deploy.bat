@echo off
setlocal
echo ===================================================
echo  Deploying SaveSync Portable Plugin to Millennium...
echo ===================================================

set "SRC=%~dp0"
set "DEST=C:\Program Files (x86)\Steam\millennium\plugins\savesync"

if not exist "%DEST%" (
    mkdir "%DEST%"
)

echo Copying files to %DEST%...
robocopy "%SRC%\" "%DEST%\" /E /IS /IT /XF deploy.bat > nul

echo.
echo ===================================================
echo  [OK] Portable Plugin deployed successfully!
echo  Location: %DEST%
echo ===================================================
echo.
pause
