param([ValidateSet('linux', 'windows')][string]$TargetOS = 'linux')
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
    $source = Join-Path $project '.cache\answer_src_2_0_2'
    $patch = Join-Path $project 'patches\answer-username-login.patch'
    if ((git -C $source rev-parse HEAD).Trim() -ne '3b9f1370612e690a0b7f230f05e688930db4c6d3') { throw 'Unexpected Answer source revision' }
    git -C $source apply --reverse --check $patch 2>$null
    if ($LASTEXITCODE -ne 0) {
        git -C $source apply --check $patch
        if ($LASTEXITCODE -ne 0) { throw 'Source does not match the reviewed login patch' }
        git -C $source apply $patch
        if ($LASTEXITCODE -ne 0) { throw 'Unable to apply the login patch' }
    }
    $env:PATH = (Join-Path $project '.cache\go-toolchain\go\bin') + ';' + $env:PATH
    $env:ANSWER_MODULE = $source
    $env:GOOS = $TargetOS
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    $env:GOTOOLCHAIN = 'local'
    $archive = '.cache\answer\answer.tar.gz'
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '49cb4f87122cc8d55ab526fb428e0d24d5bfbe2c24259a480075108a35267227') { throw 'Unexpected Answer builder archive' }
    $suffix = if ($TargetOS -eq 'windows') { '.exe' } else { '' }
    $output = ".cache\answer-login-$TargetOS$suffix"
    & '.\.cache\answer\apache-answer-2.0.2-bin-windows-amd64\answer.exe' build --with 'github.com/apache/answer-plugins/reviewer-basic@27f129f9ef49d2e49b0fae20292ab36963cd016a' --output $output --build-dir ".cache\answer-login-build-$TargetOS"
    if ($LASTEXITCODE -ne 0) { throw 'Answer login build failed' }
    if ($TargetOS -eq 'linux') {
        New-Item -ItemType Directory -Path '.cache\answer-runtime-login' -Force | Out-Null
        Copy-Item -LiteralPath $output -Destination '.cache\answer-runtime-login\answer'
        Copy-Item -LiteralPath '.cache\answer-runtime-reviewer\ca-certificates.crt' -Destination '.cache\answer-runtime-login\ca-certificates.crt'
        Copy-Item -LiteralPath 'deploy\Dockerfile.answer-runtime' -Destination '.cache\answer-runtime-login\Dockerfile'
        tar -czf .cache/answer-runtime-login.tar.gz -C .cache/answer-runtime-login .
        if ($LASTEXITCODE -ne 0) { throw 'Unable to package the runtime image context' }
    }
    Get-FileHash $output -Algorithm SHA256 | Select-Object Algorithm,Hash,Path
} finally { Pop-Location }
