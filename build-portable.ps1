$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$packageName = "LinkChecker-portable"
$packageDir = Join-Path $dist $packageName
$zipPath = Join-Path $dist "$packageName.zip"
$runtimeDir = Join-Path $packageDir "runtime"
$launcherSource = Join-Path $root "launcher\StartLinkChecker.cs"
$launcherExe = Join-Path $packageDir "Start Link Checker.exe"

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [System.IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside workspace: $childFull"
  }
}

function Resolve-CSharpCompiler {
  $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $installPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
    if ($installPath) {
      $roslynCsc = Join-Path $installPath "MSBuild\Current\Bin\Roslyn\csc.exe"
      if (Test-Path -LiteralPath $roslynCsc) {
        return $roslynCsc
      }
    }
  }

  $fallbacks = @(
    "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )

  foreach ($candidate in $fallbacks) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "C# compiler was not found. Install Visual Studio Build Tools or .NET Framework build tools."
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExe = $nodeCommand.Source
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "node.exe was not found."
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null
Assert-ChildPath -Parent $root -Child $packageDir
Assert-ChildPath -Parent $root -Child $zipPath
Assert-ChildPath -Parent $root -Child $launcherExe

if (-not (Test-Path -LiteralPath $launcherSource)) {
  throw "Launcher source was not found: $launcherSource"
}

if (Test-Path -LiteralPath $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root "link-checker.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "gui-server.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "convert-ut1-rules.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "check-links.cmd") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "gui.cmd") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "analyzer.cmd") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "public") -Destination $packageDir -Recurse
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtimeDir "node.exe")

$csc = Resolve-CSharpCompiler
& $csc `
  /nologo `
  /codepage:65001 `
  /target:winexe `
  /platform:anycpu `
  /optimize+ `
  /reference:System.dll `
  /reference:System.Windows.Forms.dll `
  /out:$launcherExe `
  $launcherSource
if ($LASTEXITCODE -ne 0) {
  throw "C# launcher build failed with exit code $LASTEXITCODE."
}

$portableReadme = @(
  "Link Checker Portable",
  "",
  "How to use:",
  "1. Extract the whole folder.",
  "2. Run Start Link Checker.exe.",
  "3. The browser opens automatically after the local GUI starts.",
  "4. If you need command-line diagnostics, run gui.cmd instead.",
  "5. Run analyzer.cmd or open the Analyzer link in the GUI to analyze external link exports.",
  "",
  "Command line:",
  "  check-links.cmd https://example.com",
  "  check-links.cmd https://example.com --system-ca",
  "  runtime\node.exe convert-ut1-rules.mjs --input path\to\ut1\blacklists --output ut1-rules.json --pretty",
  "",
  "System CA mode:",
  "  Enable the System CA checkbox for sites trusted by Windows but rejected by Node's bundled CA store.",
  "  You can also start gui.cmd --system-ca to load system roots at startup.",
  "",
  "Notes:",
  "- Keep the whole folder together. Do not move only one cmd file.",
  "- Start Link Checker.exe starts the local server and opens the correct browser URL.",
  "- The local server exits automatically after about 5 minutes with no open GUI page and no running work.",
  "- runtime\node.exe is bundled, so users do not need to install Node.js.",
  "- GUI checks automatically save logs under the logs folder.",
  "- External Link Analyzer imports report.json or external-links.csv and optional domain rules JSON.",
  "- The GUI queue can check multiple sites concurrently on this machine.",
  "- Keep concurrent site checks low for public/government websites."
) -join [Environment]::NewLine

Set-Content -LiteralPath (Join-Path $packageDir "PORTABLE-README.txt") -Value $portableReadme -Encoding UTF8

Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output "Created portable package:"
Write-Output $zipPath
