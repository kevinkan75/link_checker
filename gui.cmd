@echo off
setlocal
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
if /I "%~1"=="--system-ca" (
  if defined NODE_OPTIONS (
    echo %NODE_OPTIONS% | findstr /C:"--use-system-ca" >nul || set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"
  ) else (
    set "NODE_OPTIONS=--use-system-ca"
  )
  shift
)
"%NODE_EXE%" "%~dp0gui-server.mjs" %*
