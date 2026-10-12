param([string]$Page = '')
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $taskProject '.desktop'
try {
    New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    $taskScript = Join-Path $PSScriptRoot 'desktop.mjs'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskScript + '"'), ('--page=' + $Page)) -WorkingDirectory $taskProject -WindowStyle Hidden -PassThru
    $taskDeadline = (Get-Date).AddSeconds(90)
    do {
        try {
            $taskStatus = Invoke-WebRequest -Uri 'http://127.0.0.1:4180/__free_kick_lab_desktop__' -UseBasicParsing -TimeoutSec 1
            if ($taskStatus.Content -eq 'FREE KICK LAB desktop') { exit 0 }
        } catch {}
        if ($taskProcess.HasExited) { throw 'Launcher stopped before the game was ready.' }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $taskDeadline)
    throw 'Game startup timed out.'
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Could not open FREE KICK LAB. Check Node.js, run npm ci, and see .desktop/launcher-error.log in the project folder.", 'FREE KICK LAB') | Out-Null
    exit 1
}
