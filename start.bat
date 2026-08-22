@echo off
title GTA Map Editor - Local Server
echo ===================================================
echo  Starting GTA V Map Editor Local Server...
echo ===================================================
echo.

:: Проверяем установлен ли Python (самый надежный способ для localhost)
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Python found. Starting HTTP server on port 8000...
    start http://localhost:8000
    python -m http.server 8000
    goto end
)

:: Проверяем установлен ли Node.js (запасной вариант)
npx --version >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Node.js found. Starting HTTP server on port 8000...
    start http://localhost:8000
    npx http-server -p 8000 -c-1
    goto end
)

echo [ERROR] No local server environment found!
echo Please install Python (https://www.python.org/downloads/) 
echo or Node.js (https://nodejs.org/) to run local server.
pause

:end
