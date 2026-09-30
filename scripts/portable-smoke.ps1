[CmdletBinding()]
param(
    [string]$ZipPath = "dist\LinkChecker-portable.zip",
    [Parameter(Mandatory = $true)][string]$ExpectedZipSha256,
    [int]$ManualPort = 18927,
    [int]$IdlePort = 18928,
    [int]$IdleShutdownMs = 5000,
    [int]$StartupTimeoutMs = 30000,
    [int]$ProcessExitTimeoutMs = 15000
)

$ErrorActionPreference = "Stop"
$script:forceCleanupUsed = $false
$script:manualResult = "NOT_RUN"
$script:idleResult = "NOT_RUN"
$script:cleanupResult = "NOT_RUN"

function Resolve-RepositoryRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
}

function Test-PortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)

    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        throw "Portable smoke port is already in use: $Port"
    }
}

function New-PortableExtraction {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$CaseName
    )

    $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $tempRoot = Join-Path $tempBase ("LinkChecker-portable-smoke-$CaseName-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $tempRoot

    $packageDir = Join-Path $tempRoot "LinkChecker-portable"
    $launcherPath = Join-Path $packageDir "Link Checker.exe"
    $nodePath = Join-Path $packageDir "runtime\node.exe"
    foreach ($requiredPath in @(
        $launcherPath,
        $nodePath,
        (Join-Path $packageDir "gui-server.mjs"),
        (Join-Path $packageDir "link-checker.mjs"),
        (Join-Path $packageDir "check-links.cmd"),
        (Join-Path $packageDir "使用說明.txt"),
        (Join-Path $packageDir "BUILD-MANIFEST.json")
    )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Required Portable file is missing from the extracted ZIP: $requiredPath"
        }
    }

    return [pscustomobject]@{
        TempRoot = $tempRoot
        PackageDir = $packageDir
        LauncherPath = $launcherPath
        NodePath = $nodePath
    }
}

function Get-ExactBundledNode {
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$PackageDir,
        [Parameter(Mandatory = $true)][int]$LauncherPid,
        [Parameter(Mandatory = $true)][int]$TimeoutMs
    )

    $expectedNodePath = [System.IO.Path]::GetFullPath($NodePath)
    $expectedPackageDir = [System.IO.Path]::GetFullPath($PackageDir)
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    do {
        $matches = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
            $_.ExecutablePath -and
            [System.IO.Path]::GetFullPath($_.ExecutablePath).Equals($expectedNodePath, [System.StringComparison]::OrdinalIgnoreCase) -and
            [int]$_.ParentProcessId -eq $LauncherPid -and
            $_.CommandLine -and
            $_.CommandLine.IndexOf($expectedPackageDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        })
        if ($matches.Count -gt 1) {
            throw "Multiple bundled Node processes matched the same launcher and extraction."
        }
        if ($matches.Count -eq 1) {
            return $matches[0]
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for the exact bundled Node process."
}

function Wait-GuiReady {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int]$NodePid,
        [Parameter(Mandatory = $true)][int]$TimeoutMs
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    do {
        $listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -eq "127.0.0.1" -and [int]$_.OwningProcess -eq $NodePid })
        if ($listener.Count -eq 1) {
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
                if ($response.StatusCode -eq 200) {
                    return (Get-Date)
                }
            }
            catch {
            }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for the GUI owned by bundled Node PID $NodePid on port $Port."
}

function Get-LocalSession {
    param([Parameter(Mandatory = $true)][int]$Port)

    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/session" -TimeoutSec 5
    if ($response.StatusCode -ne 200) {
        throw "Local session endpoint returned HTTP $($response.StatusCode)."
    }
    return ($response.Content | ConvertFrom-Json)
}

function New-SessionHeaders {
    param([Parameter(Mandatory = $true)]$Session)

    $headers = @{
        Origin = $Session.BaseUrl
    }
    $headers[[string]$Session.SessionHeader] = [string]$Session.SessionToken
    return $headers
}

function Wait-ExactProcessExit {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][int]$TimeoutMs
    )

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
    }
    catch {
        return $true
    }
    return $process.WaitForExit($TimeoutMs)
}

