$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
    $cachedGo = Join-Path $project '.cache\go-toolchain\go\bin'
    if (Test-Path -LiteralPath $cachedGo) { $env:PATH = "$cachedGo;$env:PATH" }
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw 'Go 1.25.x is required to build the pinned Answer plugin.' }
    $archive = '.cache\answer\answer.tar.gz'
    New-Item -ItemType Directory -Path '.cache\answer' -Force | Out-Null
    if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri 'https://github.com/apache/answer/releases/download/v2.0.2/apache-answer-2.0.2-bin-windows-amd64.tar.gz' -OutFile $archive }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '49cb4f87122cc8d55ab526fb428e0d24d5bfbe2c24259a480075108a35267227') { throw 'Answer binary checksum mismatch' }
    tar -xzf $archive -C '.cache\answer'
    $env:GOOS = 'linux'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    & '.\.cache\answer\apache-answer-2.0.2-bin-windows-amd64\answer.exe' build --with 'github.com/apache/answer-plugins/reviewer-basic@27f129f9ef49d2e49b0fae20292ab36963cd016a' --output '.cache\answer-moderated' --build-dir '.cache\answer-plugin-build'
    if ($LASTEXITCODE -ne 0) { throw 'Answer plugin build failed' }
    New-Item -ItemType Directory -Path '.cache\answer-runtime-reviewer' -Force | Out-Null
    Copy-Item -LiteralPath '.cache\answer-moderated' -Destination '.cache\answer-runtime-reviewer\answer'
    Invoke-WebRequest -Uri 'https://curl.se/ca/cacert.pem' -OutFile '.cache\answer-runtime-reviewer\ca-certificates.crt'
    docker build --pull=false -f deploy/Dockerfile.answer-runtime -t feiyang/answer-runtime:2.0.2-reviewer .cache/answer-runtime-reviewer
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
} finally { Pop-Location }
