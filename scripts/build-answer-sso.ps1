# build-answer-sso.ps1 — 在队友原有 login 补丁构建基础上，加编官方 connector-basic 插件
# 产出与线上同代（2.0.2 / revision 3b9f137）的 Linux 二进制，供影子验证后替换镜像。
#
# 与 build-answer-login.ps1 的唯一差别：--with 多一个 connector-basic@e462a881441a
# （该提交含 "fix: preserve oauth state and verify emails"，与 2.0.2 同期）。
# 不修改任何 Answer Go 源码；username-login patch 照旧应用。
param([ValidateSet('linux', 'windows')][string]$TargetOS = 'linux')
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
    $source = Join-Path $project '.cache\answer_src_2_0_2'
    $patch = Join-Path $project 'patches\answer-username-login.patch'
    if ((git -C $source rev-parse HEAD).Trim() -ne '3b9f1370612e690a0b7f230f05e688930db4c6d3') {
        throw 'Unexpected Answer source revision'
    }
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
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '49cb4f87122cc8d55ab526fb428e0d24d5bfbe2c24259a480075108a35267227') {
        throw 'Unexpected Answer builder archive'
    }
    $suffix = if ($TargetOS -eq 'windows') { '.exe' } else { '' }
    $output = ".cache\answer-sso-$TargetOS$suffix"
    $builder = '.\.cache\answer\apache-answer-2.0.2-bin-windows-amd64\answer.exe'
    & $builder build `
        --with 'github.com/apache/answer-plugins/reviewer-basic@27f129f9ef49d2e49b0fae20292ab36963cd016a' `
        --with 'github.com/apache/answer-plugins/connector-basic@e462a881441a' `
        --output $output --build-dir ".cache\answer-sso-build-$TargetOS"
    if ($LASTEXITCODE -ne 0) { throw 'Answer SSO build failed' }

    # 插件必须真实编入，否则后面全部白做
    $plugins = & $output plugin
    if ($plugins -notmatch 'basic_reviewer' -or $plugins -notmatch 'basic_connector|connector-basic') {
        throw "Required plugins missing from binary: $plugins"
    }
    Write-Host "Plugins: $plugins"

    if ($TargetOS -eq 'linux') {
        $dir = '.cache\answer-runtime-sso'
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Copy-Item -LiteralPath $output -Destination "$dir\answer"
        Copy-Item -LiteralPath '.cache\answer-runtime-reviewer\ca-certificates.crt' -Destination "$dir\ca-certificates.crt"
        Copy-Item -LiteralPath 'deploy\Dockerfile.answer-runtime' -Destination "$dir\Dockerfile"
        tar -czf .cache/answer-runtime-sso.tar.gz -C $dir .
        if ($LASTEXITCODE -ne 0) { throw 'Unable to package runtime image context' }
    }
    Get-FileHash $output -Algorithm SHA256 | Select-Object Algorithm, Hash, Path
} finally { Pop-Location }
