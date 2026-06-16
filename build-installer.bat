@echo off
REM ========================================
REM  LaiMarkDown 2.0 - Build Installer (ASCII)
REM ========================================

cd /d "%~dp0"

set "PROXY_HTTP=http://127.0.0.1:10808"
set "PROXY_HTTPS=http://127.0.0.1:10808"
set "HTTP_PROXY=%PROXY_HTTP%"
set "HTTPS_PROXY=%PROXY_HTTPS%"

if not exist "node_modules" (
    pnpm install || goto err
)

echo [INFO] Building main + renderer...
pnpm run build || goto err

echo [INFO] Packaging Windows installer...
pnpm run package || goto err

echo [OK] Done! Installer in release\
explorer release
goto :eof

:err
echo [ERROR] Build failed. See log above.
pause