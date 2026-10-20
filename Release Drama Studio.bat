@echo off
rem Opens the Drama Studio release window. It asks before building or publishing anything.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0scripts\release-ui.ps1" %*
if errorlevel 1 pause
