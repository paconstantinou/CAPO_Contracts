@echo off
title PROCURE360 - Backup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1"
echo.
pause
