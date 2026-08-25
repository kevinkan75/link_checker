[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$ExpectedSourceCommit,
    [Parameter(Mandatory = $true)][string]$ExpectedTagType,
    [Parameter(Mandatory = $true)][string]$ExpectedReleaseTitle,
    [Parameter(Mandatory = $true)][bool]$ExpectedDraft,
    [Parameter(Mandatory = $true)][bool]$ExpectedPrerelease,
    [Parameter(Mandatory = $true)][string[]]$ExpectedAssets,
    [Parameter(Mandatory = $true)][hashtable]$ExpectedAssetSha256
)

$ErrorActionPreference = "Stop"

$checkIds = @(
    "PARAM_VERSION", "PARAM_SOURCE_COMMIT", "PARAM_TAG_TYPE", "PARAM_RELEASE_TITLE",
    "PARAM_RELEASE_FLAGS", "PARAM_ASSET_SET", "PARAM_ASSET_HASH_MAP", "REPO_ROOT",
    "TOOL_GIT", "TOOL_GH", "TOOL_FILEHASH", "GIT_FETCH", "GIT_ORIGIN_MAIN",
    "TAG_REMOTE", "TAG_TYPE", "TAG_TARGET", "RELEASE_QUERY", "RELEASE_TAG",
    "RELEASE_TITLE", "RELEASE_DRAFT", "RELEASE_PRERELEASE", "ASSET_SET",
    "TEMP_CREATE", "ASSET_DOWNLOAD", "ASSET_HASHES", "SHA256_SEMANTIC",
    "TEMP_CLEANUP", "REPOSITORY_UNCHANGED", "INTERNAL_ERROR"
)

$checks = [ordered]@{}
$checkMessages = @{}
foreach ($id in $checkIds) { $checks[$id] = "SKIPPED" }

$finalExitCode = 2
$failureClass = "NONE"
$locationPushed = $false
$repositoryRoot = $null
$gitPath = $null
$ghPath = $null
$repositoryHeadBefore = "UNKNOWN"
$repositoryStatusBefore = "UNKNOWN"
$tagName = "v$Version"
$remoteMain = "UNKNOWN"
$actualTagType = "UNKNOWN"
$tagObjectSha = "NONE"
$tagPeeledCommit = "NONE"
$tagDirectCommit = "NONE"
$releaseTitle = "UNKNOWN"
$releaseDraft = "UNKNOWN"
$releasePrerelease = "UNKNOWN"
$releaseTargetCommitish = "UNKNOWN"
$actualAssetCount = 0
$assetSetResult = "SKIPPED"
$assetHashResult = "SKIPPED"
$sha256SemanticResult = "SKIPPED"
$tempCleanupResult = "SKIPPED"
$publicationComplete = "UNKNOWN"
$downloadTempPath = $null
$normalizedExpectedHashes = $null
$zipAssetName = $null
$sha256AssetName = $null

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
    Set-Check $Id "FAIL" $Message
    switch ($Class) {
        "INVALID_INVOCATION" { $script:failureClass = "INVALID_INVOCATION"; $script:finalExitCode = 3 }
        "INFRASTRUCTURE" {
            if ($script:failureClass -ne "INVALID_INVOCATION") { $script:failureClass = "INFRASTRUCTURE"; $script:finalExitCode = 2 }
        }
        "INVARIANT" {
            if ($script:failureClass -notin @("INVALID_INVOCATION", "INFRASTRUCTURE")) {
                $script:failureClass = "INVARIANT"; $script:finalExitCode = 1
            }
        }
        default { throw "Unknown failure class: $Class" }
    }
}

function Test-AnyFailed {
    param([string[]]$Ids)
    foreach ($id in $Ids) { if ($checks[$id] -eq "FAIL") { return $true } }
    return $false
}

