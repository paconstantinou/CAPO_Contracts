@echo off
title Renewal Ledger - Install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" -Source "%~dp0app"
echo.
pause
