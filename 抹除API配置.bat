@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Wiping saved LLM API config (data/settings.json)...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wipe-api-key.ps1"
echo.
echo Done. Log: data\wipe.log
pause
