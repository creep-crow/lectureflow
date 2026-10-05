@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" %*
set "lectureExit=%ERRORLEVEL%"
if not "%lectureExit%"=="0" (
  echo.
  echo LectureFlow failed to start. See the error above or docs/LOCAL.md.
  pause
)
exit /b %lectureExit%