function Stop-ExactProcessForCleanup {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedPath
    )

    $processInfo = @(Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId") | Select-Object -First 1
    if (-not $processInfo) {
        return
    }
    if (-not $processInfo.ExecutablePath -or
        -not [System.IO.Path]::GetFullPath($processInfo.ExecutablePath).Equals(
            [System.IO.Path]::GetFullPath($ExpectedPath),
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to stop PID $ProcessId because its executable path does not match the diagnostic extraction."
    }
    $script:forceCleanupUsed = $true
    Stop-Process -Id $ProcessId -Force
    [void](Wait-ExactProcessExit -ProcessId $ProcessId -TimeoutMs 5000)
}

function Remove-PortableExtraction {
    param([Parameter(Mandatory = $true)][string]$TempRoot)

    $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [System.IO.Path]::GetFullPath($TempRoot)
    $leaf = [System.IO.Path]::GetFileName($resolved)
    if (-not $resolved.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $leaf.StartsWith("LinkChecker-portable-smoke-", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected Portable smoke path: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    if (Test-Path -LiteralPath $resolved) {
        throw "Portable smoke extraction still exists after cleanup: $resolved"
    }
}

function Invoke-ManualShutdownCase {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][int]$Port
    )

    $extraction = $null
    $launcher = $null
    $nodeInfo = $null
    $passed = $false
    try {
        Test-PortAvailable -Port $Port
        $extraction = New-PortableExtraction -ArchivePath $ArchivePath -CaseName "manual"

        $cliOutput = @(& (Join-Path $extraction.PackageDir "check-links.cmd") --help 2>&1)
        $cliExitCode = $LASTEXITCODE
        if ($cliExitCode -ne 0 -or (($cliOutput -join "`n") -notmatch "Local Link Checker")) {
            throw "Portable CLI startup check failed with exit code $cliExitCode."
        }
        Write-Output "CLI_REQUIRED_FILE_CHECKS=PASS"

        $launcher = Start-Process -FilePath $extraction.LauncherPath `
            -WorkingDirectory $extraction.PackageDir `
            -ArgumentList @("--port", $Port, "--no-idle-shutdown") `
            -WindowStyle Hidden `
            -PassThru
        $nodeInfo = Get-ExactBundledNode `
            -NodePath $extraction.NodePath `
            -PackageDir $extraction.PackageDir `
            -LauncherPid $launcher.Id `
            -TimeoutMs $StartupTimeoutMs
        $readyAt = Wait-GuiReady -Port $Port -NodePid ([int]$nodeInfo.ProcessId) -TimeoutMs $StartupTimeoutMs

        if (-not $launcher.WaitForExit(5000) -or $launcher.ExitCode -ne 0) {
            throw "Portable launcher did not exit successfully after GUI startup."
        }

        $baseUrl = "http://127.0.0.1:$Port"
        $session = Get-LocalSession -Port $Port
        $session | Add-Member -NotePropertyName BaseUrl -NotePropertyValue $baseUrl
        $headers = New-SessionHeaders -Session $session
        $shutdownAt = Get-Date
        $shutdown = Invoke-WebRequest -UseBasicParsing `
            -Method Post `
            -Uri "$baseUrl/api/shutdown" `
            -Headers $headers `
            -TimeoutSec 5
        if ($shutdown.StatusCode -ne 200) {
            throw "Manual shutdown returned HTTP $($shutdown.StatusCode)."
        }
        $nodeExited = Wait-ExactProcessExit -ProcessId ([int]$nodeInfo.ProcessId) -TimeoutMs $ProcessExitTimeoutMs
        $nodeExitObservedAt = Get-Date
        if (-not $nodeExited) {
            throw "Exact bundled Node PID $($nodeInfo.ProcessId) did not exit after manual shutdown."
        }

        Remove-PortableExtraction -TempRoot $extraction.TempRoot
        $passed = $true
        Write-Output ("MANUAL_LAUNCHER_PID=" + $launcher.Id)
        Write-Output ("MANUAL_NODE_PID=" + $nodeInfo.ProcessId)
        Write-Output ("MANUAL_NODE_PARENT_PID=" + $nodeInfo.ParentProcessId)
        Write-Output ("MANUAL_NODE_EXECUTABLE_PATH=" + $nodeInfo.ExecutablePath)
        Write-Output ("MANUAL_NODE_COMMAND_LINE=" + $nodeInfo.CommandLine)
        Write-Output ("MANUAL_GUI_READY_AT=" + $readyAt.ToString("o"))
        Write-Output ("MANUAL_SHUTDOWN_HTTP_STATUS=" + $shutdown.StatusCode)
        Write-Output ("MANUAL_SHUTDOWN_TO_NODE_EXIT_MS=" + [math]::Round(($nodeExitObservedAt - $shutdownAt).TotalMilliseconds))
        Write-Output "MANUAL_NODE_PID_EXITED=YES"
        Write-Output "MANUAL_CLEANUP_AFTER_PID_EXIT=PASS"
        Write-Output "MANUAL_SHUTDOWN_SMOKE=PASS"
    }
    finally {
        if (-not $passed -and $extraction) {
            if ($nodeInfo) {
                Stop-ExactProcessForCleanup -ProcessId ([int]$nodeInfo.ProcessId) -ExpectedPath $extraction.NodePath
            }
            if ($launcher -and -not $launcher.HasExited) {
                Stop-ExactProcessForCleanup -ProcessId $launcher.Id -ExpectedPath $extraction.LauncherPath
            }
            Remove-PortableExtraction -TempRoot $extraction.TempRoot
        }
    }
}

function Invoke-IdleShutdownCase {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int]$TimeoutMs
    )

    $extraction = $null
    $launcher = $null
    $nodeInfo = $null
    $passed = $false
    try {
        Test-PortAvailable -Port $Port
        $extraction = New-PortableExtraction -ArchivePath $ArchivePath -CaseName "idle"
        $launcher = Start-Process -FilePath $extraction.LauncherPath `
            -WorkingDirectory $extraction.PackageDir `
            -ArgumentList @("--port", $Port, "--idle-shutdown-ms", $TimeoutMs) `
            -WindowStyle Hidden `
            -PassThru
        $nodeInfo = Get-ExactBundledNode `
            -NodePath $extraction.NodePath `
            -PackageDir $extraction.PackageDir `
            -LauncherPid $launcher.Id `
            -TimeoutMs $StartupTimeoutMs
        $readyAt = Wait-GuiReady -Port $Port -NodePid ([int]$nodeInfo.ProcessId) -TimeoutMs $StartupTimeoutMs

        if (-not $launcher.WaitForExit(5000) -or $launcher.ExitCode -ne 0) {
            throw "Portable launcher did not exit successfully after idle-case GUI startup."
        }

        $baseUrl = "http://127.0.0.1:$Port"
        $session = Get-LocalSession -Port $Port
        $session | Add-Member -NotePropertyName BaseUrl -NotePropertyValue $baseUrl
        $queueResponse = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/queue" -TimeoutSec 5
        $queue = $queueResponse.Content | ConvertFrom-Json
        if ($queue.running -or $queue.stopRequested -or [int]$queue.activeSites -ne 0) {
            throw "Queue was not idle before the idle-shutdown smoke."
        }

        Start-Sleep -Milliseconds 1500
        $headers = New-SessionHeaders -Session $session
        $heartbeat = Invoke-WebRequest -UseBasicParsing `
            -Method Post `
            -Uri "$baseUrl/api/session/heartbeat" `
            -Headers $headers `
            -TimeoutSec 5
        if ($heartbeat.StatusCode -ne 200) {
            throw "Heartbeat returned HTTP $($heartbeat.StatusCode)."
        }
        $heartbeatBody = $heartbeat.Content | ConvertFrom-Json
        if ([int]$heartbeatBody.idleShutdownMs -ne $TimeoutMs) {
            throw "Server reported idle timeout $($heartbeatBody.idleShutdownMs), expected $TimeoutMs."
        }
        $lastHeartbeatAt = [DateTimeOffset]::Parse([string]$heartbeatBody.lastClientSeenAt)
        $idleEligibleAt = $lastHeartbeatAt.AddMilliseconds($TimeoutMs)
        $boundedWaitMs = $TimeoutMs + $ProcessExitTimeoutMs
        $nodeExited = Wait-ExactProcessExit -ProcessId ([int]$nodeInfo.ProcessId) -TimeoutMs $boundedWaitMs
        $nodeExitObservedAt = [DateTimeOffset](Get-Date)
        if (-not $nodeExited) {
            throw "Exact bundled Node PID $($nodeInfo.ProcessId) remained alive beyond the idle eligibility and bounded exit window."
        }

        Remove-PortableExtraction -TempRoot $extraction.TempRoot
        $passed = $true
        Write-Output ("IDLE_LAUNCHER_PID=" + $launcher.Id)
        Write-Output ("IDLE_NODE_PID=" + $nodeInfo.ProcessId)
        Write-Output ("IDLE_NODE_PARENT_PID=" + $nodeInfo.ParentProcessId)
        Write-Output ("IDLE_NODE_EXECUTABLE_PATH=" + $nodeInfo.ExecutablePath)
        Write-Output ("IDLE_NODE_COMMAND_LINE=" + $nodeInfo.CommandLine)
        Write-Output ("IDLE_GUI_READY_AT=" + $readyAt.ToString("o"))
        Write-Output ("IDLE_TIMEOUT_MS=" + $TimeoutMs)
        Write-Output ("LAST_HEARTBEAT_TIME=" + $lastHeartbeatAt.ToUniversalTime().ToString("o"))
        Write-Output ("IDLE_ELIGIBLE_TIME=" + $idleEligibleAt.ToUniversalTime().ToString("o"))
        Write-Output ("IDLE_ELIGIBLE_TO_NODE_EXIT_MS=" + [math]::Round(($nodeExitObservedAt - $idleEligibleAt).TotalMilliseconds))
        Write-Output "IDLE_NODE_PID_EXITED=YES"
        Write-Output "IDLE_CLEANUP_AFTER_PID_EXIT=PASS"
        Write-Output "IDLE_SHUTDOWN_SMOKE=PASS"
    }
    finally {
        if (-not $passed -and $extraction) {
            if ($nodeInfo) {
                Stop-ExactProcessForCleanup -ProcessId ([int]$nodeInfo.ProcessId) -ExpectedPath $extraction.NodePath
            }
            if ($launcher -and -not $launcher.HasExited) {
                Stop-ExactProcessForCleanup -ProcessId $launcher.Id -ExpectedPath $extraction.LauncherPath
            }
            Remove-PortableExtraction -TempRoot $extraction.TempRoot
        }
    }
}

