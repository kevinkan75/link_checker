[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$DistPath = "dist"
)

$ErrorActionPreference = "Stop"

$checkIds = @(
    "PARAM_VERSION", "PARAM_DIST_PATH", "REPO_ROOT",
    "TOOL_GIT", "TOOL_FILEHASH", "TOOL_AUTHENTICODE",
    "GIT_FETCH", "GIT_BRANCH", "GIT_HEAD", "GIT_ORIGIN_MAIN", "GIT_WORKTREE",
    "VERSION_TOOL", "VERSION_REPORT_DIFF", "VERSION_LAUNCHER", "VERSION_README",
    "SCHEMA_REPORT_COHERENCE",
    "ARTIFACT_PACKAGE_DIR", "ARTIFACT_ZIP", "ARTIFACT_ZIP_SHA256",
    "ARTIFACT_EXTERNAL_MANIFEST", "ARTIFACT_PACKAGE_MANIFEST",
    "ARTIFACT_LAUNCHER", "ARTIFACT_NODE", "ARTIFACT_USAGE_GUIDE",
    "MANIFEST_EXTERNAL", "MANIFEST_PACKAGE", "MANIFEST_SOURCE",
    "MANIFEST_PACKAGE_FILES", "MANIFEST_ARTIFACTS", "PACKAGE_VERSION_COHERENCE",
    "HASH_ZIP_SHA256_SEMANTIC", "SIGNATURE_NODE", "SIGNATURE_LAUNCHER",
    "REPOSITORY_UNCHANGED", "INTERNAL_ERROR"
)

$checks = [ordered]@{}
$checkMessages = @{}
foreach ($id in $checkIds) { $checks[$id] = "SKIPPED" }

$finalExitCode = 2
$failureClass = "NONE"
$locationPushed = $false
$repositoryRoot = $null
$resolvedDistPath = $null
$gitPath = $null
$sourceCommit = "UNKNOWN"
$repositoryHeadBefore = "UNKNOWN"
$repositoryStatusBefore = "UNKNOWN"
$reportSchemaVersion = "UNKNOWN"
$zipSha256 = "UNKNOWN"
$packageFileCount = "UNKNOWN"
$nodeSignatureStatus = "UNKNOWN"
$nodeSigner = "NONE"
$launcherSignatureStatus = "UNKNOWN"
$launcherSigner = "NONE"

function Set-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Status,
        [string]$Message
    )
    if (-not $checks.Contains($Id)) { throw "Unknown check ID: $Id" }
    $checks[$Id] = $Status
    if (-not [string]::IsNullOrWhiteSpace($Message)) { $checkMessages[$Id] = $Message }
}

function Set-Failure {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Class,
        [Parameter(Mandatory = $true)][string]$Message
    )
    Set-Check -Id $Id -Status "FAIL" -Message $Message
    switch ($Class) {
        "INVALID_INVOCATION" {
            $script:failureClass = "INVALID_INVOCATION"
            $script:finalExitCode = 3
        }
        "INFRASTRUCTURE" {
            if ($script:failureClass -ne "INVALID_INVOCATION") {
                $script:failureClass = "INFRASTRUCTURE"
                $script:finalExitCode = 2
            }
        }
        "INVARIANT" {
            if ($script:failureClass -notin @("INVALID_INVOCATION", "INFRASTRUCTURE")) {
                $script:failureClass = "INVARIANT"
                $script:finalExitCode = 1
            }
        }
        default { throw "Unknown failure class: $Class" }
    }
}

function Test-AnyFailed {
    param([string[]]$Ids)
    foreach ($id in $Ids) {
        if ($checks[$id] -eq "FAIL") { return $true }
    }
    return $false
}

