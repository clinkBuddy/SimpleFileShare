@echo off

echo ===================================================
echo  Simple File Share Standalone Build Script
echo ===================================================

python --version
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python.
    exit /b 1
)

if not exist venv (
    echo [INFO] Creating virtual environment venv...
    python -m venv venv
)

if not exist venv (
    echo [ERROR] Failed to create virtual environment.
    exit /b 1
)

echo [INFO] Activating virtual environment...
call venv\Scripts\activate.bat

echo [INFO] Installing/Updating dependencies from requirements.txt...
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    exit /b 1
)

echo [INFO] Cleaning up old build files...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist SimpleFileShare.spec del SimpleFileShare.spec

echo [INFO] Building standalone executable using PyInstaller...
pyinstaller --onefile --noconsole --clean --add-data "app/static;app/static" run.py --name SimpleFileShare
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    exit /b 1
)

echo ===================================================
echo  Build Completed Successfully!
echo  Executable is located at: dist\SimpleFileShare.exe
echo ===================================================
exit /b 0
