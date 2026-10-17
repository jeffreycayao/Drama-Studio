@echo off
rem Drama Studio Companion native messaging host (registered by the installer).
rem The browser runs this through cmd.exe. Replies leave on stderr because Electron
rem writes a blank line to stdout at start-up (see electron/companionLink/hostMain.cjs).
"%~dp0..\..\Drama Studio.exe" --ds-companion-host --log-level=3 --disable-gpu %* 2>&1 1>nul
