@echo off
cd /d "%~dp0"

set "PYEXE=%~dp0python\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"
set "SMART_CANVAS_PORT=3001"

echo Starting Infinite Smart Canvas...
echo Visit: http://127.0.0.1:3001/
echo Press Ctrl+C to stop.
echo.

start /b cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:3001/"
"%PYEXE%" main.py

echo.
echo Server stopped.
pause
