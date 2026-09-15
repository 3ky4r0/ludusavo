@echo off
title SaveSync Launcher
cd /d "%~dp0"

if exist "%~dp0SaveSync.Wpf\bin\Release\net8.0-windows\SaveSync.Wpf.exe" (
    start "" "%~dp0SaveSync.Wpf\bin\Release\net8.0-windows\SaveSync.Wpf.exe"
    exit
)

if exist "%~dp0SaveSync.Wpf\bin\Debug\net8.0-windows\SaveSync.Wpf.exe" (
    start "" "%~dp0SaveSync.Wpf\bin\Debug\net8.0-windows\SaveSync.Wpf.exe"
    exit
)

echo [SaveSync] Dang khoi dong bang dotnet run...
dotnet run --project SaveSync.Wpf\SaveSync.Wpf.csproj -c Release
