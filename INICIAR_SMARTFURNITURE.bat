@echo off
title SmartFurniture v3.4 - Servidor Local 100%% Offline
cd /d "%~dp0"
set "PATH=C:\TRABAJO\SOFTWARE\nodejs;%PATH%"
echo Iniciando SmartFurniture v3.4 en http://localhost:4173/ ...
start "" "http://localhost:4173/"
node node_modules/vite/bin/vite.js preview --port 4173 --strictPort --host
pause
