@echo off
REM ========================================
REM  LaiMarkDown 2.0 - Dev Launcher
REM  Exits cleanly when dev session ends
REM ========================================
chcp 65001 >nul

cd /d "%~dp0"

set "PROXY_HTTP=http://127.0.0.1:10808"
set "PROXY_HTTPS=http://127.0.0.1:10808"
set "HTTP_PROXY=%PROXY_HTTP%"
set "HTTPS_PROXY=%PROXY_HTTPS%"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call pnpm install
    if errorlevel 1 goto err
)

if not exist "node_modules\.pnpm\electron@32.3.3\node_modules\electron\dist\electron.exe" (
    echo [INFO] Downloading Electron binary...
    pushd "node_modules\.pnpm\electron@32.3.3\node_modules\electron"
    call node install.js
    popd
)

echo.
echo [INFO] Starting Vite + Electron
echo [INFO] Vite at: http://localhost:5173
echo [INFO] Close this window OR press Ctrl+C to stop
echo.

call pnpm run dev
set "DEV_EXITCODE=%errorlevel%"
echo.
echo [INFO] Dev session ended (exit code: %DEV_EXITCODE%).

REM 正常结束 → 直接退出 bat（不阻塞）
REM 出错（pnpm 启动失败、tsc 编译失败等）才 pause 让用户看错误
if %DEV_EXITCODE% neq 0 goto err
exit /b %DEV_EXITCODE%

:err
echo.
echo ========================================
echo  Dev session failed. Check output above.
echo  Press any key to close this window...
echo ========================================
pause >nul
exit /b 1