param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$requirements = Join-Path $root "requirements.txt"
$runPy = Join-Path $root "run.py"

function Test-PortListening {
    param([int]$Port)

    try {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
        return $null -ne $listener
    } catch {
        return $false
    }
}

function Ensure-Venv {
    if (Test-Path $venvPython) {
        return
    }

    python -m venv (Join-Path $root ".venv")
    & $venvPython -m pip install -q -r $requirements
}

if ((Test-PortListening -Port 8200) -or (Test-PortListening -Port 8300)) {
    Write-Output "agentchattr already running"
    exit 0
}

if ($CheckOnly) {
    Write-Output "agentchattr not running"
    exit 1
}

Ensure-Venv

Start-Process -FilePath $venvPython `
    -ArgumentList $runPy `
    -WorkingDirectory $root `
    -WindowStyle Hidden

Start-Sleep -Seconds 3

if ((Test-PortListening -Port 8200) -and (Test-PortListening -Port 8300)) {
    Write-Output "agentchattr started"
    exit 0
}

Write-Error "agentchattr did not start cleanly"
