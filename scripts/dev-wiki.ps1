$ErrorActionPreference = 'Stop'
$env:NO_MKDOCS_2_WARNING = '1'
if (-not $env:BBS_URL) { $env:BBS_URL = 'http://127.0.0.1:8080/' }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Test-Path '.venv/Scripts/python.exe')) {
        py -3.12 -m venv .venv
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & '.venv/Scripts/python.exe' -m pip --disable-pip-version-check install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & '.venv/Scripts/python.exe' -m mkdocs serve -a 127.0.0.1:8000
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
