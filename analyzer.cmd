@echo off
setlocal
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Link Checker runtime was not found:
    echo   %NODE_EXE%
    echo Node.js was also not found on PATH.
    echo Please use the complete portable package, or install Node.js and retry.
    exit /b 1
  )
  set "NODE_EXE=node"
)
call :enableSystemCa %*
echo External Link Analyzer:
echo   http://127.0.0.1:8787/analyzer.html
"%NODE_EXE%" "%~dp0gui-server.mjs" %*
exit /b %ERRORLEVEL%

:enableSystemCa
if "%~1"=="" exit /b 0
if /I "%~1"=="--system-ca" (
  call :appendSystemCa
  exit /b 0
)
shift
goto :enableSystemCa

:appendSystemCa
if defined NODE_OPTIONS (
  echo(%NODE_OPTIONS% | findstr /C:"--use-system-ca" >nul || set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"
) else (
  set "NODE_OPTIONS=--use-system-ca"
)
exit /b 0
