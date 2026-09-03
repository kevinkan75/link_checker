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
$launcherExe = Join-Path $packageDir "Start Link Checker.exe"
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
        path = "Start Link Checker.exe"
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
        path = "$packageName\Start Link Checker.exe"
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

function Write-PortableCommandScripts {
  param(
    [Parameter(Mandatory = $true)][string]$PackageDir
  )

  $checkLinksCmd = @'
@echo off
setlocal
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo Link Checker portable runtime was not found:
  echo   %NODE_EXE%
  echo Please extract the complete portable folder again, then retry.
  exit /b 1
)
"%NODE_EXE%" "%~dp0link-checker.mjs" %*
'@

  $guiCmd = @'
@echo off
setlocal
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo Link Checker portable runtime was not found:
  echo   %NODE_EXE%
  echo Please extract the complete portable folder again, then retry.
  exit /b 1
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
'@

  $analyzerCmd = @'
@echo off
setlocal
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo Link Checker portable runtime was not found:
  echo   %NODE_EXE%
  echo Please extract the complete portable folder again, then retry.
  exit /b 1
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
'@

  Set-Content -LiteralPath (Join-Path $PackageDir "check-links.cmd") -Value $checkLinksCmd -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $PackageDir "gui.cmd") -Value $guiCmd -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $PackageDir "analyzer.cmd") -Value $analyzerCmd -Encoding ASCII
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
Write-PortableCommandScripts -PackageDir $packageDir
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
function Decode-Utf8Base64Text {
  param(
    [Parameter(Mandatory = $true)][string]$Value
  )

  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

$portableReadmePrefix = Decode-Utf8Base64Text "TGluayBDaGVja2VyIOWPr+aUnOeJiAoK5L2/55So5pa55byP77yaCjEuIOino+Wjk+e4ruaVtOWAi+izh+aWmeWkvu+8jOiri+S4jeimgeWPquenu+WLleWFtuS4reS4gOWAi+aqlOahiOOAggoyLiDln7fooYwgU3RhcnQgTGluayBDaGVja2VyLmV4ZeOAggozLiDmnKzmqZ8gR1VJIOWVn+WLleW+jO+8jOeAj+imveWZqOacg+iHquWLlemWi+WVn+OAggo0LiDoi6XpnIDopoHlkb3ku6TliJfoqLrmlrfvvIzlj6/mlLnnlKggZ3VpLmNtZCDllZ/li5XjgIIKNS4g6Iul6KaB5YiG5p6Q5aSW6YCj5Yyv5Ye66LOH5paZ77yM5Y+v5Z+36KGMIGFuYWx5emVyLmNtZO+8jOaIluW+niBHVUkg6ZaL5ZWf5aSW6YOo6YCj57WQ5YiG5p6Q6aCB44CCCgrlkb3ku6TliJfnr4TkvovvvJoKICBjaGVjay1saW5rcy5jbWQgaHR0cHM6Ly9leGFtcGxlLmNvbQogIGNoZWNrLWxpbmtzLmNtZCBodHRwczovL2V4YW1wbGUuY29tIC0tc3lzdGVtLWNhCiAgcnVudGltZVxub2RlLmV4ZSByZXBvcnQtZGlmZi5tanMgb2xkLXJlcG9ydC5qc29uIG5ldy1yZXBvcnQuanNvbiAtLW91dHB1dCBkaWZmLmpzb24KICBydW50aW1lXG5vZGUuZXhlIGNvbnZlcnQtdXQxLXJ1bGVzLm1qcyAtLWlucHV0IHBhdGhcdG9cdXQxXGJsYWNrbGlzdHMgLS1vdXRwdXQgdXQxLXJ1bGVzLmpzb24gLS1wcmV0dHkKClN5c3RlbSBDQSDmqKHlvI/vvJoKICDoi6XntrLnq5nlj5cgV2luZG93cyDkv6Hku7vvvIzkvYbooqsgYnVuZGxlZCBOb2RlIENBIHN0b3JlIOaLkue1le+8jOWPr+WcqCBHVUkg5Yu+6YG4IFN5c3RlbSBDQeOAggogIOS5n+WPr+S7peeUqCBndWkuY21kIC0tc3lzdGVtLWNhIOWVn+WLle+8jOiukyBHVUkg5LiA6ZaL5aeL5bCx6LyJ5YWl57O757Wx5qC55oaR6K2J44CCCgpCdWlsZCDlrozmlbTmgKfvvJoKLSBCVUlMRC1NQU5JRkVTVC5qc29uIOacg+WIl+WHuuatpOWPr+aUnOizh+aWmeWkvuWFp+eahOaqlOahiOiIhyBTSEEyNTbjgIIKLSBMaW5rQ2hlY2tlci1wb3J0YWJsZS5idWlsZC1tYW5pZmVzdC5qc29uIOiIhyBMaW5rQ2hlY2tlci1wb3J0YWJsZS56aXAuc2hhMjU2IOacg+i8uOWHuuWcqCB6aXAg5peB6YKK44CCCi0g5pWj5biD5YmN6KuL55So5aSW6YOoIG1hbmlmZXN0IOmpl+itiSB6aXAgaGFzaOOAggoK5a6J5YWo5qih5Z6L77yaCi0gR1VJIHNlcnZlciDlj6ogbGlzdGVuIDEyNy4wLjAuMe+8jOS4jeacg+aatOmcsuWIsOe2sui3r+OAggotIOatpOWPr+aUnOeJiOS4jeacg+WuieijnSBXaW5kb3dzIHNlcnZpY2XjgIIKLSDmraTlj6/mlJzniYjkuI3mnIPlr6vlhaUgcmVnaXN0cnkg5ZWf5YuV6aCF55uu44CCCi0g5q2k5Y+v5pSc54mI5LiN5pyD6Kit5a6a6ZaL5qmf6Ieq5YuV5ZWf5YuV44CCCi0g5q2k5Y+v5pSc54mI5LiN5pyD6YCj5o6l6YGg56uv5o6n5Yi25Ly65pyN5Zmo44CCCi0g5Y+v5pSc54mIIC5jbWQg5qqU5Y+q5L2/55SoIGJ1bmRsZWQgcnVudGltZVxub2RlLmV4Ze+8m+iLpSBydW50aW1lIOS4jeWtmOWcqOacg+ebtOaOpeWBnOatouOAggoK5rOo5oSP5LqL6aCF77yaCi0g6KuL5L+d5oyB5pW05YCL6LOH5paZ5aS+5a6M5pW077yM5LiN6KaB5Y+q56e75YuV5Zau5LiAIGNtZCDmqpTjgIIKLSBTdGFydCBMaW5rIENoZWNrZXIuZXhlIOacg+WVn+WLleacrOapn+acjeWLmeS4pumWi+WVn+ato+eiuueahOeAj+imveWZqOe2suWdgOOAggotIOiLpeaykuaciemWi+WVn+S4reeahCBHVUkg6aCB6Z2i5LiU5rKS5pyJ5Z+36KGM5Lit55qE5bel5L2c77yM5pys5qmf5pyN5YuZ57SEIDUg5YiG6ZCY5b6M5pyD6Ieq5YuV57WQ5p2f44CCCi0g5beyIGJ1bmRsZWQgcnVudGltZVxub2RlLmV4Ze+8jOS9v+eUqOiAheS4jemcgOimgeWPpuWkluWuieijnSBOb2RlLmpz44CC"
$portableSignedNote = Decode-Utf8Base64Text "LSBTdGFydCBMaW5rIENoZWNrZXIuZXhlIOW3sueUqCBidWlsZCBzY3JpcHQg55Si55Sf55qE5pys5qmf6Ieq57C95oaR6K2J57C9572y44CCCi0g5pys5qmf6Ieq57C95oaR6K2J5LiN5piv5YWs6ZaL5L+h5Lu755qEIGNvZGUgc2lnbmluZ++8jOWPr+iDveeEoeazlea2iOmZpCBXaW5kb3dzIFNtYXJ0U2NyZWVuIOitpuWRiuOAggotIExpbmtDaGVja2VyLWxvY2FsLWNvZGUtc2lnbmluZy5jZXIg5piv5pys5qyh57C9572y5oaR6K2J55qE5YWs6ZaL5oaR6K2J77yM5Y+q5L6b5YWn6YOo5omL5YuV5L+h5Lu75oiW5Yyv5YWl5rWB56iL5L2/55So77yb5LiN6ZyA6KaB5LiA6Iis5L2/55So6ICF5a6J6KOd77yM5Lmf5LiN5Luj6KGoIHppcCDkvobmupDlt7LnlLHlhazplosgQ0Eg6IOM5pu444CC"
$portableUnsignedNote = Decode-Utf8Base64Text "LSBTdGFydCBMaW5rIENoZWNrZXIuZXhlIOWcqOatpCBidWlsZCDkuK3mnKrnsL3nvbLvvIzljp/lm6DmmK/mnKzmqZ/oh6rnsL3mtYHnqIvkuI3lj6/nlKjjgIIKLSDmlaPluIPliY3oq4vkvb/nlKggTGlua0NoZWNrZXItcG9ydGFibGUuemlwLnNoYTI1NiDoiIflpJbpg6ggYnVpbGQgbWFuaWZlc3Qg6amX6K2JIExpbmtDaGVja2VyLXBvcnRhYmxlLnppcOOAggotIOacquewvee9sueahOacrOapnyBsYXVuY2hlciBidWlsZCDlj6/og73op7jnmbwgU21hcnRTY3JlZW4g5oiW56uv6bue6Ziy6K235o+Q56S644CCCi0g6IiK5YyF5oiW5omL5YuV5YyF6KOd6Iul5Ye654++IExpbmtDaGVja2VyLWxvY2FsLWNvZGUtc2lnbmluZy5jZXLvvIzoq4voppbngrrnsL3nvbLlmJfoqabmrpjnlZnmqpTvvJvmnKrnsL3nvbIgYnVpbGQg5LiN6ZyA6KaB5a6J6KOd5q2k5oaR6K2J77yM5LiU5paw54mIIGJ1aWxkIHNjcmlwdCDmnIPlnKjmiZPljIXmmYLnp7vpmaTlroPjgII="
$portableReadmeSuffix = Decode-Utf8Base64Text "LSBHVUkg5qqi5p+l5pyD6Ieq5YuV5bCH57SA6YyE5YSy5a2Y5ZyoIGxvZ3Mg6LOH5paZ5aS+44CCCi0g5aSW6YOo6YCj57WQ5YiG5p6Q5Y+v5Yyv5YWlIHJlcG9ydC5qc29uIOaIliBleHRlcm5hbC1saW5rcy5jc3bvvIzkuZ/lj6/mkK3phY3pgbjnlKjnmoQgZG9tYWluIHJ1bGVzIEpTT07jgIIKLSBHVUkg5L2H5YiX5Y+v5Zyo5pys5qmf5ZCM5pmC5qqi5p+l5aSa5YCL57ay56uZ44CCCi0g5qqi5p+l5YWs6ZaL5oiW5pS/5bqc57ay56uZ5pmC77yM5bu66K2w57at5oyB6LyD5L2O55qE5ZCM5pmC5qqi5p+l57ay56uZ5pW444CC"

$portableSignatureNote = if ($launcherSigned) { $portableSignedNote } else { $portableUnsignedNote }
$portableReadme = @($portableReadmePrefix, $portableSignatureNote, $portableReadmeSuffix) -join [Environment]::NewLine

Set-Content -LiteralPath (Join-Path $packageDir "PORTABLE-README.txt") -Value $portableReadme -Encoding UTF8

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
