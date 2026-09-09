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
const launcherSource = await readFile(new URL("./launcher/StartLinkChecker.cs", import.meta.url), "utf8");
const quickGuide = await readFile(new URL("./使用說明.txt", import.meta.url), "utf8");
const readme = await readFile(new URL("./README.md", import.meta.url), "utf8");
const projectContext = await readFile(new URL("./docs/PROJECT_CONTEXT.md", import.meta.url), "utf8");
const cliReference = await readFile(new URL("./docs/CLI_REFERENCE.md", import.meta.url), "utf8");
const technicalSpec = await readFile(new URL("./docs/TECHNICAL_SPEC.md", import.meta.url), "utf8");
const releasePreflight = await readFile(new URL("./scripts/release-preflight.ps1", import.meta.url), "utf8");
const releaseVerify = await readFile(new URL("./scripts/release-verify.ps1", import.meta.url), "utf8");

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

assertIncludes(buildPortable, '$launcherExe = Join-Path $packageDir "Link Checker.exe"', "build-portable.ps1");
assertIncludes(buildPortable, 'path = "Link Checker.exe"', "package manifest launcher metadata");
assertIncludes(buildPortable, 'path = "$packageName\\Link Checker.exe"', "external manifest launcher metadata");
assertIncludes(
  buildPortable,
  'Copy-Item -LiteralPath (Join-Path $root "使用說明.txt") -Destination $packageDir',
  "build-portable.ps1"
);
assertNotIncludes(buildPortable, "Decode-Utf8Base64Text", "build-portable.ps1");
assertNotIncludes(buildPortable, "$portableReadme", "build-portable.ps1");
assertNotIncludes(buildPortable, "PORTABLE-README.txt", "build-portable.ps1");
assertIncludes(buildPortable, "function Get-OrCreate-CodeSigningCertificate", "build-portable.ps1");
assertIncludes(buildPortable, "function Sign-PortableLauncher", "build-portable.ps1");
assertIncludes(buildPortable, "$launcherSigned = Sign-PortableLauncher -FilePath $launcherExe", "build-portable.ps1");
assertIncludes(buildPortable, "function Assert-RequiredPortablePaths", "build-portable.ps1");
assertIncludes(buildPortable, '"使用說明.txt",', "required portable paths");
assertIncludes(buildPortable, 'throw "Required portable path is missing: $relativePath"', "required portable paths");
const requiredPathGuardIndex = buildPortable.indexOf("Assert-RequiredPortablePaths -PackageDir $packageDir");
const packageManifestIndex = buildPortable.indexOf("Write-PackageBuildManifest `");
assert(
  requiredPathGuardIndex >= 0 && requiredPathGuardIndex < packageManifestIndex,
  "Required portable paths should be checked before writing BUILD-MANIFEST.json.",
);
assertIncludes(buildPortable, "Compress-Archive -LiteralPath $packageDir", "build-portable.ps1");

assertIncludes(launcherSource, "internal static class StartLinkChecker", "launcher source implementation");
assertIncludes(launcherSource, 'AssemblyProduct("Link Checker")', "launcher product metadata");
assertIncludes(launcherSource, "then run Link Checker.exe from that folder", "launcher missing-file guidance");
assertIncludes(releasePreflight, '$launcherPath = Join-Path $packageDir "Link Checker.exe"', "release preflight");
assertIncludes(releasePreflight, '"ARTIFACT_USAGE_GUIDE"', "release preflight checks");
assertIncludes(releasePreflight, '$usageGuidePath = Join-Path $packageDir "使用說明.txt"', "release preflight");
assertIncludes(
  releasePreflight,
  '@{ Id = "ARTIFACT_USAGE_GUIDE"; Path = $usageGuidePath; Type = "Leaf" }',
  "release preflight artifact checks",
);

assertIncludes(quickGuide, "Link Checker 使用說明", "quick guide");
assertIncludes(quickGuide, "雙擊「Link Checker.exe」", "quick guide");
assertIncludes(quickGuide, "完整解壓縮", "quick guide");
assertIncludes(quickGuide, "SmartScreen", "quick guide");
assertIncludes(quickGuide, "gui.cmd", "quick guide");
assertIncludes(quickGuide, "check-links.cmd", "quick guide");

for (const [label, text] of [
  ["build-portable.ps1", buildPortable],
  ["launcher source", launcherSource],
  ["README.md", readme],
  ["docs/PROJECT_CONTEXT.md", projectContext],
  ["docs/CLI_REFERENCE.md", cliReference],
  ["docs/TECHNICAL_SPEC.md", technicalSpec],
  ["scripts/release-preflight.ps1", releasePreflight],
  ["scripts/release-verify.ps1", releaseVerify],
]) {
  assertNotIncludes(text, "Start Link Checker.exe", label);
}

console.log("ok portable launcher, quick guide, and command wrapper contracts");
