[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$DistPath = "dist",
    [switch]$Deep
)

$ErrorActionPreference = "Stop"

$checkIds = @(
    "PARAM_VERSION", "PARAM_DIST_PATH", "REPO_ROOT",
    "TOOL_GIT", "TOOL_GH", "TOOL_FILEHASH",
    "LOCAL_ZIP", "LOCAL_ZIP_SHA256", "LOCAL_EXTERNAL_MANIFEST", "LOCAL_EVIDENCE",
    "TAG_REMOTE", "TAG_TARGET", "RELEASE_QUERY", "RELEASE_TAG",
    "RELEASE_DRAFT", "RELEASE_PRERELEASE", "ASSET_ZIP", "ASSET_SHA256", "ZIP_DIGEST",
    "DEEP_TEMP_CREATE", "DEEP_DOWNLOAD", "DEEP_ZIP_HASH", "DEEP_SHA256_SEMANTIC",
    "TEMP_CLEANUP", "REPOSITORY_UNCHANGED", "INTERNAL_ERROR"
)

$checks = [ordered]@{}
$checkMessages = @{}
foreach ($id in $checkIds) { $checks[$id] = "SKIPPED" }

$finalExitCode = 2
$failureClass = "NONE"
$publicationComplete = "UNKNOWN"
$locationPushed = $false
$repositoryRoot = $null
$resolvedDistPath = $null
$gitPath = $null
$ghPath = $null
$repositoryHeadBefore = "UNKNOWN"
$repositoryStatusBefore = "UNKNOWN"
$expectedSourceCommit = "UNKNOWN"
$expectedZipSha256 = "UNKNOWN"
$remoteTagCommit = "UNKNOWN"
$releaseDraft = "UNKNOWN"
$releasePrerelease = "UNKNOWN"
$zipDigest = "UNKNOWN"
$deepResult = if ($Deep) { "SKIPPED" } else { "NOT_REQUESTED" }
$downloadTempPath = $null
$tagName = "v$Version"
$repoName = $null
$zipAssetName = "LinkChecker-portable.zip"
$sha256AssetName = "LinkChecker-portable.zip.sha256"

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

function Get-RepositoryNameWithOwner {
    param([Parameter(Mandatory = $true)][string]$RemoteUrl)
    $match = [regex]::Match($RemoteUrl.Trim(), "github\.com[:/](?<repo>[^/\s]+/[^/\s]+?)(?:\.git)?$")
    if (-not $match.Success) { throw "Unable to derive GitHub repository from origin URL." }
    return $match.Groups["repo"].Value
}

