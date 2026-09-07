$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
foreach ($name in @('wiki-process.json', 'tunnel-process.json')) {
    $record = Join-Path $project "runtime\$name"
    if (-not (Test-Path -LiteralPath $record)) { continue }
    $saved = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
    $process = Get-Process -Id $saved.Id -ErrorAction SilentlyContinue
    if ($process -and ([datetime]$saved.StartTime).ToUniversalTime() -eq $process.StartTime.ToUniversalTime()) {
        Stop-Process -Id $process.Id
        Write-Output "Stopped owned process $($process.Id)"
    }
}
