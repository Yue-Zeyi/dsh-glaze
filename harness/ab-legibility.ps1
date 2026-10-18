<#
.SYNOPSIS
    A/B test the skin's transparency defaults and capture one home screen per variant.

.DESCRIPTION
    For each variant this script:

      1. writes the `dsh-glaze` row config into the isolated home patch
         (<HomeDir>\cordis.patch.yml), which outranks the profile patch and
         therefore survives start-test-instance.ps1's rewrite of
         profiles\<profile>\cordis.patch.yml;
      2. restarts the disposable instance (only ever its own recorded PID);
      3. uploads the test wallpaper and captures a clean home screen;
      4. saves the shot as shots\ab-<label>-home.png.

    The result is a like-for-like comparison: same wallpaper, same home screen,
    same viewport -- only opacity / scrim / blur differ.

.PARAMETER Variants
    Ordered list of label=opacity/scrim/blur entries.

    Default:
        a-newdefaults=70/25/14
        b-showwallpaper=45/15/10
        c-current=55/35/18

.PARAMETER HomeDir
    Isolated DSH_HOME used by start-test-instance.ps1.

.EXAMPLE
    .\ab-legibility.ps1

.EXAMPLE
    .\ab-legibility.ps1 -Variants "d-flat=60/10/6","e-bright=80/45/24"
#>
[CmdletBinding()]
param(
    [string[]]$Variants = @(
        'a-newdefaults=70/25/14',
        'b-showwallpaper=45/15/10',
        'c-current=55/35/18'
    ),
    [string]$HomeDir = (Join-Path $env:TEMP 'dsh-glaze-harness\home'),
    [string]$ProfileName = 'skin-test',
    [string]$PluginPath = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-glaze\plugin',
    [int]$Port = 59821,
    [string]$PlaywrightRoot = 'C:\Users\Administrator\.dsh\profiles\desktop\node_modules'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$HarnessDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ShotsDir   = Join-Path $HarnessDir 'shots'
$StartScript = Join-Path $HarnessDir 'start-test-instance.ps1'
$StopScript  = Join-Path $HarnessDir 'stop-test-instance.ps1'
$CaptureScript = Join-Path $HarnessDir 'capture.ps1'
$HomePatch  = Join-Path $HomeDir 'cordis.patch.yml'

foreach ($f in @($StartScript, $StopScript, $CaptureScript)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "missing harness script: $f" }
}
if (-not (Test-Path -LiteralPath $ShotsDir)) { New-Item -ItemType Directory -Force -Path $ShotsDir | Out-Null }

function Info([string]$Message) { Write-Host "ab-legibility: $Message" -ForegroundColor Cyan }
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# Parse "label=opacity/scrim/blur".
$plan = @()
foreach ($v in $Variants) {
    $m = [regex]::Match($v.Trim(), '^(?<label>[A-Za-z0-9._-]+)=(?<op>\d+)/(?<sc>\d+)/(?<bl>\d+)$')
    if (-not $m.Success) { throw "variant '$v' must look like label=opacity/scrim/blur (e.g. a-new=70/25/14)" }
    $plan += [pscustomobject]@{
        Label   = $m.Groups['label'].Value
        Opacity = [int]$m.Groups['op'].Value
        Scrim   = [int]$m.Groups['sc'].Value
        Blur    = [int]$m.Groups['bl'].Value
    }
}
if ($plan.Count -eq 0) { throw "no variants supplied" }

# The home patch also carries the harness-only Settings unlock; keep it. The
# pristine form is restored after the sweep so a leftover dsh-glaze row cannot
# block the Settings page's writes in later runs.
$pristineHomePatch = @'
# Test-harness only: unlock Settings (the GUI gates it behind sign-in / API key).
# NOTE: do NOT configure a plugin entry here that the Settings page must write -
# the home overlay outranks the profile patch, and the Host REFUSES a form write
# that the home overlay would immediately override.
- id: ui-settings-models
  disabled: true
'@

$homePatchTemplate = $pristineHomePatch + @'

# A/B legibility variant: #VARIANT#
# A patch replaces the targeted row's whole config, so every key is restated.
- id: dsh-glaze
  config:
    enabled: true
    opacity: #OPACITY#
    blur: #BLUR#
    scrim: #SCRIM#
    dim: 0
    fit: cover
    position: center
    surfaces: all
'@

$results = @()
foreach ($variant in $plan) {
    Info "=== variant $($variant.Label): opacity=$($variant.Opacity) scrim=$($variant.Scrim) blur=$($variant.Blur) ==="

    $patch = $homePatchTemplate.
        Replace('#VARIANT#', $variant.Label).
        Replace('#OPACITY#', [string]$variant.Opacity).
        Replace('#SCRIM#', [string]$variant.Scrim).
        Replace('#BLUR#', [string]$variant.Blur)
    Write-Utf8NoBom $HomePatch $patch
    Info "wrote $HomePatch"

    # Restart so the plugin's Config picks up the new values from composition.
    & powershell -NoProfile -ExecutionPolicy Bypass -File $StopScript | Out-Null
    $startOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $StartScript `
        -PluginPath $PluginPath -Port $Port -ProfileName $ProfileName 2>&1 | Out-String
    if ($startOut -notmatch '\?token=') {
        Write-Host $startOut -ForegroundColor Yellow
        throw "variant $($variant.Label): instance failed to start"
    }
    Info "instance up"

    $capOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $CaptureScript `
        -Steps wallpaper -Name "ab-$($variant.Label)" -PlaywrightRoot $PlaywrightRoot 2>&1 | Out-String
    $capExit = $LASTEXITCODE
    if ($capOut -match 'dsh-glaze specific problems') {
        Write-Host $capOut -ForegroundColor Yellow
        throw "variant $($variant.Label): dsh-glaze problems during capture"
    }
    if ($capExit -ne 0) {
        Write-Host $capOut -ForegroundColor Yellow
        throw "variant $($variant.Label): capture failed (exit $capExit)"
    }

    # ab-<label>-05-home-wallpaper-esc.png is the clean home screen.
    $clean = Join-Path $ShotsDir "ab-$($variant.Label)-05-home-wallpaper-esc.png"
    $target = Join-Path $ShotsDir "ab-$($variant.Label)-home.png"
    if (Test-Path -LiteralPath $clean) {
        Copy-Item -LiteralPath $clean -Destination $target -Force
        Info "shot: $target"
    }
    else {
        Info "WARNING: expected shot missing: $clean"
    }

    $results += [pscustomobject]@{
        Label   = $variant.Label
        Opacity = $variant.Opacity
        Scrim   = $variant.Scrim
        Blur    = $variant.Blur
        Shot    = $target
    }
}

Write-Host ''
Info "=== summary ==="
$results | Format-Table -AutoSize

Write-Utf8NoBom (Join-Path $ShotsDir 'ab-summary.json') ($results | ConvertTo-Json -Depth 4)
Info "wrote $(Join-Path $ShotsDir 'ab-summary.json')"

# Restore the pristine home patch. Leaving a dsh-glaze row in the HOME overlay
# would outrank the profile patch and make the Settings page refuse every write
# ("save failed"), which is a trap for whoever uses the harness next.
Write-Utf8NoBom $HomePatch $pristineHomePatch
Info "restored the home patch to the Settings-unlock-only form"

Info "instance left RUNNING with the last variant ($($plan[-1].Label)); run stop-test-instance.ps1 to shut it down"
