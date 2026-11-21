@echo off
title SMARTFURNITURE v3.0 - APLICACION LOCAL OFFLINE
set "PATH=C:\TRABAJO\SOFTWARE\nodejs;%PATH%"
cd /d "%~dp0"
echo ==========================================================
echo   SMARTFURNITURE v3.0 // 100%% LOCAL OFFLINE (INACAP U3)
echo ==========================================================
echo   Abriendo servidor de desarrollo Vite en navegador...
echo   Presione Ctrl+C para detener.
echo ==========================================================
node node_modules\vite\bin\vite.js --open
pause
