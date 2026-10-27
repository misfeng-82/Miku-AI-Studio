@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Miku AI 创作平台

echo ============================================
echo   Miku AI 创作平台
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 没找到 Node.js。
  echo     请先安装 Node 18 或更高版本： https://nodejs.org
  echo     装完重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

for /f "tokens=1" %%v in ('node -v') do set NODEV=%%v
echo 已检测到 Node %NODEV%
echo 服务地址： http://127.0.0.1:8787/
echo 关闭本窗口即停止服务。
echo.

start "" http://127.0.0.1:8787/
node src/server.js

echo.
echo 服务已退出。
pause
