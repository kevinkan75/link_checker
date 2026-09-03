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
set "LINK_CHECKER_GUI_WRAPPER=cmd"
set "LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED="

:runGui
"%NODE_EXE%" "%~dp0gui-server.mjs" %*
set "GUI_EXIT_CODE=%ERRORLEVEL%"
if "%GUI_EXIT_CODE%"=="75" (
  if defined LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED (
    echo Link Checker system certificate restart did not complete after one retry.
    exit /b %GUI_EXIT_CODE%
  )
  set "LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED=1"
  call :appendSystemCa
  goto runGui
)
exit /b %GUI_EXIT_CODE%

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
