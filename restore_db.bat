@echo off
cd /d "%~dp0"
python restore_db.py %*
pause
