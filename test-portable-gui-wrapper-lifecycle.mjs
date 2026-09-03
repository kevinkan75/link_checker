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

function extractPortableGuiTemplate(buildScript) {
  const match = /\$guiCmd\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/.exec(buildScript);
  assert(match, "build-portable.ps1 should define a gui.cmd template.");
  return match[1];
}

function assertWrapperLifecycle(text, label) {
  assertIncludes(text, 'set "LINK_CHECKER_GUI_WRAPPER=cmd"', label);
  assertIncludes(text, 'set "LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED="', label);
  assertIncludes(text, ":runGui", label);
  assertIncludes(text, '"%NODE_EXE%" "%~dp0gui-server.mjs" %*', label);
  assertIncludes(text, 'set "GUI_EXIT_CODE=%ERRORLEVEL%"', label);
  assertIncludes(text, 'if "%GUI_EXIT_CODE%"=="75" (', label);
  assertIncludes(text, "if defined LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED", label);
  assertIncludes(text, 'set "LINK_CHECKER_GUI_SYSTEM_CA_RESTARTED=1"', label);
  assertIncludes(text, "call :appendSystemCa", label);
  assertIncludes(text, "goto runGui", label);
  assertIncludes(text, "exit /b %GUI_EXIT_CODE%", label);
  assertNotIncludes(
    text,
    '"%NODE_EXE%" "%~dp0gui-server.mjs" %*\r\nexit /b %ERRORLEVEL%',
    label
  );
}

const sourceGuiCmd = await readFile(new URL("./gui.cmd", import.meta.url), "utf8");
const buildPortable = await readFile(new URL("./build-portable.ps1", import.meta.url), "utf8");
const portableGuiTemplate = extractPortableGuiTemplate(buildPortable);

assertWrapperLifecycle(sourceGuiCmd, "source gui.cmd");
assertWrapperLifecycle(portableGuiTemplate, "portable gui.cmd template");

assertIncludes(
  portableGuiTemplate,
  "Link Checker portable runtime was not found:",
  "portable gui.cmd template"
);
assertNotIncludes(portableGuiTemplate, "where node.exe", "portable gui.cmd template");

console.log("ok portable gui wrapper lifecycle");