$finalExitCode = 1
try {
    $repositoryRoot = Resolve-RepositoryRoot
    Push-Location $repositoryRoot
    try {
        $resolvedZip = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $ZipPath))
        if (-not (Test-Path -LiteralPath $resolvedZip -PathType Leaf)) {
            throw "Portable ZIP does not exist: $resolvedZip"
        }
        if ($ManualPort -eq $IdlePort) {
            throw "ManualPort and IdlePort must be different."
        }
        if ($IdleShutdownMs -le 0 -or $StartupTimeoutMs -le 0 -or $ProcessExitTimeoutMs -le 0) {
            throw "Smoke timeouts must be positive integers."
        }

        $actualZipSha256 = (Get-FileHash -LiteralPath $resolvedZip -Algorithm SHA256).Hash.ToLowerInvariant()
        $expectedHash = $ExpectedZipSha256.Trim().ToLowerInvariant()
        if ($actualZipSha256 -cne $expectedHash) {
            throw "Portable ZIP SHA256 mismatch. Expected $expectedHash, observed $actualZipSha256."
        }
        Write-Output ("ZIP_FILE=" + $resolvedZip)
        Write-Output ("ZIP_SHA256=" + $actualZipSha256)
        Write-Output "ARTIFACT_BASELINE=PASS"

        try {
            Invoke-ManualShutdownCase -ArchivePath $resolvedZip -Port $ManualPort
            $script:manualResult = "PASS"
        }
        catch {
            $script:manualResult = "FAIL"
            throw
        }
        try {
            Invoke-IdleShutdownCase -ArchivePath $resolvedZip -Port $IdlePort -TimeoutMs $IdleShutdownMs
            $script:idleResult = "PASS"
        }
        catch {
            $script:idleResult = "FAIL"
            throw
        }
        $script:cleanupResult = "PASS"

        $finalHash = (Get-FileHash -LiteralPath $resolvedZip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($finalHash -cne $expectedHash) {
            throw "Portable ZIP SHA256 changed during smoke."
        }
        Write-Output "EXACT_BUNDLED_NODE_PID_TRACKING=PASS"
        Write-Output "CLEANUP_AFTER_PID_EXIT=PASS"
        Write-Output "ARTIFACT_SHA256_UNCHANGED=YES"
        Write-Output ("FORCE_CLEANUP_USED=" + $(if ($script:forceCleanupUsed) { "YES" } else { "NO" }))
        Write-Output "PORTABLE_SMOKE=PASS"
        $finalExitCode = 0
    }
    finally {
        Pop-Location
    }
}
catch {
    Write-Output ("MANUAL_SHUTDOWN_SMOKE=" + $script:manualResult)
    Write-Output ("IDLE_SHUTDOWN_SMOKE=" + $script:idleResult)
    Write-Output ("CLEANUP_AFTER_PID_EXIT=" + $script:cleanupResult)
    Write-Output ("FORCE_CLEANUP_USED=" + $(if ($script:forceCleanupUsed) { "YES" } else { "NO" }))
    Write-Output ("FAILED_REASON=" + $_.Exception.Message)
    Write-Output "PORTABLE_SMOKE=FAIL"
}

exit $finalExitCode
