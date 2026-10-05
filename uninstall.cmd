@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1" %*
set "lecture_exit=%errorlevel%"
pause
exit /b %lecture_exit%
