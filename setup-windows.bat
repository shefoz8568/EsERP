@echo off
REM EsERP — Windows setup (double-click this file).
REM Calls setup-windows.ps1 with -ExecutionPolicy Bypass so no policy
REM change is needed. Run from the repo root.
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File setup-windows.ps1
pause
