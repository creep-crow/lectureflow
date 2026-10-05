@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" --export-mcp-configs %*
if errorlevel 1 (
  echo LectureFlow MCP configuration export failed.
  pause
  exit /b 1
)
explorer.exe "%~dp0.sites-runtime\mcp-configs"
