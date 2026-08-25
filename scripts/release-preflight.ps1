[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$ExpectedSourceCommit,
    [Parameter(Mandatory = $true)][string]$ExpectedReportSchemaVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedZipSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedExternalManifestSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedPackageManifestSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedLauncherSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedNodeSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedLauncherSignatureStatus,
    [Parameter(Mandatory = $true)][string]$ExpectedNodeSignatureStatus,
    [string]$ExpectedNodeSigner,
    [string]$DistPath = "dist"
)

$ErrorActionPreference = "Stop"

$checkIds = @(
    "PARAM_VERSION", "PARAM_SOURCE_COMMIT", "PARAM_REPORT_SCHEMA", "PARAM_HASHES",
    "PARAM_SIGNATURE_POLICY", "PARAM_DIST_PATH", "REPO_ROOT", "TOOL_GIT", "TOOL_NODE",
    "TOOL_POWERSHELL", "TOOL_GH", "TOOL_FILEHASH", "TOOL_AUTHENTICODE", "TOOL_ARCHIVE",
    "GIT_FETCH", "GIT_BRANCH", "GIT_HEAD", "GIT_ORIGIN_MAIN", "GIT_WORKTREE",
    "VERSION_TOOL", "VERSION_REPORT_DIFF", "VERSION_LAUNCHER", "VERSION_README",
    "VERSION_ROADMAP", "SCHEMA_REPORT_SOURCE", "SCHEMA_REPORT_JSON", "SCHEMA_DIFF_COHERENCE",
    "REGRESSION_PROCESS", "REGRESSION_SUMMARY", "ARTIFACT_PACKAGE_DIR", "ARTIFACT_ZIP",
    "ARTIFACT_EXTERNAL_MANIFEST", "ARTIFACT_PACKAGE_MANIFEST", "ARTIFACT_ZIP_SHA256",
    "ARTIFACT_LAUNCHER", "ARTIFACT_NODE", "MANIFEST_EXTERNAL", "MANIFEST_PACKAGE",
    "MANIFEST_SOURCE", "MANIFEST_PACKAGE_FILES", "MANIFEST_ZIP_RELATIONSHIP",
    "PACKAGE_VERSION_COHERENCE", "HASH_ZIP", "HASH_EXTERNAL_MANIFEST",
    "HASH_PACKAGE_MANIFEST", "HASH_LAUNCHER", "HASH_NODE", "HASH_ZIP_SHA256_SEMANTIC",
    "SIGNATURE_LAUNCHER", "SIGNATURE_NODE", "SIGNER_NODE", "CERTIFICATE_LAUNCHER",
    "TAG_LOCAL_ABSENT", "TAG_REMOTE_ABSENT", "GH_PUBLIC_READ", "RELEASE_ABSENT",
    "GH_AUTH", "GH_REPO_PERMISSION", "ZIP_TEMP_CLEANUP", "REPOSITORY_UNCHANGED",
    "INTERNAL_ERROR"
)

$checks = [ordered]@{}
$checkMessages = @{}
foreach ($id in $checkIds) {
    $checks[$id] = "SKIPPED"
}

$finalExitCode = 2
$failureClass = "NONE"
$manualReviewRequired = "NO"
$locationPushed = $false
$repositoryRoot = $null
$resolvedDistPath = $null
$gitPath = $null
$nodePath = $null
$powershellPath = $null
$ghPath = $null
$repositoryHeadBefore = "UNKNOWN"
$repositoryStatusBefore = "UNKNOWN"
$regressionResult = "SKIPPED"
$diffSchemaVersion = "UNKNOWN"
$zipSha256 = "UNKNOWN"
$externalManifestSha256 = "UNKNOWN"
$packageManifestSha256 = "UNKNOWN"
$packageFileCount = "UNKNOWN"
$launcherSignatureStatus = "UNKNOWN"
$nodeSignatureStatus = "UNKNOWN"
$nodeSigner = "NONE"
$localTagState = "UNKNOWN"
$remoteTagState = "UNKNOWN"
$releaseState = "UNKNOWN"
$publicReadState = "UNKNOWN"
$ghAuthState = "UNKNOWN"
$zipTempPath = $null
$localTagBeforeFetch = $null
$tagName = "v$Version"

function Set-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Status,
        [string]$Message
    )

    if (-not $checks.Contains($Id)) {
        throw "Unknown check ID: $Id"
    }
    $checks[$Id] = $Status
    if (-not [string]::IsNullOrWhiteSpace($Message)) {
        $checkMessages[$Id] = $Message
    }
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

function Test-VersionSurface {
    param(
        [Parameter(Mandatory = $true)][string]$CheckId,
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Expected
    )
    try {
        $actual = Get-UniqueRegexValue -LiteralPath $LiteralPath -Pattern $Pattern
        if ($actual -ceq $Expected) {
            Set-Check -Id $CheckId -Status "PASS"
        }
        else {
            Set-Failure -Id $CheckId -Class "INVARIANT" -Message "Expected '$Expected'; found '$actual'."
        }
        return $actual
    }
    catch {
        Set-Failure -Id $CheckId -Class "INVARIANT" -Message $_.Exception.Message
        return $null
    }
}

function Get-RepositoryNameWithOwner {
    param([Parameter(Mandatory = $true)][string]$RemoteUrl)
    $match = [regex]::Match($RemoteUrl.Trim(), "github\.com[:/](?<repo>[^/\s]+/[^/\s]+?)(?:\.git)?$")
    if (-not $match.Success) {
        throw "Unable to derive GitHub repository from origin URL."
    }
    return $match.Groups["repo"].Value
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
    Write-Output "TAG=$tagName"
    Write-Output "SOURCE_COMMIT=$ExpectedSourceCommit"
    Write-Output "REPORT_SCHEMA_VERSION=$ExpectedReportSchemaVersion"
    Write-Output "DIFF_SCHEMA_VERSION=$diffSchemaVersion"
    Write-Output "REGRESSION_RESULT=$regressionResult"
    Write-Output "ZIP_SHA256=$zipSha256"
    Write-Output "EXTERNAL_MANIFEST_SHA256=$externalManifestSha256"
    Write-Output "PACKAGE_MANIFEST_SHA256=$packageManifestSha256"
    Write-Output "PACKAGE_FILE_COUNT=$packageFileCount"
    Write-Output "LAUNCHER_SIGNATURE=$launcherSignatureStatus"
    Write-Output "NODE_SIGNATURE=$nodeSignatureStatus"
    Write-Output "NODE_SIGNER=$nodeSigner"
    Write-Output "LOCAL_TAG_STATE=$localTagState"
    Write-Output "REMOTE_TAG_STATE=$remoteTagState"
    Write-Output "RELEASE_STATE=$releaseState"
    Write-Output "PUBLIC_READ_STATE=$publicReadState"
    Write-Output "GH_AUTH_STATE=$ghAuthState"
    Write-Output "FAILURE_CLASS=$failureClass"
    Write-Output "FAILED_CHECKS=$failedLabel"
    Write-Output "MANUAL_REVIEW_REQUIRED=$manualReviewRequired"
    Write-Output "RELEASE_PREFLIGHT_RESULT=$result"
}

