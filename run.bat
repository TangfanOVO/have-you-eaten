@echo off
rem Open the have-you-eaten page at http://127.0.0.1:8770
cd /d "%~dp0"
start "" "http://127.0.0.1:8770"
python web.py
pause
