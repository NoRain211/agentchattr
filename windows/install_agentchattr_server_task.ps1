param(
    [string]$EntryName = "AgentChattrServer"
)

$ErrorActionPreference = "Stop"

$launcher = (Resolve-Path (Join-Path $PSScriptRoot "run_server_hidden.ps1")).Path
$pwsh = (Get-Command pwsh).Source
$command = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name $EntryName -Value $command

Start-Process -FilePath $pwsh `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $launcher `
    -WindowStyle Hidden

Write-Output "Installed startup entry '$EntryName' and launched agentchattr."
