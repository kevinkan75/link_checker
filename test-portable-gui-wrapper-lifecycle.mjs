import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

function assertIncludes(text, expected, label) {
  assert(
    text.includes(expected),
    `${label} should include ${JSON.stringify(expected)}.`
  );
}

function assertNotIncludes(text, unexpected, label) {
  assert(
    !text.includes(unexpected),
    `${label} should not include stale ${JSON.stringify(unexpected)}.`
  );
}

function assertWrapperLifecycle(text, label) {
  const defaultSystemCaIndex = text.indexOf("call :appendSystemCa");
  const wrapperMarkerIndex = text.indexOf('set "LINK_CHECKER_GUI_WRAPPER=cmd"');
  assert(
    defaultSystemCaIndex >= 0 && defaultSystemCaIndex < wrapperMarkerIndex,
    `${label} should enable system CA before normal GUI startup.`,
  );
  assertIncludes(text, 'set "LINK_CHECKER_GUI_WRAPPER=cmd"', label);
  assertIncludes(text, 'set "LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED="', label);
  assertIncludes(text, ":runGui", label);
  assertIncludes(text, '"%NODE_EXE%" "%~dp0gui-server.mjs" %*', label);
  assertIncludes(text, 'set "GUI_EXIT_CODE=%ERRORLEVEL%"', label);
  assertIncludes(text, 'if "%GUI_EXIT_CODE%"=="75" (', label);
  assertIncludes(text, "if defined LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED", label);
  assertIncludes(text, 'set "LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED=1"', label);
  assertIncludes(text, "call :appendSystemCa", label);
  assertIncludes(text, 'echo(%NODE_OPTIONS% | findstr /I /C:"--use-system-ca" >nul', label);
  assertIncludes(text, 'set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"', label);
  assertIncludes(text, "goto runGui", label);
  assertIncludes(text, "exit /b %GUI_EXIT_CODE%", label);
  assertNotIncludes(
    text,
    '"%NODE_EXE%" "%~dp0gui-server.mjs" %*\r\nexit /b %ERRORLEVEL%',
    label
  );
}

function assertCliWrapper(text, label) {
  assertIncludes(text, 'set "NODE_EXE=%~dp0runtime\\node.exe"', label);
  assertIncludes(text, 'if not exist "%NODE_EXE%" set "NODE_EXE=node"', label);
  assertIncludes(text, '"%NODE_EXE%" "%~dp0link-checker.mjs" %*', label);
}

const sourceGuiCmd = await readFile(new URL("./gui.cmd", import.meta.url), "utf8");
const sourceCheckLinksCmd = await readFile(new URL("./check-links.cmd", import.meta.url), "utf8");
const buildPortable = await readFile(new URL("./build-portable.ps1", import.meta.url), "utf8");

assertWrapperLifecycle(sourceGuiCmd, "source gui.cmd");
assertCliWrapper(sourceCheckLinksCmd, "source check-links.cmd");

assertIncludes(
  buildPortable,
  'Copy-Item -LiteralPath (Join-Path $root "gui.cmd") -Destination $packageDir',
  "build-portable.ps1"
);
assertIncludes(
  buildPortable,
  'Copy-Item -LiteralPath (Join-Path $root "check-links.cmd") -Destination $packageDir',
  "build-portable.ps1"
);
assertNotIncludes(buildPortable, "Write-PortableCommandScripts", "build-portable.ps1");
assertNotIncludes(buildPortable, "$guiCmd", "build-portable.ps1");
assertNotIncludes(buildPortable, "$checkLinksCmd", "build-portable.ps1");
assertNotIncludes(buildPortable, ":runGui", "build-portable.ps1");
assertNotIncludes(buildPortable, '"%NODE_EXE%" "%~dp0link-checker.mjs" %*', "build-portable.ps1");

console.log("ok portable command wrapper single source");
