@echo off
setlocal
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 "%~dp0run-tier1-matrix.py" %*
    exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
    python "%~dp0run-tier1-matrix.py" %*
    exit /b %errorlevel%
)

echo Python was not found in PATH. Run this on a machine with Python installed, then use:
echo   py -3 run-tier1-matrix.py [options]
echo or:
echo   python run-tier1-matrix.py [options]
exit /b 1
