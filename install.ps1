# Thin wrapper: all logic is in install.js so it stays identical across OSes.
$ErrorActionPreference = 'Stop'
$js = Join-Path $PSScriptRoot 'install.js'
& node $js @args
exit $LASTEXITCODE
