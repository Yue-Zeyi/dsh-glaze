<#
.SYNOPSIS
    Boot a SECOND, disposable DeepSeek Harness Web instance for visual skin verification.

.DESCRIPTION
    Starts an isolated `dsh web` instance that never touches the running desktop app:

      * its own DSH_HOME            (-HomeDir, default %TEMP%\dsh-glaze-harness\home)
      * its own throwaway profile   (-ProfileName, default 'skin-test')
      * its own spare port          (-Port, default 59821)
      * its own log files           (<harness>\logs\*)
      * optionally mounts a skin plugin package (-PluginPath)

    The authenticated URL (contains ?token=...) is written to
      <harness>\state\url.txt  and  %TEMP%\dsh-glaze-test-url.txt
    and printed to stdout. The PID goes to <harness>\state\pid.txt and
    %TEMP%\dsh-glaze-test-pid.txt.

    The script returns as soon as the URL line appears; the instance keeps
    running detached so the caller is never blocked.

    WHY NO `pnpm install` IS NEEDED
      Bundle resolution in dsh-app-boot is "installation first": every
      @deepseek-ai/* bundle resolves from the dsh installation inside
      app.asar, not from the profile. A throwaway profile therefore only needs
      a package.json listing the bundle names. Anything the profile itself must
      supply is a 3rd-party package, and for the skin plugin we simply link it
      into <profile>\node_modules with a directory junction (no copy, no
      network). Nothing is installed and the pnpm store is never consulted.

.PARAMETER PluginPath
    Directory of the skin plugin package (containing package.json). Optional:
    when omitted (or when the directory has no package.json yet) the instance
    still boots a clean baseline GUI.

.PARAMETER Port
    Listen port. Must be free. Default 59821.

.PARAMETER HomeDir
    Isolated DSH_HOME for the throwaway instance. Default
    %TEMP%\dsh-glaze-harness\home.

.PARAMETER ProfileName
    Throwaway profile name. Refuses 'desktop'. Default 'skin-test'.

.PARAMETER ResetHome
    Delete the isolated DSH_HOME first (clears the stored wallpaper, settings
    and sessions) for a truly clean boot.

.PARAMETER InstallDir
    DeepSeek Harness installation directory.

.EXAMPLE
    .\start-test-instance.ps1

.EXAMPLE
    .\start-test-instance.ps1 -PluginPath "C:\...\dsh-glaze"
#>
[CmdletBinding()]
param(
    [string]$PluginPath = '',
    [string[]]$ExtraBundles = @(),
    [int]$Port = 59821,
    [string]$HomeDir = (Join-Path $env:TEMP 'dsh-glaze-harness\home'),
    [string]$ProfileName = 'skin-test',
    [switch]$ResetHome,
    [string]$InstallDir = 'D:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness',
    [int]$ReadyTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$HarnessDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir   = Join-Path $HarnessDir 'state'
$LogDir     = Join-Path $HarnessDir 'logs'
$ShotsDir   = Join-Path $HarnessDir 'shots'
foreach ($d in @($StateDir, $LogDir, $ShotsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

$StatePath    = Join-Path $StateDir 'state.json'
$UrlFile      = Join-Path $StateDir 'url.txt'
$PidFile      = Join-Path $StateDir 'pid.txt'
$TmpUrlFile   = Join-Path $env:TEMP 'dsh-glaze-test-url.txt'
$TmpPidFile   = Join-Path $env:TEMP 'dsh-glaze-test-pid.txt'

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Fail([string]$Message) {
    Write-Host "start-test-instance: ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Info([string]$Message) {
    Write-Host "start-test-instance: $Message" -ForegroundColor Cyan
}

# -- guards -------------------------------------------------------------------
if ($ProfileName -eq 'desktop') { Fail "profile 'desktop' is owned by the Electron app and must never be used here" }
if ($Port -lt 1 -or $Port -gt 65535) { Fail "invalid port $Port" }

$ExePath = Join-Path $InstallDir 'DeepSeek Harness.exe'
$CliPath = Join-Path $InstallDir 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path -LiteralPath $ExePath)) { Fail "DeepSeek Harness.exe not found at $ExePath" }

# A port already bound means a run is live (or something else owns it): stop.
$busy = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' }
if ($busy) { Fail "port $Port is already listening (PID $($busy[0].OwningProcess)); run .\stop-test-instance.ps1 first" }

# -- stop any previous instance this harness started --------------------------
if (Test-Path -LiteralPath $PidFile) {
    $oldPid = 0
    [void][int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$oldPid)
    if ($oldPid -gt 0) {
        $old = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($old) {
            Info "stopping previous test instance PID $oldPid"
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 700
        }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

# -- isolated home + throwaway profile ----------------------------------------
if ($ResetHome -and (Test-Path -LiteralPath $HomeDir)) {
    Info "reset: removing isolated DSH_HOME $HomeDir"
    Remove-Item -LiteralPath $HomeDir -Recurse -Force -ErrorAction SilentlyContinue
}
$ProfileDir = Join-Path $HomeDir "profiles\$ProfileName"
foreach ($d in @($HomeDir, $ProfileDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

# -- resolve the optional plugin ----------------------------------------------
$pluginName = $null
$pluginResolved = $null
if ($PluginPath -ne '') {
    $candidate = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PluginPath)
    $manifestPath = Join-Path $candidate 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        Info "NOTICE: $(-join @('no package.json in ', $candidate)) -- booting the BASELINE instance instead"
    }
    else {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if (-not $manifest.name) { Fail "plugin package.json at $manifestPath has no 'name'" }
        $pluginName = [string]$manifest.name
        $pluginResolved = (Resolve-Path -LiteralPath $candidate).Path
        Info "plugin: $pluginName  <-  $pluginResolved"
    }
}

# -- profile manifest: bundles (+ linked plugin dependency) -------------------
$bundles = New-Object System.Collections.ArrayList
[void]$bundles.Add('@deepseek-ai/dsh-base')
[void]$bundles.Add('@deepseek-ai/dsh-web-app')
# Extra bundles let the harness reproduce the user's real layout (e.g.
# dsh-better-sidebar), which changes where the shell paints its surfaces.
foreach ($extra in $ExtraBundles) { if ($extra) { [void]$bundles.Add($extra) } }
if ($pluginName) { [void]$bundles.Add($pluginName) }

$manifestObj = [ordered]@{
    name        = "dsh-profile-$ProfileName"
    private     = $true
    dsh         = [ordered]@{ profile = [ordered]@{ bundles = @($bundles) } }
    dependencies = [ordered]@{}
}
if ($pluginName) {
    # POSIX-style absolute path: pnpm/npm `link:` accepts forward slashes on Windows.
    $manifestObj.dependencies[$pluginName] = 'link:' + ($pluginResolved -replace '\\', '/')
}
$manifestJson = ($manifestObj | ConvertTo-Json -Depth 8) + "`n"
Write-Utf8NoBom (Join-Path $ProfileDir 'package.json') $manifestJson
Write-Utf8NoBom (Join-Path $ProfileDir 'cordis.patch.yml') "# Harness-owned user patch layer. Add overrides here; leave [] for a clean boot.`n[]`n"
Write-Utf8NoBom (Join-Path $ProfileDir 'pnpm-workspace.yaml') "packages:`n  - .`n`nnodeLinker: hoisted`nautoInstallPeers: false`n"

# -- link the plugin into the profile's node_modules (junction: no copy, no net) -
if ($pluginName) {
    $modulesDir = Join-Path $ProfileDir 'node_modules'
    if (-not (Test-Path $modulesDir)) { New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null }
    $linkDir = Join-Path $modulesDir $pluginName          # handles @scope/name too
    $linkParent = Split-Path -Parent $linkDir
    if (-not (Test-Path $linkParent)) { New-Item -ItemType Directory -Force -Path $linkParent | Out-Null }
    if (Test-Path -LiteralPath $linkDir) { cmd /c rmdir "$linkDir" 2>$null | Out-Null }
    cmd /c mklink /J "$linkDir" "$pluginResolved" 2>$null | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $linkDir 'package.json'))) {
        # Junction unavailable (different volume / policy): fall back to a copy.
        Info "junction failed; copying the plugin into the profile instead"
        Copy-Item -LiteralPath $pluginResolved -Destination $linkDir -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath (Join-Path $linkDir 'package.json'))) {
        Fail "could not place plugin '$pluginName' into $modulesDir"
    }
    Info "linked $pluginName -> $linkDir"
}

# -- link any extra bundles from the live desktop profile --------------------
# Better-sidebar and friends are third-party packages: unlike the @deepseek-ai
# bundles they are NOT present in the installation, so the test profile must
# borrow them from the desktop profile (read-only junction; the desktop profile
# itself is never modified).
foreach ($extra in $ExtraBundles) {
    if (-not $extra) { continue }
    $source = Join-Path (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules') $extra
    if (-not (Test-Path -LiteralPath $source)) { Fail "extra bundle '$extra' is not installed in the desktop profile" }
    $modulesDir = Join-Path $ProfileDir 'node_modules'
    $linkDir = Join-Path $modulesDir $extra
    $linkParent = Split-Path -Parent $linkDir
    if (-not (Test-Path $linkParent)) { New-Item -ItemType Directory -Force -Path $linkParent | Out-Null }
    if (Test-Path -LiteralPath $linkDir) { cmd /c rmdir "$linkDir" 2>$null | Out-Null }
    cmd /c mklink /J "$linkDir" "$source" 2>$null | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $linkDir 'package.json'))) {
        Fail "could not link extra bundle '$extra' into $modulesDir"
    }
    Info "linked extra bundle $extra -> $source"
}

# -- child environment: isolated, and stripped of the desktop session's vars --
# The variables are baked into the detached command line instead of this
# process's environment, because the launch goes through WMI (see below).
$childEnv = [ordered]@{
    ELECTRON_RUN_AS_NODE = '1'
    DSH_HOME             = $HomeDir
}
foreach ($v in @('DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_SHELL',
                 'DSH_TELEMETRY_DISABLED')) {
    $childEnv[$v] = ''      # explicit clear keeps the desktop session out of the child
    Remove-Item -LiteralPath "Env:$v" -ErrorAction SilentlyContinue
}

# -- launch detached, logging stdout/stderr to the harness --------------------
# A plain Start-Process child stays inside this tool invocation's Windows job
# object, so killing the caller would take the server with it, and the call
# itself would block for as long as the server runs. Win32_Process.Create goes
# through the WMI service instead: the server is re-parented outside the job,
# survives this script exiting, and is stoppable only by its own recorded PID.
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog  = Join-Path $LogDir "$stamp.out.log"
$errLog  = Join-Path $LogDir "$stamp.err.log"

$envPrefix = ($childEnv.GetEnumerator() | ForEach-Object { "set $($_.Key)=$($_.Value)" }) -join '&& '
$inner = '{0}&& "{1}" "{2}" --profile {3} --no-open --port {4} > "{5}" 2> "{6}"' -f `
    $envPrefix, $ExePath, $CliPath, $ProfileName, $Port, $outLog, $errLog
# cmd /c "..." needs one extra outer quote pair around the whole inner command.
$cmdLine = 'cmd.exe /c "' + $inner + '"'

Info "booting: dsh --profile $ProfileName --no-open --port $Port  (DSH_HOME=$HomeDir)"
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
if ($created.ReturnValue -ne 0) { Fail "Win32_Process.Create failed with $($created.ReturnValue)" }
$launchPid = [int]$created.ProcessId   # PID of cmd.exe; the server child is found below

# -- wait for the authenticated URL line -------------------------------------
$url = $null
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    if (Test-Path -LiteralPath $outLog) {
        $text = Get-Content -LiteralPath $outLog -Raw -ErrorAction SilentlyContinue
        if ($text) {
            $m = [regex]::Match($text, 'https?://[^\s"'']+\?token=[^\s"'']+')
            if ($m.Success) { $url = $m.Value; break }
        }
    }
}

if (-not $url) {
    $stderr = ''
    if (Test-Path -LiteralPath $errLog) { $stderr = (Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue) }
    $stdout = ''
    if (Test-Path -LiteralPath $outLog) { $stdout = (Get-Content -LiteralPath $outLog -Raw -ErrorAction SilentlyContinue) }
    Write-Host "--- stdout ---`n$stdout" -ForegroundColor Yellow
    Write-Host "--- stderr ---`n$stderr" -ForegroundColor Yellow
    Fail "instance did not print an authenticated URL within $ReadyTimeoutSeconds s (logs: $LogDir)"
}

# The listening socket belongs to the Electron node process, not to cmd.exe:
# resolve the real server PID by port so stop-test-instance.ps1 kills the right
# process and never a recycled cmd PID.
$serverPid = 0
$listen = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
          Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
if ($listen) { $serverPid = [int]$listen.OwningProcess }
if ($serverPid -eq 0) { $serverPid = $launchPid }

# -- record state for stop/capture -------------------------------------------
$payload = [ordered]@{
    pid         = $serverPid
    launcherPid = $launchPid
    port        = $Port
    url         = $url
    homeDir     = $HomeDir
    profile     = $ProfileName
    profileDir  = $ProfileDir
    pluginName  = $pluginName
    pluginPath  = $pluginResolved
    stdoutLog   = $outLog
    stderrLog   = $errLog
    startedAt   = (Get-Date).ToString('o')
}
Write-Utf8NoBom $StatePath ($payload | ConvertTo-Json -Depth 6)
Write-Utf8NoBom $UrlFile   ($url + "`n")
Write-Utf8NoBom $PidFile   ([string]$serverPid)
Write-Utf8NoBom $TmpUrlFile ($url + "`n")
Write-Utf8NoBom $TmpPidFile ([string]$serverPid)

Write-Host ''
Info "ready (PID $serverPid, port $Port)"
Info "plugin: $(if ($pluginName) { $pluginName } else { '(none - baseline GUI)' })"
Write-Host ''
Write-Host $url -ForegroundColor Green
Write-Host ''
Info "authenticated URL also written to:"
Write-Host "  $UrlFile"
Write-Host "  $TmpUrlFile"
