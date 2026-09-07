param([int]$WikiPort = 5173)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $project 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

$wikiRecord = Join-Path $runtime 'wiki-process.json'
if (Test-Path -LiteralPath $wikiRecord) {
    $saved = Get-Content -LiteralPath $wikiRecord -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $saved.Id -ErrorAction SilentlyContinue
    if ($existing -and ([datetime]$saved.StartTime).ToUniversalTime() -eq $existing.StartTime.ToUniversalTime()) {
        $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $existing.Id | Select-Object -First 1
        if ($listener) {
            Write-Output "Existing Wiki: http://127.0.0.1:$($listener.LocalPort)/"
            Write-Output 'Answer: http://127.0.0.1:9080/; server preview: http://127.0.0.1:9081/'
            return
        }
    }
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort 9080 -ErrorAction SilentlyContinue)) {
    $tunnelArgs = @('-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-L', '127.0.0.1:9080:127.0.0.1:9080', '-L', '127.0.0.1:9081:127.0.0.1:9081', 'ubuntu@45.40.247.178')
    $tunnel = Start-Process -FilePath 'ssh.exe' -ArgumentList $tunnelArgs -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $runtime 'tunnel.err.log') -RedirectStandardOutput (Join-Path $runtime 'tunnel.out.log')
    $tunnel | Select-Object Id, StartTime | ConvertTo-Json | Out-File (Join-Path $runtime 'tunnel-process.json') -Encoding utf8
}
while (Get-NetTCPConnection -State Listen -LocalPort $WikiPort -ErrorAction SilentlyContinue) { $WikiPort++ }
$env:QA_ORIGIN = 'http://127.0.0.1:9080'
$env:WIKI_ORIGIN = "http://127.0.0.1:$WikiPort"
Push-Location $project
try {
    $env:PORT = $WikiPort
    $entry = Join-Path $project 'scripts\dev.mjs'
    $dev = Start-Process -FilePath 'node.exe' -ArgumentList @("`"$entry`"") -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $runtime 'wiki.err.log') -RedirectStandardOutput (Join-Path $runtime 'wiki.out.log')
    $dev | Select-Object Id, StartTime | ConvertTo-Json | Out-File (Join-Path $runtime 'wiki-process.json') -Encoding utf8
    Write-Output "Wiki: http://127.0.0.1:$WikiPort/"
    Write-Output 'Server preview: http://127.0.0.1:9081/'
} finally { Pop-Location }