try {
    $semverPattern = "^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"
    $sha1Pattern = "^[0-9a-fA-F]{40}$"
    $sha256Pattern = "^[0-9a-fA-F]{64}$"
    $allowedSignatureStatuses = @("Valid", "NotSigned", "NotTrusted")

    if ($Version -match $semverPattern) { Set-Check "PARAM_VERSION" "PASS" }
    else { Set-Failure "PARAM_VERSION" "INVALID_INVOCATION" "Version must be SemVer core only." }

    if ($ExpectedSourceCommit -match $sha1Pattern) { Set-Check "PARAM_SOURCE_COMMIT" "PASS" }
    else { Set-Failure "PARAM_SOURCE_COMMIT" "INVALID_INVOCATION" "ExpectedSourceCommit must be a full 40-character hexadecimal SHA." }

    if ($ExpectedReportSchemaVersion -match $semverPattern) { Set-Check "PARAM_REPORT_SCHEMA" "PASS" }
    else { Set-Failure "PARAM_REPORT_SCHEMA" "INVALID_INVOCATION" "ExpectedReportSchemaVersion must be SemVer core only." }

    $hashValues = @($ExpectedZipSha256, $ExpectedExternalManifestSha256, $ExpectedPackageManifestSha256, $ExpectedLauncherSha256, $ExpectedNodeSha256)
    if (@($hashValues | Where-Object { $_ -notmatch $sha256Pattern }).Count -eq 0) { Set-Check "PARAM_HASHES" "PASS" }
    else { Set-Failure "PARAM_HASHES" "INVALID_INVOCATION" "Every expected SHA256 must contain exactly 64 hexadecimal characters." }

    $signatureParametersValid = $allowedSignatureStatuses -contains $ExpectedLauncherSignatureStatus -and
        $allowedSignatureStatuses -contains $ExpectedNodeSignatureStatus
    if ($ExpectedNodeSignatureStatus -eq "NotSigned") {
        $signatureParametersValid = $signatureParametersValid -and [string]::IsNullOrWhiteSpace($ExpectedNodeSigner)
    }
    else {
        $signatureParametersValid = $signatureParametersValid -and -not [string]::IsNullOrWhiteSpace($ExpectedNodeSigner)
    }
    if ($signatureParametersValid) { Set-Check "PARAM_SIGNATURE_POLICY" "PASS" }
    else { Set-Failure "PARAM_SIGNATURE_POLICY" "INVALID_INVOCATION" "Signature status or ExpectedNodeSigner policy is invalid." }

    if (-not (Test-AnyFailed @("PARAM_VERSION", "PARAM_SOURCE_COMMIT", "PARAM_REPORT_SCHEMA", "PARAM_HASHES", "PARAM_SIGNATURE_POLICY"))) {
        if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
            Set-Failure "REPO_ROOT" "INFRASTRUCTURE" "PSScriptRoot is unavailable."
        }
        else {
            $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
            if (Test-Path -LiteralPath $repositoryRoot -PathType Container) {
                Set-Check "REPO_ROOT" "PASS"
            }
            else {
                Set-Failure "REPO_ROOT" "INFRASTRUCTURE" "Derived repository root does not exist."
            }
        }

        if ($checks["REPO_ROOT"] -eq "PASS") {
            try {
                $distParts = @($DistPath -split "[\\/]+" | Where-Object { $_ -ne "" })
                if ($distParts -contains "..") { throw "DistPath may not contain '..'." }
                $candidateDist = if ([IO.Path]::IsPathRooted($DistPath)) { [IO.Path]::GetFullPath($DistPath) } else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $DistPath)) }
                $rootPrefix = $repositoryRoot.TrimEnd("\") + "\"
                if ($candidateDist -eq $repositoryRoot -or -not $candidateDist.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "DistPath must resolve to a child of the repository root."
                }
                $pathCursor = $candidateDist
                while ($pathCursor.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    if (Test-Path -LiteralPath $pathCursor) {
                        $pathItem = Get-Item -LiteralPath $pathCursor -Force
                        if (($pathItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                            throw "DistPath may not traverse a reparse point."
                        }
                    }
                    $parentCursor = [IO.Path]::GetDirectoryName($pathCursor)
                    if ([string]::IsNullOrWhiteSpace($parentCursor) -or $parentCursor -eq $pathCursor) { break }
                    $pathCursor = $parentCursor
                }
                $resolvedDistPath = $candidateDist
                Set-Check "PARAM_DIST_PATH" "PASS"
            }
            catch {
                Set-Failure "PARAM_DIST_PATH" "INVALID_INVOCATION" $_.Exception.Message
            }
        }
    }

    if (-not (Test-AnyFailed @("PARAM_VERSION", "PARAM_SOURCE_COMMIT", "PARAM_REPORT_SCHEMA", "PARAM_HASHES", "PARAM_SIGNATURE_POLICY", "PARAM_DIST_PATH", "REPO_ROOT"))) {
        Push-Location -LiteralPath $repositoryRoot
        $locationPushed = $true

        $toolMap = @(
            @{ Id = "TOOL_GIT"; Name = "git"; Type = "Application" },
            @{ Id = "TOOL_NODE"; Name = "node"; Type = "Application" },
            @{ Id = "TOOL_POWERSHELL"; Name = "powershell.exe"; Type = "Application" },
            @{ Id = "TOOL_GH"; Name = "gh"; Type = "Application" }
        )
        foreach ($tool in $toolMap) {
            $command = Get-Command -Name $tool.Name -CommandType $tool.Type -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($command) {
                Set-Check $tool.Id "PASS"
                switch ($tool.Id) {
                    "TOOL_GIT" { $gitPath = $command.Source }
                    "TOOL_NODE" { $nodePath = $command.Source }
                    "TOOL_POWERSHELL" { $powershellPath = $command.Source }
                    "TOOL_GH" { $ghPath = $command.Source }
                }
            }
            else {
                Set-Failure $tool.Id "INFRASTRUCTURE" "$($tool.Name) is unavailable."
            }
        }

        if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) { Set-Check "TOOL_FILEHASH" "PASS" }
        else { Set-Failure "TOOL_FILEHASH" "INFRASTRUCTURE" "Get-FileHash is unavailable." }
        if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) { Set-Check "TOOL_AUTHENTICODE" "PASS" }
        else { Set-Failure "TOOL_AUTHENTICODE" "INFRASTRUCTURE" "Get-AuthenticodeSignature is unavailable." }
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
            if (-not (Get-Command Expand-Archive -ErrorAction SilentlyContinue)) { throw "Expand-Archive is unavailable." }
            Set-Check "TOOL_ARCHIVE" "PASS"
        }
        catch { Set-Failure "TOOL_ARCHIVE" "INFRASTRUCTURE" $_.Exception.Message }

        if (-not (Test-AnyFailed @("TOOL_GIT", "TOOL_NODE", "TOOL_POWERSHELL", "TOOL_GH", "TOOL_FILEHASH", "TOOL_AUTHENTICODE", "TOOL_ARCHIVE"))) {
            $toolProbes = @(
                @{ Id = "TOOL_GIT"; Path = $gitPath; Args = @("--version") },
                @{ Id = "TOOL_NODE"; Path = $nodePath; Args = @("--version") },
                @{ Id = "TOOL_POWERSHELL"; Path = $powershellPath; Args = @("-NoProfile", "-Command", "exit 0") },
                @{ Id = "TOOL_GH"; Path = $ghPath; Args = @("--version") }
            )
            foreach ($probe in $toolProbes) {
                $result = Invoke-NativeCommand $probe.Path $probe.Args
                if ($result.StartError -or $result.ExitCode -ne 0) {
                    Set-Failure $probe.Id "INFRASTRUCTURE" "Tool usability check failed."
                }
            }
        }
    }

    $toolPhaseIds = @("TOOL_GIT", "TOOL_NODE", "TOOL_POWERSHELL", "TOOL_GH", "TOOL_FILEHASH", "TOOL_AUTHENTICODE", "TOOL_ARCHIVE")
    if ($locationPushed -and -not (Test-AnyFailed $toolPhaseIds)) {
        $beforeHeadResult = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
        $beforeStatusResult = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")
        if ($beforeHeadResult.ExitCode -ne 0 -or $beforeStatusResult.ExitCode -ne 0) {
            Set-Failure "GIT_HEAD" "INFRASTRUCTURE" "Unable to record repository identity before validation."
        }
        else {
            $repositoryHeadBefore = (@($beforeHeadResult.Output) -join "`n").Trim()
            $repositoryStatusBefore = (@($beforeStatusResult.Output) -join "`n").Trim()
        }

        $tagRef = "refs/tags/$tagName"
        $localTagBeforeFetch = Invoke-NativeCommand $gitPath @("show-ref", "--verify", "--quiet", $tagRef)

        $fetchResult = Invoke-NativeCommand $gitPath @("fetch", "--no-tags", "origin")
        if ($fetchResult.StartError -or $fetchResult.ExitCode -ne 0) {
            Set-Failure "GIT_FETCH" "INFRASTRUCTURE" "git fetch origin failed."
        }
        else { Set-Check "GIT_FETCH" "PASS" }

        if ($checks["GIT_FETCH"] -eq "PASS") {
            $branchResult = Invoke-NativeCommand $gitPath @("branch", "--show-current")
            $headResult = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
            $originResult = Invoke-NativeCommand $gitPath @("rev-parse", "origin/main")
            $statusResult = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")

            if ($branchResult.ExitCode -eq 0 -and ((@($branchResult.Output) -join "").Trim() -ceq "main")) { Set-Check "GIT_BRANCH" "PASS" }
            else { Set-Failure "GIT_BRANCH" "INVARIANT" "Current branch must be main." }
            if ($headResult.ExitCode -eq 0 -and ((@($headResult.Output) -join "").Trim() -ieq $ExpectedSourceCommit)) { Set-Check "GIT_HEAD" "PASS" }
            else { Set-Failure "GIT_HEAD" "INVARIANT" "HEAD does not equal ExpectedSourceCommit." }
            if ($originResult.ExitCode -eq 0 -and ((@($originResult.Output) -join "").Trim() -ieq $ExpectedSourceCommit)) { Set-Check "GIT_ORIGIN_MAIN" "PASS" }
            elseif ($originResult.ExitCode -ne 0) { Set-Failure "GIT_ORIGIN_MAIN" "INFRASTRUCTURE" "Unable to resolve origin/main." }
            else { Set-Failure "GIT_ORIGIN_MAIN" "INVARIANT" "origin/main does not equal ExpectedSourceCommit." }
            if ($statusResult.ExitCode -eq 0 -and [string]::IsNullOrEmpty((@($statusResult.Output) -join "`n").Trim())) { Set-Check "GIT_WORKTREE" "PASS" }
            elseif ($statusResult.ExitCode -ne 0) { Set-Failure "GIT_WORKTREE" "INFRASTRUCTURE" "Unable to query Git worktree status." }
            else { Set-Failure "GIT_WORKTREE" "INVARIANT" "Nonignored worktree changes are present." }
        }
    }

    $gitPhaseIds = @("GIT_FETCH", "GIT_BRANCH", "GIT_HEAD", "GIT_ORIGIN_MAIN", "GIT_WORKTREE")
    if ($locationPushed -and -not (Test-AnyFailed $gitPhaseIds)) {
        $linkCheckerPath = Join-Path $repositoryRoot "link-checker.mjs"
        $reportDiffPath = Join-Path $repositoryRoot "report-diff.mjs"
        $launcherSourcePath = Join-Path $repositoryRoot "launcher\StartLinkChecker.cs"
        $readmePath = Join-Path $repositoryRoot "README.md"
        $roadmapPath = Join-Path $repositoryRoot "ROADMAP.md"
        $schemaPath = Join-Path $repositoryRoot "schemas\report.schema.json"

        [void](Test-VersionSurface "VERSION_TOOL" $linkCheckerPath 'const\s+TOOL_VERSION\s*=\s*"(?<value>[^"]+)"\s*;' $Version)
        [void](Test-VersionSurface "VERSION_REPORT_DIFF" $reportDiffPath 'const\s+GENERATOR_VERSION\s*=\s*"(?<value>[^"]+)"\s*;' $Version)

        try {
            $assembly = Get-UniqueRegexValue $launcherSourcePath 'AssemblyVersion\("(?<value>[^"]+)"\)'
            $file = Get-UniqueRegexValue $launcherSourcePath 'AssemblyFileVersion\("(?<value>[^"]+)"\)'
            $info = Get-UniqueRegexValue $launcherSourcePath 'AssemblyInformationalVersion\("(?<value>[^"]+)"\)'
            if ($assembly -ceq "$Version.0" -and $file -ceq "$Version.0" -and $info -ceq "$Version-portable") { Set-Check "VERSION_LAUNCHER" "PASS" }
            else { Set-Failure "VERSION_LAUNCHER" "INVARIANT" "Launcher source versions do not match Version." }
        }
        catch { Set-Failure "VERSION_LAUNCHER" "INVARIANT" $_.Exception.Message }

        [void](Test-VersionSurface "VERSION_README" $readmePath '(?m)^\s*\u76ee\u524d\u6b63\u5f0f\u7248\u672c\uff1a\s*`v(?<value>[^`]+)`\s*$' $Version)
        [void](Test-VersionSurface "VERSION_ROADMAP" $roadmapPath '(?m)^\s*-\s*\u6700\u65b0\u6b63\u5f0f\u7248\u672c\uff1a\s*`v(?<value>[^`]+)`\u3002?\s*$' $Version)
        [void](Test-VersionSurface "SCHEMA_REPORT_SOURCE" $linkCheckerPath 'const\s+REPORT_SCHEMA_VERSION\s*=\s*"(?<value>[^"]+)"\s*;' $ExpectedReportSchemaVersion)

        try {
            $schema = [IO.File]::ReadAllText($schemaPath) | ConvertFrom-Json
            $actualSchemaVersion = [string]$schema.properties.schemaVersion.const
            if ($actualSchemaVersion -ceq $ExpectedReportSchemaVersion) { Set-Check "SCHEMA_REPORT_JSON" "PASS" }
            else { Set-Failure "SCHEMA_REPORT_JSON" "INVARIANT" "Schema const does not match ExpectedReportSchemaVersion." }
        }
        catch { Set-Failure "SCHEMA_REPORT_JSON" "INVARIANT" "Unable to parse report schema identity: $($_.Exception.Message)" }

        try {
            $diffSchemaVersion = Get-UniqueRegexValue $reportDiffPath 'const\s+DIFF_SCHEMA_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
            if ([string]::IsNullOrWhiteSpace($diffSchemaVersion)) { throw "DIFF_SCHEMA_VERSION is empty." }
            Set-Check "SCHEMA_DIFF_COHERENCE" "PASS"
        }
        catch { Set-Failure "SCHEMA_DIFF_COHERENCE" "INVARIANT" $_.Exception.Message }
    }

    $versionPhaseIds = @("VERSION_TOOL", "VERSION_REPORT_DIFF", "VERSION_LAUNCHER", "VERSION_README", "VERSION_ROADMAP", "SCHEMA_REPORT_SOURCE", "SCHEMA_REPORT_JSON", "SCHEMA_DIFF_COHERENCE")
    if ($locationPushed -and -not (Test-AnyFailed $versionPhaseIds)) {
        $runnerPath = Join-Path $repositoryRoot "scripts\run-tests.ps1"
        if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
            Set-Failure "REGRESSION_PROCESS" "INFRASTRUCTURE" "Regression runner is missing."
        }
        else {
            $runnerOutput = New-Object System.Collections.Generic.List[string]
            try {
                & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $runnerPath 2>&1 | ForEach-Object {
                    $line = $_.ToString()
                    Write-Output $line
                    [void]$runnerOutput.Add($line)
                }
                $runnerExit = $LASTEXITCODE
                Set-Check "REGRESSION_PROCESS" "PASS"

                $summaryNames = @("TEST_FILES_DISCOVERED", "TESTS_RUN", "TESTS_PASSED", "TESTS_FAILED", "FAILED_TESTS", "REGRESSION_RESULT")
                $summary = @{}
                $summaryValid = $true
                foreach ($name in $summaryNames) {
                    $matches = @($runnerOutput | Where-Object { $_ -match "^$name=(.*)$" })
                    if ($matches.Count -ne 1) { $summaryValid = $false; continue }
                    $summary[$name] = $matches[0].Substring($name.Length + 1)
                }

                $discovered = 0; $run = 0; $passed = 0; $failed = 0
                $numericValid = $summaryValid -and [int]::TryParse([string]$summary["TEST_FILES_DISCOVERED"], [ref]$discovered) -and
                    [int]::TryParse([string]$summary["TESTS_RUN"], [ref]$run) -and
                    [int]::TryParse([string]$summary["TESTS_PASSED"], [ref]$passed) -and
                    [int]::TryParse([string]$summary["TESTS_FAILED"], [ref]$failed)
                $accountingValid = $numericValid -and $discovered -gt 0 -and $run -eq $discovered -and $run -eq ($passed + $failed)

                if ($runnerExit -eq 0 -and $accountingValid -and $failed -eq 0 -and $summary["FAILED_TESTS"] -ceq "NONE" -and $summary["REGRESSION_RESULT"] -ceq "PASS") {
                    $regressionResult = "PASS"
                    Set-Check "REGRESSION_SUMMARY" "PASS"
                }
                elseif ($runnerExit -eq 1 -and $accountingValid -and $failed -gt 0 -and
                    -not [string]::IsNullOrWhiteSpace([string]$summary["FAILED_TESTS"]) -and
                    $summary["FAILED_TESTS"] -cne "NONE" -and $summary["REGRESSION_RESULT"] -ceq "FAIL") {
                    $regressionResult = "FAIL"
                    Set-Failure "REGRESSION_SUMMARY" "INVARIANT" "Regression runner reported ordinary test failures."
                }
                elseif ($runnerExit -eq 130) {
                    $finalExitCode = 130
                    $failureClass = "INTERRUPTED"
                    $regressionResult = "FAIL"
                    Set-Check "REGRESSION_SUMMARY" "FAIL" "Regression runner was interrupted."
                }
                else {
                    $regressionResult = "FAIL"
                    Set-Failure "REGRESSION_SUMMARY" "INFRASTRUCTURE" "Runner exit code or summary contract is invalid."
                }
            }
            catch [System.Management.Automation.PipelineStoppedException] { throw }
            catch { Set-Failure "REGRESSION_PROCESS" "INFRASTRUCTURE" "Unable to invoke regression runner: $($_.Exception.Message)" }
        }
    }

    $regressionPhaseIds = @("REGRESSION_PROCESS", "REGRESSION_SUMMARY")
    if ($locationPushed -and $finalExitCode -ne 130 -and -not (Test-AnyFailed $regressionPhaseIds)) {
        $packageDir = Join-Path $resolvedDistPath "LinkChecker-portable"
        $zipPath = Join-Path $resolvedDistPath "LinkChecker-portable.zip"
        $externalManifestPath = Join-Path $resolvedDistPath "LinkChecker-portable.build-manifest.json"
        $zipHashPath = Join-Path $resolvedDistPath "LinkChecker-portable.zip.sha256"
        $packageManifestPath = Join-Path $packageDir "BUILD-MANIFEST.json"
        $launcherPath = Join-Path $packageDir "Start Link Checker.exe"
        $bundledNodePath = Join-Path $packageDir "runtime\node.exe"
        $certPath = Join-Path $packageDir "LinkChecker-local-code-signing.cer"

        $artifactChecks = @(
            @{ Id = "ARTIFACT_PACKAGE_DIR"; Path = $packageDir; Type = "Container" },
            @{ Id = "ARTIFACT_ZIP"; Path = $zipPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_EXTERNAL_MANIFEST"; Path = $externalManifestPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_PACKAGE_MANIFEST"; Path = $packageManifestPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_ZIP_SHA256"; Path = $zipHashPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_LAUNCHER"; Path = $launcherPath; Type = "Leaf" },
            @{ Id = "ARTIFACT_NODE"; Path = $bundledNodePath; Type = "Leaf" }
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
                if ([int]$externalManifest.manifestVersion -ne 1 -or [string]$externalManifest.scope -cne "portable-zip") { throw "Unsupported external manifest format or scope." }
                Set-Check "MANIFEST_EXTERNAL" "PASS"
            }
            catch { Set-Failure "MANIFEST_EXTERNAL" "INVARIANT" $_.Exception.Message }
            try {
                $packageManifest = [IO.File]::ReadAllText($packageManifestPath) | ConvertFrom-Json
                if ([int]$packageManifest.manifestVersion -ne 1 -or [string]$packageManifest.scope -cne "portable-package") { throw "Unsupported package manifest format or scope." }
                Set-Check "MANIFEST_PACKAGE" "PASS"
            }
            catch { Set-Failure "MANIFEST_PACKAGE" "INVARIANT" $_.Exception.Message }

            if (-not (Test-AnyFailed @("MANIFEST_EXTERNAL", "MANIFEST_PACKAGE"))) {
                $sourceCoherent = [string]$externalManifest.build.packageName -ceq "LinkChecker-portable" -and
                    [string]$packageManifest.build.packageName -ceq "LinkChecker-portable" -and
                    [string]$externalManifest.build.gitCommit -ieq $ExpectedSourceCommit -and
                    [string]$packageManifest.build.gitCommit -ieq $ExpectedSourceCommit -and
                    [string]$externalManifest.build.gitBranch -ceq "main" -and
                    [string]$packageManifest.build.gitBranch -ceq "main" -and
                    [string]::IsNullOrEmpty([string]$externalManifest.build.gitStatus) -and
                    [string]::IsNullOrEmpty([string]$packageManifest.build.gitStatus) -and
                    [string]$externalManifest.build.nodeVersion -ceq [string]$packageManifest.build.nodeVersion
                if ($sourceCoherent) { Set-Check "MANIFEST_SOURCE" "PASS" }
                else { Set-Failure "MANIFEST_SOURCE" "INVARIANT" "Manifest source/build identity is not coherent." }

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
                    $packageFileCount = $manifestPaths.Count
                    $actualPackageFiles = @(Get-ChildItem -LiteralPath $packageDir -Recurse -File | Where-Object { $_.FullName -ne $packageManifestPath })
                    if ($actualPackageFiles.Count -ne $manifestPaths.Count) { throw "Package contains unlisted or missing files." }
                    foreach ($file in $actualPackageFiles) {
                        $relative = Get-RelativeFilePath $packageDir $file.FullName
                        if (-not $manifestPaths.ContainsKey($relative)) { throw "Unexpected package file: $relative" }
                    }
                    # BUILD-MANIFEST.json is the sole self-exception because it cannot contain its final self-hash.
                    Set-Check "MANIFEST_PACKAGE_FILES" "PASS"
                }
                catch { Set-Failure "MANIFEST_PACKAGE_FILES" "INVARIANT" $_.Exception.Message }

                try {
                    $packageTool = Get-UniqueRegexValue (Join-Path $packageDir "link-checker.mjs") 'const\s+TOOL_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $packageSchema = Get-UniqueRegexValue (Join-Path $packageDir "link-checker.mjs") 'const\s+REPORT_SCHEMA_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $packageGenerator = Get-UniqueRegexValue (Join-Path $packageDir "report-diff.mjs") 'const\s+GENERATOR_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $packageDiffSchema = Get-UniqueRegexValue (Join-Path $packageDir "report-diff.mjs") 'const\s+DIFF_SCHEMA_VERSION\s*=\s*"(?<value>[^"]+)"\s*;'
                    $binaryVersion = [Reflection.AssemblyName]::GetAssemblyName($launcherPath).Version.ToString()
                    $versionInfo = (Get-Item -LiteralPath $launcherPath).VersionInfo
                    if ($packageTool -cne $Version -or $packageSchema -cne $ExpectedReportSchemaVersion -or
                        $packageGenerator -cne $Version -or $packageDiffSchema -cne $diffSchemaVersion -or
                        $binaryVersion -cne "$Version.0" -or $versionInfo.FileVersion -cne "$Version.0" -or
                        $versionInfo.ProductVersion -cne "$Version-portable") {
                        throw "Package version surfaces do not match locked source semantics."
                    }
                    Set-Check "PACKAGE_VERSION_COHERENCE" "PASS"
                }
                catch { Set-Failure "PACKAGE_VERSION_COHERENCE" "INVARIANT" $_.Exception.Message }

                try {
                    $zipArchive = [IO.Compression.ZipFile]::OpenRead($zipPath)
                    try {
                        $zipNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
                        foreach ($entry in $zipArchive.Entries) {
                            $normalized = $entry.FullName.Replace("\", "/").TrimEnd("/")
                            if ([string]::IsNullOrWhiteSpace($normalized)) { continue }
                            if ($normalized.StartsWith("/") -or $normalized.IndexOf(":") -ge 0) { throw "Unsafe absolute ZIP entry: $($entry.FullName)" }
                            $parts = @($normalized -split "/")
                            if ($parts -contains "." -or $parts -contains ".." -or $parts[0] -cne "LinkChecker-portable") { throw "Unsafe or unexpected ZIP entry: $($entry.FullName)" }
                            if (-not $zipNames.Add($normalized)) { throw "Duplicate ZIP entry: $normalized" }
                        }
                    }
                    finally { $zipArchive.Dispose() }

                    $zipTempPath = Join-Path ([IO.Path]::GetTempPath()) ("link-checker-preflight-" + [guid]::NewGuid().ToString("N"))
                    New-Item -ItemType Directory -Path $zipTempPath | Out-Null
                    Expand-Archive -LiteralPath $zipPath -DestinationPath $zipTempPath
                    $extractedPackage = Join-Path $zipTempPath "LinkChecker-portable"
                    if (-not (Test-Path -LiteralPath $extractedPackage -PathType Container)) { throw "ZIP package root is missing." }
                    $sourceFiles = @(Get-ChildItem -LiteralPath $packageDir -Recurse -File)
                    $zipFiles = @(Get-ChildItem -LiteralPath $extractedPackage -Recurse -File)
                    if ($sourceFiles.Count -ne $zipFiles.Count) { throw "ZIP/package file counts differ." }
                    foreach ($sourceFile in $sourceFiles) {
                        $relative = Get-RelativeFilePath $packageDir $sourceFile.FullName
                        $zipFile = Join-Path $extractedPackage $relative
                        if (-not (Test-Path -LiteralPath $zipFile -PathType Leaf)) { throw "ZIP file is missing: $relative" }
                        if ($sourceFile.Length -ne (Get-Item -LiteralPath $zipFile).Length -or (Get-NormalizedSha256 $sourceFile.FullName) -ine (Get-NormalizedSha256 $zipFile)) {
                            throw "ZIP/package content mismatch: $relative"
                        }
                    }
                    Set-Check "MANIFEST_ZIP_RELATIONSHIP" "PASS"
                }
                catch { Set-Failure "MANIFEST_ZIP_RELATIONSHIP" "INVARIANT" $_.Exception.Message }

                $hashChecks = @(
                    @{ Id = "HASH_ZIP"; Path = $zipPath; Expected = $ExpectedZipSha256; Variable = "zip" },
                    @{ Id = "HASH_EXTERNAL_MANIFEST"; Path = $externalManifestPath; Expected = $ExpectedExternalManifestSha256; Variable = "external" },
                    @{ Id = "HASH_PACKAGE_MANIFEST"; Path = $packageManifestPath; Expected = $ExpectedPackageManifestSha256; Variable = "package" },
                    @{ Id = "HASH_LAUNCHER"; Path = $launcherPath; Expected = $ExpectedLauncherSha256; Variable = "launcher" },
                    @{ Id = "HASH_NODE"; Path = $bundledNodePath; Expected = $ExpectedNodeSha256; Variable = "node" }
                )
                foreach ($hashCheck in $hashChecks) {
                    try {
                        $actualHash = Get-NormalizedSha256 $hashCheck.Path
                        switch ($hashCheck.Variable) {
                            "zip" { $zipSha256 = $actualHash }
                            "external" { $externalManifestSha256 = $actualHash }
                            "package" { $packageManifestSha256 = $actualHash }
                        }
                        if ($actualHash -ieq $hashCheck.Expected) { Set-Check $hashCheck.Id "PASS" }
                        else { Set-Failure $hashCheck.Id "INVARIANT" "Artifact SHA256 does not match locked value." }
                    }
                    catch { Set-Failure $hashCheck.Id "INFRASTRUCTURE" $_.Exception.Message }
                }

                try {
                    $externalCoherent = [string]$externalManifest.artifacts.zip.path -ceq "LinkChecker-portable.zip" -and
                        [string]$externalManifest.artifacts.packageManifest.path -ceq "LinkChecker-portable\BUILD-MANIFEST.json" -and
                        [string]$externalManifest.artifacts.launcher.path -ceq "LinkChecker-portable\Start Link Checker.exe" -and
                        [string]$externalManifest.artifacts.node.path -ceq "LinkChecker-portable\runtime\node.exe" -and
                        [string]$packageManifest.artifacts.launcher.path -ceq "Start Link Checker.exe" -and
                        [string]$packageManifest.artifacts.node.path -ceq "runtime\node.exe" -and
                        [string]$externalManifest.artifacts.zip.sha256 -ieq $zipSha256 -and
                        [int64]$externalManifest.artifacts.zip.bytes -eq (Get-Item -LiteralPath $zipPath).Length -and
                        [string]$externalManifest.artifacts.packageManifest.sha256 -ieq $packageManifestSha256 -and
                        [string]$externalManifest.artifacts.launcher.sha256 -ieq $ExpectedLauncherSha256 -and
                        [string]$externalManifest.artifacts.node.sha256 -ieq $ExpectedNodeSha256 -and
                        [string]$packageManifest.artifacts.launcher.sha256 -ieq $ExpectedLauncherSha256 -and
                        [string]$packageManifest.artifacts.node.sha256 -ieq $ExpectedNodeSha256
                    if (-not $externalCoherent) { throw "External manifest artifact relationships are inconsistent." }
                    $records = @([IO.File]::ReadAllLines($zipHashPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                    if ($records.Count -ne 1) { throw "ZIP SHA256 file must contain exactly one record." }
                    $recordMatch = [regex]::Match($records[0], '^\s*(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>[^\s]+)\s*$')
                    if (-not $recordMatch.Success -or $recordMatch.Groups["hash"].Value -ine $ExpectedZipSha256 -or $recordMatch.Groups["name"].Value -cne "LinkChecker-portable.zip") {
                        throw "ZIP SHA256 semantic record is invalid."
                    }
                    Set-Check "HASH_ZIP_SHA256_SEMANTIC" "PASS"
                }
                catch { Set-Failure "HASH_ZIP_SHA256_SEMANTIC" "INVARIANT" $_.Exception.Message }

                $launcherSignature = $null
                try { $launcherSignature = Get-AuthenticodeSignature -LiteralPath $launcherPath }
                catch { Set-Failure "SIGNATURE_LAUNCHER" "INFRASTRUCTURE" "Unable to inspect launcher signature: $($_.Exception.Message)" }
                if ($launcherSignature) {
                    $launcherSignatureStatus = $launcherSignature.Status.ToString()
                    $manifestLauncherCoherent = [string]$externalManifest.artifacts.launcher.signature.status -ceq $launcherSignatureStatus -and
                        [string]$packageManifest.artifacts.launcher.signature.status -ceq $launcherSignatureStatus
                    if ($launcherSignatureStatus -cne $ExpectedLauncherSignatureStatus -or -not $manifestLauncherCoherent) {
                        Set-Failure "SIGNATURE_LAUNCHER" "INVARIANT" "Launcher signature status does not match policy/manifests."
                    }
                    else { Set-Check "SIGNATURE_LAUNCHER" "PASS" }
                }

                $nodeSignature = $null
                try { $nodeSignature = Get-AuthenticodeSignature -LiteralPath $bundledNodePath }
                catch { Set-Failure "SIGNATURE_NODE" "INFRASTRUCTURE" "Unable to inspect Node signature: $($_.Exception.Message)" }
                if ($nodeSignature) {
                    $nodeSignatureStatus = $nodeSignature.Status.ToString()
                    $nodeSigner = if ($nodeSignature.SignerCertificate) { $nodeSignature.SignerCertificate.Subject } else { "NONE" }
                    $manifestNodeCoherent = [string]$externalManifest.artifacts.node.signature.status -ceq $nodeSignatureStatus -and
                        [string]$packageManifest.artifacts.node.signature.status -ceq $nodeSignatureStatus
                    if ($nodeSignatureStatus -cne $ExpectedNodeSignatureStatus -or -not $manifestNodeCoherent) {
                        Set-Failure "SIGNATURE_NODE" "INVARIANT" "Node signature status does not match policy/manifests."
                    }
                    else { Set-Check "SIGNATURE_NODE" "PASS" }

                    if ($checks["SIGNATURE_NODE"] -eq "PASS") {
                        if ($ExpectedNodeSignatureStatus -eq "NotSigned") {
                            if ($nodeSignature.SignerCertificate -or
                                -not [string]::IsNullOrEmpty([string]$externalManifest.artifacts.node.signature.signerSubject) -or
                                -not [string]::IsNullOrEmpty([string]$packageManifest.artifacts.node.signature.signerSubject)) {
                                Set-Failure "SIGNER_NODE" "INVARIANT" "NotSigned Node unexpectedly has signer evidence."
                            }
                            else { Set-Check "SIGNER_NODE" "PASS" }
                        }
                        elseif (-not $nodeSignature.SignerCertificate -or $nodeSigner -cne $ExpectedNodeSigner -or
                            [string]$externalManifest.artifacts.node.signature.signerSubject -cne $nodeSigner -or
                            [string]$packageManifest.artifacts.node.signature.signerSubject -cne $nodeSigner -or
                            [string]$externalManifest.artifacts.node.signature.signerThumbprint -ine $nodeSignature.SignerCertificate.Thumbprint -or
                            [string]$packageManifest.artifacts.node.signature.signerThumbprint -ine $nodeSignature.SignerCertificate.Thumbprint) {
                            Set-Failure "SIGNER_NODE" "INVARIANT" "Node signer does not match policy/manifests."
                        }
                        else { Set-Check "SIGNER_NODE" "PASS" }
                    }
                }

                try {
                    if (-not $launcherSignature) { throw "Launcher signature evidence is unavailable." }
                    if ($ExpectedLauncherSignatureStatus -eq "NotSigned") {
                        if ($launcherSignature.SignerCertificate -or (Test-Path -LiteralPath $certPath)) { throw "Unsigned launcher must not include signer evidence or certificate file." }
                        if (-not [string]::IsNullOrEmpty([string]$externalManifest.artifacts.launcher.signature.signerSubject) -or
                            -not [string]::IsNullOrEmpty([string]$packageManifest.artifacts.launcher.signature.signerSubject) -or
                            -not [string]::IsNullOrEmpty([string]$externalManifest.artifacts.launcher.signature.signerThumbprint) -or
                            -not [string]::IsNullOrEmpty([string]$packageManifest.artifacts.launcher.signature.signerThumbprint)) {
                            throw "Unsigned launcher manifests contain signer evidence."
                        }
                    }
                    else {
                        if (-not $launcherSignature.SignerCertificate -or -not (Test-Path -LiteralPath $certPath -PathType Leaf)) { throw "Signed launcher requires signer evidence and certificate file." }
                        $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath)
                        if ($certificate.Thumbprint -ine $launcherSignature.SignerCertificate.Thumbprint -or $certificate.Subject -cne $launcherSignature.SignerCertificate.Subject) { throw "Packaged certificate does not match launcher signer." }
                        $expectedSubject = [string]$externalManifest.artifacts.launcher.signature.signerSubject
                        $expectedThumbprint = [string]$externalManifest.artifacts.launcher.signature.signerThumbprint
                        if ($expectedSubject -cne $certificate.Subject -or $expectedThumbprint -ine $certificate.Thumbprint -or
                            [string]$packageManifest.artifacts.launcher.signature.signerSubject -cne $certificate.Subject -or
                            [string]$packageManifest.artifacts.launcher.signature.signerThumbprint -ine $certificate.Thumbprint) {
                            throw "Manifest launcher signer evidence does not match packaged certificate."
                        }
                    }
                    Set-Check "CERTIFICATE_LAUNCHER" "PASS"
                }
                catch { Set-Failure "CERTIFICATE_LAUNCHER" "INVARIANT" $_.Exception.Message }
            }
        }
    }

    $localCandidateIds = @(
        "ARTIFACT_PACKAGE_DIR", "ARTIFACT_ZIP", "ARTIFACT_EXTERNAL_MANIFEST",
        "ARTIFACT_PACKAGE_MANIFEST", "ARTIFACT_ZIP_SHA256", "ARTIFACT_LAUNCHER", "ARTIFACT_NODE",
        "MANIFEST_EXTERNAL", "MANIFEST_PACKAGE", "MANIFEST_SOURCE", "MANIFEST_PACKAGE_FILES",
        "MANIFEST_ZIP_RELATIONSHIP", "PACKAGE_VERSION_COHERENCE", "HASH_ZIP",
        "HASH_EXTERNAL_MANIFEST", "HASH_PACKAGE_MANIFEST", "HASH_LAUNCHER", "HASH_NODE",
        "HASH_ZIP_SHA256_SEMANTIC", "SIGNATURE_LAUNCHER", "SIGNATURE_NODE", "SIGNER_NODE",
        "CERTIFICATE_LAUNCHER"
    )
    if ($locationPushed -and $finalExitCode -ne 130 -and (Test-AllPassed $localCandidateIds)) {
        $tagRef = "refs/tags/$tagName"
        $localTag = $localTagBeforeFetch
        if (-not $localTag) {
            $localTag = Invoke-NativeCommand $gitPath @("show-ref", "--verify", "--quiet", $tagRef)
        }
        if ($localTag.ExitCode -eq 1) { $localTagState = "ABSENT"; Set-Check "TAG_LOCAL_ABSENT" "PASS" }
        elseif ($localTag.ExitCode -eq 0) { $localTagState = "PRESENT"; $manualReviewRequired = "YES"; Set-Failure "TAG_LOCAL_ABSENT" "INVARIANT" "Local tag already exists." }
        else { Set-Failure "TAG_LOCAL_ABSENT" "INFRASTRUCTURE" "Unable to query local tag." }

        $remoteTag = Invoke-NativeCommand $gitPath @("ls-remote", "--exit-code", "--tags", "origin", $tagRef, "$tagRef^{}")
        if ($remoteTag.ExitCode -eq 2) { $remoteTagState = "ABSENT"; Set-Check "TAG_REMOTE_ABSENT" "PASS" }
        elseif ($remoteTag.ExitCode -eq 0) { $remoteTagState = "PRESENT"; $manualReviewRequired = "YES"; Set-Failure "TAG_REMOTE_ABSENT" "INVARIANT" "Remote tag already exists." }
        else { Set-Failure "TAG_REMOTE_ABSENT" "INFRASTRUCTURE" "Unable to query remote tag." }

        $originResult = Invoke-NativeCommand $gitPath @("remote", "get-url", "origin")
        if ($originResult.ExitCode -ne 0) {
            Set-Failure "GH_PUBLIC_READ" "INFRASTRUCTURE" "Unable to resolve origin URL."
        }
        else {
            try {
                $repoName = Get-RepositoryNameWithOwner ((@($originResult.Output) -join "").Trim())
                $publicRead = Invoke-NativeCommand $ghPath @("api", "repos/$repoName", "--jq", ".full_name")
                if ($publicRead.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace((@($publicRead.Output) -join ""))) {
                    $publicReadState = "AVAILABLE"
                    Set-Check "GH_PUBLIC_READ" "PASS"
                }
                else { throw "GitHub repository API is not publicly readable." }

                $releaseQuery = Invoke-NativeCommand $ghPath @("api", "--include", "repos/$repoName/releases/tags/$tagName")
                $releaseText = @($releaseQuery.Output) -join "`n"
                if ($releaseQuery.ExitCode -eq 0) {
                    $releaseState = "PRESENT"
                    $manualReviewRequired = "YES"
                    Set-Failure "RELEASE_ABSENT" "INVARIANT" "GitHub Release already exists."
                }
                elseif ($releaseText -match "(?m)^HTTP/\S+\s+404\b") {
                    $releaseState = "ABSENT"
                    Set-Check "RELEASE_ABSENT" "PASS"
                }
                else { Set-Failure "RELEASE_ABSENT" "INFRASTRUCTURE" "GitHub Release absence could not be determined." }

                $auth = Invoke-NativeCommand $ghPath @("auth", "status", "--active", "--hostname", "github.com")
                $identity = Invoke-NativeCommand $ghPath @("api", "user", "--jq", ".login")
                if ($auth.ExitCode -eq 0 -and $identity.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace((@($identity.Output) -join ""))) {
                    $ghAuthState = "VALID"
                    Set-Check "GH_AUTH" "PASS"
                }
                else {
                    $ghAuthState = "INVALID"
                    Set-Failure "GH_AUTH" "INFRASTRUCTURE" "GitHub publication authentication is unusable."
                }

                if ($checks["GH_AUTH"] -eq "PASS") {
                    $permission = Invoke-NativeCommand $ghPath @("api", "repos/$repoName", "--jq", ".permissions.admin or .permissions.maintain or .permissions.push")
                    if ($permission.ExitCode -eq 0 -and ((@($permission.Output) -join "").Trim() -ceq "true")) { Set-Check "GH_REPO_PERMISSION" "PASS" }
                    else { Set-Failure "GH_REPO_PERMISSION" "INFRASTRUCTURE" "Observable repository permission is insufficient for publication." }
                }
            }
            catch { Set-Failure "GH_PUBLIC_READ" "INFRASTRUCTURE" $_.Exception.Message }
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
    if ($zipTempPath -and (Test-Path -LiteralPath $zipTempPath)) {
        try {
            $fullTemp = [IO.Path]::GetFullPath($zipTempPath)
            $osTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            if (-not $fullTemp.StartsWith($osTemp, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to clean a non-temp path." }
            Remove-Item -LiteralPath $fullTemp -Recurse -Force
            Set-Check "ZIP_TEMP_CLEANUP" "PASS"
        }
        catch {
            Set-Failure "ZIP_TEMP_CLEANUP" "INFRASTRUCTURE" "Unable to clean ZIP temporary directory: $($_.Exception.Message)"
        }
    }

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
    $failedCount = @($checkIds | Where-Object { $checks[$_] -eq "FAIL" }).Count
    if ($failedCount -eq 0) {
        $finalExitCode = 0
        $failureClass = "NONE"
    }
    elseif ($finalExitCode -eq 0) {
        $finalExitCode = 2
        $failureClass = "INFRASTRUCTURE"
    }

    try { Write-FinalOutput }
    catch {
        $finalExitCode = 2
        $failureClass = "INFRASTRUCTURE"
    }
}

exit $finalExitCode