function Test-AllPassed {
    param([string[]]$Ids)
    foreach ($id in $Ids) { if ($checks[$id] -ne "PASS") { return $false } }
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

function Test-PlainAssetName {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name -in @(".", "..")) { return $false }
    if ([IO.Path]::GetFileName($Name) -cne $Name -or $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { return $false }
    if ($Name.IndexOf("/") -ge 0 -or $Name.IndexOf("\") -ge 0) { return $false }
    return $true
}

function Write-FinalOutput {
    $failed = New-Object System.Collections.Generic.List[string]
    foreach ($id in $checkIds) {
        Write-Output "CHECK_$id=$($checks[$id])"
        if ($checks[$id] -eq "FAIL") {
            [void]$failed.Add($id)
            if ($checkMessages.ContainsKey($id)) { [Console]::Error.WriteLine("[DETAIL] $id`: $($checkMessages[$id])") }
        }
    }
    $failedLabel = if ($failed.Count -eq 0) { "NONE" } else { [string]::Join(",", $failed.ToArray()) }
    $result = if ($script:finalExitCode -eq 0) { "PASS" } else { "FAIL" }
    Write-Output "VERSION=$Version"
    Write-Output "TAG=$tagName"
    Write-Output "EXPECTED_SOURCE_COMMIT=$ExpectedSourceCommit"
    Write-Output "REMOTE_MAIN=$remoteMain"
    Write-Output "TAG_TYPE=$actualTagType"
    Write-Output "TAG_OBJECT_SHA=$tagObjectSha"
    Write-Output "TAG_PEELED_COMMIT=$tagPeeledCommit"
    Write-Output "TAG_DIRECT_COMMIT=$tagDirectCommit"
    Write-Output "RELEASE_TITLE=$releaseTitle"
    Write-Output "RELEASE_DRAFT=$releaseDraft"
    Write-Output "RELEASE_PRERELEASE=$releasePrerelease"
    Write-Output "RELEASE_TARGET_COMMITISH=$releaseTargetCommitish"
    Write-Output "EXPECTED_ASSET_COUNT=$(@($ExpectedAssets).Count)"
    Write-Output "ACTUAL_ASSET_COUNT=$actualAssetCount"
    Write-Output "ASSET_SET_RESULT=$assetSetResult"
    Write-Output "ASSET_HASH_RESULT=$assetHashResult"
    Write-Output "SHA256_SEMANTIC_RESULT=$sha256SemanticResult"
    Write-Output "TEMP_CLEANUP_RESULT=$tempCleanupResult"
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
    if ($ExpectedSourceCommit -match $sha1Pattern) { Set-Check "PARAM_SOURCE_COMMIT" "PASS" }
    else { Set-Failure "PARAM_SOURCE_COMMIT" "INVALID_INVOCATION" "ExpectedSourceCommit must be a full 40-character hexadecimal SHA." }
    if ($ExpectedTagType -in @("Annotated", "Lightweight")) { Set-Check "PARAM_TAG_TYPE" "PASS" }
    else { Set-Failure "PARAM_TAG_TYPE" "INVALID_INVOCATION" "ExpectedTagType must be Annotated or Lightweight." }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedReleaseTitle)) { Set-Check "PARAM_RELEASE_TITLE" "PASS" }
    else { Set-Failure "PARAM_RELEASE_TITLE" "INVALID_INVOCATION" "ExpectedReleaseTitle must be nonempty." }
    Set-Check "PARAM_RELEASE_FLAGS" "PASS"

    $assetNamesValid = @($ExpectedAssets).Count -gt 0
    $assetNameSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($assetName in @($ExpectedAssets)) {
        if (-not (Test-PlainAssetName $assetName) -or -not $assetNameSet.Add($assetName)) { $assetNamesValid = $false }
    }
    $zipAssets = @($ExpectedAssets | Where-Object { $_.EndsWith(".zip", [StringComparison]::OrdinalIgnoreCase) })
    $shaAssets = @($ExpectedAssets | Where-Object { $_.EndsWith(".sha256", [StringComparison]::OrdinalIgnoreCase) })
    if ($zipAssets.Count -ne 1 -or $shaAssets.Count -ne 1) { $assetNamesValid = $false }
    if ($assetNamesValid) {
        $zipAssetName = $zipAssets[0]
        $sha256AssetName = $shaAssets[0]
        Set-Check "PARAM_ASSET_SET" "PASS"
    }
    else { Set-Failure "PARAM_ASSET_SET" "INVALID_INVOCATION" "ExpectedAssets must contain unique plain names and exactly one .zip and one .sha256 asset." }

    $hashMapValid = $ExpectedAssetSha256 -ne $null -and $ExpectedAssetSha256.Count -eq @($ExpectedAssets).Count
    $normalizedExpectedHashes = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
    if ($hashMapValid) {
        foreach ($assetName in @($ExpectedAssets)) {
            $exactKeys = @($ExpectedAssetSha256.Keys | Where-Object { [string]::Equals([string]$_, $assetName, [StringComparison]::Ordinal) })
            if ($exactKeys.Count -ne 1) { $hashMapValid = $false; break }
            $hashValue = [string]$ExpectedAssetSha256[$exactKeys[0]]
            if ($hashValue -notmatch $sha256Pattern) { $hashMapValid = $false; break }
            $normalizedExpectedHashes.Add($assetName, $hashValue.ToLowerInvariant())
        }
        foreach ($key in @($ExpectedAssetSha256.Keys)) {
            if (@($ExpectedAssets | Where-Object { [string]::Equals($_, [string]$key, [StringComparison]::Ordinal) }).Count -ne 1) { $hashMapValid = $false }
        }
    }
    if ($hashMapValid) { Set-Check "PARAM_ASSET_HASH_MAP" "PASS" }
    else { Set-Failure "PARAM_ASSET_HASH_MAP" "INVALID_INVOCATION" "ExpectedAssetSha256 keys and values must exactly match ExpectedAssets." }

    $parameterIds = @("PARAM_VERSION", "PARAM_SOURCE_COMMIT", "PARAM_TAG_TYPE", "PARAM_RELEASE_TITLE", "PARAM_RELEASE_FLAGS", "PARAM_ASSET_SET", "PARAM_ASSET_HASH_MAP")
    if (-not (Test-AnyFailed $parameterIds)) {
        if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { Set-Failure "REPO_ROOT" "INFRASTRUCTURE" "PSScriptRoot is unavailable." }
        else {
            $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
            if (Test-Path -LiteralPath $repositoryRoot -PathType Container) { Set-Check "REPO_ROOT" "PASS" }
            else { Set-Failure "REPO_ROOT" "INFRASTRUCTURE" "Derived repository root does not exist." }
        }
    }

    if ($checks["REPO_ROOT"] -eq "PASS") {
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

        if (-not (Test-AnyFailed @("TOOL_GIT", "TOOL_GH", "TOOL_FILEHASH"))) {
            $gitProbe = Invoke-NativeCommand $gitPath @("--version")
            $ghProbe = Invoke-NativeCommand $ghPath @("--version")
            if ($gitProbe.ExitCode -ne 0) { Set-Failure "TOOL_GIT" "INFRASTRUCTURE" "git usability check failed." }
            if ($ghProbe.ExitCode -ne 0) { Set-Failure "TOOL_GH" "INFRASTRUCTURE" "gh usability check failed." }
        }
    }

    if ($locationPushed -and -not (Test-AnyFailed @("TOOL_GIT", "TOOL_GH", "TOOL_FILEHASH"))) {
        $headBefore = Invoke-NativeCommand $gitPath @("rev-parse", "HEAD")
        $statusBefore = Invoke-NativeCommand $gitPath @("status", "--porcelain=v1", "--untracked-files=all")
        if ($headBefore.ExitCode -ne 0 -or $statusBefore.ExitCode -ne 0) { Set-Failure "GIT_FETCH" "INFRASTRUCTURE" "Unable to record initial repository identity." }
        else {
            $repositoryHeadBefore = (@($headBefore.Output) -join "`n").Trim()
            $repositoryStatusBefore = (@($statusBefore.Output) -join "`n").Trim()
            $fetch = Invoke-NativeCommand $gitPath @("fetch", "--no-tags", "origin")
            if ($fetch.ExitCode -eq 0) { Set-Check "GIT_FETCH" "PASS" }
            else { Set-Failure "GIT_FETCH" "INFRASTRUCTURE" "git fetch origin failed." }
        }

        if ($checks["GIT_FETCH"] -eq "PASS") {
            $originMainResult = Invoke-NativeCommand $gitPath @("rev-parse", "origin/main")
            if ($originMainResult.ExitCode -ne 0) { Set-Failure "GIT_ORIGIN_MAIN" "INFRASTRUCTURE" "Unable to resolve origin/main." }
            else {
                $remoteMain = (@($originMainResult.Output) -join "").Trim()
                if ($remoteMain -ieq $ExpectedSourceCommit) { Set-Check "GIT_ORIGIN_MAIN" "PASS" }
                else { Set-Failure "GIT_ORIGIN_MAIN" "INVARIANT" "origin/main does not equal ExpectedSourceCommit." }
            }
        }
    }

    if ($checks["GIT_ORIGIN_MAIN"] -eq "PASS") {
        $tagRef = "refs/tags/$tagName"
        $tagResult = Invoke-NativeCommand $gitPath @("ls-remote", "--exit-code", "--tags", "origin", $tagRef, "$tagRef^{}")
        if ($tagResult.ExitCode -eq 2) {
            Set-Failure "TAG_REMOTE" "INVARIANT" "Remote tag is absent."
        }
        elseif ($tagResult.ExitCode -ne 0) {
            Set-Failure "TAG_REMOTE" "INFRASTRUCTURE" "Unable to query remote tag."
        }
        else {
            $directMatches = @()
            $peeledMatches = @()
            foreach ($line in @($tagResult.Output)) {
                $match = [regex]::Match($line.ToString(), '^(?<sha>[0-9a-fA-F]{40})\s+(?<ref>.+)$')
                if (-not $match.Success) { continue }
                if ($match.Groups["ref"].Value -ceq $tagRef) { $directMatches += $match.Groups["sha"].Value.ToLowerInvariant() }
                elseif ($match.Groups["ref"].Value -ceq "$tagRef^{}") { $peeledMatches += $match.Groups["sha"].Value.ToLowerInvariant() }
            }
            if ($directMatches.Count -ne 1 -or $peeledMatches.Count -gt 1) {
                Set-Failure "TAG_REMOTE" "INFRASTRUCTURE" "Remote tag response is malformed or ambiguous."
            }
            else {
                Set-Check "TAG_REMOTE" "PASS"
                if ($peeledMatches.Count -eq 1) {
                    $actualTagType = "Annotated"
                    $tagObjectSha = $directMatches[0]
                    $tagPeeledCommit = $peeledMatches[0]
                    $resolvedTagCommit = $tagPeeledCommit
                }
                else {
                    $actualTagType = "Lightweight"
                    $tagDirectCommit = $directMatches[0]
                    $resolvedTagCommit = $tagDirectCommit
                }
                if ($actualTagType -ceq $ExpectedTagType) { Set-Check "TAG_TYPE" "PASS" }
                else { Set-Failure "TAG_TYPE" "INVARIANT" "Remote tag type does not match ExpectedTagType." }
                if ($resolvedTagCommit -ieq $ExpectedSourceCommit) { Set-Check "TAG_TARGET" "PASS" }
                else { Set-Failure "TAG_TARGET" "INVARIANT" "Remote tag does not resolve to ExpectedSourceCommit." }
            }
        }
    }

    if (-not (Test-AnyFailed @("TAG_REMOTE", "TAG_TYPE", "TAG_TARGET")) -and $checks["TAG_TARGET"] -eq "PASS") {
        $origin = Invoke-NativeCommand $gitPath @("remote", "get-url", "origin")
        if ($origin.ExitCode -ne 0) { Set-Failure "RELEASE_QUERY" "INFRASTRUCTURE" "Unable to resolve origin URL." }
        else {
            try {
                $repoName = Get-RepositoryNameWithOwner ((@($origin.Output) -join "").Trim())
                $releaseProbe = Invoke-NativeCommand $ghPath @("api", "--include", "repos/$repoName/releases/tags/$tagName")
                $probeText = @($releaseProbe.Output) -join "`n"
                if ($releaseProbe.ExitCode -ne 0) {
                    if ($probeText -match "(?m)^HTTP/\S+\s+404\b") { Set-Failure "RELEASE_QUERY" "INVARIANT" "GitHub Release is absent." }
                    else { Set-Failure "RELEASE_QUERY" "INFRASTRUCTURE" "GitHub Release metadata is unavailable." }
                }
                else {
                    $releaseView = Invoke-NativeCommand $ghPath @("release", "view", $tagName, "--repo", $repoName, "--json", "tagName,name,isDraft,isPrerelease,targetCommitish,assets")
                    if ($releaseView.ExitCode -ne 0) { throw "gh release view failed." }
                    $release = ((@($releaseView.Output) -join "`n") | ConvertFrom-Json)
                    Set-Check "RELEASE_QUERY" "PASS"
                    $releaseTitle = [string]$release.name
                    $releaseDraft = ([bool]$release.isDraft).ToString().ToLowerInvariant()
                    $releasePrerelease = ([bool]$release.isPrerelease).ToString().ToLowerInvariant()
                    $releaseTargetCommitish = if ([string]::IsNullOrWhiteSpace([string]$release.targetCommitish)) { "NONE" } else { [string]$release.targetCommitish }

                    if ([string]$release.tagName -ceq $tagName) { Set-Check "RELEASE_TAG" "PASS" }
                    else { Set-Failure "RELEASE_TAG" "INVARIANT" "Release tag does not match derived tag." }
                    if ($releaseTitle -ceq $ExpectedReleaseTitle) { Set-Check "RELEASE_TITLE" "PASS" }
                    else { Set-Failure "RELEASE_TITLE" "INVARIANT" "Release title does not match expected title." }
                    if ([bool]$release.isDraft -eq $ExpectedDraft) { Set-Check "RELEASE_DRAFT" "PASS" }
                    else { Set-Failure "RELEASE_DRAFT" "INVARIANT" "Release draft state does not match." }
                    if ([bool]$release.isPrerelease -eq $ExpectedPrerelease) { Set-Check "RELEASE_PRERELEASE" "PASS" }
                    else { Set-Failure "RELEASE_PRERELEASE" "INVARIANT" "Release prerelease state does not match." }

                    $actualAssets = @($release.assets | ForEach-Object { [string]$_.name })
                    $actualAssetCount = $actualAssets.Count
                    $expectedSorted = [string[]]@($ExpectedAssets)
                    $actualSorted = [string[]]@($actualAssets)
                    [Array]::Sort($expectedSorted, [StringComparer]::Ordinal)
                    [Array]::Sort($actualSorted, [StringComparer]::Ordinal)
                    $setsEqual = $expectedSorted.Count -eq $actualSorted.Count
                    if ($setsEqual) {
                        for ($index = 0; $index -lt $expectedSorted.Count; $index++) {
                            if ($expectedSorted[$index] -cne $actualSorted[$index]) { $setsEqual = $false; break }
                        }
                    }
                    if ($setsEqual) { $assetSetResult = "PASS"; Set-Check "ASSET_SET" "PASS" }
                    else { $assetSetResult = "FAIL"; Set-Failure "ASSET_SET" "INVARIANT" "Public asset set does not exactly match ExpectedAssets." }
                }
            }
            catch { Set-Failure "RELEASE_QUERY" "INFRASTRUCTURE" $_.Exception.Message }
        }
    }

    $releaseIds = @("RELEASE_QUERY", "RELEASE_TAG", "RELEASE_TITLE", "RELEASE_DRAFT", "RELEASE_PRERELEASE", "ASSET_SET")
    if (-not (Test-AnyFailed $releaseIds) -and $checks["ASSET_SET"] -eq "PASS") {
        try {
            $downloadTempPath = Join-Path ([IO.Path]::GetTempPath()) ("link-checker-release-verify-" + [guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Path $downloadTempPath | Out-Null
            Set-Check "TEMP_CREATE" "PASS"

            $download = Invoke-NativeCommand $ghPath @("release", "download", $tagName, "--repo", $repoName, "--dir", $downloadTempPath)
            if ($download.ExitCode -ne 0) { Set-Failure "ASSET_DOWNLOAD" "INFRASTRUCTURE" "Public asset download failed." }
            else {
                Set-Check "ASSET_DOWNLOAD" "PASS"
                $hashMismatch = $false
                foreach ($assetName in @($ExpectedAssets)) {
                    $assetPath = Join-Path $downloadTempPath $assetName
                    if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { $hashMismatch = $true; continue }
                    if ((Get-NormalizedSha256 $assetPath) -ine $normalizedExpectedHashes[$assetName]) { $hashMismatch = $true }
                }
                if ($hashMismatch) {
                    $assetHashResult = "FAIL"
                    Set-Failure "ASSET_HASHES" "INVARIANT" "One or more public asset hashes do not match."
                }
                else {
                    $assetHashResult = "PASS"
                    Set-Check "ASSET_HASHES" "PASS"
                }

                try {
                    $shaPath = Join-Path $downloadTempPath $sha256AssetName
                    $records = @([IO.File]::ReadAllLines($shaPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                    if ($records.Count -ne 1) { throw "SHA256 asset must contain exactly one usable record." }
                    $record = [regex]::Match($records[0], '^\s*(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>.+?)\s*$')
                    if (-not $record.Success -or $record.Groups["name"].Value -cne $zipAssetName -or
                        $record.Groups["hash"].Value -ine $normalizedExpectedHashes[$zipAssetName]) {
                        throw "SHA256 semantic record does not identify the locked ZIP."
                    }
                    $sha256SemanticResult = "PASS"
                    Set-Check "SHA256_SEMANTIC" "PASS"
                }
                catch {
                    $sha256SemanticResult = "FAIL"
                    Set-Failure "SHA256_SEMANTIC" "INVARIANT" $_.Exception.Message
                }
            }
        }
        catch { Set-Failure "TEMP_CREATE" "INFRASTRUCTURE" "Unable to create/use download temporary directory: $($_.Exception.Message)" }
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
            $tempCleanupResult = "PASS"
            Set-Check "TEMP_CLEANUP" "PASS"
        }
        catch {
            $tempCleanupResult = "FAIL"
            Set-Failure "TEMP_CLEANUP" "INFRASTRUCTURE" "Unable to clean download temporary directory: $($_.Exception.Message)"
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
    $failedCount = @($checkIds | Where-Object { $checks[$_] -eq "FAIL" }).Count
    if ($failedCount -eq 0) {
        $finalExitCode = 0
        $failureClass = "NONE"
        $publicationComplete = "YES"
    }
    elseif ($failureClass -eq "INVARIANT") { $publicationComplete = "NO" }
    else { $publicationComplete = "UNKNOWN" }

    try { Write-FinalOutput }
    catch { $finalExitCode = 2; $failureClass = "INFRASTRUCTURE" }
}

exit $finalExitCode
