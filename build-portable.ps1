$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$packageName = "LinkChecker-portable"
$packageDir = Join-Path $dist $packageName
$zipPath = Join-Path $dist "$packageName.zip"
$runtimeDir = Join-Path $packageDir "runtime"

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

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExe = $nodeCommand.Source
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "node.exe was not found."
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null
Assert-ChildPath -Parent $root -Child $packageDir
Assert-ChildPath -Parent $root -Child $zipPath

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

$portableReadme = @(
  "Link Checker Portable",
  "",
  "How to use:",
  "1. Extract the whole folder.",
  "2. Run gui.cmd.",
  "3. Open http://127.0.0.1:8787 in your browser.",
  "4. Run analyzer.cmd or open http://127.0.0.1:8787/analyzer.html to analyze external link exports.",
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
