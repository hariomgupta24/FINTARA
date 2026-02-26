@echo off
title Barclays LC System — Starting Server
color 0B
echo.
echo  ============================================
echo   Barclays Bank — Letter of Credit System
echo  ============================================
echo.
echo  Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo  Please download and install it from: https://nodejs.org
    echo  Then run this file again.
    pause
    exit /b 1
)
echo  Node.js found!
echo.
echo  Installing dependencies (first-time only)...
call npm install --silent
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
)
echo  Dependencies ready!
echo.
echo  Starting Barclays LC Server on http://localhost:3000 ...
echo.
echo  Pages:
echo    Main Chat     ^> http://localhost:3000/index.html
echo    Client Portal ^> http://localhost:3000/loc-client.html
echo    Officer Dash  ^> http://localhost:3000/loc-officer.html
echo.
echo  Press Ctrl+C to stop the server.
echo.
node server.js
pause
