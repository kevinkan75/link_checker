[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$testFiles = @()
$testsRun = 0
$testsPassed = 0
$testsFailed = 0
$failedTests = New-Object System.Collections.Generic.List[string]
$runnerExitCode = 2
$locationPushed = $false

function Write-RunnerError {
    param([string]$Message)

    [Console]::Error.WriteLine("[ERROR] $Message")
}

function Write-RunnerSummary {
    param(
        [int]$Discovered,
        [int]$Run,
        [int]$Passed,
        [int]$Failed,
        [string[]]$FailedNames,
        [int]$ExitCode
    )

    $failedLabel = if ($FailedNames.Count -eq 0) {
        "NONE"
    }
    else {
        [string]::Join(",", $FailedNames)
    }

    Write-Output "TEST_FILES_DISCOVERED=$Discovered"
    Write-Output "TESTS_RUN=$Run"
    Write-Output "TESTS_PASSED=$Passed"
    Write-Output "TESTS_FAILED=$Failed"
    Write-Output "FAILED_TESTS=$failedLabel"

    if ($ExitCode -eq 0) {
        Write-Output "REGRESSION_RESULT=PASS"
    }
    else {
        Write-Output "REGRESSION_RESULT=FAIL"
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        throw "Unable to determine the runner script directory."
    }

    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath ".."))
    if (-not (Test-Path -LiteralPath $repositoryRoot -PathType Container)) {
        throw "Repository root does not exist: $repositoryRoot"
    }

    Push-Location -LiteralPath $repositoryRoot
    $locationPushed = $true

    $testFiles = [System.IO.FileInfo[]]@(
        Get-ChildItem -LiteralPath $repositoryRoot -Filter "test-*.mjs" -File
    )
    $filenameComparison = [System.Comparison[System.IO.FileInfo]] {
        param($left, $right)

        [System.StringComparer]::Ordinal.Compare($left.Name, $right.Name)
    }
    [System.Array]::Sort($testFiles, $filenameComparison)

    if ($testFiles.Count -eq 0) {
        Write-RunnerError "No root-level test-*.mjs files were discovered."
        $runnerExitCode = 3
    }
    else {
        $nodeCommands = @(Get-Command -Name "node" -CommandType Application -ErrorAction SilentlyContinue)
        if ($nodeCommands.Count -eq 0) {
            Write-RunnerError "Node is unavailable from PATH."
            $runnerExitCode = 2
        }
        else {
            $nodePath = $nodeCommands[0].Source
            Write-Output "NODE_PATH=$nodePath"

            $nodeVersionOutput = @(& $nodePath --version)
            $nodeVersionExitCode = $LASTEXITCODE
            $nodeVersion = ($nodeVersionOutput -join " ").Trim()

            if ($nodeVersionExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($nodeVersion)) {
                throw "Unable to obtain the Node version from: $nodePath"
            }

            Write-Output "NODE_VERSION=$nodeVersion"

            $infrastructureFailure = $false
            foreach ($testFile in $testFiles) {
                Write-Output "[RUN ] $($testFile.Name)"

                try {
                    & $nodePath $testFile.FullName
                    $testExitCode = $LASTEXITCODE
                }
                catch [System.Management.Automation.PipelineStoppedException] {
                    throw
                }
                catch {
                    Write-RunnerError "Unable to start test process for $($testFile.Name): $($_.Exception.Message)"
                    $infrastructureFailure = $true
                    break
                }

                $testsRun++
                if ($testExitCode -eq 0) {
                    $testsPassed++
                    Write-Output "[PASS] $($testFile.Name)"
                }
                else {
                    $testsFailed++
                    [void]$failedTests.Add($testFile.Name)
                    Write-Output "[FAIL] $($testFile.Name) (exit code $testExitCode)"
                }
            }

            if ($infrastructureFailure -or $testsRun -ne $testFiles.Count) {
                $runnerExitCode = 2
            }
            elseif ($testsFailed -gt 0) {
                $runnerExitCode = 1
            }
            else {
                $runnerExitCode = 0
            }
        }
    }
}
catch [System.Management.Automation.PipelineStoppedException] {
    $runnerExitCode = 130
    try {
        Write-RunnerError "Test execution was interrupted."
    }
    catch {
        # The host may reject output while its pipeline is stopping.
    }
}
catch {
    $runnerExitCode = 2
    Write-RunnerError "Runner internal error: $($_.Exception.Message)"
}
finally {
    if ($locationPushed) {
        try {
            Pop-Location
        }
        catch {
            $runnerExitCode = 2
            Write-RunnerError "Unable to restore the original working directory: $($_.Exception.Message)"
        }
    }

    try {
        Write-RunnerSummary `
            -Discovered $testFiles.Count `
            -Run $testsRun `
            -Passed $testsPassed `
            -Failed $testsFailed `
            -FailedNames $failedTests.ToArray() `
            -ExitCode $runnerExitCode
    }
    catch {
        # Summary output is best effort when the host pipeline is interrupted.
    }
}

exit $runnerExitCode
