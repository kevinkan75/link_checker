@echo off
setlocal
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo External Link Analyzer:
echo   http://127.0.0.1:8787/analyzer.html
"%NODE_EXE%" "%~dp0gui-server.mjs" %*
