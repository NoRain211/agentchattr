param()

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\AgentChattr"

New-Item -ItemType Directory -Path $startMenu -Force | Out-Null

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    @{
        Name = "AgentChattr Claude"
        Target = Join-Path $root "windows\start_claude_skip-permissions.bat"
    },
    @{
        Name = "AgentChattr Codex"
        Target = Join-Path $root "windows\start_codex_bypass.bat"
    },
    @{
        Name = "AgentChattr Chat UI"
        Target = "http://127.0.0.1:8300"
    }
)

foreach ($item in $targets) {
    foreach ($folder in @($desktop, $startMenu)) {
        $shortcutPath = Join-Path $folder ($item.Name + ".lnk")
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $item.Target
        if ($item.Target -like "*.bat") {
            $shortcut.WorkingDirectory = $root
            $shortcut.WindowStyle = 7
        }
        $shortcut.Save()
    }
}

Write-Output "Installed AgentChattr shortcuts on Desktop and Start Menu."
