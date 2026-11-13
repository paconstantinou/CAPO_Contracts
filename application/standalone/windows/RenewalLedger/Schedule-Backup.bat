@echo off
title PROCURE360 - Scheduled backup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\schedule-backup.ps1"
echo.
pause
