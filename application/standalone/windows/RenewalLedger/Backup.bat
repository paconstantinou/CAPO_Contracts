@echo off
title Renewal Ledger - Backup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1"
echo.
pause
