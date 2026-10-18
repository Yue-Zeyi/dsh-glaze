<#
.SYNOPSIS
    Stop the disposable DSH Web instance started by start-test-instance.ps1.

.DESCRIPTION
    Kills ONLY the instance this harness started, identified by the PID recorded
    in <harness>\state\pid.txt. Before killing it verifies the process really is
    that instance (its command line must reference the harness CLI entry and the
    harness profile), so a recycled PID, the running desktop app, or any other
    DeepSeek Harness process can never be hit.

    Hard refusals:
      * the recorded PID is the running desktop host (or any dsh-desktop-host
        process), or
      * the PID's command line does not look like a harness test instance.

.PARAMETER Force
    Skip the identity re-check. Still refuses PID of the desktop host.

.PARAMETER KeepHome
    Keep the isolated DSH_HOME (default: keep it, so the wallpaper/settings
    survive between runs; pass -KeepHome:$false to wipe it).

.EXAMPLE
    .\stop-test-instance.ps1
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$RemoveLogs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$HarnessDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir   = Join-Path $HarnessDir 'state'
$LogDir     = Join-Path $HarnessDir 'logs'
$StatePath  = Join-Path $StateDir 'state.json'
$PidFile    = Join-Path $StateDir 'pid.txt'
$UrlFile    = Join-Path $StateDir 'url.txt'
$TmpUrlFile = Join-Path $env:TEMP 'dsh-glaze-test-url.txt'
$TmpPidFile = Join-Path $env:TEMP 'dsh-glaze-test-pid.txt'

function Info([string]$Message) { Write-Host "stop-test-instance: $Message" -ForegroundColor Cyan }

# The desktop app must never be touched. Record its identity up front.
$desktopPids = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like '*dsh-desktop-host*' -or $_.CommandLine -like '*--expose-internals*') } |
    ForEach-Object { [int]$_.ProcessId })

$statePids = @()
if (Test-Path -LiteralPath $StatePath) {
    try { $statePids += [int](Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json).pid } catch { }
}
if (Test-Path -LiteralPath $PidFile) {
    $n = 0
    if ([int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$n)) { $statePids += $n }
}
$statePids = @($statePids | Where-Object { $_ -gt 0 } | Select-Object -Unique)

if ($statePids.Count -eq 0) {
    Info "no recorded test instance (nothing to stop)"
}
else {
    foreach ($procId in $statePids) {
        if ($desktopPids -contains $procId) {
            Write-Host "stop-test-instance: REFUSING to kill PID $procId - it is the running desktop app" -ForegroundColor Red
            continue
        }
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc) { Info "PID $procId already gone"; continue }

        if (-not $Force) {
            $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
            $cl = if ($ci) { [string]$ci.CommandLine } else { '' }
            if ($cl -like '*dsh-desktop-host*') {
                Write-Host "stop-test-instance: REFUSING to kill PID $procId - desktop host command line" -ForegroundColor Red
                continue
            }
            $looksLikeOurs = ($cl -like '*@deepseek-ai\dsh\lib\bin.js*') -and ($cl -like '*--profile skin-test*')
            if (-not $looksLikeOurs) {
                Write-Host "stop-test-instance: REFUSING to kill PID $procId - command line is not a harness test instance" -ForegroundColor Red
                Write-Host "  $cl" -ForegroundColor DarkGray
                continue
            }
        }

        Info "stopping test instance PID $procId"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        $waitUntil = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $waitUntil -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 200
        }
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            Info "PID $procId still present after 10 s; taskkill /T for its tree"
            cmd /c "taskkill /PID $procId /T /F" 2>$null | Out-Null
        }
        Info "stopped PID $procId"
    }
}

# Clean up bookkeeping so a stale PID can never be reused.
foreach ($f in @($PidFile, $UrlFile, $TmpUrlFile, $TmpPidFile)) {
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $StatePath) {
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
}
if ($RemoveLogs -and (Test-Path -LiteralPath $LogDir)) {
    Remove-Item -LiteralPath $LogDir -Recurse -Force -ErrorAction SilentlyContinue
    Info "removed log directory"
}

$stillListening = @(Get-NetTCPConnection -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -ge 59821 -and $_.LocalPort -le 59839 })
if ($stillListening.Count -gt 0) {
    Info ("still listening in the harness port band: " + (($stillListening | ForEach-Object { "$($_.LocalPort)(pid $($_.OwningProcess))" }) -join ', '))
}
Info "done (desktop app untouched: $(if ($desktopPids.Count) { "PID $($desktopPids -join ', ') still running" } else { 'no desktop host found' }))"
