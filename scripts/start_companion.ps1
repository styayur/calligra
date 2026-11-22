$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $source 'apps/api/requirements-companion.txt'
$launcher = Join-Path $source 'apps/api/launch_companion.py'
$config = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash.Substring(0, 12)
$environment = Join-Path $source ".venv/companion-$config"
$python = Join-Path $environment 'Scripts/python.exe'
$installed = Join-Path $environment 'requirements-installed'

if (!(Test-Path -LiteralPath $python)) {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if (!$py) { throw 'Install Python 3.12 or 3.13 and the Windows Python launcher first.' }
    $version = '-3.12'
    & $py.Source $version -c 'import sys' 2>$null
    if ($LASTEXITCODE -ne 0) { $version = '-3.13' }
    & $py.Source $version -m venv $environment
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Companion environment. Check that Python 3.12 or 3.13 is installed.' }
}

if (!(Test-Path -LiteralPath $installed)) {
    & $python -I -m pip install --disable-pip-version-check -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Companion dependencies could not be installed. Re-run this script after checking the error above.' }
    New-Item -ItemType File -Path $installed | Out-Null
}

& $python -I $launcher @args
exit $LASTEXITCODE