function Read-ZipSha256Record {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$ExpectedName
    )
    $records = @([IO.File]::ReadAllLines($LiteralPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($records.Count -ne 1) { throw "SHA256 file must contain exactly one record." }
    $record = [regex]::Match($records[0], '^\s*(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>.+?)\s*$')
    if (-not $record.Success -or $record.Groups["name"].Value -cne $ExpectedName) {
        throw "SHA256 record does not identify $ExpectedName."
    }
    return $record.Groups["hash"].Value.ToLowerInvariant()
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
    Write-Output "EXPECTED_SOURCE_COMMIT=$expectedSourceCommit"
    Write-Output "REMOTE_TAG_COMMIT=$remoteTagCommit"
    Write-Output "EXPECTED_ZIP_SHA256=$expectedZipSha256"
    Write-Output "GITHUB_ZIP_DIGEST=$zipDigest"
    Write-Output "RELEASE_DRAFT=$releaseDraft"
    Write-Output "RELEASE_PRERELEASE=$releasePrerelease"
    Write-Output "DEEP_VERIFY_RESULT=$deepResult"
    Write-Output "FAILURE_CLASS=$failureClass"
    Write-Output "FAILED_CHECKS=$failedLabel"
    Write-Output "PUBLICATION_COMPLETE=$publicationComplete"
    Write-Output "RELEASE_VERIFY_RESULT=$result"
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
        $ghCommand = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($gitCommand) { $gitPath = $gitCommand.Source; Set-Check "TOOL_GIT" "PASS" }
        else { Set-Failure "TOOL_GIT" "INFRASTRUCTURE" "git is unavailable." }
        if ($ghCommand) { $ghPath = $ghCommand.Source; Set-Check "TOOL_GH" "PASS" }
        else { Set-Failure "TOOL_GH" "INFRASTRUCTURE" "gh is unavailable." }
        if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) { Set-Check "TOOL_FILEHASH" "PASS" }
        else { Set-Failure "TOOL_FILEHASH" "INFRASTRUCTURE" "Get-FileHash is unavailable." }

        if ($checks["TOOL_GIT"] -eq "PASS") {
            $gitProbe = Invoke-NativeCommand $gitPath @("--version")
            if ($gitProbe.ExitCode -ne 0) { Set-Failure "TOOL_GIT" "INFRASTRUCTURE" "git usability check failed." }
        }
        if ($checks["TOOL_GH"] -eq "PASS") {
            $ghProbe = Invoke-NativeCommand $ghPath @("--version")
            if ($ghProbe.ExitCode -ne 0) { Set-Failure "TOOL_GH" "INFRASTRUCTURE" "gh usability check failed." }
        }
    }

    if ($locationPushed -and -not (Test-AnyFailed @("TOOL_GIT", "TOOL_GH", "TOOL_FILEHASH"))) {
        $headBefore = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
        $statusBefore = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")
        if ($headBefore.ExitCode -ne 0 -or $statusBefore.ExitCode -ne 0) {
            Set-Failure "LOCAL_EVIDENCE" "INFRASTRUCTURE" "Unable to record repository identity."
        }
        else {
            $repositoryHeadBefore = (@($headBefore.Output) -join "`n").Trim()
            $repositoryStatusBefore = (@($statusBefore.Output) -join "`n").Trim()
        }

        $zipPath = Join-Path $resolvedDistPath $zipAssetName
        $zipHashPath = Join-Path $resolvedDistPath $sha256AssetName
        $externalManifestPath = Join-Path $resolvedDistPath "LinkChecker-portable.build-manifest.json"

        if (Test-Path -LiteralPath $zipPath -PathType Leaf) { Set-Check "LOCAL_ZIP" "PASS" }
        else { Set-Failure "LOCAL_ZIP" "INVARIANT" "Local approved ZIP is missing." }
        if (Test-Path -LiteralPath $zipHashPath -PathType Leaf) { Set-Check "LOCAL_ZIP_SHA256" "PASS" }
        else { Set-Failure "LOCAL_ZIP_SHA256" "INVARIANT" "Local ZIP SHA256 file is missing." }
        if (Test-Path -LiteralPath $externalManifestPath -PathType Leaf) { Set-Check "LOCAL_EXTERNAL_MANIFEST" "PASS" }
        else { Set-Failure "LOCAL_EXTERNAL_MANIFEST" "INVARIANT" "Local external build manifest is missing." }

        if (-not (Test-AnyFailed @("LOCAL_ZIP", "LOCAL_ZIP_SHA256", "LOCAL_EXTERNAL_MANIFEST"))) {
            try {
                $manifest = [IO.File]::ReadAllText($externalManifestPath) | ConvertFrom-Json
                if ([int]$manifest.manifestVersion -ne 1 -or [string]$manifest.scope -cne "portable-zip") {
                    throw "Unsupported external manifest format or scope."
                }
                $expectedSourceCommit = ([string]$manifest.build.gitCommit).ToLowerInvariant()
                if ($expectedSourceCommit -notmatch $sha1Pattern -or [string]$manifest.build.gitBranch -cne "main" -or
                    -not [string]::IsNullOrEmpty([string]$manifest.build.gitStatus)) {
                    throw "Local manifest does not describe a clean main release source."
                }
                $expectedZipSha256 = Get-NormalizedSha256 $zipPath
                if ($expectedZipSha256 -notmatch $sha256Pattern -or [string]$manifest.artifacts.zip.sha256 -ine $expectedZipSha256) {
                    throw "Local ZIP does not match the external manifest."
                }
                $sidecarHash = Read-ZipSha256Record -LiteralPath $zipHashPath -ExpectedName $zipAssetName
                if ($sidecarHash -ine $expectedZipSha256) { throw "Local SHA256 file does not match the approved ZIP." }
                Set-Check "LOCAL_EVIDENCE" "PASS"
            }
            catch { Set-Failure "LOCAL_EVIDENCE" "INVARIANT" $_.Exception.Message }
        }

        if ($checks["LOCAL_EVIDENCE"] -eq "PASS") {
            $origin = Invoke-NativeCommand $gitPath @("remote", "get-url", "origin")
            if ($origin.ExitCode -ne 0) { Set-Failure "TAG_REMOTE" "INFRASTRUCTURE" "Unable to resolve origin URL." }
            else {
                try { $repoName = Get-RepositoryNameWithOwner ((@($origin.Output) -join "").Trim()) }
                catch { Set-Failure "TAG_REMOTE" "INFRASTRUCTURE" $_.Exception.Message }
            }

            if ($repoName) {
                $tagRef = "refs/tags/$tagName"
                $tag = Invoke-NativeCommand $gitPath @("ls-remote", "--exit-code", "--tags", "origin", $tagRef, "$tagRef^{}")
                if ($tag.ExitCode -eq 2) { Set-Failure "TAG_REMOTE" "INVARIANT" "Remote tag is absent." }
                elseif ($tag.ExitCode -ne 0) { Set-Failure "TAG_REMOTE" "INFRASTRUCTURE" "Unable to query remote tag." }
                else {
                    $direct = @()
                    $peeled = @()
                    foreach ($line in @($tag.Output)) {
                        $match = [regex]::Match($line.ToString(), '^(?<sha>[0-9a-fA-F]{40})\s+(?<ref>.+)$')
                        if (-not $match.Success) { continue }
                        if ($match.Groups["ref"].Value -ceq $tagRef) { $direct += $match.Groups["sha"].Value.ToLowerInvariant() }
                        elseif ($match.Groups["ref"].Value -ceq "$tagRef^{}") { $peeled += $match.Groups["sha"].Value.ToLowerInvariant() }
                    }
                    if ($direct.Count -ne 1 -or $peeled.Count -gt 1) {
                        Set-Failure "TAG_REMOTE" "INFRASTRUCTURE" "Remote tag response is malformed or ambiguous."
                    }
                    else {
                        Set-Check "TAG_REMOTE" "PASS"
                        $remoteTagCommit = if ($peeled.Count -eq 1) { $peeled[0] } else { $direct[0] }
                        if ($remoteTagCommit -ieq $expectedSourceCommit) { Set-Check "TAG_TARGET" "PASS" }
                        else { Set-Failure "TAG_TARGET" "INVARIANT" "Remote tag does not resolve to the locally approved source commit." }
                    }
                }
            }
        }

        if ($checks["TAG_TARGET"] -eq "PASS") {
            try {
                $releaseView = Invoke-NativeCommand $ghPath @("release", "view", $tagName, "--repo", $repoName, "--json", "tagName,isDraft,isPrerelease,assets")
                if ($releaseView.ExitCode -ne 0) { throw "GitHub Release is absent or unavailable." }
                $release = ((@($releaseView.Output) -join "`n") | ConvertFrom-Json)
                Set-Check "RELEASE_QUERY" "PASS"

                if ([string]$release.tagName -ceq $tagName) { Set-Check "RELEASE_TAG" "PASS" }
                else { Set-Failure "RELEASE_TAG" "INVARIANT" "Release tag does not match $tagName." }

                $releaseDraft = ([bool]$release.isDraft).ToString().ToLowerInvariant()
                $releasePrerelease = ([bool]$release.isPrerelease).ToString().ToLowerInvariant()
                if (-not [bool]$release.isDraft) { Set-Check "RELEASE_DRAFT" "PASS" }
                else { Set-Failure "RELEASE_DRAFT" "INVARIANT" "Release is still a draft." }
                if (-not [bool]$release.isPrerelease) { Set-Check "RELEASE_PRERELEASE" "PASS" }
                else { Set-Failure "RELEASE_PRERELEASE" "INVARIANT" "Release is marked as prerelease." }

                $zipAssets = @($release.assets | Where-Object { [string]$_.name -ceq $zipAssetName })
                $shaAssets = @($release.assets | Where-Object { [string]$_.name -ceq $sha256AssetName })
                if ($zipAssets.Count -eq 1) { Set-Check "ASSET_ZIP" "PASS" }
                else { Set-Failure "ASSET_ZIP" "INVARIANT" "Release must contain exactly one $zipAssetName asset." }
                if ($shaAssets.Count -eq 1) { Set-Check "ASSET_SHA256" "PASS" }
                else { Set-Failure "ASSET_SHA256" "INVARIANT" "Release must contain exactly one $sha256AssetName asset." }

                if ($zipAssets.Count -eq 1) {
                    $zipDigest = [string]$zipAssets[0].digest
                    if ($zipDigest -ieq "sha256:$expectedZipSha256") { Set-Check "ZIP_DIGEST" "PASS" }
                    else { Set-Failure "ZIP_DIGEST" "INVARIANT" "GitHub ZIP digest does not match the locally approved ZIP." }
                }
            }
            catch { Set-Failure "RELEASE_QUERY" "INFRASTRUCTURE" $_.Exception.Message }
        }

        $normalIds = @("RELEASE_QUERY", "RELEASE_TAG", "RELEASE_DRAFT", "RELEASE_PRERELEASE", "ASSET_ZIP", "ASSET_SHA256", "ZIP_DIGEST")
        if ($Deep -and -not (Test-AnyFailed $normalIds)) {
            try {
                $downloadTempPath = Join-Path ([IO.Path]::GetTempPath()) ("link-checker-release-verify-" + [guid]::NewGuid().ToString("N"))
                New-Item -ItemType Directory -Path $downloadTempPath | Out-Null
                Set-Check "DEEP_TEMP_CREATE" "PASS"

                $zipDownload = Invoke-NativeCommand $ghPath @("release", "download", $tagName, "--repo", $repoName, "--dir", $downloadTempPath, "--pattern", $zipAssetName)
                $shaDownload = Invoke-NativeCommand $ghPath @("release", "download", $tagName, "--repo", $repoName, "--dir", $downloadTempPath, "--pattern", $sha256AssetName)
                if ($zipDownload.ExitCode -ne 0 -or $shaDownload.ExitCode -ne 0) { throw "Deep release asset download failed." }
                Set-Check "DEEP_DOWNLOAD" "PASS"

                $downloadedZip = Join-Path $downloadTempPath $zipAssetName
                $downloadedSha = Join-Path $downloadTempPath $sha256AssetName
                if ((Get-NormalizedSha256 $downloadedZip) -ine $expectedZipSha256) {
                    Set-Failure "DEEP_ZIP_HASH" "INVARIANT" "Downloaded ZIP does not match the locally approved ZIP."
                }
                else { Set-Check "DEEP_ZIP_HASH" "PASS" }

                try {
                    $downloadedSidecarHash = Read-ZipSha256Record -LiteralPath $downloadedSha -ExpectedName $zipAssetName
                    if ($downloadedSidecarHash -ine $expectedZipSha256) { throw "Downloaded SHA256 file does not match the approved ZIP." }
                    Set-Check "DEEP_SHA256_SEMANTIC" "PASS"
                }
                catch { Set-Failure "DEEP_SHA256_SEMANTIC" "INVARIANT" $_.Exception.Message }

                if (-not (Test-AnyFailed @("DEEP_TEMP_CREATE", "DEEP_DOWNLOAD", "DEEP_ZIP_HASH", "DEEP_SHA256_SEMANTIC"))) {
                    $deepResult = "PASS"
                }
                else { $deepResult = "FAIL" }
            }
            catch {
                $deepResult = "FAIL"
                Set-Failure "DEEP_DOWNLOAD" "INFRASTRUCTURE" $_.Exception.Message
            }
        }
        elseif (-not $Deep) {
            foreach ($id in @("DEEP_TEMP_CREATE", "DEEP_DOWNLOAD", "DEEP_ZIP_HASH", "DEEP_SHA256_SEMANTIC", "TEMP_CLEANUP")) {
                Set-Check $id "PASS" "Not requested in normal lightweight verification."
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
    if ($downloadTempPath -and (Test-Path -LiteralPath $downloadTempPath)) {
        try {
            $fullTemp = [IO.Path]::GetFullPath($downloadTempPath)
            $osTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            if (-not $fullTemp.StartsWith($osTemp, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to clean a non-temp path." }
            Remove-Item -LiteralPath $fullTemp -Recurse -Force
            Set-Check "TEMP_CLEANUP" "PASS"
        }
        catch { Set-Failure "TEMP_CLEANUP" "INFRASTRUCTURE" "Unable to clean verification temp directory: $($_.Exception.Message)" }
    }

    if ($locationPushed -and $gitPath -and $repositoryHeadBefore -ne "UNKNOWN") {
        try {
            $afterHead = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
            $afterStatus = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")
            if ($afterHead.ExitCode -ne 0 -or $afterStatus.ExitCode -ne 0) { throw "Unable to query final repository identity." }
            $headValue = (@($afterHead.Output) -join "`n").Trim()
            $statusValue = (@($afterStatus.Output) -join "`n").Trim()
            if ($headValue -cne $repositoryHeadBefore -or $statusValue -cne $repositoryStatusBefore) {
                Set-Failure "REPOSITORY_UNCHANGED" "INVARIANT" "Repository identity changed during verification."
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
        $publicationComplete = "YES"
    }
    elseif ($failureClass -eq "INVARIANT") { $publicationComplete = "NO" }
    try { Write-FinalOutput }
    catch { $finalExitCode = 2; $failureClass = "INFRASTRUCTURE" }
}

exit $finalExitCode
