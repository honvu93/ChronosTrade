param(
    [ValidateSet('all', 'persist', 'stress')]
    [string]$Scope = 'all',
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Invoke-Step {
    param(
        [string]$Label,
        [string[]]$Command
    )

    Write-Host "==> $Label"
    Write-Host ("    " + ($Command -join ' '))
    if (-not $DryRun) {
        & $Command[0] $Command[1..($Command.Length - 1)]
        if ($LASTEXITCODE -ne 0) {
            throw "Step failed: $Label"
        }
    }
}

$persistDir = '.artifacts/xau-abc-protected-review'
$stressDir = '.artifacts/xau-abc-m5-stress'

$persistSteps = @(
    @{
        Label = 'Persist M5 ATR 1.2 review candidate'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/persistXauAsianBreakProtectedReviewVariants.ts', '--group', 'm5_atr12', '--out', "$persistDir/m5_atr12.json")
    },
    @{
        Label = 'Persist M5 ATR 1.4 review candidate'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/persistXauAsianBreakProtectedReviewVariants.ts', '--group', 'm5_atr14', '--out', "$persistDir/m5_atr14.json")
    },
    @{
        Label = 'Persist M15 ATR 1.4 review candidate'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/persistXauAsianBreakProtectedReviewVariants.ts', '--group', 'm15_atr14', '--out', "$persistDir/m15_atr14.json")
    },
    @{
        Label = 'Render protected review markdown'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/renderXauAsianBreakProtectedReviewPersistReport.ts', '--inputs', "$persistDir/m5_atr12.json", "$persistDir/m5_atr14.json", "$persistDir/m15_atr14.json", '--out', "$persistDir/xau-abc-protected-review.md")
    }
)

$stressSteps = @(
    @{
        Label = 'Run M5 ATR 1.2 stress ladder'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/runXauAsianBreakM5StressMatrix.ts', '--group', 'm5_atr12', '--out', "$stressDir/m5_atr12.json")
    },
    @{
        Label = 'Run M5 ATR 1.4 stress ladder'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/runXauAsianBreakM5StressMatrix.ts', '--group', 'm5_atr14', '--out', "$stressDir/m5_atr14.json")
    },
    @{
        Label = 'Render M5 stress markdown'
        Command = @('node', '-r', 'ts-node/register', 'src/scripts/renderXauAsianBreakM5StressReport.ts', '--inputs', "$stressDir/m5_atr12.json", "$stressDir/m5_atr14.json", '--out', "$stressDir/xau-abc-m5-stress.md")
    }
)

if ($Scope -in @('all', 'persist')) {
    foreach ($step in $persistSteps) {
        Invoke-Step -Label $step.Label -Command $step.Command
    }
}

if ($Scope -in @('all', 'stress')) {
    foreach ($step in $stressSteps) {
        Invoke-Step -Label $step.Label -Command $step.Command
    }
}

Write-Host '==> Completed requested XAU phase 2 packages.'
