@echo off
title SimpleFileShare
echo ==============================================
echo  Starting SimpleFileShare (Dev Mode)
echo ==============================================

if exist "venv\Scripts\activate.bat" (
    echo [INFO] Activating virtual environment...
    call "venv\Scripts\activate.bat"
    python run.py
) else (
    echo [ERROR] Virtual environment not found. 
    echo [INFO] Please run build.bat first to setup the environment.
)

pause
