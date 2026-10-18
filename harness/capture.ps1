<#
.SYNOPSIS
    Capture screenshots + page-state JSON from the running disposable DSH Web instance.

.DESCRIPTION
    Drives a real Chromium (via the Playwright copy already present in the DSH
    desktop profile's node_modules -- nothing is installed) against the
    authenticated URL recorded by start-test-instance.ps1, then writes:

        shots\<Name>-01-home.png             home / chat screen
        shots\<Name>-02-settings.png         Settings dialog
        shots\<Name>-03-settings-skin.png    Settings -> Skin page
        shots\<Name>-04-home-wallpaper.png   home screen with the wallpaper set
        shots\<Name>-05-home-wallpaper-esc.png  same, after closing Settings
        shots\<Name>-state.json              DOM/plugin state dump
        shots\console-<Name>.log             console + page errors + failed requests

    Browser problems are captured as text, so a plugin bug that is invisible in
    a picture still shows up: console.*, uncaught pageerror, requestfailed, and
    every non-2xx response (dsh-glaze ones are promoted to hard failures).

.PARAMETER Steps
    Comma-separated subset of: home,settings,wallpaper,all. Default: all.

.PARAMETER Name
    Screenshot / log prefix. Default 'skin'.

.PARAMETER WallpaperPath
    Image uploaded for the 'wallpaper' step. Default: a generated gradient PNG
    under shots\fixtures\.

.PARAMETER Url
    Override the recorded authenticated URL.

.PARAMETER Headless
    Headless by default; pass -Headless:$false to watch the run.

.PARAMETER Viewport
    WxH. Default 1440x900.

.PARAMETER BrowserChannel
    Playwright browser channel. The Playwright copy bundled in the DSH desktop
    profile ships no browser download, so an installed Chrome ('chrome',
    default) or Edge ('msedge') is used. Pass 'bundled' to force Playwright's
    own Chromium when it is installed.

.EXAMPLE
    .\capture.ps1

.EXAMPLE
    .\capture.ps1 -Steps home,settings -Name baseline
#>
[CmdletBinding()]
param(
    [string]$Steps = 'all',
    [string]$Name = 'skin',
    [string]$WallpaperPath = '',
    [string]$Url = '',
    [switch]$Headless = $true,
    [string]$Viewport = '1440x900',
    [string]$BrowserChannel = 'chrome',
    [int]$SettleMs = 900,
    [int]$TuneOpacity = 12,
    [int]$TuneRangeIndex = 0,
    [string]$PlaywrightRoot = 'C:\Users\Administrator\.dsh\profiles\desktop\node_modules'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$HarnessDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir   = Join-Path $HarnessDir 'state'
$ShotsDir   = Join-Path $HarnessDir 'shots'
$LibDir     = Join-Path $HarnessDir 'lib'
$UrlFile    = Join-Path $StateDir 'url.txt'
$TmpUrlFile = Join-Path $env:TEMP 'dsh-glaze-test-url.txt'
foreach ($d in @($StateDir, $ShotsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

function Info([string]$Message) { Write-Host "capture: $Message" -ForegroundColor Cyan }
function Fail([string]$Message) { Write-Host "capture: ERROR: $Message" -ForegroundColor Red; exit 1 }

# -- authenticated URL --------------------------------------------------------
if (-not $Url) {
    foreach ($f in @($UrlFile, $TmpUrlFile)) {
        if (Test-Path -LiteralPath $f) {
            $candidate = (Get-Content -LiteralPath $f -Raw).Trim()
            if ($candidate) { $Url = $candidate; break }
        }
    }
}
if (-not $Url) { Fail "no authenticated URL recorded; run .\start-test-instance.ps1 first" }
if ($Url -notmatch '\?token=') { Fail "recorded URL has no token: $Url" }

$portMatch = [regex]::Match($Url, ':(\d+)/')
$port = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 59821 }
$origin = "http://127.0.0.1:$port"
Info "target $origin (token from state)"

# -- driver present ----------------------------------------------------------
$driverPath = Join-Path $LibDir 'capture-driver.cjs'
if (-not (Test-Path -LiteralPath $driverPath)) { Fail "missing driver: $driverPath" }
if (-not (Test-Path -LiteralPath (Join-Path $PlaywrightRoot 'playwright-core'))) {
    Fail "playwright-core not found under $PlaywrightRoot (needed to drive Chromium)"
}

# -- wallpaper fixture -------------------------------------------------------
if ($WallpaperPath -eq '') {
    $fixtureDir = Join-Path $ShotsDir 'fixtures'
    if (-not (Test-Path $fixtureDir)) { New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null }
    $WallpaperPath = Join-Path $fixtureDir 'test-wallpaper.png'
    if (-not (Test-Path -LiteralPath $WallpaperPath)) {
        Info "generating test wallpaper $WallpaperPath"
        $gen = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class DshGlazeWallpaper {
    public static void Make(string path, int w, int h) {
        using (var bmp = new Bitmap(w, h))
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, w, h);
            using (var lin = new LinearGradientBrush(rect, Color.FromArgb(255, 24, 30, 74), Color.FromArgb(255, 240, 86, 140), 45f))
                g.FillRectangle(lin, rect);
            using (var b = new SolidBrush(Color.FromArgb(120, 40, 200, 220)))
                g.FillEllipse(b, (int)(w * 0.05), (int)(h * 0.12), (int)(w * 0.42), (int)(h * 0.42));
            using (var b = new SolidBrush(Color.FromArgb(110, 250, 190, 90)))
                g.FillEllipse(b, (int)(w * 0.55), (int)(h * 0.45), (int)(w * 0.38), (int)(h * 0.38));
            using (var b = new SolidBrush(Color.FromArgb(90, 20, 15, 40)))
                g.FillEllipse(b, (int)(w * 0.30), (int)(h * 0.58), (int)(w * 0.40), (int)(h * 0.40));
            using (var f = new Font("Segoe UI", Math.Max(28f, h / 14f), FontStyle.Bold, GraphicsUnit.Pixel))
            using (var tb = new SolidBrush(Color.FromArgb(235, 255, 255, 255))) {
                var text = "DSH SKIN TEST";
                var size = g.MeasureString(text, f);
                float y = (h - size.Height) / 2f;
                using (var band = new SolidBrush(Color.FromArgb(60, 0, 0, 0)))
                    g.FillRectangle(band, 40, (int)y - 18, w - 80, (int)size.Height + 36);
                g.DrawString(text, f, tb, (w - size.Width) / 2f, y);
            }
            bmp.Save(path, ImageFormat.Png);
        }
    }
}
'@
        try {
            Add-Type -TypeDefinition $gen -ReferencedAssemblies System.Drawing
            [DshGlazeWallpaper]::Make($WallpaperPath, 1920, 1080)
        }
        catch {
            Info "System.Drawing unavailable; writing a small solid-colour PNG instead"
            $b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4jWNgYGD4z0AswK4bRjEwMDAwMDAwMDAwMDAwMDAwMDAwAAB2eAP9cQ0mQwAAAABJRU5ErkJggg=='
            [System.IO.File]::WriteAllBytes($WallpaperPath, [Convert]::FromBase64String($b64))
        }
    }
}
if (-not (Test-Path -LiteralPath $WallpaperPath)) { Fail "could not create the test wallpaper" }

# -- build the job -----------------------------------------------------------
$stepList = @()
foreach ($s in ($Steps -split ',')) {
    $t = $s.Trim().ToLowerInvariant()
    if ($t -eq '' -or $t -eq 'all') { $stepList += @('home', 'settings', 'wallpaper', 'tune', 'scroll'); continue }
    if (@('home', 'settings', 'wallpaper', 'tune', 'scroll') -notcontains $t) {
        Fail "unknown step '$t' (expected home, settings, wallpaper, tune, scroll, all)"
    }
    $stepList += $t
}
$stepList = @($stepList | Select-Object -Unique)

$vp = $Viewport -split 'x'
if ($vp.Count -ne 2) { Fail "viewport must look like 1440x900" }

$consoleLog = Join-Path $ShotsDir "console-$Name.log"
$jobObj = [ordered]@{
    url            = $Url
    origin         = $origin
    name           = $Name
    steps          = $stepList
    shotsDir       = (Resolve-Path -LiteralPath $ShotsDir).Path
    wallpaperPath  = (Resolve-Path -LiteralPath $WallpaperPath).Path
    consoleLog     = $consoleLog
    headless       = [bool]$Headless
    settleMs       = $SettleMs
    viewport       = [ordered]@{ width = [int]$vp[0]; height = [int]$vp[1] }
    playwrightRoot = (Resolve-Path -LiteralPath $PlaywrightRoot).Path
    browserChannel = $(if ($BrowserChannel -eq 'bundled' -or $BrowserChannel -eq '') { $null } else { $BrowserChannel })
    tuneOpacity    = $TuneOpacity
    tuneRangeIndex = $TuneRangeIndex
}
# Windows PowerShell 5.1 mangles quotes when passing a JSON string as a native
# program argument, so the job travels through a file instead.
$jobFile = Join-Path $StateDir 'capture-job.json'
[System.IO.File]::WriteAllText(
    $jobFile,
    ($jobObj | ConvertTo-Json -Depth 6),
    (New-Object System.Text.UTF8Encoding($false))
)

Info ("steps: " + ($stepList -join ', '))
$nodeOut = & node $driverPath $jobFile 2>&1 | Out-String
Write-Host $nodeOut

# -- parse the driver envelope ----------------------------------------------
$resultJson = $null
$m = [regex]::Match($nodeOut, '__RESULT__(\{.*\})', 'Singleline')
if ($m.Success) { $resultJson = $m.Groups[1].Value }
else {
    $fm = [regex]::Match($nodeOut, '__FATAL__(\{.*\})', 'Singleline')
    if ($fm.Success) { Fail ("browser driver failed: " + $fm.Groups[1].Value) }
    Fail "browser driver produced no result (see $consoleLog)"
}

$result = $resultJson | ConvertFrom-Json
Write-Host ''
Info ("screenshots in " + (Resolve-Path -LiteralPath $ShotsDir).Path)
foreach ($step in $result.steps) {
    if (($step.PSObject.Properties.Name -contains 'file') -and $step.file) { Write-Host "  $($step.file)" }
}
Write-Host "  state:   $(Join-Path $ShotsDir "$Name-state.json")"
Write-Host "  console: $consoleLog"

# -- surface problems loudly -------------------------------------------------
$errors = @($result.errors)
if ($errors.Count -gt 0) {
    Write-Host ''
    Write-Host "capture: $($errors.Count) browser problem(s) recorded:" -ForegroundColor Yellow
    $errors | Select-Object -First 25 | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}

$skinProblems = @($errors | Where-Object { $_ -like '*dsh-glaze*' })
if ($skinProblems.Count -gt 0) {
    Write-Host ''
    Write-Host "capture: dsh-glaze specific problems:" -ForegroundColor Red
    $skinProblems | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 2
}
exit 0
