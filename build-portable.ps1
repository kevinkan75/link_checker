$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$packageName = "LinkChecker-portable"
$packageDir = Join-Path $dist $packageName
$zipPath = Join-Path $dist "$packageName.zip"
$zipHashPath = Join-Path $dist "$packageName.zip.sha256"
$externalManifestPath = Join-Path $dist "$packageName.build-manifest.json"
$runtimeDir = Join-Path $packageDir "runtime"
$launcherSource = Join-Path $root "launcher\StartLinkChecker.cs"
$launcherExe = Join-Path $packageDir "Link Checker.exe"
$packageManifestPath = Join-Path $packageDir "BUILD-MANIFEST.json"
$selfSignedSubject = "CN=Link Checker Local Self-Signed Code Signing"
$selfSignedCertExport = Join-Path $packageDir "LinkChecker-local-code-signing.cer"
$timestampServer = "http://timestamp.digicert.com"

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

function Assert-RequiredPortablePaths {
  param(
    [Parameter(Mandatory = $true)][string]$PackageDir
  )

  $requiredPortablePaths = @(
    "Link Checker.exe",
    "link-checker.mjs",
    "gui-server.mjs",
    "gui.cmd",
    "check-links.cmd",
    "使用說明.txt",
    "runtime\node.exe",
    "public"
  )

  foreach ($relativePath in $requiredPortablePaths) {
    $requiredPath = Join-Path $PackageDir $relativePath
    if (-not (Test-Path -LiteralPath $requiredPath)) {
      throw "Required portable path is missing: $relativePath"
    }
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

function Get-OrCreate-CodeSigningCertificate {
  $now = Get-Date
  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object {
      $_.Subject -eq $selfSignedSubject -and
      $_.NotAfter -gt $now.AddMonths(1) -and
      $_.HasPrivateKey
    } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if ($cert) {
    return $cert
  }

  Write-Host "Creating local self-signed code signing certificate: $selfSignedSubject"
  return New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $selfSignedSubject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -NotAfter $now.AddYears(3)
}

function Sign-PortableLauncher {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  try {
    $cert = Get-OrCreate-CodeSigningCertificate
    Export-Certificate -Cert $cert -FilePath $selfSignedCertExport -Force | Out-Null

    try {
      Set-AuthenticodeSignature `
        -FilePath $FilePath `
        -Certificate $cert `
        -TimestampServer $timestampServer `
        -HashAlgorithm SHA256 | Out-Null
    }
    catch {
      Write-Warning "Timestamped signing failed; retrying without timestamp. $($_.Exception.Message)"
      Set-AuthenticodeSignature `
        -FilePath $FilePath `
        -Certificate $cert `
        -HashAlgorithm SHA256 | Out-Null
    }
  }
  catch {
    Write-Warning "Launcher self-signing skipped: $($_.Exception.Message)"
    if (Test-Path -LiteralPath $selfSignedCertExport) {
      Remove-Item -LiteralPath $selfSignedCertExport -Force
    }
    return $false
  }

  $verifiedSignature = Get-AuthenticodeSignature -FilePath $FilePath
  if (-not $verifiedSignature.SignerCertificate -or $verifiedSignature.Status -eq "HashMismatch" -or $verifiedSignature.Status -eq "NotSigned") {
    Write-Warning "Launcher self-signing did not produce a usable signature: $($verifiedSignature.StatusMessage)"
    if (Test-Path -LiteralPath $selfSignedCertExport) {
      Remove-Item -LiteralPath $selfSignedCertExport -Force
    }
    return $false
  }

  Write-Output "Signed launcher with local self-signed certificate:"
  Write-Output "  $FilePath"
  Write-Output "Certificate exported for manual trust/import:"
  Write-Output "  $selfSignedCertExport"
  Write-Output "Note: Self-signed signatures are not publicly trusted and may not remove SmartScreen warnings."
  return $true
}

function Get-FileSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $null
  }

  return (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  $baseUri = [Uri]([System.IO.Path]::GetFullPath($BasePath).TrimEnd('\') + '\')
  $fileUri = [Uri]([System.IO.Path]::GetFullPath($FilePath))
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString()).Replace('/', '\')
}

function Get-GitValue {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$Fallback = "unknown"
  )

  try {
    $value = & git -C $root @Arguments 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [String]::IsNullOrWhiteSpace($value)) {
      return ($value | Select-Object -First 1).Trim()
    }
  }
  catch {
    return $Fallback
  }

  return $Fallback
}

function Get-SignatureInfo {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $null
  }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  $certificate = $signature.SignerCertificate
  $timestampCertificate = $signature.TimeStamperCertificate

  return [ordered]@{
    status = [string]$signature.Status
    statusMessage = $signature.StatusMessage
    signatureType = [string]$signature.SignatureType
    signerSubject = if ($certificate) { $certificate.Subject } else { $null }
    signerIssuer = if ($certificate) { $certificate.Issuer } else { $null }
    signerThumbprint = if ($certificate) { $certificate.Thumbprint } else { $null }
    signerNotBefore = if ($certificate) { $certificate.NotBefore.ToUniversalTime().ToString("o") } else { $null }
    signerNotAfter = if ($certificate) { $certificate.NotAfter.ToUniversalTime().ToString("o") } else { $null }
    timestampSubject = if ($timestampCertificate) { $timestampCertificate.Subject } else { $null }
  }
}

function Get-BuildMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$NodeExe
  )

  $nodeVersion = "unknown"
  try {
    $nodeVersion = (& $NodeExe --version 2>$null | Select-Object -First 1).Trim()
  }
  catch {
    $nodeVersion = "unknown"
  }

  return [ordered]@{
    packageName = $packageName
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = Get-GitValue -Arguments @("rev-parse", "HEAD")
    gitBranch = Get-GitValue -Arguments @("branch", "--show-current")
    gitStatus = Get-GitValue -Arguments @("status", "--short") -Fallback ""
    nodeVersion = $nodeVersion
  }
}

function Write-PackageBuildManifest {
  param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$LauncherExe
  )

  $files = Get-ChildItem -LiteralPath $PackageDir -Recurse -File |
    Where-Object { $_.FullName -ne $ManifestPath } |
    Sort-Object FullName |
    ForEach-Object {
      [ordered]@{
        path = Get-RelativePath -BasePath $PackageDir -FilePath $_.FullName
        bytes = $_.Length
        sha256 = Get-FileSha256 -FilePath $_.FullName
      }
    }

  $manifest = [ordered]@{
    manifestVersion = 1
    scope = "portable-package"
    build = Get-BuildMetadata -NodeExe $NodeExe
    artifacts = [ordered]@{
      launcher = [ordered]@{
        path = "Link Checker.exe"
        sha256 = Get-FileSha256 -FilePath $LauncherExe
        signature = Get-SignatureInfo -FilePath $LauncherExe
      }
      node = [ordered]@{
        path = "runtime\node.exe"
        sha256 = Get-FileSha256 -FilePath (Join-Path $PackageDir "runtime\node.exe")
        signature = Get-SignatureInfo -FilePath (Join-Path $PackageDir "runtime\node.exe")
      }
    }
    files = $files
    notes = @(
      "This manifest is inside the portable package and therefore does not contain the zip file hash.",
      "The zip hash is written next to the zip in $packageName.build-manifest.json and $packageName.zip.sha256."
    )
  }

  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
}

function Write-ExternalBuildManifest {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$LauncherExe
  )

  $manifest = [ordered]@{
    manifestVersion = 1
    scope = "portable-zip"
    build = Get-BuildMetadata -NodeExe $NodeExe
    artifacts = [ordered]@{
      zip = [ordered]@{
        path = [System.IO.Path]::GetFileName($ZipPath)
        bytes = (Get-Item -LiteralPath $ZipPath).Length
        sha256 = Get-FileSha256 -FilePath $ZipPath
      }
      launcher = [ordered]@{
        path = "$packageName\Link Checker.exe"
        sha256 = Get-FileSha256 -FilePath $LauncherExe
        signature = Get-SignatureInfo -FilePath $LauncherExe
      }
      node = [ordered]@{
        path = "$packageName\runtime\node.exe"
        sha256 = Get-FileSha256 -FilePath (Join-Path $packageDir "runtime\node.exe")
        signature = Get-SignatureInfo -FilePath (Join-Path $packageDir "runtime\node.exe")
      }
      packageManifest = [ordered]@{
        path = "$packageName\BUILD-MANIFEST.json"
        sha256 = Get-FileSha256 -FilePath $packageManifestPath
      }
    }
  }

  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
  Set-Content -LiteralPath $zipHashPath -Value "$($manifest.artifacts.zip.sha256)  $([System.IO.Path]::GetFileName($ZipPath))" -Encoding ASCII
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExe = $nodeCommand.Source
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "node.exe was not found."
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null
Assert-ChildPath -Parent $root -Child $packageDir
Assert-ChildPath -Parent $root -Child $zipPath
Assert-ChildPath -Parent $root -Child $zipHashPath
Assert-ChildPath -Parent $root -Child $externalManifestPath
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
if (Test-Path -LiteralPath $zipHashPath) {
  Remove-Item -LiteralPath $zipHashPath -Force
}
if (Test-Path -LiteralPath $externalManifestPath) {
  Remove-Item -LiteralPath $externalManifestPath -Force
}

New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root "link-checker.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "report-diff.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "gui-server.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "convert-ut1-rules.mjs") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "check-links.cmd") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "gui.cmd") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "使用說明.txt") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "ROADMAP.md") -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root "docs") -Destination $packageDir -Recurse
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

$launcherSigned = Sign-PortableLauncher -FilePath $launcherExe

Assert-RequiredPortablePaths -PackageDir $packageDir

Write-PackageBuildManifest `
  -PackageDir $packageDir `
  -ManifestPath $packageManifestPath `
  -NodeExe (Join-Path $runtimeDir "node.exe") `
  -LauncherExe $launcherExe

Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -CompressionLevel Optimal

Write-ExternalBuildManifest `
  -ZipPath $zipPath `
  -ManifestPath $externalManifestPath `
  -NodeExe (Join-Path $runtimeDir "node.exe") `
  -LauncherExe $launcherExe

Write-Output "Created portable package:"
Write-Output $zipPath
Write-Output "Created build manifests:"
Write-Output $packageManifestPath
Write-Output $externalManifestPath
Write-Output $zipHashPath