function Test-AllPassed {
    param([string[]]$Ids)
    foreach ($id in $Ids) {
        if ($checks[$id] -ne "PASS") { return $false }
    }
    return $true
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{ Output = $output; ExitCode = $exitCode; StartError = $null }
    }
    catch {
        return [pscustomobject]@{ Output = @(); ExitCode = $null; StartError = $_.Exception.Message }
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Get-NormalizedSha256 {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-UniqueRegexValue {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Pattern
    )
    $content = [IO.File]::ReadAllText($LiteralPath)
    $matches = [regex]::Matches($content, $Pattern)
    if ($matches.Count -ne 1) {
        throw "Expected exactly one semantic value in $LiteralPath; found $($matches.Count)."
    }
    return $matches[0].Groups["value"].Value
}

function Test-VersionSurface {
    param(
        [Parameter(Mandatory = $true)][string]$CheckId,
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Expected
    )
    try {
        $actual = Get-UniqueRegexValue -LiteralPath $LiteralPath -Pattern $Pattern
        if ($actual -ceq $Expected) { Set-Check $CheckId "PASS" }
        else { Set-Failure $CheckId "INVARIANT" "Expected '$Expected'; found '$actual'." }
        return $actual
    }
    catch {
        Set-Failure $CheckId "INVARIANT" $_.Exception.Message
        return $null
    }
}

function ConvertTo-SafeRelativePath {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    if ([IO.Path]::IsPathRooted($PathValue) -or $PathValue.IndexOf(":") -ge 0) {
        throw "Package path is absolute or drive-qualified: $PathValue"
    }
    $parts = @($PathValue -split "[\\/]+" | Where-Object { $_ -ne "" })
    if ($parts.Count -eq 0 -or $parts -contains "." -or $parts -contains "..") {
        throw "Package path is empty or contains traversal: $PathValue"
    }
    return [string]::Join("\", $parts)
}

function Get-RelativeFilePath {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$FilePath
    )
    $prefix = $BasePath.TrimEnd("\") + "\"
    if (-not $FilePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "File is outside expected base path: $FilePath"
    }
    return $FilePath.Substring($prefix.Length)
}

function Write-FinalOutput {
    $failed = New-Object System.Collections.Generic.List[string]
    foreach ($id in $checkIds) {
        Write-Output "CHECK_$id=$($checks[$id])"
        if ($checks[$id] -eq "FAIL") {
            [void]$failed.Add($id)
            if ($checkMessages.ContainsKey($id)) {
                [Console]::Error.WriteLine("[DETAIL] $id`: $($checkMessages[$id])")
            }
        }
    }
    $failedLabel = if ($failed.Count -eq 0) { "NONE" } else { [string]::Join(",", $failed.ToArray()) }
    $result = if ($script:finalExitCode -eq 0) { "PASS" } else { "FAIL" }
    Write-Output "VERSION=$Version"
    Write-Output "SOURCE_COMMIT=$sourceCommit"
    Write-Output "REPORT_SCHEMA_VERSION=$reportSchemaVersion"
    Write-Output "ZIP_SHA256=$zipSha256"
    Write-Output "PACKAGE_FILE_COUNT=$packageFileCount"
    Write-Output "NODE_SIGNATURE=$nodeSignatureStatus"
    Write-Output "NODE_SIGNER=$nodeSigner"
    Write-Output "LAUNCHER_SIGNATURE=$launcherSignatureStatus"
    Write-Output "LAUNCHER_SIGNER=$launcherSigner"
    Write-Output "FAILURE_CLASS=$failureClass"
    Write-Output "FAILED_CHECKS=$failedLabel"
    Write-Output "RELEASE_PREFLIGHT_RESULT=$result"
}

try {
    $semverPattern = "^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"
    $sha1Pattern = "^[0-9a-fA-F]{40}$"
    $sha256Pattern = "^[0-9a-fA-F]{64}$"

    if ($Version -match $semverPattern) { Set-Check "PARAM_VERSION" "PASS" }
    else { Set-Failure "PARAM_VERSION" "INVALID_INVOCATION" "Version must be SemVer core only." }

    if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        Set-Failure "REPO_ROOT" "INFRASTRUCTURE" "PSScriptRoot is unavailable."
    }
    else {
        $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
        if (Test-Path -LiteralPath $repositoryRoot -PathType Container) { Set-Check "REPO_ROOT" "PASS" }
        else { Set-Failure "REPO_ROOT" "INFRASTRUCTURE" "Derived repository root does not exist." }
    }

    if ($checks["REPO_ROOT"] -eq "PASS") {
        try {
            $distParts = @($DistPath -split "[\\/]+" | Where-Object { $_ -ne "" })
            if ($distParts -contains "..") { throw "DistPath may not contain '..'." }
            $candidateDist = if ([IO.Path]::IsPathRooted($DistPath)) {
                [IO.Path]::GetFullPath($DistPath)
            }
            else {
                [IO.Path]::GetFullPath((Join-Path $repositoryRoot $DistPath))
            }
            $rootPrefix = $repositoryRoot.TrimEnd("\") + "\"
            if ($candidateDist -eq $repositoryRoot -or -not $candidateDist.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "DistPath must resolve to a child of the repository root."
            }
            $resolvedDistPath = $candidateDist
            Set-Check "PARAM_DIST_PATH" "PASS"
        }
        catch { Set-Failure "PARAM_DIST_PATH" "INVALID_INVOCATION" $_.Exception.Message }
    }

    if (-not (Test-AnyFailed @("PARAM_VERSION", "PARAM_DIST_PATH", "REPO_ROOT"))) {
        Push-Location -LiteralPath $repositoryRoot
        $locationPushed = $true

        $gitCommand = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($gitCommand) { $gitPath = $gitCommand.Source; Set-Check "TOOL_GIT" "PASS" }
        else { Set-Failure "TOOL_GIT" "INFRASTRUCTURE" "git is unavailable." }
        if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) { Set-Check "TOOL_FILEHASH" "PASS" }
        else { Set-Failure "TOOL_FILEHASH" "INFRASTRUCTURE" "Get-FileHash is unavailable." }
        if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) { Set-Check "TOOL_AUTHENTICODE" "PASS" }
        else { Set-Failure "TOOL_AUTHENTICODE" "INFRASTRUCTURE" "Get-AuthenticodeSignature is unavailable." }

        if ($checks["TOOL_GIT"] -eq "PASS") {
            $gitProbe = Invoke-NativeCommand $gitPath @("--version")
            if ($gitProbe.ExitCode -ne 0) { Set-Failure "TOOL_GIT" "INFRASTRUCTURE" "git usability check failed." }
        }
    }

    $toolIds = @("TOOL_GIT", "TOOL_FILEHASH", "TOOL_AUTHENTICODE")
    if ($locationPushed -and -not (Test-AnyFailed $toolIds)) {
        $beforeHead = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
        $beforeStatus = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")
        if ($beforeHead.ExitCode -ne 0 -or $beforeStatus.ExitCode -ne 0) {
            Set-Failure "GIT_HEAD" "INFRASTRUCTURE" "Unable to record repository identity."
        }
        else {
            $repositoryHeadBefore = (@($beforeHead.Output) -join "`n").Trim()
            $repositoryStatusBefore = (@($beforeStatus.Output) -join "`n").Trim()
        }

        $fetch = Invoke-NativeCommand $gitPath @("fetch", "--no-tags", "origin")
        if ($fetch.ExitCode -eq 0) { Set-Check "GIT_FETCH" "PASS" }
        else { Set-Failure "GIT_FETCH" "INFRASTRUCTURE" "git fetch --no-tags origin failed." }

        if ($checks["GIT_FETCH"] -eq "PASS") {
            $branch = Invoke-NativeCommand $gitPath @("branch", "--show-current")
            $head = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
            $originMain = Invoke-NativeCommand $gitPath @("rev-parse", "origin/main")
            $status = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")

            if ($branch.ExitCode -eq 0 -and ((@($branch.Output) -join "").Trim() -ceq "main")) { Set-Check "GIT_BRANCH" "PASS" }
            else { Set-Failure "GIT_BRANCH" "INVARIANT" "Current branch must be main." }

            if ($head.ExitCode -eq 0) {
                $sourceCommit = ((@($head.Output) -join "").Trim()).ToLowerInvariant()
                if ($sourceCommit -match $sha1Pattern) { Set-Check "GIT_HEAD" "PASS" }
                else { Set-Failure "GIT_HEAD" "INFRASTRUCTURE" "HEAD is not a full commit SHA." }
            }
            else { Set-Failure "GIT_HEAD" "INFRASTRUCTURE" "Unable to resolve HEAD." }

            if ($originMain.ExitCode -eq 0 -and ((@($originMain.Output) -join "").Trim() -ieq $sourceCommit)) { Set-Check "GIT_ORIGIN_MAIN" "PASS" }
            elseif ($originMain.ExitCode -ne 0) { Set-Failure "GIT_ORIGIN_MAIN" "INFRASTRUCTURE" "Unable to resolve origin/main." }
            else { Set-Failure "GIT_ORIGIN_MAIN" "INVARIANT" "HEAD does not equal origin/main." }

            if ($status.ExitCode -eq 0 -and [string]::IsNullOrEmpty((@($status.Output) -join "`n").Trim())) { Set-Check "GIT_WORKTREE" "PASS" }
            elseif ($status.ExitCode -ne 0) { Set-Failure "GIT_WORKTREE" "INFRASTRUCTURE" "Unable to query worktree status." }
            else { Set-Failure "GIT_WORKTREE" "INVARIANT" "Nonignored worktree changes are present." }
        }
    }

    $sourceIds = @("GIT_FETCH", "GIT_BRANCH", "GIT_HEAD", "GIT_ORIGIN_MAIN", "GIT_WORKTREE")
    if ($locationPushed -and -not (Test-AnyFailed $sourceIds)) {
        $linkCheckerPath = Join-Path $repositoryRoot "link-checker.mjs"
        $reportDiffPath = Join-Path $repositoryRoot "report-diff.mjs"
        $launcherSourcePath = Join-Path $repositoryRoot "launcher\StartLinkChecker.cs"
        $readmePath = Join-Path $repositoryRoot "README.md"
        $schemaPath = Join-Path $repositoryRoot "schemas\report.schema.json"

        [void](Test-VersionSurface "VERSION_TOOL" $linkCheckerPath 'const\s+TOOL_VERSION\s*=\s*"(?<value>[^"]+)"\s*;' $Version)
        [void](Test-VersionSurface "VERSION_REPORT_DIFF" $reportDiffPath 'const\s+GENERATOR_VERSION\s*=\s*"(?<value>[^"]+)"\s*;' $Version)
        [void](Test-VersionSurface "VERSION_README" $readmePath '(?m)^\s*\u76ee\u524d\u6b63\u5f0f\u7248\u672c\uff1a\s*`v(?<value>[^`]+)`\s*$' $Version)

        try {
            $assembly = Get-UniqueRegexValue $launcherSourcePath 'AssemblyVersion\("(?<value>[^"]+)"\)'
            $file = Get-UniqueRegexValue $launcherSourcePath 'AssemblyFileVersion\("(?<value>[^"]+)"\)'
            $info = Get-UniqueRegexValue $launcherSourcePath 'AssemblyInformationalVersion\("(?<value>[^"]+)"\)'
            if ($assembly -ceq "$Version.0" -and $file -ceq "$Version.0" -and $info -ceq "$Version-portable") { Set-Check "VERSION_LAUNCHER" "PASS" }
            else { Set-Failure "VERSION_LAUNCHER" "INVARIANT" "Launcher source versions do not match Version." }
        }
        catch { Set-Failure "VERSION_LAUNCHER" "INVARIANT" $_.Exception.Message }

        try {
            $reportSchemaVersion = Get-UniqueRegexValue $linkCheckerPath 'const\s+REPORT_SCHEMA_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
            $schema = [IO.File]::ReadAllText($schemaPath) | ConvertFrom-Json
            if ([string]$schema.properties.schemaVersion.const -cne $reportSchemaVersion) {
                throw "Report source and schema JSON versions differ."
            }
            Set-Check "SCHEMA_REPORT_COHERENCE" "PASS"
        }
        catch { Set-Failure "SCHEMA_REPORT_COHERENCE" "INVARIANT" $_.Exception.Message }
    }

    $versionIds = @("VERSION_TOOL", "VERSION_REPORT_DIFF", "VERSION_LAUNCHER", "VERSION_README", "SCHEMA_REPORT_COHERENCE")
    if ($locationPushed -and -not (Test-AnyFailed $versionIds)) {
        $packageDir = Join-Path $resolvedDistPath "LinkChecker-portable"
        $zipPath = Join-Path $resolvedDistPath "LinkChecker-portable.zip"
        $zipHashPath = Join-Path $resolvedDistPath "LinkChecker-portable.zip.sha256"
        $externalManifestPath = Join-Path $resolvedDistPath "LinkChecker-portable.build-manifest.json"
        $packageManifestPath = Join-Path $packageDir "BUILD-MANIFEST.json"
        $launcherPath = Join-Path $packageDir "Link Checker.exe"
        $bundledNodePath = Join-Path $packageDir "runtime\node.exe"
        $usageGuidePath = Join-Path $packageDir "使用說明.txt"

        $artifactChecks = @(
            @{ Id = "ARTIFACT_PACKAGE_DIR"; Path = $packageDir; Type = "Container" },
            @{ Id = "ARTIFACT_ZIP"; Path = $zipPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_ZIP_SHA256"; Path = $zipHashPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_EXTERNAL_MANIFEST"; Path = $externalManifestPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_PACKAGE_MANIFEST"; Path = $packageManifestPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_LAUNCHER"; Path = $launcherPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_NODE"; Path = $bundledNodePath; Type = "Leaf" },
            @{ Id = "ARTIFACT_USAGE_GUIDE"; Path = $usageGuidePath; Type = "Leaf" }
        )
        foreach ($artifact in $artifactChecks) {
            if (Test-Path -LiteralPath $artifact.Path -PathType $artifact.Type) { Set-Check $artifact.Id "PASS" }
            else { Set-Failure $artifact.Id "INVARIANT" "Required artifact is missing: $($artifact.Path)" }
        }

        $artifactIds = @($artifactChecks | ForEach-Object { $_.Id })
        if (-not (Test-AnyFailed $artifactIds)) {
            $externalManifest = $null
            $packageManifest = $null
            try {
                $externalManifest = [IO.File]::ReadAllText($externalManifestPath) | ConvertFrom-Json
                if ([int]$externalManifest.manifestVersion -ne 1 -or [string]$externalManifest.scope -cne "portable-zip") {
                    throw "Unsupported external manifest format or scope."
                }
                Set-Check "MANIFEST_EXTERNAL" "PASS"
            }
            catch { Set-Failure "MANIFEST_EXTERNAL" "INVARIANT" $_.Exception.Message }

            try {
                $packageManifest = [IO.File]::ReadAllText($packageManifestPath) | ConvertFrom-Json
                if ([int]$packageManifest.manifestVersion -ne 1 -or [string]$packageManifest.scope -cne "portable-package") {
                    throw "Unsupported package manifest format or scope."
                }
                Set-Check "MANIFEST_PACKAGE" "PASS"
            }
            catch { Set-Failure "MANIFEST_PACKAGE" "INVARIANT" $_.Exception.Message }

            if (-not (Test-AnyFailed @("MANIFEST_EXTERNAL", "MANIFEST_PACKAGE"))) {
                try {
                    $sourceCoherent = [string]$externalManifest.build.gitCommit -ieq $sourceCommit -and
                        [string]$packageManifest.build.gitCommit -ieq $sourceCommit -and
                        [string]$externalManifest.build.gitBranch -ceq "main" -and
                        [string]$packageManifest.build.gitBranch -ceq "main" -and
                        [string]::IsNullOrEmpty([string]$externalManifest.build.gitStatus) -and
                        [string]::IsNullOrEmpty([string]$packageManifest.build.gitStatus) -and
                        [string]$externalManifest.build.nodeVersion -ceq [string]$packageManifest.build.nodeVersion
                    if (-not $sourceCoherent) { throw "Manifest source/build identity is not coherent with HEAD." }
                    Set-Check "MANIFEST_SOURCE" "PASS"
                }
                catch { Set-Failure "MANIFEST_SOURCE" "INVARIANT" $_.Exception.Message }

                try {
                    $manifestPaths = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
                    foreach ($entry in @($packageManifest.files)) {
                        $relative = ConvertTo-SafeRelativePath ([string]$entry.path)
                        if ($manifestPaths.ContainsKey($relative)) { throw "Duplicate package manifest path: $relative" }
                        if ([string]$entry.sha256 -notmatch $sha256Pattern) { throw "Invalid package manifest SHA256: $relative" }
                        $manifestPaths.Add($relative, $entry)
                        $filePath = Join-Path $packageDir $relative
                        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Manifest-listed package file is missing: $relative" }
                        $item = Get-Item -LiteralPath $filePath
                        if ([int64]$entry.bytes -ne $item.Length) { throw "Package file size mismatch: $relative" }
                        if ((Get-NormalizedSha256 $filePath) -ine [string]$entry.sha256) { throw "Package file hash mismatch: $relative" }
                    }
                    $actualPackageFiles = @(Get-ChildItem -LiteralPath $packageDir -Recurse -File | Where-Object { $_.FullName -ne $packageManifestPath })
                    if ($actualPackageFiles.Count -ne $manifestPaths.Count) { throw "Package contains unlisted or missing files." }
                    foreach ($fileItem in $actualPackageFiles) {
                        $relative = Get-RelativeFilePath $packageDir $fileItem.FullName
                        if (-not $manifestPaths.ContainsKey($relative)) { throw "Unexpected package file: $relative" }
                    }
                    $packageFileCount = $manifestPaths.Count
                    Set-Check "MANIFEST_PACKAGE_FILES" "PASS"
                }
                catch { Set-Failure "MANIFEST_PACKAGE_FILES" "INVARIANT" $_.Exception.Message }

                try {
                    $packageTool = Get-UniqueRegexValue (Join-Path $packageDir "link-checker.mjs") 'const\s+TOOL_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $packageSchema = Get-UniqueRegexValue (Join-Path $packageDir "link-checker.mjs") 'const\s+REPORT_SCHEMA_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $packageGenerator = Get-UniqueRegexValue (Join-Path $packageDir "report-diff.mjs") 'const\s+GENERATOR_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $binaryVersion = [Reflection.AssemblyName]::GetAssemblyName($launcherPath).Version.ToString()
                    $versionInfo = (Get-Item -LiteralPath $launcherPath).VersionInfo
                    if ($packageTool -cne $Version -or $packageSchema -cne $reportSchemaVersion -or
                        $packageGenerator -cne $Version -or $binaryVersion -cne "$Version.0" -or
                        $versionInfo.FileVersion -cne "$Version.0" -or $versionInfo.ProductVersion -cne "$Version-portable") {
                        throw "Package version surfaces do not match source semantics."
                    }
                    Set-Check "PACKAGE_VERSION_COHERENCE" "PASS"
                }
                catch { Set-Failure "PACKAGE_VERSION_COHERENCE" "INVARIANT" $_.Exception.Message }

                try {
                    $zipSha256 = Get-NormalizedSha256 $zipPath
                    $packageManifestSha256 = Get-NormalizedSha256 $packageManifestPath
                    $launcherSha256 = Get-NormalizedSha256 $launcherPath
                    $nodeSha256 = Get-NormalizedSha256 $bundledNodePath
                    $artifactCoherent = [string]$externalManifest.artifacts.zip.path -ceq "LinkChecker-portable.zip" -and
                        [string]$externalManifest.artifacts.zip.sha256 -ieq $zipSha256 -and
                        [int64]$externalManifest.artifacts.zip.bytes -eq (Get-Item -LiteralPath $zipPath).Length -and
                        [string]$externalManifest.artifacts.packageManifest.sha256 -ieq $packageManifestSha256 -and
                        [string]$externalManifest.artifacts.launcher.sha256 -ieq $launcherSha256 -and
                        [string]$externalManifest.artifacts.node.sha256 -ieq $nodeSha256 -and
                        [string]$packageManifest.artifacts.launcher.sha256 -ieq $launcherSha256 -and
                        [string]$packageManifest.artifacts.node.sha256 -ieq $nodeSha256
                    if (-not $artifactCoherent) { throw "Manifest artifact relationships are inconsistent." }
                    Set-Check "MANIFEST_ARTIFACTS" "PASS"
                }
                catch { Set-Failure "MANIFEST_ARTIFACTS" "INVARIANT" $_.Exception.Message }

                try {
                    if ($zipSha256 -notmatch $sha256Pattern) { $zipSha256 = Get-NormalizedSha256 $zipPath }
                    $records = @([IO.File]::ReadAllLines($zipHashPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                    if ($records.Count -ne 1) { throw "ZIP SHA256 file must contain exactly one record." }
                    $record = [regex]::Match($records[0], '^\s*(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>[^\s]+)\s*$')
                    if (-not $record.Success -or $record.Groups["hash"].Value -ine $zipSha256 -or
                        $record.Groups["name"].Value -cne "LinkChecker-portable.zip") {
                        throw "ZIP SHA256 semantic record does not identify the built ZIP."
                    }
                    Set-Check "HASH_ZIP_SHA256_SEMANTIC" "PASS"
                }
                catch { Set-Failure "HASH_ZIP_SHA256_SEMANTIC" "INVARIANT" $_.Exception.Message }

                try {
                    $nodeSignature = Get-AuthenticodeSignature -LiteralPath $bundledNodePath
                    $nodeSignatureStatus = $nodeSignature.Status.ToString()
                    $nodeSigner = if ($nodeSignature.SignerCertificate) { $nodeSignature.SignerCertificate.Subject } else { "NONE" }
                    if ($nodeSignatureStatus -cne "Valid") { throw "Bundled Node Authenticode status must be Valid; found $nodeSignatureStatus." }
                    Set-Check "SIGNATURE_NODE" "PASS"
                }
                catch { Set-Failure "SIGNATURE_NODE" "INVARIANT" $_.Exception.Message }

                try {
                    $launcherSignature = Get-AuthenticodeSignature -LiteralPath $launcherPath
                    $launcherSignatureStatus = $launcherSignature.Status.ToString()
                    $launcherSigner = if ($launcherSignature.SignerCertificate) { $launcherSignature.SignerCertificate.Subject } else { "NONE" }
                    if ($launcherSignatureStatus -ceq "HashMismatch") { throw "Launcher Authenticode reports HashMismatch." }
                    Set-Check "SIGNATURE_LAUNCHER" "PASS"
                }
                catch { Set-Failure "SIGNATURE_LAUNCHER" "INVARIANT" $_.Exception.Message }
            }
        }
    }
}
catch [System.Management.Automation.PipelineStoppedException] {
    $finalExitCode = 130
    $failureClass = "INTERRUPTED"
    try { Set-Check "INTERNAL_ERROR" "FAIL" "Execution was interrupted." } catch {}
}
catch {
    $finalExitCode = 2
    $failureClass = "INFRASTRUCTURE"
    try { Set-Check "INTERNAL_ERROR" "FAIL" $_.Exception.Message } catch {}
}
finally {
    if ($locationPushed -and $gitPath -and $repositoryHeadBefore -ne "UNKNOWN") {
        try {
            $afterHead = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
            $afterStatus = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")
            if ($afterHead.ExitCode -ne 0 -or $afterStatus.ExitCode -ne 0) { throw "Unable to query final repository identity." }
            $headValue = (@($afterHead.Output) -join "`n").Trim()
            $statusValue = (@($afterStatus.Output) -join "`n").Trim()
            if ($headValue -cne $repositoryHeadBefore -or $statusValue -cne $repositoryStatusBefore) {
                Set-Failure "REPOSITORY_UNCHANGED" "INVARIANT" "Repository identity changed during preflight."
            }
            else { Set-Check "REPOSITORY_UNCHANGED" "PASS" }
        }
        catch { Set-Failure "REPOSITORY_UNCHANGED" "INFRASTRUCTURE" $_.Exception.Message }
    }

    if ($locationPushed) {
        try { Pop-Location }
        catch { Set-Failure "REPOSITORY_UNCHANGED" "INFRASTRUCTURE" "Unable to restore caller working directory." }
    }

    $requiredPassIds = @($checkIds | Where-Object { $_ -ne "INTERNAL_ERROR" })
    if (@($checkIds | Where-Object { $checks[$_] -eq "FAIL" }).Count -eq 0 -and -not (Test-AllPassed $requiredPassIds)) {
        Set-Failure "INTERNAL_ERROR" "INFRASTRUCTURE" "Required checks did not reach PASS."
    }
    if (@($checkIds | Where-Object { $checks[$_] -eq "FAIL" }).Count -eq 0) {
        $finalExitCode = 0
        $failureClass = "NONE"
    }
    try { Write-FinalOutput }
    catch { $finalExitCode = 2; $failureClass = "INFRASTRUCTURE" }
}

exit $finalExitCode
